/**
 * `promise.ts` — the roblox-ts Promise (evaera's `roblox-lua-promise` v4),
 * rebuilt on the browser's own async primitives.
 *
 * roblox-ts does not compile to the native JS Promise. Every roblox-ts project
 * gets `Promise.lua` bundled into its output, and app code talks to *that*
 * object: colon-methods (`:andThen`, `:catch`, `:finally`, `:cancel`,
 * `:expect`, `:await`) and statics the native constructor has never heard of
 * (`Promise.new`, `Promise.delay`, `Promise.some`, `Promise.retry`,
 * `Promise.fromEvent`). A data panel that fetches on mount dies on its very
 * first line under the browser's built-in Promise — `andThen is not a
 * function` — so this file exists to make that line work.
 *
 * Three things about the port are worth knowing before reading the code:
 *
 * 1. **Handlers run synchronously.** evaera resolves a promise by calling its
 *    queued callbacks right there in `_resolve`, and `andThen` on an
 *    already-settled promise calls the handler before it returns. Native JS
 *    always defers to a microtask instead. We copy Roblox, not JS: an app whose
 *    render order depends on a handler having already run behaves in the
 *    preview the way it behaves in the engine. `await` on one of these is still
 *    properly deferred, because that is the JS engine's doing, not ours.
 *
 * 2. **A promise settles to one of four states, not two.** `Cancelled` is a
 *    real, distinct outcome: a cancelled promise is neither resolved nor
 *    rejected, its `andThen` handlers never run, and its `finally` handlers do.
 *    Cancellation travels *down* to consumers and *up* to a parent that has no
 *    other consumer left — that upward hop is why `promise:cancel()` in Roblox
 *    actually aborts the work instead of just ignoring its result.
 *
 * 3. **The yielding methods cannot yield.** `:await()`, `:awaitStatus()` and
 *    `:expect()` block the calling Luau thread and return a LuaTuple. A browser
 *    tab has one thread and blocking it freezes the preview, so each of them
 *    returns a *native* Promise of the same tuple instead. Every one of the
 *    three is marked with the same warning where it is defined.
 *
 * The class is `LoomPromise` here and is exported as `RobloxPromise` so that
 * nothing in this file — or any file that imports it — accidentally shadows the
 * real `Promise`. `installGlobals` in `index.ts` is what puts it on
 * `globalThis.Promise` for app code.
 */

/**
 * The real `Promise`, captured before `installGlobals` can put ours on the
 * global. The three yielding methods below hand out native promises, and
 * looking `Promise` up by name at call time would hand out *ours* instead —
 * an infinite regress that only shows up once a preview app is running.
 */
const NativePromise = globalThis.Promise;

/** Every member of `Promise.Status`, in the order Roblox declares them. */
export const PromiseStatus = {
	/** The Promise is executing, and not settled yet. */
	Started: "Started",
	/** The Promise finished successfully. */
	Resolved: "Resolved",
	/** The Promise was rejected. */
	Rejected: "Rejected",
	/** The Promise was cancelled before it finished. */
	Cancelled: "Cancelled",
} as const;

/** `Promise.Status` — the fate of a promise. */
export type PromiseStatus = (typeof PromiseStatus)[keyof typeof PromiseStatus];

/** `Promise.Error.Kind` — why the library itself rejected something. */
export type PromiseErrorKind =
	| "ExecutionError"
	| "AlreadyCancelled"
	| "NotResolvedInTime"
	| "TimedOut";

/** The options bag `Promise.Error.new` takes. */
export interface PromiseErrorOptions {
	/** The underlying error. Stringified, exactly as Roblox does. */
	error?: unknown;
	/** Where the error was raised. */
	trace?: string;
	/** Human-readable "and here is how we got here" text. */
	context?: string;
	/** Which library-level failure this is, if any. */
	kind?: PromiseErrorKind;
}

/**
 * Anything with a Roblox-shaped `Connect` — what `Promise.fromEvent` accepts.
 *
 * Deliberately structural rather than `LoomSignal`: Roblox's own docs promise
 * that `fromEvent` works with "any object with a Connect method", and app code
 * hands it hand-rolled signal classes as often as it hands it real events.
 */
export interface PromiseEvent {
	Connect(callback: (...args: unknown[]) => void): { Disconnect(): void };
}

/**
 * The unhandled-rejection callback shape.
 *
 * Roblox calls it as `callback(promise, ...rejectionValues)`, and the roblox-ts
 * typings turn that leading argument into a `this` parameter — so we invoke it
 * with the promise as `this` and the rejection value as the first argument,
 * which is what the TS source was written against either way.
 */
export type UnhandledRejectionHandler = (
	this: LoomPromise<unknown>,
	...values: unknown[]
) => void;

/** The executor `Promise.new` takes. */
export type PromiseExecutor<T> = (
	resolve: (value: T | LoomPromise<T> | PromiseLike<T>) => void,
	reject: (reason?: unknown) => void,
	onCancel: (abortHandler?: () => void) => boolean,
) => void;

const ERROR_NON_LIST = (name: string) =>
	`Please pass a list of promises to ${name}`;
const ERROR_NON_PROMISE_IN_LIST = (name: string, index: number) =>
	`Non-promise value passed into ${name} at index ${index}`;
const ERROR_NON_FUNCTION = (name: string) =>
	`Please pass a handler function to ${name}!`;

/** `wait()`'s floor, which `Promise.delay` inherits. */
const MINIMUM_DELAY = 1 / 60;

/** Registered `Promise.onUnhandledRejection` callbacks, in registration order. */
const unhandledRejectionCallbacks: UnhandledRejectionHandler[] = [];

/** Drop the first occurrence of `item`. Used to unqueue cancelled handlers. */
function removeFrom<T>(list: T[], item: T): void {
	const index = list.indexOf(item);
	if (index >= 0) list.splice(index, 1);
}

/**
 * Roblox validates a combinator's argument list eagerly so that passing a
 * non-promise throws at the call site, where the stack still points at the
 * mistake, rather than surfacing later as a mystery rejection.
 *
 * Takes `unknown` on purpose: an `Array.isArray` guard applied to the caller's
 * own `readonly LoomPromise<T>[]` would narrow it to `any[]` and quietly erase
 * the element type for the rest of the function.
 */
function assertPromiseList(name: string, promises: unknown): void {
	if (!Array.isArray(promises)) throw new Error(ERROR_NON_LIST(name));
	for (const [index, promise] of promises.entries()) {
		if (!LoomPromise.is(promise) && !isThenable(promise)) {
			throw new Error(ERROR_NON_PROMISE_IN_LIST(name, index));
		}
	}
}

/**
 * Adopt whatever the list holds into loom promises.
 *
 * Accepting a foreign thenable at all is a deliberate widening of Roblox's
 * rule, which admits only its own promises: loom runs in a browser, where half
 * the interesting work (`fetch`, decoding an image, a dynamic `import`) hands
 * back a NATIVE promise. Combining one of those with `Promise.all` is the
 * obvious thing for preview code to write, and erroring on it would be pedantry
 * rather than fidelity. A plain non-thenable value is still rejected by
 * {@link assertPromiseList}, exactly as Roblox does, so the classic
 * `Promise.all(1, 2)` mistake is still caught at the call site.
 */
