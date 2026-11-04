/**
 * `vm.ts` — `LuauVM`, the Luau virtual machine (upstream Luau compiled to
 * WASM, see `native/`) with a JavaScript-shaped API on top of its stack.
 *
 * The VM knows nothing about Roblox. It moves values across the boundary and
 * runs threads; `bindings.ts`-style layers decide what Luau sees:
 *
 * - Luau → JS: nil is `undefined`, booleans/numbers/strings are themselves, a
 *   host userdata is the JS object it was made from, and tables, functions and
 *   threads arrive as `LuauTable`/`LuauFunction`/`LuauThread` references.
 * - JS → Luau: a JS function becomes a host function; an object the
 *   classifier recognises becomes host userdata dispatched through its
 *   `HostClass` (the same object is always the same userdata, so `==` and
 *   table keys behave); plain arrays and objects are copied into new tables.
 *
 * Yielding is Roblox's model: a host function that returns a `Suspend` yields
 * the calling thread, and the thread runs again when the `Suspend` resumes it —
 * whoever resumed the thread in the first place.
 */
import createLuauModule, { type LuauModule } from "./wasm/luau-vm.mjs";

// Stable value kinds reported by `lb_kind` (bridge.cpp `Kind`).
const KIND_NIL = 0;
const KIND_BOOLEAN = 1;
const KIND_NUMBER = 2;
const KIND_STRING = 3;
const KIND_TABLE = 4;
const KIND_FUNCTION = 5;
const KIND_HOST = 6;
const KIND_THREAD = 7;

const LUA_OK = 0;
const LUA_YIELD = 1;

// `lua_costatus`: a thread that has not started, or is parked in a yield.
const LUA_COSUS = 1;

// Host-call sentinels (bridge.cpp `LB_ERROR` / `LB_YIELD`).
const LB_ERROR = -1;
const LB_YIELD = -2;

/** An error raised in Luau, or by a host function on Luau's behalf. */
export class LuauError extends Error {
	override readonly name = "LuauError";

	constructor(
		message: string,
		/** The raised value itself (`error({ code = 1 })` keeps its table). */
		readonly value: unknown = message,
		/** The Luau stack at the point of the error, when known. */
		readonly traceback?: string,
	) {
		super(message);
	}
}

/** Several return values from a host function. */
export class Tuple {
	constructor(readonly values: readonly unknown[]) {}
}

/** Return several values from a host function. */
export function tuple(...values: unknown[]): Tuple {
	return new Tuple(values);
}

/**
 * Returned by a host function to yield the thread that called it. `wait` runs
 * once the thread has actually suspended and receives the function that
 * resumes it with the host function's results.
 */
export class Suspend {
	constructor(
		readonly wait: (resume: (...values: unknown[]) => void) => void,
	) {}
}

/**
 * How Luau sees one kind of host object. Every hook is optional: a missing
 * `index` makes every field read an error, a missing `namecall` every method
 * call. Arithmetic hooks receive both operands, either of which may be the
 * host object.
 */
export interface HostClass<T extends object = object> {
	/** What `typeof` returns. */
	readonly name: string;
	index?(self: T, key: unknown): unknown;
	newindex?(self: T, key: unknown, value: unknown): void;
	namecall?(self: T, method: string, args: unknown[]): unknown;
	call?(self: T, args: unknown[]): unknown;
	tostring?(self: T): string;
	eq?(a: T, b: unknown): boolean;
	lt?(a: unknown, b: unknown): boolean;
	le?(a: unknown, b: unknown): boolean;
	len?(self: T): number;
	unm?(self: T): unknown;
	add?(a: unknown, b: unknown): unknown;
	sub?(a: unknown, b: unknown): unknown;
	mul?(a: unknown, b: unknown): unknown;
	div?(a: unknown, b: unknown): unknown;
	idiv?(a: unknown, b: unknown): unknown;
	mod?(a: unknown, b: unknown): unknown;
	pow?(a: unknown, b: unknown): unknown;
}

/** Picks the `HostClass` for a JS object, or `undefined` to copy it as a table. */
export type Classifier = (value: object) => HostClass | undefined;

export interface LuauVMOptions {
	/** Decides which JS objects cross as host userdata. */
	classify?: Classifier;
	/** Where an error that escapes a thread goes. Defaults to `console.error`. */
	onError?: (error: LuauError) => void;
	/** Wall-clock milliseconds one entry into Luau may run. 0 disables. */
	budgetMs?: number;
	/** Passed to emscripten — for loading the `.wasm` from somewhere unusual. */
	locateFile?: (path: string, prefix: string) => string;
	/** The `.wasm` bytes themselves, skipping the fetch (tests, Node). */
	wasmBinary?: ArrayBuffer | Uint8Array;
}

/** How a resumed thread came back. */
export type ThreadResult =
	| { readonly status: "done"; readonly values: unknown[] }
	| { readonly status: "yielded" }
	| { readonly status: "error"; readonly error: LuauError };

type HostEntry = (L: number, args: unknown[]) => unknown;

interface HostHandle {
	readonly value: object;
	readonly cls: HostClass;
	/** Live userdata holding this handle (normally 1; see `lbHostRelease`). */
	count: number;
}

const METAMETHODS = [
	"__index",
	"__newindex",
	"__namecall",
	"__call",
	"__tostring",
	"__eq",
	"__lt",
	"__le",
	"__len",
	"__unm",
	"__add",
	"__sub",
	"__mul",
	"__div",
	"__idiv",
	"__mod",
	"__pow",
] as const;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** A reference that keeps a Luau value alive until the JS side is collected. */
abstract class LuauRef {
	constructor(
		/** @internal */ readonly vm: LuauVM,
		/** @internal */ readonly ref: number,
	) {
		vm.track(this, ref);
	}
}

/** A Luau function. `call` runs it to completion; `spawn` gives it a thread. */
export class LuauFunction extends LuauRef {
	call(...args: unknown[]): unknown[] {
		return this.vm.call(this, args);
	}

	spawn(...args: unknown[]): ThreadResult {
		return this.vm.spawn(this, args);
	}
}

/** A Luau table, read and written raw (no metamethods). */
export class LuauTable extends LuauRef {
	get(key: unknown): unknown {
		return this.vm.tableGet(this, key);
	}

	set(key: unknown, value: unknown): void {
		this.vm.tableSet(this, key, value);
	}

	/** `#t`. */
	get length(): number {
		return this.vm.tableLength(this);
	}

	/** Every key/value pair, in `next` order. */
	entries(): [unknown, unknown][] {
		return this.vm.tableEntries(this);
	}

	/** `t[1]` … `t[#t]`. */
	array(): unknown[] {
		const out: unknown[] = [];
		const n = this.length;
		for (let i = 1; i <= n; i++) out.push(this.get(i));
		return out;
	}
}

/** A Luau coroutine. */
export class LuauThread extends LuauRef {}

/** A Luau value JS has no use for beyond handing it back (vector, buffer, …). */
export class LuauOpaque extends LuauRef {
	constructor(
		vm: LuauVM,
		ref: number,
		readonly typeName: string,
	) {
		super(vm, ref);
	}
}

export class LuauVM {
	/** Instantiate the WASM module and open a fresh Luau state. */
	static async create(options: LuauVMOptions = {}): Promise<LuauVM> {
		let vm: LuauVM | undefined;
		const module = await createLuauModule({
			lbHostCall: (L, id) => (vm as LuauVM).hostCall(L, id),
			lbHostRelease: (handle) => vm?.hostRelease(handle),
			...(options.locateFile ? { locateFile: options.locateFile } : {}),
			...(options.wasmBinary ? { wasmBinary: options.wasmBinary } : {}),
		});
		vm = new LuauVM(module, options);
		return vm;
	}

	private readonly M: LuauModule;
	private readonly L: number;
	private readonly classify: Classifier;
	private readonly onError: (error: LuauError) => void;
	private readonly budgetMs: number;

	private readonly entries: HostEntry[] = [];
	private readonly functionIds = new Map<
		(...args: never[]) => unknown,
		number
	>();
	private readonly debugNames = new Map<string, number>();
	private readonly handles = new Map<number, HostHandle>();
	private readonly handleOf = new Map<object, number>();
	private nextHandle = 1;
	private readonly metatables = new Map<HostClass, number>();
	private readonly metamethodIds = new Map<string, number>();
	private readonly refs = new FinalizationRegistry<number>((ref) => {
		if (!this.closed) this.M._lb_unref(this.L, ref);
	});

	private scratch = 0;
	private scratchSize = 0;
	private readonly lenPtr: number;
	private depth = 0;
	private frozen = false;
	private closed = false;
	/** `run`'s `onFinish` for each thread still on its way to the end. */
	private readonly finishers = new Map<
		number,
		(result: ThreadResult) => void
	>();