function asPromiseList(promises: readonly unknown[]): LoomPromise<unknown>[] {
	return promises.map((promise) =>
		LoomPromise.is(promise)
			? (promise as LoomPromise<unknown>)
			: LoomPromise.resolve(promise),
	);
}

/** As {@link assertPromiseList}, for the lists that may hold plain values. */
function assertList(message: string, list: unknown): void {
	if (!Array.isArray(list)) throw new Error(message);
}

/** Best-effort stack text for a thrown value (used to fill `Error.trace`). */
function stackOf(err: unknown): string | undefined {
	if (err instanceof Error) return err.stack ?? undefined;
	return new Error(String(err)).stack ?? undefined;
}

/**
 * `Promise.Error` — the object the library rejects with when the failure is its
 * own doing (an executor that threw, a `:timeout()` that expired, an
 * `:andThen` on a cancelled promise).
 *
 * App code checks these with `Promise.Error.isKind(err, ...)`, so the `kind`
 * strings and the `is`/`isKind` duck-typing have to match Roblox exactly; a
 * `catch` handler that branches on the kind is the normal way to tell "the
 * request timed out" from "the request came back 500".
 */
export class LoomPromiseError {
	/** `Promise.Error.Kind` — the four kinds the library itself produces. */
	static readonly Kind = {
		ExecutionError: "ExecutionError",
		AlreadyCancelled: "AlreadyCancelled",
		NotResolvedInTime: "NotResolvedInTime",
		TimedOut: "TimedOut",
	} as const;

	/** The underlying error, stringified (Luau errors are strings). */
	readonly error: string;
	readonly trace: string | undefined;
	readonly context: string | undefined;
	readonly kind: PromiseErrorKind | undefined;
	/** The error this one wraps, if it was produced by `extend`. */
	readonly parent: LoomPromiseError | undefined;
	/** Seconds since page load — the browser's stand-in for `os.clock()`. */
	readonly createdTick: number;
	readonly createdTrace: string;

	constructor(options: PromiseErrorOptions = {}, parent?: LoomPromiseError) {
		this.error =
			options.error === undefined
				? "[This error has no error text.]"
				: String(options.error);
		this.trace = options.trace;
		this.context = options.context;
		this.kind = options.kind;
		this.parent = parent;
		this.createdTick = performance.now() / 1000;
		this.createdTrace = new Error("Promise.Error created at:").stack ?? "";
	}

	/** `Promise.Error.new(options, parent)`. */
	static new(
		options?: PromiseErrorOptions,
		parent?: LoomPromiseError,
	): LoomPromiseError {
		return new LoomPromiseError(options, parent);
	}

	/**
	 * `Promise.Error.is` — duck-typed, exactly like Roblox's: anything carrying
	 * an `error` field and an `extend` method counts, so an error thrown by a
	 * *different* copy of the Promise library still passes.
	 */
	static is(value: unknown): value is LoomPromiseError {
		if (value instanceof LoomPromiseError) return true;
		if (typeof value !== "object" || value === null) return false;
		const candidate = value as { error?: unknown; extend?: unknown };
		return (
			candidate.error !== undefined && typeof candidate.extend === "function"
		);
	}

	/** `Promise.Error.isKind(value, kind)`. */
	static isKind(
		value: unknown,
		kind: PromiseErrorKind,
	): value is LoomPromiseError {
		if (kind === undefined) {
			throw new Error("Argument #2 to Promise.Error.isKind must not be nil");
		}
		return LoomPromiseError.is(value) && value.kind === kind;
	}

	/** Wrap this error in a new one, inheriting `kind` when none is given. */
	extend(options: PromiseErrorOptions = {}): LoomPromiseError {
		return new LoomPromiseError(
			{ ...options, kind: options.kind ?? this.kind },
			this,
		);
	}

	/** This error followed by every error it wraps, outermost first. */
	getErrorChain(): LoomPromiseError[] {
		const chain: LoomPromiseError[] = [this];
		let current: LoomPromiseError | undefined = this.parent;
		while (current !== undefined) {
			chain.push(current);
			current = current.parent;
		}
		return chain;
	}

	/** Roblox's `__tostring`: the kind, then every link of the chain. */
	toString(): string {
		const lines = [`-- Promise.Error(${this.kind ?? "?"}) --`];
		for (const link of this.getErrorChain()) {
			lines.push(
				[link.trace ?? link.error, link.context].filter(Boolean).join("\n"),
			);
		}
		return lines.join("\n");
	}
}

/**
 * A Roblox promise.
 *
 * Generic over a single resolved value. Luau promises can carry a whole tuple
 * (`resolve(a, b)`), but the roblox-ts typings only ever expose the first, so
 * TS source has no way to observe the rest — one value is the honest surface
 * here, and extra arguments to `resolve` are dropped rather than pretended at.
 */
export class LoomPromise<T = unknown> {
	/** `Promise.Status`. */
	static readonly Status = PromiseStatus;
	/** `Promise.Error`. */
	static readonly Error = LoomPromiseError;

	private status: PromiseStatus = PromiseStatus.Started;
	/** The resolved value or the rejection reason; meaningless until settled. */
	private value: unknown;
	/** Cleared the moment anything observes this promise's failure. */
	private unhandledRejection = true;
	private queuedResolve: ((value: unknown) => void)[] = [];
	private queuedReject: ((reason: unknown) => void)[] = [];
	private queuedFinally: ((status: PromiseStatus) => void)[] = [];
	private cancellationHook: (() => void) | undefined;
	/** Upstream link — the promise cancellation propagates *to*. */
	private parent: LoomPromise<unknown> | undefined;
	/** Downstream links — the promises cancellation propagates *from*. */
	private consumers = new Set<LoomPromise<unknown>>();
	/**
	 * Where this promise was created. Held as an `Error` rather than a string
	 * because V8 only formats `.stack` when something reads it, and the vast
	 * majority of promises settle without anyone ever needing the trace.
	 */
	private readonly source: Error;

	/**
	 * `Promise.new(executor)` / `new Promise(executor)`.
	 *
	 * Both spellings work on purpose. roblox-ts compiles `new Promise(...)` down
	 * to `Promise.new(...)`, so app source may contain either, and loom runs the
	 * source rather than the compiled Lua.
	 *
	 * The executor runs immediately and synchronously. Anything it throws
	 * becomes a rejection, which is why Roblox code never wraps it in `pcall`.
	 *
	 * @param parent @internal the promise this one is chained from.
	 */
	constructor(executor: PromiseExecutor<T>, parent?: LoomPromise<unknown>) {
		this.source = new Error("Promise created at:");
		this.parent = parent;
		if (parent !== undefined && parent.status === PromiseStatus.Started) {
			parent.consumers.add(this as LoomPromise<unknown>);
		}

		const resolve = (value: T | LoomPromise<T> | PromiseLike<T>): void => {
			this.resolveWith(value);
		};
		const reject = (reason?: unknown): void => {
			this.rejectWith(reason);
		};
		const onCancel = (abortHandler?: () => void): boolean => {
			if (abortHandler !== undefined) {
				// Setting a hook on an already-cancelled promise runs it now — the
				// abort still has to happen, it just missed the broadcast.
				if (this.status === PromiseStatus.Cancelled) abortHandler();
				else this.cancellationHook = abortHandler;
			}
			return this.status === PromiseStatus.Cancelled;
		};

		try {
			executor(resolve, reject, onCancel);
		} catch (err) {
			reject(this.toRejection(err));
		}
	}

	/** Roblox `tostring`: `Promise(Resolved)`. */
	toString(): string {
		return `Promise(${this.status})`;
	}

	// --- construction ----------------------------------------------------------

	/** `Promise.new(executor)`. */
	static new<T = unknown>(executor: PromiseExecutor<T>): LoomPromise<T> {
		return new LoomPromise<T>(executor);
	}

	/**
	 * `Promise.defer(executor)` — `Promise.new`, except the executor starts later.
	 *
	 * Roblox waits for the next `Heartbeat`. The browser's nearest equivalent
	 * that preserves the point of the method — the executor must not run inside
	 * the caller's own stack frame — is the microtask queue, which is also what
	 * `task.defer` uses in `luau.ts`. It resumes sooner than a Roblox frame
	 * would; code that used `defer` to wait out a frame of layout will notice.
	 */
	static defer<T = unknown>(executor: PromiseExecutor<T>): LoomPromise<T> {
		return new LoomPromise<T>((resolve, reject, onCancel) => {
			queueMicrotask(() => {
				try {
					executor(resolve, reject, onCancel);
				} catch (err) {
					reject(err);
				}
			});
		});
	}

	/** `Promise.resolve(value)` — an already-resolved promise. */
	static resolve<T = void>(value?: T | LoomPromise<T>): LoomPromise<T> {
		return new LoomPromise<T>((resolve) => {
			resolve(value as T);
		});
	}

	/**
	 * `Promise.reject(reason)` — an already-rejected promise.
	 *
	 * Something has to consume this (a `catch`, an `await`), or it reports itself
	 * as an unhandled rejection a tick later. Build them on demand; never stash
	 * one in a variable for later.
	 */
	static reject(reason?: unknown): LoomPromise<never> {
		return new LoomPromise<never>((_resolve, reject) => {
			reject(reason);
		});
	}

	/**
	 * `Promise.try(callback, ...args)` — run `callback` now, capture its return
	 * value (or its throw) as a promise.
	 */
	static try<A extends unknown[], R>(
		callback: (...args: A) => R | LoomPromise<R>,
		...args: A
	): LoomPromise<R> {
		return new LoomPromise<R>((resolve) => {
			resolve(callback(...args) as R);
		});
	}

	/**
	 * `Promise.promisify(callback)` — `Promise.try`, deferred: you get back a
	 * function that runs `callback` inside a promise each time it is called.
	 */
	static promisify<A extends unknown[], R>(
		callback: (...args: A) => R | LoomPromise<R>,
	): (...args: A) => LoomPromise<R> {
		return (...args: A) => LoomPromise.try(callback, ...args);
	}

	/**
	 * `Promise.delay(seconds)` — resolves with how long it actually waited.
	 *
	 * Roblox runs its own sorted scheduler off `Heartbeat`; here a plain
	 * `setTimeout` is both simpler and more accurate, and cancelling the promise
	 * clears the timer outright rather than letting it fire into nothing.
	 *
	 * `NaN`, infinity and anything under one frame all clamp to 1/60s, exactly
	 * as `wait()` does — including the deliberately odd `Promise.delay(0)`,
	 * which still waits a frame.
	 */
	static delay(seconds: number): LoomPromise<number> {
		if (typeof seconds !== "number") {
			throw new Error("Bad argument #1 to Promise.delay, must be a number.");
		}
		const wait =
			!(seconds >= MINIMUM_DELAY) || seconds === Number.POSITIVE_INFINITY
				? MINIMUM_DELAY
				: seconds;
		return new LoomPromise<number>((resolve, _reject, onCancel) => {
			const startTime = performance.now();
			const timer = setTimeout(
				() => resolve((performance.now() - startTime) / 1000),
				wait * 1000,
			);
			onCancel(() => clearTimeout(timer));
		});
	}

	/**
	 * `Promise.fromEvent(event, predicate?)` — the next fire of `event`, as a
	 * promise. The connection is severed as soon as it resolves, and cancelling
	 * severs it too, so a `fromEvent` nobody waits for leaks nothing.
	 *
	 * Resolves with the event's first argument (see the class note on tuples).
	 */
	static fromEvent<T = unknown>(
		event: PromiseEvent,
		predicate?: (value: T) => boolean,
	): LoomPromise<T> {
		const test = predicate ?? (() => true);
		return new LoomPromise<T>((resolve, _reject, onCancel) => {
			let connection: { Disconnect(): void } | undefined;
			// A signal that fires *during* `Connect` (a queued RemoteEvent in
			// Roblox, a synchronous re-fire here) reaches the callback before
			// `Connect` has returned, so there is nothing to disconnect yet.
			let shouldDisconnect = false;

			const disconnect = (): void => {
				connection?.Disconnect();
				connection = undefined;
			};

			connection = event.Connect((...args: unknown[]) => {
				const verdict = test(args[0] as T);
				if (verdict === true) {
					resolve(args[0] as T);
					if (connection !== undefined) disconnect();
					else shouldDisconnect = true;
				} else if (typeof verdict !== "boolean") {
					throw new Error(
						"Promise.fromEvent predicate should always return a boolean",
					);
				}
			});

			if (shouldDisconnect && connection !== undefined) {
				disconnect();
				return;
			}
			onCancel(disconnect);
		});
	}

	// --- combinators -----------------------------------------------------------

	/**
	 * The engine behind `all` and `some`.
	 *
	 * With no `amount` this is `all`: resolve once every promise has, reject the
	 * instant one does. With an `amount` it is `some`: resolve as soon as that
	 * many have (values in *completion* order, not input order), reject once so
	 * many have failed that reaching the count is impossible. Either way the
	 * losers are cancelled, which is what makes `Promise.race` on a pair of
	 * network calls actually abort the loser.
	 */
	private static allOrSome<T>(
		name: string,
		promises: readonly LoomPromise<T>[],
		amount?: number,
	): LoomPromise<T[]> {
		assertPromiseList(name, promises);
		promises = asPromiseList(promises) as LoomPromise<T>[];

		if (promises.length === 0 || amount === 0)
			return LoomPromise.resolve<T[]>([]);

		return new LoomPromise<T[]>((resolve, reject, onCancel) => {
			const resolvedValues: T[] = [];
			const newPromises: LoomPromise<unknown>[] = [];
			let resolvedCount = 0;
			let rejectedCount = 0;
			let done = false;

			const cancelAll = (): void => {
				for (const promise of newPromises) promise.cancel();
			};

			const resolveOne = (index: number, value: T): void => {
				if (done) return;
				resolvedCount += 1;
				if (amount === undefined) resolvedValues[index] = value;
				else resolvedValues.push(value);

				if (resolvedCount >= (amount ?? promises.length)) {
					done = true;
					resolve(resolvedValues);
					cancelAll();
				}
			};

			onCancel(cancelAll);

			promises.forEach((promise, index) => {
				newPromises.push(
					promise.andThen(
						(value) => {
							resolveOne(index, value);
						},
						(reason) => {
							rejectedCount += 1;
							if (
								amount === undefined ||
								promises.length - rejectedCount < amount
							) {
								cancelAll();
								done = true;
								reject(reason);
							}
						},
					),
				);
			});

			// Everything was already settled before we finished wiring: the
			// cancellation above ran against a half-built list, so redo it.
			if (done) cancelAll();
		});
	}