	private constructor(module: LuauModule, options: LuauVMOptions) {
		this.M = module;
		this.L = module._lb_open();
		this.classify = options.classify ?? (() => undefined);
		this.onError = options.onError ?? ((error) => console.error(error.message));
		this.budgetMs = options.budgetMs ?? 0;
		this.lenPtr = module._malloc(4);
		for (const name of METAMETHODS) {
			this.metamethodIds.set(name, this.register(this.metamethod(name)));
		}
	}

	// --- globals and scripts ---------------------------------------------------

	/** Define a global. Only before the first script runs (globals freeze then). */
	setGlobal(name: string, value: unknown): void {
		if (this.frozen)
			throw new Error(`loom luau: globals are frozen; cannot set ${name}`);
		this.push(this.L, value);
		this.M._lb_setglobal(this.L, this.cstr(name));
	}

	getGlobal(name: string): unknown {
		const base = this.M._lb_gettop(this.L);
		this.M._lb_getglobal(this.L, this.cstr(name));
		const value = this.read(this.L, -1);
		this.M._lb_settop(this.L, base);
		return value;
	}

	/**
	 * Freeze the globals and the standard libraries, Roblox style. Runs on its
	 * own before the first script; scripts then see the frozen set through
	 * their own writable environment.
	 */
	freeze(): void {
		if (this.frozen) return;
		this.frozen = true;
		this.M._lb_sandbox(this.L);
	}

	/** Compile `source` into a function, or throw the syntax error. */
	load(source: string, chunkname = "=loom"): LuauFunction {
		const base = this.M._lb_gettop(this.L);
		const status = this.loadOnto(this.L, source, chunkname);
		const value = this.read(this.L, -1);
		this.M._lb_settop(this.L, base);
		if (status !== LUA_OK) throw new LuauError(String(value));
		return value as LuauFunction;
	}

	/**
	 * Run `source` as a script: its own thread with its own global environment
	 * (the frozen globals plus `globals`), the way Roblox runs a Script or
	 * LocalScript. Returns how the thread first came back; `onFinish` hears how
	 * it ended, after however many yields (`require` of a module that yields).
	 */
	run(
		source: string,
		options: {
			chunkname?: string;
			globals?: Record<string, unknown>;
			onFinish?: (result: ThreadResult) => void;
		} = {},
	): ThreadResult {
		this.freeze();
		const co = this.M._lb_newthread(this.L);
		const ref = this.M._lb_ref(this.L, -1);
		this.M._lb_settop(this.L, -2);
		try {
			this.M._lb_sandboxthread(co);
			for (const [name, value] of Object.entries(options.globals ?? {})) {
				this.push(co, value);
				this.M._lb_setglobal(co, this.cstr(name));
			}
			if (this.loadOnto(co, source, options.chunkname ?? "=loom") !== LUA_OK) {
				const error = new LuauError(String(this.read(co, -1)));
				this.M._lb_settop(co, 0);
				this.onError(error);
				const result: ThreadResult = { status: "error", error };
				options.onFinish?.(result);
				return result;
			}
			if (options.onFinish) this.finishers.set(co, options.onFinish);
			return this.resume(co, 0);
		} finally {
			this.M._lb_unref(this.L, ref);
		}
	}

	// --- calling ---------------------------------------------------------------

	/**
	 * Call a Luau function to completion and return its results. A function
	 * that yields throws here — give it a thread with `spawn` instead.
	 */
	call(fn: LuauFunction, args: readonly unknown[] = []): unknown[] {
		const L = this.L;
		const base = this.M._lb_gettop(L);
		this.ensureStack(L, args.length + 1);
		this.M._lb_getref(L, fn.ref);
		for (const arg of args) this.push(L, arg);
		const status = this.enter(() => this.M._lb_pcall(L, args.length, -1));
		if (status !== LUA_OK) {
			const message = this.read(L, -1);
			this.M._lb_settop(L, base);
			throw new LuauError(String(message), message);
		}
		const results = this.readRange(L, base + 1, this.M._lb_gettop(L));
		this.M._lb_settop(L, base);
		return results;
	}