	/**
	 * `Promise.all(promises)` — every value, in input order. Rejects with the
	 * first rejection and cancels whatever is still in flight.
	 */
	static all<T>(promises: readonly LoomPromise<T>[]): LoomPromise<T[]> {
		return LoomPromise.allOrSome("Promise.all", promises);
	}

	/**
	 * `Promise.some(promises, count)` — the first `count` values, in the order
	 * they arrived. Rejects once too many have failed for `count` to be
	 * reachable.
	 */
	static some<T>(
		promises: readonly LoomPromise<T>[],
		count: number,
	): LoomPromise<T[]> {
		if (typeof count !== "number") {
			throw new Error("Bad argument #2 to Promise.some: must be a number");
		}
		return LoomPromise.allOrSome("Promise.some", promises, count);
	}

	/**
	 * `Promise.any(promises)` — the first value to arrive. Rejects only if every
	 * input rejects. `some(…, 1)` with the array unwrapped.
	 */
	static any<T>(promises: readonly LoomPromise<T>[]): LoomPromise<T> {
		return LoomPromise.allOrSome("Promise.any", promises, 1).andThen(
			(values) => values[0] as T,
		);
	}

	/**
	 * `Promise.allSettled(promises)` — one `Status` per input, once they have all
	 * finished. Never rejects; a rejected input is simply `"Rejected"`.
	 */
	static allSettled<T>(
		promises: readonly LoomPromise<T>[],
	): LoomPromise<PromiseStatus[]> {
		assertPromiseList("Promise.allSettled", promises);
		promises = asPromiseList(promises) as LoomPromise<T>[];

		if (promises.length === 0) return LoomPromise.resolve<PromiseStatus[]>([]);

		return new LoomPromise<PromiseStatus[]>((resolve, _reject, onCancel) => {
			const fates: PromiseStatus[] = [];
			const newPromises: LoomPromise<unknown>[] = [];
			let finishedCount = 0;

			const resolveOne = (index: number, status: PromiseStatus): void => {
				finishedCount += 1;
				fates[index] = status;
				if (finishedCount >= promises.length) resolve(fates);
			};

			onCancel(() => {
				for (const promise of newPromises) promise.cancel();
			});

			promises.forEach((promise, index) => {
				const settled = promise.finally((status) => {
					resolveOne(index, status);
				});
				// `finally` passes the parent's fate through, so a rejected input
				// leaves a rejected promise here that nobody chains onto. Roblox
				// lets that trip the unhandled-rejection warning; we don't, because
				// a rejection is the *expected* outcome of `allSettled` and warning
				// about it would make the console useless.
				settled.markObserved();
				newPromises.push(settled);
			});
		});
	}

	/**
	 * `Promise.race(promises)` — the first promise to settle either way wins and
	 * the rest are cancelled. A rejection wins the race too; use `any` or `some`
	 * when you only care about a success.
	 */
	static race<T>(promises: readonly LoomPromise<T>[]): LoomPromise<T> {
		assertPromiseList("Promise.race", promises);
		promises = asPromiseList(promises) as LoomPromise<T>[];

		return new LoomPromise<T>((resolve, reject, onCancel) => {
			const newPromises: LoomPromise<unknown>[] = [];
			let finished = false;

			const cancelAll = (): void => {
				for (const promise of newPromises) promise.cancel();
			};
			/** Whoever settles first stops the others, then settles the race. */
			const settleOnce =
				<A>(callback: (value: A) => void) =>
				(value: A): void => {
					cancelAll();
					finished = true;
					callback(value);
				};

			const abort = settleOnce(reject);
			if (onCancel(() => abort(undefined))) return;

			for (const promise of promises) {
				newPromises.push(
					promise.andThen(
						settleOnce<T>(resolve as (value: T) => void),
						settleOnce(reject),
					),
				);
			}

			if (finished) cancelAll();
		});
	}

	/**
	 * `Promise.each(list, predicate)` — walk the list **in order**, waiting for
	 * each result before starting the next. `Promise.all` runs everything at
	 * once; this is the one to reach for when the calls must not overlap.
	 *
	 * A promise already sitting in the list is awaited when iteration reaches
	 * it; one that is already rejected (or cancelled) fails the whole thing
	 * before the predicate is ever called.
	 *
	 * The `index` handed to the predicate is **1-based**, because that is what
	 * the Luau library passes and the whole point of this file is that app
	 * source behaves the same here as it does in the engine. `luau.ts` makes the
	 * same call for `ipairs` and `string.find`.
	 */
	static each<T, U>(
		list: readonly (T | LoomPromise<T>)[],
		predicate: (value: T, index: number) => U | LoomPromise<U>,
	): LoomPromise<U[]> {
		assertList(ERROR_NON_LIST("Promise.each"), list);
		if (typeof predicate !== "function") {
			throw new Error(ERROR_NON_FUNCTION("Promise.each"));
		}

		return new LoomPromise<U[]>((resolve, reject, onCancel) => {
			const results: U[] = [];
			const promisesToCancel: LoomPromise<unknown>[] = [];
			let cancelled = false;

			const cancelAll = (): void => {
				for (const promise of promisesToCancel) promise.cancel();
			};
			onCancel(() => {
				cancelled = true;
				cancelAll();
			});

			// Chain off every promise in the list up front. Without a consumer
			// registered now, something else could cancel one of them before this
			// loop reaches it — there is no other way to say "I intend to use that".
			const prepared: (T | LoomPromise<T>)[] = [];
			for (const [index, value] of list.entries()) {
				if (!LoomPromise.is(value)) {
					prepared[index] = value;
					continue;
				}
				const promise = value as LoomPromise<T>;
				if (promise.getStatus() === PromiseStatus.Cancelled) {
					cancelAll();
					reject(
						new LoomPromiseError({
							error: "Promise is cancelled",
							kind: "AlreadyCancelled",
							context: `The Promise that was part of the array at index ${index + 1} passed into Promise.each was already cancelled when Promise.each began.`,
						}),
					);
					return;
				}
				if (promise.getStatus() === PromiseStatus.Rejected) {
					cancelAll();
					// Roblox reads the reason back through `:await()`, which marks the
					// failure observed on the way past; we read the field directly, so
					// say so explicitly or the watchdog reports a rejection we handled.
					promise.markObserved();
					reject(promise.value);
					return;
				}
				const ours = promise.andThen((resolved) => resolved);
				ours.markObserved();
				promisesToCancel.push(ours);
				prepared[index] = ours;
			}

			// Roblox yields the calling thread through the loop; the browser gets
			// an async walk instead, which is the same sequencing without the block.
			void (async () => {
				for (const [index, entry] of prepared.entries()) {
					let value = entry;
					if (LoomPromise.is(value)) {
						const [ok, settled] = await (value as LoomPromise<T>).await();
						if (!ok) {
							cancelAll();
							reject(settled);
							return;
						}
						value = settled as T;
					}
					if (cancelled) return;

					const predicatePromise = LoomPromise.resolve(
						predicate(value as T, index + 1),
					);
					promisesToCancel.push(predicatePromise);
					const [ok, result] = await predicatePromise.await();
					if (!ok) {
						cancelAll();
						reject(result);
						return;
					}
					results[index] = result as U;
				}
				resolve(results);
			})();
		});
	}

	/**
	 * `Promise.fold(list, reducer, initialValue)` — `each`, accumulating. Stops
	 * at the first rejection, and the reducer may return a promise.
	 */
	static fold<T, U>(
		list: readonly (T | LoomPromise<T>)[],
		reducer: (accumulator: U, value: T, index: number) => U | LoomPromise<U>,
		initialValue: U,
	): LoomPromise<U> {
		assertList("Bad argument #1 to Promise.fold: must be a table", list);
		if (typeof reducer !== "function") {
			throw new Error("Bad argument #2 to Promise.fold: must be a function");
		}

		let accumulator = LoomPromise.resolve(initialValue);
		return LoomPromise.each(list, (value, index) => {
			accumulator = accumulator.andThen((previous) =>
				reducer(previous as U, value, index),
			) as LoomPromise<U>;
		}).andThen(() => accumulator) as LoomPromise<U>;
	}

	/**
	 * `Promise.retry(callback, times, ...args)` — call `callback` again for every
	 * rejection, up to `times` extra attempts, then give up with the last one.
	 */
	static retry<A extends unknown[], R>(
		callback: (...args: A) => LoomPromise<R>,
		times: number,
		...args: A
	): LoomPromise<R> {
		if (typeof callback !== "function") {
			throw new Error("Parameter #1 to Promise.retry must be a function");
		}
		if (typeof times !== "number") {
			throw new Error("Parameter #2 to Promise.retry must be a number");
		}
		return LoomPromise.resolve(callback(...args)).catch((reason) => {
			if (times > 0) return LoomPromise.retry(callback, times - 1, ...args);
			return LoomPromise.reject(reason);
		}) as LoomPromise<R>;
	}

	/**
	 * `Promise.retryWithDelay(callback, times, seconds, ...args)` — `retry` with
	 * a pause between attempts, so a failing endpoint isn't hammered.
	 */
	static retryWithDelay<A extends unknown[], R>(
		callback: (...args: A) => LoomPromise<R>,
		times: number,
		seconds: number,
		...args: A
	): LoomPromise<R> {
		if (typeof callback !== "function") {
			throw new Error(
				"Parameter #1 to Promise.retryWithDelay must be a function",
			);
		}
		if (typeof times !== "number") {
			throw new Error(
				"Parameter #2 (times) to Promise.retryWithDelay must be a number",
			);
		}
		if (typeof seconds !== "number") {
			throw new Error(
				"Parameter #3 (seconds) to Promise.retryWithDelay must be a number",
			);
		}
		return LoomPromise.resolve(callback(...args)).catch((reason) => {
			if (times > 0) {
				return LoomPromise.delay(seconds).andThen(() =>
					LoomPromise.retryWithDelay(callback, times - 1, seconds, ...args),
				);
			}
			return LoomPromise.reject(reason);
		}) as LoomPromise<R>;
	}

	/**
	 * `Promise.is(object)` — duck-typed on `andThen`, exactly as Roblox does it,
	 * so a promise from another copy of the library still chains.
	 */
	static is(object: unknown): object is LoomPromise<unknown> {
		if (object instanceof LoomPromise) return true;
		if (typeof object !== "object" || object === null) return false;
		return typeof (object as { andThen?: unknown }).andThen === "function";
	}

	/**
	 * `Promise.onUnhandledRejection(callback)` — called with the promise (as
	 * `this`) and the rejection value whenever a rejection reaches a tick later
	 * with nothing observing it. Returns the function that unregisters it.
	 *
	 * These promises never touch the browser's own unhandled-rejection
	 * reporting, so this is the *only* hook there is; without a handler
	 * registered, loom writes the rejection to the console itself.
	 */
	static onUnhandledRejection(callback: UnhandledRejectionHandler): () => void {
		unhandledRejectionCallbacks.push(callback);
		return () => {
			removeFrom(unhandledRejectionCallbacks, callback);
		};
	}

	// --- chaining --------------------------------------------------------------

	/** `promise:getStatus()`. */
	getStatus(): PromiseStatus {
		return this.status;
	}

	/**
	 * `promise:andThen(onResolved, onRejected)`.
	 *
	 * Returning a promise from either handler chains onto it. Calling `andThen`
	 * on a cancelled promise gives you a cancelled promise back — neither
	 * handler ever runs, which is why cleanup belongs in `finally`.
	 *
	 * Never assume the rejection value is a string: the library itself rejects
	 * with `Promise.Error` objects.
	 */
	andThen<R1 = T, R2 = never>(
		onResolved?: (value: T) => R1 | LoomPromise<R1>,
		onRejected?: (reason: unknown) => R2 | LoomPromise<R2>,
	): LoomPromise<R1 | R2> {
		if (onResolved !== undefined && typeof onResolved !== "function") {
			throw new Error(ERROR_NON_FUNCTION("Promise:andThen"));
		}
		if (onRejected !== undefined && typeof onRejected !== "function") {
			throw new Error(ERROR_NON_FUNCTION("Promise:andThen"));
		}
		return this.chain(
			onResolved as ((value: unknown) => unknown) | undefined,
			onRejected as ((reason: unknown) => unknown) | undefined,
		) as LoomPromise<R1 | R2>;
	}

	/**
	 * The JS thenable bridge, so `await somePromise` works from ordinary TS and
	 * so a native promise chain can adopt one of these.
	 *
	 * It is *not* simply `andThen`. An `andThen` child of a cancelled promise is
	 * itself cancelled, and a cancelled promise never settles — an `await` on
	 * one would hang the calling async function forever. JS has no third
	 * outcome, so cancellation surfaces here as a rejection with a
	 * `Promise.Error(AlreadyCancelled)`. That is the only honest mapping.
	 *
	 * Like `finally`, `then` does not register as a consumer: awaiting a promise
	 * should not change whether cancelling something else can cancel it.
	 */
	// biome-ignore lint/suspicious/noThenProperty: being a thenable is the point — it is what makes `await somePromise` work on a Roblox promise.
	then<R1 = T, R2 = never>(
		onResolved?: ((value: T) => R1 | LoomPromise<R1>) | undefined | null,
		onRejected?: ((reason: unknown) => R2 | LoomPromise<R2>) | undefined | null,
	): LoomPromise<R1 | R2> {
		this.unhandledRejection = false;
		return new LoomPromise<R1 | R2>((resolve, reject) => {
			const run = (status: PromiseStatus): void => {
				if (status === PromiseStatus.Resolved) {
					if (onResolved) {
						try {
							resolve(onResolved(this.value as T) as R1);
						} catch (err) {
							reject(this.toRejection(err));
						}
					} else {
						resolve(this.value as R1);
					}
					return;
				}
				// Cancellation joins the rejection path rather than getting a branch
				// of its own: `await` hands us a rejection callback and nothing else,
				// so anything that does not reach it is a hang.
				const reason =
					status === PromiseStatus.Rejected
						? this.value
						: this.cancelledError("then");
				if (onRejected) {
					try {
						resolve(onRejected(reason) as R2);
					} catch (err) {
						reject(this.toRejection(err));
					}
				} else {
					reject(reason);
				}
			};

			// `then` must NEVER run its handlers in the caller's frame, even when
			// this promise has already settled. `andThen` may — Roblox's scheduler
			// is the only thing watching that one — but `then` is the JS bridge,
			// and the ecosystem relies on the spec guarantee that it defers.
			// React's scheduler in particular takes its microtask from
			// `Promise.resolve().then(flushWork)`, and `installGlobals` puts this
			// class on `globalThis.Promise`; a synchronous `then` would make React
			// flush work inside whatever frame happened to touch a promise. So
			// every path settles through a microtask.
			const settle = (status: PromiseStatus): void => {
				queueMicrotask(() => run(status));
			};

			if (this.status === PromiseStatus.Started)
				this.queuedFinally.push(settle);
			else settle(this.status);
		});
	}