	/** Run a Luau function in a new thread (`task.spawn`). */
	spawn(fn: LuauFunction, args: readonly unknown[] = []): ThreadResult {
		const co = this.M._lb_newthread(this.L);
		const ref = this.M._lb_ref(this.L, -1);
		this.M._lb_settop(this.L, -2);
		try {
			this.ensureStack(co, args.length + 1);
			this.M._lb_getref(co, fn.ref);
			for (const arg of args) this.push(co, arg);
			return this.resume(co, args.length);
		} finally {
			this.M._lb_unref(this.L, ref);
		}
	}

	/**
	 * Resume a Luau thread (`task.defer`'s and `task.delay`'s, made with
	 * `coroutine.create`). A thread that cannot be resumed — finished, running,
	 * or closed by `task.cancel` — is left alone and gives `undefined`.
	 */
	resumeThread(
		thread: LuauThread,
		args: readonly unknown[] = [],
	): ThreadResult | undefined {
		const co = this.threadOf(thread);
		if (this.M._lb_costatus(this.L, co) !== LUA_COSUS) return undefined;
		this.ensureStack(co, args.length);
		for (const arg of args) this.push(co, arg);
		return this.resume(co, args.length);
	}

	/** Hand an error to `onError`, as if it had escaped a thread. */
	report(error: LuauError): void {
		this.onError(error);
	}

	/** Collect garbage now (tests use it to observe userdata release). */
	collect(): void {
		this.M._lb_gc(this.L);
	}

	/** Close the state. Every reference into it is dead afterwards. */
	close(): void {
		if (this.closed) return;
		this.M._lb_close(this.L);
		this.closed = true;
	}

	/** Whether `close` has run: every entry into Luau throws afterwards. */
	get isClosed(): boolean {
		return this.closed;
	}

	/** How many JS objects Luau currently holds as userdata. */
	get liveHostObjects(): number {
		return this.handles.size;
	}

	// --- internals used by the reference classes -------------------------------

	/** @internal */
	track(owner: LuauRef, ref: number): void {
		this.refs.register(owner, ref);
	}

	/** @internal */
	tableGet(table: LuauTable, key: unknown): unknown {
		const L = this.L;
		const base = this.M._lb_gettop(L);
		this.M._lb_getref(L, table.ref);
		this.push(L, key);
		this.M._lb_rawget(L, -2);
		const value = this.read(L, -1);
		this.M._lb_settop(L, base);
		return value;
	}

	/** @internal */
	tableSet(table: LuauTable, key: unknown, value: unknown): void {
		const L = this.L;
		const base = this.M._lb_gettop(L);
		this.M._lb_getref(L, table.ref);
		this.push(L, key);
		this.push(L, value);
		this.M._lb_rawset(L, -3);
		this.M._lb_settop(L, base);
	}

	/** @internal */
	tableLength(table: LuauTable): number {
		const L = this.L;
		this.M._lb_getref(L, table.ref);
		const n = this.M._lb_objlen(L, -1);
		this.M._lb_settop(L, -2);
		return n;
	}

	/** @internal */
	tableEntries(table: LuauTable): [unknown, unknown][] {
		const L = this.L;
		const base = this.M._lb_gettop(L);
		this.M._lb_getref(L, table.ref);
		this.M._lb_pushnil(L);
		const out: [unknown, unknown][] = [];
		while (this.M._lb_next(L, base + 1) !== 0) {
			out.push([this.read(L, -2), this.read(L, -1)]);
			this.M._lb_settop(L, -2);
		}
		this.M._lb_settop(L, base);
		return out;
	}

	// --- threads ---------------------------------------------------------------

	/** Resume `co` with the top `nargs` values of its stack. */
	private resume(co: number, nargs: number): ThreadResult {
		const result = this.resumeOnce(co, nargs);
		if (result.status !== "yielded") {
			const finish = this.finishers.get(co);
			if (finish) {
				this.finishers.delete(co);
				finish(result);
			}
		}
		return result;
	}

	private resumeOnce(co: number, nargs: number): ThreadResult {
		const status = this.enter(() => this.M._lb_resume(co, 0, nargs));
		if (status === LUA_OK) {
			const values = this.readRange(co, 1, this.M._lb_gettop(co));
			this.M._lb_settop(co, 0);
			return { status: "done", values };
		}
		if (status === LUA_YIELD) {
			this.M._lb_settop(co, 0);
			return { status: "yielded" };
		}
		const value = this.read(co, -1);
		const traceback = this.M.UTF8ToString(this.M._lb_debugtrace(co));
		this.M._lb_settop(co, 0);
		const error = new LuauError(String(value), value, traceback);
		this.onError(error);
		return { status: "error", error };
	}