	/** `promise:catch(onRejected)` — sugar for `andThen(nil, onRejected)`. */
	catch<R = never>(
		onRejected?: (reason: unknown) => R | LoomPromise<R>,
	): LoomPromise<T | R> {
		if (onRejected !== undefined && typeof onRejected !== "function") {
			throw new Error(ERROR_NON_FUNCTION("Promise:catch"));
		}
		return this.chain(
			undefined,
			onRejected as ((reason: unknown) => unknown) | undefined,
		) as LoomPromise<T | R>;
	}

	/**
	 * `promise:tap(handler)` — look at the value without changing it. If the
	 * handler returns a promise, `tap` waits for it and then passes the
	 * *original* value on.
	 */
	tap(tapHandler: (value: T) => unknown): LoomPromise<T> {
		if (typeof tapHandler !== "function") {
			throw new Error(ERROR_NON_FUNCTION("Promise:tap"));
		}
		return this.chain((value) => {
			const returned = tapHandler(value as T);
			if (LoomPromise.is(returned)) return returned.andThen(() => value);
			return value;
		}) as LoomPromise<T>;
	}

	/**
	 * `promise:andThenCall(callback, ...args)` — call `callback` with fixed
	 * arguments on success, discarding the resolved value.
	 */
	andThenCall<A extends unknown[], R>(
		callback: (...args: A) => R,
		...args: A
	): LoomPromise<R> {
		if (typeof callback !== "function") {
			throw new Error(ERROR_NON_FUNCTION("Promise:andThenCall"));
		}
		return this.chain(() => callback(...args)) as LoomPromise<R>;
	}

	/** `promise:andThenReturn(value)` — replace the resolved value on success. */
	andThenReturn<U>(value: U): LoomPromise<U> {
		return this.chain(() => value) as LoomPromise<U>;
	}

	/**
	 * `promise:finally(handler)` — runs on resolve, reject **and** cancel. The
	 * one place cleanup is guaranteed to happen.
	 *
	 * The returned promise mirrors this one: same value, same rejection, also
	 * cancelled if this one was. The handler's return value is discarded — but a
	 * promise returned from it is waited for, and if *that* rejects, the chain
	 * rejects with its reason. (Promise v4 changed this: in v3 the handler's
	 * return value replaced the settled value. Code written against v3's
	 * `finallyReturn` gets v4 behaviour here, same as any current Roblox game.)
	 *
	 * `finally` is not a consumer for cancellation purposes: a promise whose only
	 * remaining callbacks are `finally` handlers still cancels, and runs them.
	 */
	finally(onSettled?: (status: PromiseStatus) => unknown): LoomPromise<T> {
		if (onSettled !== undefined && typeof onSettled !== "function") {
			throw new Error(ERROR_NON_FUNCTION("Promise:finally"));
		}
		return this.chainFinally(onSettled, false);
	}

	/** `promise:finallyCall(callback, ...args)` — `finally` with fixed arguments. */
	finallyCall<A extends unknown[]>(
		callback: (...args: A) => unknown,
		...args: A
	): LoomPromise<T> {
		if (typeof callback !== "function") {
			throw new Error(ERROR_NON_FUNCTION("Promise:finallyCall"));
		}
		return this.chainFinally(() => callback(...args), false);
	}

	/**
	 * `promise:finallyReturn(value)`.
	 *
	 * Kept for source compatibility, but note the v4 semantics above: the value
	 * is evaluated and then discarded, and the settled value passes through.
	 */
	finallyReturn<U>(value: U): LoomPromise<T> {
		return this.chainFinally(() => value, false);
	}

	/**
	 * `promise:done(handler)` — `finally`, except rejections skip the handler and
	 * pass straight through. Use it for "we got somewhere, tidy up"; use
	 * `finally` for "tidy up no matter what".
	 */
	done(onSettled?: (status: PromiseStatus) => unknown): LoomPromise<T> {
		if (onSettled !== undefined && typeof onSettled !== "function") {
			throw new Error(ERROR_NON_FUNCTION("Promise:done"));
		}
		return this.chainFinally(onSettled, true);
	}

	/** `promise:doneCall(callback, ...args)`. */
	doneCall<A extends unknown[]>(
		callback: (...args: A) => unknown,
		...args: A
	): LoomPromise<T> {
		if (typeof callback !== "function") {
			throw new Error(ERROR_NON_FUNCTION("Promise:doneCall"));
		}
		return this.chainFinally(() => callback(...args), true);
	}

	/** `promise:doneReturn(value)` — see `finallyReturn` on the discarded value. */
	doneReturn<U>(value: U): LoomPromise<T> {
		return this.chainFinally(() => value, true);
	}

	/**
	 * `promise:timeout(seconds, rejectionValue?)` — reject if this hasn't settled
	 * in time, and cancel it when that happens.
	 *
	 * Without a `rejectionValue` you get a `Promise.Error` of kind `TimedOut`,
	 * which `Promise.Error.isKind` can tell apart from a real failure.
	 */
	timeout(seconds: number, rejectionValue?: unknown): LoomPromise<T> {
		return LoomPromise.race<T>([
			LoomPromise.delay(seconds).andThen(() =>
				LoomPromise.reject(
					rejectionValue === undefined
						? new LoomPromiseError({
								kind: "TimedOut",
								error: "Timed out",
								context: `Timeout of ${seconds} seconds exceeded.`,
							})
						: rejectionValue,
				),
			) as unknown as LoomPromise<T>,
			this,
		]);
	}

	/**
	 * `promise:now(rejectionValue?)` — resolve only if this promise has *already*
	 * resolved, so the handler runs on the same frame instead of a tick later.
	 * Anything else (still running, rejected, cancelled) rejects with a
	 * `Promise.Error` of kind `NotResolvedInTime`.
	 */
	now(rejectionValue?: unknown): LoomPromise<T> {
		if (this.status === PromiseStatus.Resolved) {
			return this.chain((value) => value) as LoomPromise<T>;
		}
		return LoomPromise.reject(
			rejectionValue === undefined
				? new LoomPromiseError({
						kind: "NotResolvedInTime",
						error: "This Promise was not resolved in time for :now()",
						context: ":now() was called before this Promise resolved.",
					})
				: rejectionValue,
		) as unknown as LoomPromise<T>;
	}

	// --- cancellation ----------------------------------------------------------

	/**
	 * `promise:cancel()` — stop this promise settling, run its cancellation hook,
	 * and propagate.
	 *
	 * Downward: every promise chained off this one is cancelled too. Upward: the
	 * parent loses this consumer, and cancels itself once it has none left. That
	 * second rule is the important one — `andThen` twice and cancel only one
	 * child, and the shared parent keeps running for the other.
	 *
	 * Does nothing to an already-settled promise.
	 */
	cancel(): void {
		if (this.status !== PromiseStatus.Started) return;

		this.status = PromiseStatus.Cancelled;
		this.cancellationHook?.();

		this.parent?.consumerCancelled(this as LoomPromise<unknown>);
		// Snapshot: a cancelled child unhooks itself from this set as it goes.
		for (const child of [...this.consumers]) child.cancel();

		this.finalize();
	}

	/** One consumer gave up; with none left there is nobody to finish this for. */
	private consumerCancelled(consumer: LoomPromise<unknown>): void {
		if (this.status !== PromiseStatus.Started) return;
		this.consumers.delete(consumer);
		if (this.consumers.size === 0) this.cancel();
	}

	// --- settling (the "cannot yield in a browser" trio) -----------------------

	/**
	 * `promise:awaitStatus()` — the fate, then the value.
	 *
	 * **Divergence, and it is a loud one.** In Roblox this blocks the calling
	 * thread and returns a LuaTuple, so `local status, value = p:awaitStatus()`
	 * reads as straight-line code. A browser tab has a single thread that must
	 * not be blocked — freezing it freezes the preview, the frame loop and the
	 * DOM with it — so this returns a native Promise of that same tuple instead:
	 *
	 * ```ts
	 * const [status, value] = await promise.awaitStatus();
	 * ```
	 *
	 * Compiled roblox-ts that destructures without awaiting gets a Promise where
	 * it expected a status. That is the one part of `:await` no browser runtime
	 * can close, and pretending otherwise would be worse than saying so.
	 */
	awaitStatus(): Promise<[PromiseStatus, unknown]> {
		this.unhandledRejection = false;
		return new NativePromise<[PromiseStatus, unknown]>((resolve) => {
			const settle = (): void => {
				resolve([
					this.status,
					this.status === PromiseStatus.Cancelled ? undefined : this.value,
				]);
			};
			if (this.status === PromiseStatus.Started)
				this.queuedFinally.push(settle);
			else settle();
		});
	}

	/**
	 * `promise:await()` — `[true, value]` or `[false, reason]`.
	 *
	 * Same divergence as `awaitStatus`: this cannot block, so it hands back a
	 * native Promise of the tuple and you write `await promise.await()`.
	 *
	 * A cancelled promise reports `false`, indistinguishable from a rejection —
	 * that is Roblox's behaviour too. Use `awaitStatus` when the difference
	 * matters.
	 */
	await(): Promise<[true, T] | [false, unknown]> {
		return this.awaitStatus().then(([status, value]) =>
			status === PromiseStatus.Resolved
				? ([true, value as T] as [true, T])
				: ([false, value] as [false, unknown]),
		);
	}

	/**
	 * `promise:expect()` — the resolved value, or throw the rejection.
	 *
	 * Same divergence again: Roblox blocks and returns the value, we return a
	 * native Promise of it, so `const value = await promise.expect()`. The throw
	 * becomes a rejection of that promise, which `try`/`catch` around the `await`
	 * catches exactly as `pcall` would have.
	 *
	 * Cancellation throws here as well — `expect` promises a value, and a
	 * cancelled promise has none.
	 */
	expect(): Promise<T> {
		return this.awaitStatus().then(([status, value]) => {
			if (status !== PromiseStatus.Resolved) {
				throw value === undefined
					? new Error("Expected Promise rejected with no value.")
					: value;
			}
			return value as T;
		});
	}

	/** Pre-v3 name for {@link expect}, still used by older roblox-ts code. */
	awaitValue(): Promise<T> {
		return this.expect();
	}

	// --- internals -------------------------------------------------------------

	/**
	 * Tell the unhandled-rejection watchdog that loom itself is reading this
	 * promise's outcome, so a rejection here is not going unnoticed.
	 */
	private markObserved(): void {
		this.unhandledRejection = false;
	}

	/** The rejection `andThen`/`then` produce when the source was cancelled. */
	private cancelledError(method: string): LoomPromiseError {
		return new LoomPromiseError({
			error: "Promise is cancelled",
			kind: "AlreadyCancelled",
			context: `The Promise that :${method}() was called on was already cancelled.\n\nThat Promise was created at:\n\n${this.source.stack ?? ""}`,
		});
	}

	/**
	 * Turn a thrown value into a rejection value the way Luau does: a table is
	 * forwarded untouched, anything else is wrapped in a
	 * `Promise.Error(ExecutionError)` carrying the trace.
	 *
	 * The browser equivalent of "a table" is any object — which keeps a thrown
	 * `Error` intact with its own stack and message, rather than flattening it
	 * to a string the way a naive port would.
	 */
	private toRejection(err: unknown): unknown {
		if (typeof err === "object" && err !== null) return err;
		return new LoomPromiseError({
			error: err,
			kind: "ExecutionError",
			trace: stackOf(err),
			context: `Promise created at:\n\n${this.source.stack ?? ""}`,
		});
	}

	/** Wrap a handler so its return value resolves and its throw rejects. */
	private advancer(
		callback: (value: unknown) => unknown,
		resolve: (value: unknown) => void,
		reject: (reason?: unknown) => void,
	): (value: unknown) => void {
		return (value: unknown) => {
			try {
				resolve(callback(value));
			} catch (err) {
				reject(this.toRejection(err));
			}
		};
	}

	/** The shared body of `andThen`/`catch`/`tap`/`andThenCall`/`now`. */
	private chain(
		onResolved?: (value: unknown) => unknown,
		onRejected?: (reason: unknown) => unknown,
	): LoomPromise<unknown> {
		// Attaching any handler counts as observing the failure: from here on the
		// *child* is the one that owes someone a `catch`.
		this.unhandledRejection = false;

		if (this.status === PromiseStatus.Cancelled) {
			const cancelled = new LoomPromise<unknown>(() => {});
			cancelled.cancel();
			return cancelled;
		}

		return new LoomPromise<unknown>(
			(resolve, reject, onCancel) => {
				const successCallback = onResolved
					? this.advancer(onResolved, resolve, reject)
					: resolve;
				const failureCallback = onRejected
					? this.advancer(onRejected, resolve, reject)
					: reject;

				if (this.status === PromiseStatus.Started) {
					this.queuedResolve.push(successCallback);
					this.queuedReject.push(failureCallback);
					onCancel(() => {
						// Cancelling this link must not leave its handlers in the parent's
						// queues, or a later settle would run them anyway.
						if (this.status !== PromiseStatus.Started) return;
						removeFrom(this.queuedResolve, successCallback);
						removeFrom(this.queuedReject, failureCallback);
					});
				} else if (this.status === PromiseStatus.Resolved) {
					successCallback(this.value);
				} else if (this.status === PromiseStatus.Rejected) {
					failureCallback(this.value);
				}
			},
			this as LoomPromise<unknown>,
		);
	}