	/**
	 * A host function returned `suspend` on thread `co`. Keep the thread alive
	 * and hand `wait` its resume function once Luau has unwound — only then is
	 * the thread really suspended, whoever resumed it.
	 */
	/** The `lua_State*` behind a thread reference. */
	private threadOf(thread: LuauThread): number {
		if (thread.vm !== this)
			throw new TypeError("loom luau: a thread from another VM");
		this.M._lb_getref(this.L, thread.ref);
		const co = this.M._lb_tothread(this.L, -1);
		this.M._lb_settop(this.L, -2);
		return co;
	}

	private suspend(co: number, suspend: Suspend): void {
		const ref = this.M._lb_refthread(co);
		let resumed = false;
		queueMicrotask(() => {
			suspend.wait((...values) => {
				if (resumed || this.closed) return;
				resumed = true;
				try {
					// `task.cancel` may have closed it in the meantime.
					if (this.M._lb_costatus(this.L, co) !== LUA_COSUS) return;
					this.ensureStack(co, values.length);
					for (const value of values) this.push(co, value);
					this.resume(co, values.length);
				} finally {
					this.M._lb_unref(this.L, ref);
				}
			});
		});
	}

	/** Run `fn` as one entry into Luau, under the run-time budget. */
	private enter<T>(fn: () => T): T {
		if (this.closed) throw new Error("loom luau: the VM is closed");
		if (this.depth === 0 && this.budgetMs > 0) this.M._lb_budget(this.budgetMs);
		this.depth++;
		try {
			return fn();
		} finally {
			this.depth--;
			if (this.depth === 0) this.M._lb_budget(0);
		}
	}

	// --- host calls ------------------------------------------------------------

	private register(entry: HostEntry): number {
		this.entries.push(entry);
		return this.entries.length - 1;
	}

	private hostCall(L: number, id: number): number {
		const entry = this.entries[id];
		const args = this.readRange(L, 1, this.M._lb_gettop(L));
		try {
			const result = (entry as HostEntry)(L, args);
			if (result instanceof Suspend) {
				this.suspend(L, result);
				return LB_YIELD;
			}
			return this.pushResults(L, result);
		} catch (error) {
			this.push(L, errorValue(error));
			return LB_ERROR;
		}
	}

	private pushResults(L: number, result: unknown): number {
		if (result === undefined) return 0;
		if (result instanceof Tuple) {
			this.ensureStack(L, result.values.length);
			for (const value of result.values) this.push(L, value);
			return result.values.length;
		}
		this.push(L, result);
		return 1;
	}

	private hostRelease(handle: number): void {
		const entry = this.handles.get(handle);
		if (entry === undefined) return;
		entry.count--;
		if (entry.count > 0) return;
		this.handles.delete(handle);
		this.handleOf.delete(entry.value);
	}

	/** The host function behind metamethod `name`, shared by every class. */
	private metamethod(name: (typeof METAMETHODS)[number]): HostEntry {
		const self = (args: unknown[]): [object, HostClass] => {
			const value = args[0] as object;
			return [value, this.classOf(value) as HostClass];
		};
		const binary =
			(
				op:
					| "add"
					| "sub"
					| "mul"
					| "div"
					| "idiv"
					| "mod"
					| "pow"
					| "lt"
					| "le",
			) =>
			(_: number, args: unknown[]) => {
				const cls = this.classOf(args[0]) ?? this.classOf(args[1]);
				const hook = cls?.[op];
				if (hook === undefined) {
					throw new LuauError(
						`attempt to perform arithmetic (${op}) on ${cls?.name ?? "userdata"}`,
					);
				}
				return hook.call(cls, args[0], args[1]);
			};
		switch (name) {
			case "__index":
				return (_, args) => {
					const [value, cls] = self(args);
					if (cls.index === undefined)
						throw new LuauError(
							`${String(args[1])} is not a valid member of ${cls.name}`,
						);
					return cls.index(value, args[1]);
				};
			case "__newindex":
				return (_, args) => {
					const [value, cls] = self(args);
					if (cls.newindex === undefined)
						throw new LuauError(`${String(args[1])} cannot be assigned to`);
					cls.newindex(value, args[1], args[2]);
					return undefined;
				};
			case "__namecall":
				return (L, args) => {
					const method = this.M.UTF8ToString(this.M._lb_namecall(L));
					const [value, cls] = self(args);
					if (cls.namecall === undefined)
						throw new LuauError(
							`${method} is not a valid member of ${cls.name}`,
						);
					return cls.namecall(value, method, args.slice(1));
				};
			case "__call":
				return (_, args) => {
					const [value, cls] = self(args);
					if (cls.call === undefined)
						throw new LuauError(`attempt to call a ${cls.name} value`);
					return cls.call(value, args.slice(1));
				};
			case "__tostring":
				return (_, args) => {
					const [value, cls] = self(args);
					return cls.tostring?.(value) ?? cls.name;
				};
			case "__eq":
				return (_, args) => {
					const [value, cls] = self(args);
					return cls.eq?.(value, args[1]) ?? value === args[1];
				};
			case "__len":
				return (_, args) => {
					const [value, cls] = self(args);
					if (cls.len === undefined)
						throw new LuauError(`attempt to get length of a ${cls.name} value`);
					return cls.len(value);
				};
			case "__unm":
				return (_, args) => {
					const [value, cls] = self(args);
					if (cls.unm === undefined)
						throw new LuauError(
							`attempt to perform arithmetic (unm) on ${cls.name}`,
						);
					return cls.unm(value);
				};
			default:
				return binary(name.slice(2) as Parameters<typeof binary>[0]);
		}
	}

	private classOf(value: unknown): HostClass | undefined {
		if (typeof value !== "object" || value === null) return undefined;
		const handle = this.handleOf.get(value);
		return handle === undefined ? undefined : this.handles.get(handle)?.cls;
	}

	private metatableFor(cls: HostClass): number {
		const existing = this.metatables.get(cls);
		if (existing !== undefined) return existing;
		const L = this.L;
		this.M._lb_newtable(L, 0, METAMETHODS.length + 2);
		for (const name of METAMETHODS) {
			this.M._lb_pushfunction(
				L,
				this.metamethodIds.get(name) as number,
				this.debugName(name),
			);
			this.M._lb_setfield(L, -2, this.cstr(name));
		}
		this.pushString(L, cls.name);
		this.M._lb_setfield(L, -2, this.cstr("__type"));
		this.pushString(L, "The metatable is locked");
		this.M._lb_setfield(L, -2, this.cstr("__metatable"));
		this.M._lb_setreadonly(L, -1, 1);
		const ref = this.M._lb_ref(L, -1);
		this.M._lb_settop(L, -2);
		this.metatables.set(cls, ref);
		return ref;
	}

	// --- marshaling ------------------------------------------------------------

	private read(L: number, idx: number): unknown {
		switch (this.M._lb_kind(L, idx)) {
			case KIND_NIL:
				return undefined;
			case KIND_BOOLEAN:
				return this.M._lb_toboolean(L, idx) !== 0;
			case KIND_NUMBER:
				return this.M._lb_tonumber(L, idx);
			case KIND_STRING: {
				const ptr = this.M._lb_tostring(L, idx, this.lenPtr);
				const len = this.M.HEAPU32[this.lenPtr >> 2] as number;
				return decoder.decode(this.M.HEAPU8.subarray(ptr, ptr + len));
			}
			case KIND_HOST:
				return this.handles.get(this.M._lb_tohost(L, idx))?.value;
			case KIND_TABLE:
				return new LuauTable(this, this.M._lb_ref(L, idx));
			case KIND_FUNCTION:
				return new LuauFunction(this, this.M._lb_ref(L, idx));
			case KIND_THREAD:
				return new LuauThread(this, this.M._lb_ref(L, idx));
			default:
				return new LuauOpaque(
					this,
					this.M._lb_ref(L, idx),
					this.M.UTF8ToString(this.M._lb_typeof(L, idx)),
				);
		}
	}

	private readRange(L: number, from: number, to: number): unknown[] {
		const out: unknown[] = [];
		for (let i = from; i <= to; i++) out.push(this.read(L, i));
		return out;
	}