	/**
	 * The shared body of `finally`/`done` and their `Call`/`Return` sugar.
	 *
	 * `onlyOk` is what makes `done` different: a rejection short-circuits
	 * straight to passing the rejection through, and — because `done` is not
	 * treating the failure as observed — the unhandled-rejection watchdog stays
	 * armed.
	 */
	private chainFinally(
		onSettled: ((status: PromiseStatus) => unknown) | undefined,
		onlyOk: boolean,
	): LoomPromise<T> {
		if (!onlyOk) this.unhandledRejection = false;

		// No parent argument on purpose: as of Promise v4 a `finally` handler is
		// not a consumer, so it can never keep a promise alive that everyone else
		// has cancelled.
		return new LoomPromise<T>((resolve, reject, onCancel) => {
			let handlerPromise: LoomPromise<unknown> | undefined;

			onCancel(() => {
				// Not a consumer, so there is nothing to unregister — but if this was
				// the last thing keeping the parent around, the parent should go too.
				this.consumerCancelled(this as LoomPromise<unknown>);
				handlerPromise?.cancel();
			});

			// Resolving with `this` is how the fate passes through: `resolveWith`
			// chains onto it, so the child adopts this promise's value, its
			// rejection, or its cancellation.
			const passThrough = (): void => {
				resolve(this);
			};

			let settle: (status: PromiseStatus) => void = passThrough;
			if (onSettled) {
				settle = (status: PromiseStatus) => {
					let returned: unknown;
					try {
						returned = onSettled(status);
					} catch (err) {
						reject(this.toRejection(err));
						return;
					}
					if (LoomPromise.is(returned)) {
						handlerPromise = returned;
						returned
							.finally((handlerStatus) => {
								if (handlerStatus !== PromiseStatus.Rejected) passThrough();
							})
							.catch((reason) => {
								reject(reason);
							});
						return;
					}
					passThrough();
				};
			}

			if (onlyOk) {
				const inner = settle;
				settle = (status: PromiseStatus) => {
					if (this.status === PromiseStatus.Rejected) {
						passThrough();
						return;
					}
					inner(status);
				};
			}

			if (this.status === PromiseStatus.Started)
				this.queuedFinally.push(settle);
			else settle(this.status);
		});
	}

	/** `_resolve` — settle with a value, or adopt the promise/thenable given. */
	private resolveWith(value: unknown): void {
		if (this.status !== PromiseStatus.Started) {
			// Late resolution with a promise still has to release that promise: we
			// are no longer a consumer of it.
			if (LoomPromise.is(value)) {
				(value as LoomPromise<unknown>).consumerCancelled(
					this as LoomPromise<unknown>,
				);
			}
			return;
		}

		if (LoomPromise.is(value)) {
			const chained = value as LoomPromise<unknown>;
			const link = chained.andThen(
				(resolved) => {
					this.resolveWith(resolved);
				},
				(reason) => {
					// An ExecutionError gets a note about *this* promise appended, so
					// the console shows both ends of the chain instead of just the
					// throw site.
					if (LoomPromiseError.isKind(reason, "ExecutionError")) {
						this.rejectWith(
							reason.extend({
								error: "This Promise was chained to a Promise that errored.",
								trace: "",
								context: `The Promise at:\n\n${this.source.stack ?? ""}\n...Rejected because it was chained to the following Promise, which encountered an error:\n`,
							}),
						);
						return;
					}
					this.rejectWith(reason);
				},
			);

			if (link.status === PromiseStatus.Cancelled) {
				this.cancel();
			} else if (link.status === PromiseStatus.Started) {
				// Adopt the link as our parent so cancelling us cancels the work.
				this.parent = link as LoomPromise<unknown>;
				link.consumers.add(this as LoomPromise<unknown>);
			}
			return;
		}

		// Not a Roblox promise, but the browser has its own: a preview app that
		// hands `fetch()` straight to `resolve` should still work. Roblox has no
		// equivalent case, so nothing is being contradicted here.
		if (isThenable(value)) {
			value.then(
				(resolved) => {
					this.resolveWith(resolved);
				},
				(reason: unknown) => {
					this.rejectWith(reason);
				},
			);
			return;
		}

		this.status = PromiseStatus.Resolved;
		this.value = value;
		for (const callback of [...this.queuedResolve]) callback(value);
		this.finalize();
	}

	/** `_reject` — settle as a failure, and arm the unhandled-rejection watchdog. */
	private rejectWith(reason: unknown): void {
		if (this.status !== PromiseStatus.Started) return;

		this.status = PromiseStatus.Rejected;
		this.value = reason;

		const observers = [...this.queuedReject];
		if (observers.length > 0) {
			for (const callback of observers) callback(reason);
		} else {
			// Nobody is listening *yet*. A handler attached synchronously right
			// after this — the overwhelmingly common `doThing().catch(...)` — still
			// counts, so give the current task a chance to finish before shouting.
			setTimeout(() => {
				if (!this.unhandledRejection) return;
				for (const callback of [...unhandledRejectionCallbacks]) {
					callback.call(this as LoomPromise<unknown>, this.value);
				}
				if (unhandledRejectionCallbacks.length === 0) {
					console.warn(
						`loom: unhandled Promise rejection:\n\n${String(this.value)}\n\n${this.source.stack ?? ""}`,
					);
				}
			}, 0);
		}

		this.finalize();
	}

	/**
	 * Run the `finally` queue. Separate from resolve/reject because it has to
	 * happen for all three fates, cancellation included — which is the whole
	 * reason `finally` is the only trustworthy place to put cleanup.
	 */
	private finalize(): void {
		for (const callback of [...this.queuedFinally]) callback(this.status);

		this.queuedFinally = [];
		this.queuedReject = [];
		this.queuedResolve = [];
		// Drop the graph links so a long chain doesn't pin every promise in it.
		this.parent = undefined;
		this.consumers = new Set();
	}
}

/** A native (or foreign) thenable — anything with a `then` method. */
function isThenable(value: unknown): value is PromiseLike<unknown> {
	return (
		typeof value === "object" &&
		value !== null &&
		typeof (value as { then?: unknown }).then === "function"
	);
}

/**
 * The name app code sees. The preview plugin prepends
 * `import { RobloxPromise as Promise } from "@loom-dev/runtime"` to each app
 * module, so the binding shadows the page global for that file alone —
 * `installGlobals` deliberately leaves `globalThis.Promise` native, because the
 * host page (React, the Vite client, loom's own prerender) needs the JS
 * semantics of `Promise.allSettled` and friends. Inside loom itself always
 * import `LoomPromise` (or this alias) explicitly, so that no module here ever
 * loses access to the real `Promise`.
 */
export { LoomPromise as RobloxPromise };