	private push(L: number, value: unknown): void {
		this.ensureStack(L, 3);
		switch (typeof value) {
			case "undefined":
				this.M._lb_pushnil(L);
				return;
			case "boolean":
				this.M._lb_pushboolean(L, value ? 1 : 0);
				return;
			case "number":
				this.M._lb_pushnumber(L, value);
				return;
			case "bigint":
				this.M._lb_pushnumber(L, Number(value));
				return;
			case "string":
				this.pushString(L, value);
				return;
			case "function":
				this.M._lb_pushfunction(
					L,
					this.functionId(value as (...args: never[]) => unknown),
					this.debugName(value.name || "host"),
				);
				return;
			case "symbol":
				throw new TypeError("loom luau: a symbol cannot cross into Luau");
		}
		if (value === null) {
			this.M._lb_pushnil(L);
			return;
		}
		if (value instanceof LuauRef) {
			if (value.vm !== this)
				throw new TypeError(
					"loom luau: a value from another VM cannot cross into this one",
				);
			this.M._lb_getref(L, value.ref);
			return;
		}
		const cls = this.classify(value as object);
		if (cls !== undefined) {
			this.pushHost(L, value as object, cls);
			return;
		}
		if (Array.isArray(value)) {
			this.M._lb_newtable(L, value.length, 0);
			value.forEach((item, i) => {
				this.push(L, item);
				this.M._lb_rawseti(L, -2, i + 1);
			});
			return;
		}
		const proto = Object.getPrototypeOf(value);
		if (proto === Object.prototype || proto === null) {
			const fields = Object.entries(value as object);
			this.M._lb_newtable(L, 0, fields.length);
			for (const [key, item] of fields) {
				this.pushString(L, key);
				this.push(L, item);
				this.M._lb_rawset(L, -3);
			}
			return;
		}
		throw new TypeError(
			`loom luau: no HostClass for ${proto?.constructor?.name ?? "object"}; cannot cross into Luau`,
		);
	}

	private pushHost(L: number, value: object, cls: HostClass): void {
		let handle = this.handleOf.get(value);
		if (handle === undefined) {
			handle = this.nextHandle++;
			this.handleOf.set(value, handle);
			this.handles.set(handle, { value, cls, count: 0 });
		}
		const created = this.M._lb_pushhost(L, handle, this.metatableFor(cls));
		if (created !== 0) (this.handles.get(handle) as HostHandle).count++;
	}

	private functionId(fn: (...args: never[]) => unknown): number {
		let id = this.functionIds.get(fn);
		if (id === undefined) {
			id = this.register((_, args) =>
				(fn as (...args: unknown[]) => unknown)(...args),
			);
			this.functionIds.set(fn, id);
		}
		return id;
	}

	private ensureStack(L: number, n: number): void {
		if (this.M._lb_checkstack(L, n) === 0)
			throw new LuauError("stack overflow");
	}

	private loadOnto(L: number, source: string, chunkname: string): number {
		const name = encoder.encode(`${chunkname}\0`);
		const namePtr = this.M._malloc(name.length);
		this.M.HEAPU8.set(name, namePtr);
		try {
			const bytes = encoder.encode(source);
			const ptr = this.reserve(bytes.length);
			this.M.HEAPU8.set(bytes, ptr);
			return this.M._lb_load(L, namePtr, ptr, bytes.length);
		} finally {
			this.M._free(namePtr);
		}
	}

	private pushString(L: number, value: string): void {
		const bytes = encoder.encode(value);
		const ptr = this.reserve(bytes.length);
		this.M.HEAPU8.set(bytes, ptr);
		this.M._lb_pushstring(L, ptr, bytes.length);
	}

	/** A NUL-terminated copy of `value` in the scratch buffer (overwritten by the next use). */
	private cstr(value: string): number {
		const bytes = encoder.encode(`${value}\0`);
		const ptr = this.reserve(bytes.length);
		this.M.HEAPU8.set(bytes, ptr);
		return ptr;
	}

	/** A permanent NUL-terminated string: Luau keeps C function debug names by pointer. */
	private debugName(name: string): number {
		let ptr = this.debugNames.get(name);
		if (ptr === undefined) {
			const bytes = encoder.encode(`${name}\0`);
			ptr = this.M._malloc(bytes.length);
			this.M.HEAPU8.set(bytes, ptr);
			this.debugNames.set(name, ptr);
		}
		return ptr;
	}

	private reserve(size: number): number {
		if (size > this.scratchSize) {
			if (this.scratch !== 0) this.M._free(this.scratch);
			this.scratchSize = Math.max(size, 256, this.scratchSize * 2);
			this.scratch = this.M._malloc(this.scratchSize);
		}
		return this.scratch;
	}
}

/** What a JS exception becomes when it is raised into Luau. */
function errorValue(error: unknown): unknown {
	if (error instanceof LuauError) return error.value;
	if (error instanceof Error) return error.message;
	return error;
}
