import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	LoomPromise,
	LoomPromiseError,
	PromiseStatus,
	RobloxPromise,
} from "./promise";

/** A Roblox-shaped event, for the `Promise.fromEvent` tests. */
class FakeEvent {
	private listeners: ((...args: unknown[]) => void)[] = [];

	Connect(callback: (...args: unknown[]) => void): { Disconnect(): void } {
		this.listeners.push(callback);
		return {
			Disconnect: () => {
				this.listeners = this.listeners.filter((l) => l !== callback);
			},
		};
	}

	get connectionCount(): number {
		return this.listeners.length;
	}

	fire(...args: unknown[]): void {
		for (const listener of [...this.listeners]) listener(...args);
	}
}

/** Let the unhandled-rejection watchdog's `setTimeout(0)` fire. */
const settleWatchdog = (): Promise<void> =>
	new Promise((resolve) => setTimeout(resolve, 5));

const sleep = (ms: number): Promise<void> =>
	new Promise((resolve) => setTimeout(resolve, ms));

let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
	// Every unobserved rejection in this file would otherwise print; the
	// watchdog test asserts against this same spy.
	warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
	warnSpy.mockRestore();
});

describe("construction", () => {
	it("exports under a name that leaves the native Promise alone", () => {
		expect(RobloxPromise).toBe(LoomPromise);
		expect(globalThis.Promise).not.toBe(LoomPromise);
		expect(LoomPromise.Status).toBe(PromiseStatus);
		expect(LoomPromise.Error).toBe(LoomPromiseError);
		expect(LoomPromise.Status.Resolved).toBe("Resolved");
	});

	it("runs the executor synchronously, from both spellings", () => {
		const order: string[] = [];
		new LoomPromise<void>(() => {
			order.push("constructor");
		});
		LoomPromise.new<void>(() => {
			order.push("static");
		});
		order.push("after");
		expect(order).toEqual(["constructor", "static", "after"]);
	});

	it("turns a thrown string into a Promise.Error(ExecutionError)", async () => {
		const [ok, reason] = await LoomPromise.new(() => {
			throw "kaboom";
		}).await();
		expect(ok).toBe(false);
		expect(LoomPromiseError.isKind(reason, "ExecutionError")).toBe(true);
		expect((reason as LoomPromiseError).error).toBe("kaboom");
	});

	it("forwards a thrown Error object untouched", async () => {
		const thrown = new Error("nope");
		const [, reason] = await LoomPromise.new(() => {
			throw thrown;
		}).await();
		expect(reason).toBe(thrown);
	});

	it("chains when the executor resolves with another promise", async () => {
		const inner = LoomPromise.resolve(7);
		const outer = LoomPromise.new<number>((resolve) => resolve(inner));
		expect(await outer.expect()).toBe(7);
	});

	it("adopts a native thenable handed to resolve", async () => {
		const outer = LoomPromise.new<number>((resolve) =>
			resolve(globalThis.Promise.resolve(11)),
		);
		expect(outer.getStatus()).toBe(PromiseStatus.Started);
		expect(await outer.expect()).toBe(11);
	});

	it("defer keeps the executor out of the caller's frame", async () => {
		const order: string[] = [];
		const deferred = LoomPromise.defer<number>((resolve) => {
			order.push("executor");
			resolve(1);
		});
		order.push("after");
		expect(order).toEqual(["after"]);
		expect(await deferred.expect()).toBe(1);
		expect(order).toEqual(["after", "executor"]);
	});
});

describe("andThen and friends", () => {
	it("runs handlers synchronously, the way Roblox does", () => {
		const order: string[] = [];
		LoomPromise.resolve(1).andThen(() => {
			order.push("handler");
		});
		order.push("after");
		expect(order).toEqual(["handler", "after"]);
	});

	it("passes the resolved value along and chains a returned promise", async () => {
		const result = await LoomPromise.resolve(2)
			.andThen((n) => n * 3)
			.andThen((n) => LoomPromise.resolve(n + 1))
			.expect();
		expect(result).toBe(7);
	});

	it("routes a throw in the handler to the next rejection handler", async () => {
		const reason = await LoomPromise.resolve(1)
			.andThen(() => {
				throw "handler blew up";
			})
			.catch((err) => (err as LoomPromiseError).error)
			.expect();
		expect(reason).toBe("handler blew up");
	});

	it("catch recovers the chain", async () => {
		expect(
			await LoomPromise.reject("bad")
				.catch(() => "recovered")
				.expect(),
		).toBe("recovered");
	});

	it("tap sees the value without replacing it", async () => {
		const seen: number[] = [];
		const value = await LoomPromise.resolve(3)
			.tap((n) => {
				seen.push(n);
				return 99;
			})
			.expect();
		expect(value).toBe(3);
		expect(seen).toEqual([3]);
	});

	it("tap waits for a promise the handler returns, then passes through", async () => {
		let finished = false;
		const value = await LoomPromise.resolve(3)
			.tap(() =>
				LoomPromise.delay(0.02).andThen(() => {
					finished = true;
				}),
			)
			.expect();
		expect(finished).toBe(true);
		expect(value).toBe(3);
	});

	it("andThenCall calls with fixed arguments, andThenReturn replaces the value", async () => {
		const callback = vi.fn((a: number, b: number) => a + b);
		expect(
			await LoomPromise.resolve("ignored").andThenCall(callback, 2, 3).expect(),
		).toBe(5);
		expect(callback).toHaveBeenCalledWith(2, 3);
		expect(await LoomPromise.resolve(1).andThenReturn("x").expect()).toBe("x");
	});

	it("rejects the argument checks Roblox rejects", () => {
		const resolved = LoomPromise.resolve(1);
		expect(() => resolved.andThen(42 as unknown as () => void)).toThrow(
			"Promise:andThen",
		);
		expect(() => resolved.tap(42 as unknown as () => void)).toThrow(
			"Promise:tap",
		);
	});
});

describe("thenable bridge", () => {
	it("supports a plain `await`", async () => {
		expect(await LoomPromise.resolve(5)).toBe(5);
	});

	it("throws the rejection reason out of `await`", async () => {
		let caught: unknown;
		try {
			await LoomPromise.reject("bad");
		} catch (err) {
			caught = err;
		}
		expect(caught).toBe("bad");
	});

	it("rejects an `await` on a cancelled promise instead of hanging", async () => {
		const pending = new LoomPromise<number>(() => {});
		queueMicrotask(() => pending.cancel());
		let caught: unknown;
		try {
			await pending;
		} catch (err) {
			caught = err;
		}
		expect(LoomPromiseError.isKind(caught, "AlreadyCancelled")).toBe(true);
	});

	it("does not become a consumer, so awaiting cannot block cancellation", () => {
		const parent = new LoomPromise<number>(() => {});
		const child = parent.andThen((n) => n);
		parent.then(() => {}).catch(() => {});
		child.cancel();
		expect(parent.getStatus()).toBe(PromiseStatus.Cancelled);
	});
});

describe("cancellation", () => {
	it("settles to Cancelled, runs the hook, and ignores a later resolve", () => {
		let resolveLater!: (value: number) => void;
		let aborted = false;
		const promise = new LoomPromise<number>((resolve, _reject, onCancel) => {
			resolveLater = resolve;
			onCancel(() => {
				aborted = true;
			});
		});
		const onRejected = vi.fn();
		promise.catch(onRejected);

		promise.cancel();
		expect(promise.getStatus()).toBe(PromiseStatus.Cancelled);
		expect(aborted).toBe(true);

		resolveLater(1);
		expect(promise.getStatus()).toBe(PromiseStatus.Cancelled);
		expect(onRejected).not.toHaveBeenCalled();
	});

	it("reports the current state from onCancel and runs a late hook at once", () => {
		let probe!: (abortHandler?: () => void) => boolean;
		const promise = new LoomPromise<number>((_resolve, _reject, onCancel) => {
			probe = onCancel;
			expect(onCancel()).toBe(false);
		});
		promise.cancel();
		let late = false;
		expect(
			probe(() => {
				late = true;
			}),
		).toBe(true);
		expect(late).toBe(true);
	});

	it("cancels the parent once its last consumer gives up", () => {
		let aborted = false;
		const parent = new LoomPromise<number>((_resolve, _reject, onCancel) => {
			onCancel(() => {
				aborted = true;
			});
		});
		const first = parent.andThen((n) => n);
		const second = parent.andThen((n) => n);

		first.cancel();
		expect(parent.getStatus()).toBe(PromiseStatus.Started);
		expect(aborted).toBe(false);

		second.cancel();
		expect(parent.getStatus()).toBe(PromiseStatus.Cancelled);
		expect(aborted).toBe(true);
	});

	it("cancels every consumer downstream", () => {
		const parent = new LoomPromise<number>(() => {});
		const child = parent.andThen((n) => n);
		const grandchild = child.andThen((n) => n);
		parent.cancel();
		expect(child.getStatus()).toBe(PromiseStatus.Cancelled);
		expect(grandchild.getStatus()).toBe(PromiseStatus.Cancelled);
	});

	it("never runs andThen handlers on a cancelled promise", () => {
		const onResolved = vi.fn();
		const onRejected = vi.fn();
		const promise = new LoomPromise<number>(() => {});
		promise.andThen(onResolved, onRejected);
		promise.cancel();
		expect(onResolved).not.toHaveBeenCalled();
		expect(onRejected).not.toHaveBeenCalled();
	});

	it("andThen on an already-cancelled promise returns a cancelled promise", () => {
		const promise = new LoomPromise<number>(() => {});
		promise.cancel();
		const onResolved = vi.fn();
		const child = promise.andThen(onResolved);
		expect(child.getStatus()).toBe(PromiseStatus.Cancelled);
		expect(onResolved).not.toHaveBeenCalled();
	});

	it("unqueues a cancelled link so a later settle skips it", () => {
		let resolveLater!: (value: number) => void;
		const parent = new LoomPromise<number>((resolve) => {
			resolveLater = resolve;
		});
		const kept = vi.fn();
		const dropped = vi.fn();
		parent.andThen(kept);
		parent.andThen(dropped).cancel();

		resolveLater(1);
		expect(kept).toHaveBeenCalledWith(1);
		expect(dropped).not.toHaveBeenCalled();
	});
});

describe("finally and done", () => {
	it("runs on resolve, on reject and on cancel", async () => {
		const seen: PromiseStatus[] = [];
		LoomPromise.resolve(1).finally((status) => {
			seen.push(status);
		});
		LoomPromise.reject("x").finally((status) => {
			seen.push(status);
		});
		const cancelled = new LoomPromise<number>(() => {});
		cancelled.finally((status) => {
			seen.push(status);
		});
		cancelled.cancel();

		expect(seen).toEqual(["Resolved", "Rejected", "Cancelled"]);
		await settleWatchdog();
	});

	it("passes the settled value through and discards the handler's return", async () => {
		expect(
			await LoomPromise.resolve(7)
				.finally(() => 99)
				.expect(),
		).toBe(7);
		expect(await LoomPromise.resolve(7).finallyReturn(99).expect()).toBe(7);

		const callback = vi.fn(() => 99);
		expect(
			await LoomPromise.resolve(7)
				.finallyCall(callback, ...[])
				.expect(),
		).toBe(7);
		expect(callback).toHaveBeenCalledTimes(1);
	});

	it("passes a rejection through", async () => {
		const chained = LoomPromise.reject("bad").finally(() => {});
		await expect(chained.await()).resolves.toEqual([false, "bad"]);
	});

	it("rejects the chain when the handler throws", async () => {
		const [ok, reason] = await LoomPromise.resolve(1)
			.finally(() => {
				throw "cleanup failed";
			})
			.await();
		expect(ok).toBe(false);
		expect(LoomPromiseError.isKind(reason, "ExecutionError")).toBe(true);
	});

	it("waits for a promise from the handler, and rejects if it rejects", async () => {
		let finished = false;
		expect(
			await LoomPromise.resolve(4)
				.finally(() =>
					LoomPromise.delay(0.02).andThen(() => {
						finished = true;
					}),
				)
				.expect(),
		).toBe(4);
		expect(finished).toBe(true);

		await expect(
			LoomPromise.resolve(4)
				.finally(() => LoomPromise.reject("cleanup rejected"))
				.await(),
		).resolves.toEqual([false, "cleanup rejected"]);
	});

	it("does not count as a consumer for cancellation", () => {
		const parent = new LoomPromise<number>(() => {});
		const child = parent.andThen((n) => n);
		const cleanup = vi.fn();
		parent.finally(cleanup);

		child.cancel();
		expect(parent.getStatus()).toBe(PromiseStatus.Cancelled);
		expect(cleanup).toHaveBeenCalledWith("Cancelled");
	});

	it("done skips the handler on rejection but still propagates it", async () => {
		const handler = vi.fn();
		const chained = LoomPromise.reject("boom").done(handler);
		expect(handler).not.toHaveBeenCalled();
		await expect(chained.await()).resolves.toEqual([false, "boom"]);
	});

	it("done runs on resolve and on cancel", () => {
		const seen: PromiseStatus[] = [];
		LoomPromise.resolve(1).done((status) => {
			seen.push(status);
		});
		const cancelled = new LoomPromise<number>(() => {});
		cancelled.done((status) => {
			seen.push(status);
		});
		cancelled.cancel();
		expect(seen).toEqual(["Resolved", "Cancelled"]);
	});

	it("doneCall and doneReturn pass the settled value through", async () => {
		const callback = vi.fn();
		expect(await LoomPromise.resolve(8).doneCall(callback, "a").expect()).toBe(
			8,
		);
		expect(callback).toHaveBeenCalledWith("a");
		expect(await LoomPromise.resolve(8).doneReturn("z").expect()).toBe(8);
	});
});

describe("await, awaitStatus and expect", () => {
	it("await gives the (ok, value) tuple", async () => {
		await expect(LoomPromise.resolve(1).await()).resolves.toEqual([true, 1]);
		await expect(LoomPromise.reject("x").await()).resolves.toEqual([
			false,
			"x",
		]);
		const cancelled = new LoomPromise<number>(() => {});
		cancelled.cancel();
		await expect(cancelled.await()).resolves.toEqual([false, undefined]);
	});

	it("awaitStatus distinguishes a cancellation from a rejection", async () => {
		await expect(LoomPromise.resolve(1).awaitStatus()).resolves.toEqual([
			"Resolved",
			1,
		]);
		await expect(LoomPromise.reject("x").awaitStatus()).resolves.toEqual([
			"Rejected",
			"x",
		]);
		const cancelled = new LoomPromise<number>(() => {});
		cancelled.cancel();
		await expect(cancelled.awaitStatus()).resolves.toEqual([
			"Cancelled",
			undefined,
		]);
	});

	it("resolves once the promise settles later", async () => {
		const promise = new LoomPromise<number>((resolve) => {
			setTimeout(() => resolve(42), 5);
		});
		expect(promise.getStatus()).toBe(PromiseStatus.Started);
		await expect(promise.await()).resolves.toEqual([true, 42]);
		expect(promise.getStatus()).toBe(PromiseStatus.Resolved);
	});

	it("expect throws the rejection value, and awaitValue is its old name", async () => {
		let caught: unknown;
		try {
			await LoomPromise.reject("bad").expect();
		} catch (err) {
			caught = err;
		}
		expect(caught).toBe("bad");
		expect(await LoomPromise.resolve(4).awaitValue()).toBe(4);
	});

	it("expect throws when the promise was cancelled", async () => {
		const cancelled = new LoomPromise<number>(() => {});
		cancelled.cancel();
		let caught: unknown;
		try {
			await cancelled.expect();
		} catch (err) {
			caught = err;
		}
		expect(caught).toBeInstanceOf(Error);
	});
});

describe("delay, timeout and now", () => {
	it("resolves with the time actually waited", async () => {
		const started = performance.now();
		const waited = await LoomPromise.delay(0.05).expect();
		expect(performance.now() - started).toBeGreaterThanOrEqual(40);
		expect(waited).toBeGreaterThan(0.03);
	});

	it("clamps NaN and sub-frame waits to one frame instead of hanging", async () => {
		expect(await LoomPromise.delay(Number.NaN).expect()).toBeGreaterThan(0);
		expect(await LoomPromise.delay(0).expect()).toBeGreaterThan(0);
	});

	it("cancelling a delay stops it settling", async () => {
		const onSettled = vi.fn();
		const delayed = LoomPromise.delay(0.02);
		delayed.finally(onSettled);
		delayed.cancel();

		expect(delayed.getStatus()).toBe(PromiseStatus.Cancelled);
		await sleep(50);
		expect(delayed.getStatus()).toBe(PromiseStatus.Cancelled);
		expect(onSettled).toHaveBeenCalledTimes(1);
		expect(onSettled).toHaveBeenCalledWith("Cancelled");
	});

	it("timeout rejects with a TimedOut error and cancels the source", async () => {
		const slow = new LoomPromise<number>(() => {});
		const [ok, reason] = await slow.timeout(0.02).await();
		expect(ok).toBe(false);
		expect(LoomPromiseError.isKind(reason, "TimedOut")).toBe(true);
		expect(slow.getStatus()).toBe(PromiseStatus.Cancelled);
	});

	it("timeout takes a custom rejection value and lets a fast promise through", async () => {
		expect(await LoomPromise.resolve(1).timeout(1).expect()).toBe(1);
		const [, reason] = await new LoomPromise<number>(() => {})
			.timeout(0.02, "too slow")
			.await();
		expect(reason).toBe("too slow");
	});

	it("now resolves only when the promise has already resolved", async () => {
		expect(LoomPromise.resolve(3).now().getStatus()).toBe(
			PromiseStatus.Resolved,
		);

		const pending = new LoomPromise<number>(() => {});
		const notYet = pending.now();
		expect(notYet.getStatus()).toBe(PromiseStatus.Rejected);
		const [, reason] = await notYet.await();
		expect(LoomPromiseError.isKind(reason, "NotResolvedInTime")).toBe(true);
	});
});

describe("combinators", () => {
	it("all resolves with every value in input order", async () => {
		const values = await LoomPromise.all([
			LoomPromise.delay(0.03).andThenReturn(1),
			LoomPromise.resolve(2),
			LoomPromise.delay(0.01).andThenReturn(3),
		]).expect();
		expect(values).toEqual([1, 2, 3]);
		expect(await LoomPromise.all<number>([]).expect()).toEqual([]);
	});

	it("all rejects on the first rejection and cancels the rest", async () => {
		const slow = LoomPromise.delay(0.2).andThenReturn("slow");
		const [ok, reason] = await LoomPromise.all<unknown>([
			slow,
			LoomPromise.reject("bad"),
		]).await();
		expect(ok).toBe(false);
		expect(reason).toBe("bad");
		expect(slow.getStatus()).toBe(PromiseStatus.Cancelled);
	});

	it("all throws at the call site for a non-promise argument", () => {
		expect(() =>
			LoomPromise.all([1 as unknown as LoomPromise<number>]),
		).toThrow("Non-promise value passed into Promise.all at index 0");
		expect(() =>
			LoomPromise.all("nope" as unknown as LoomPromise<number>[]),
		).toThrow("Please pass a list of promises to Promise.all");
	});

	it("some resolves with the first count values, in completion order", async () => {
		const slow = LoomPromise.delay(0.15).andThenReturn("slow");
		const fast = LoomPromise.delay(0.01).andThenReturn("fast");
		const middle = LoomPromise.delay(0.06).andThenReturn("middle");

		expect(await LoomPromise.some([slow, fast, middle], 2).expect()).toEqual([
			"fast",
			"middle",
		]);
		expect(slow.getStatus()).toBe(PromiseStatus.Cancelled);
	});

	it("some rejects once the count is out of reach", async () => {
		const [ok, reason] = await LoomPromise.some<string>(
			[
				LoomPromise.reject("a"),
				LoomPromise.reject("b"),
				LoomPromise.resolve("c"),
			],
			2,
		).await();
		expect(ok).toBe(false);
		expect(reason).toBe("b");
	});

	it("any takes the first success and tolerates rejections", async () => {
		const failing = LoomPromise.delay(0.01).andThen(() =>
			LoomPromise.reject("a"),
		);
		const winning = LoomPromise.delay(0.04).andThenReturn("b");
		expect(await LoomPromise.any<string>([failing, winning]).expect()).toBe(
			"b",
		);

		const [ok] = await LoomPromise.any<string>([
			LoomPromise.reject("a"),
			LoomPromise.reject("b"),
		]).await();
		expect(ok).toBe(false);
	});

	it("allSettled reports one status per input and never rejects", async () => {
		const statuses = await LoomPromise.allSettled<unknown>([
			LoomPromise.resolve(1),
			LoomPromise.reject("x"),
			LoomPromise.delay(0.02),
		]).expect();
		expect(statuses).toEqual(["Resolved", "Rejected", "Resolved"]);
		await settleWatchdog();
		expect(warnSpy).not.toHaveBeenCalled();
	});

	it("race settles with the first promise and cancels the losers", async () => {
		const fast = LoomPromise.delay(0.01).andThenReturn("fast");
		const slow = LoomPromise.delay(0.2).andThenReturn("slow");
		expect(await LoomPromise.race([fast, slow]).expect()).toBe("fast");
		expect(slow.getStatus()).toBe(PromiseStatus.Cancelled);
	});

	it("race rejects when the first to settle rejects", async () => {
		const [ok, reason] = await LoomPromise.race<string>([
			LoomPromise.delay(0.01).andThen(() => LoomPromise.reject("first")),
			LoomPromise.delay(0.2).andThenReturn("second"),
		]).await();
		expect(ok).toBe(false);
		expect(reason).toBe("first");
	});

	it("each walks the list in order with 1-based Luau indices", async () => {
		const seen: [string, number][] = [];
		const results = await LoomPromise.each(["a", "b", "c"], (value, index) => {
			seen.push([value, index]);
			return LoomPromise.delay(0.01).andThenReturn(value.toUpperCase());
		}).expect();

		expect(results).toEqual(["A", "B", "C"]);
		expect(seen).toEqual([
			["a", 1],
			["b", 2],
			["c", 3],
		]);
	});

	it("each never overlaps two predicate calls", async () => {
		const trace: string[] = [];
		await LoomPromise.each([1, 2], (value) => {
			trace.push(`start ${value}`);
			return LoomPromise.delay(0.02).andThen(() => {
				trace.push(`end ${value}`);
			});
		}).expect();
		expect(trace).toEqual(["start 1", "end 1", "start 2", "end 2"]);
	});

	it("each awaits promises found in the list", async () => {
		const results = await LoomPromise.each<number, number>(
			[LoomPromise.delay(0.02).andThenReturn(10), 20],
			(value) => value + 1,
		).expect();
		expect(results).toEqual([11, 21]);
	});

	it("each rejects up front on an already-rejected entry", async () => {
		const predicate = vi.fn((value: string) => value);
		const [ok, reason] = await LoomPromise.each<string, string>(
			[LoomPromise.reject("bad"), "b"],
			predicate,
		).await();
		expect(ok).toBe(false);
		expect(reason).toBe("bad");
		expect(predicate).not.toHaveBeenCalled();
		await settleWatchdog();
		expect(warnSpy).not.toHaveBeenCalled();
	});

	it("each rejects up front on an already-cancelled entry", async () => {
		const cancelled = new LoomPromise<string>(() => {});
		cancelled.cancel();
		const [ok, reason] = await LoomPromise.each<string, string>(
			[cancelled],
			(value) => value,
		).await();
		expect(ok).toBe(false);
		expect(LoomPromiseError.isKind(reason, "AlreadyCancelled")).toBe(true);
	});

	it("fold accumulates over the list", async () => {
		expect(
			await LoomPromise.fold<number, number>(
				[1, 2, 3],
				(accumulator, value) => accumulator + value,
				0,
			).expect(),
		).toBe(6);

		expect(
			await LoomPromise.fold<number, number>(
				[1, 2, 3],
				(accumulator, value) => LoomPromise.resolve(accumulator + value),
				10,
			).expect(),
		).toBe(16);
	});

	it("fold stops at the first rejection", async () => {
		const [ok, reason] = await LoomPromise.fold<number, number>(
			[1, 2, 3],
			(accumulator, value) =>
				value === 2 ? LoomPromise.reject("stop") : accumulator + value,
			0,
		).await();
		expect(ok).toBe(false);
		expect(reason).toBe("stop");
	});
});

describe("retry, promisify, try and is", () => {
	it("retry keeps going until the promise resolves", async () => {
		let attempts = 0;
		const value = await LoomPromise.retry(() => {
			attempts += 1;
			return attempts < 3
				? LoomPromise.reject("nope")
				: LoomPromise.resolve("ok");
		}, 5).expect();
		expect(value).toBe("ok");
		expect(attempts).toBe(3);
	});

	it("retry gives up with the last rejection", async () => {
		let attempts = 0;
		const [ok, reason] = await LoomPromise.retry(() => {
			attempts += 1;
			return LoomPromise.reject(`fail ${attempts}`);
		}, 2).await();
		expect(ok).toBe(false);
		expect(reason).toBe("fail 3");
		expect(attempts).toBe(3);
	});

	it("retry forwards its extra arguments to every attempt", async () => {
		const callback = vi.fn((a: number, b: number) =>
			LoomPromise.resolve(a + b),
		);
		expect(await LoomPromise.retry(callback, 1, 2, 3).expect()).toBe(5);
		expect(callback).toHaveBeenCalledWith(2, 3);
	});

	it("retryWithDelay waits between attempts", async () => {
		let attempts = 0;
		const started = performance.now();
		const value = await LoomPromise.retryWithDelay(
			() => {
				attempts += 1;
				return attempts < 3
					? LoomPromise.reject("nope")
					: LoomPromise.resolve("ok");
			},
			5,
			0.03,
		).expect();
		expect(value).toBe("ok");
		expect(attempts).toBe(3);
		expect(performance.now() - started).toBeGreaterThanOrEqual(50);
	});

	it("promisify defers the call, try runs it now", async () => {
		const doubled = LoomPromise.promisify((n: number) => n * 2);
		expect(await doubled(21).expect()).toBe(42);

		const ran = vi.fn(() => "done");
		const attempted = LoomPromise.try(ran);
		expect(ran).toHaveBeenCalledTimes(1);
		expect(await attempted.expect()).toBe("done");

		const [ok, reason] = await LoomPromise.try(() => {
			throw "try blew up";
		}).await();
		expect(ok).toBe(false);
		expect(LoomPromiseError.isKind(reason, "ExecutionError")).toBe(true);
	});

	it("is duck-types on andThen, exactly as Roblox does", () => {
		expect(LoomPromise.is(LoomPromise.resolve(1))).toBe(true);
		expect(LoomPromise.is({ andThen: () => {} })).toBe(true);
		expect(LoomPromise.is({})).toBe(false);
		expect(LoomPromise.is(globalThis.Promise.resolve(1))).toBe(false);
		expect(LoomPromise.is(undefined)).toBe(false);
	});
});

describe("fromEvent", () => {
	it("resolves on the next fire and disconnects", async () => {
		const event = new FakeEvent();
		const promise = LoomPromise.fromEvent<string>(event);
		expect(event.connectionCount).toBe(1);

		event.fire("hello");
		expect(event.connectionCount).toBe(0);
		expect(await promise.expect()).toBe("hello");
	});

	it("waits until the predicate accepts a fire", async () => {
		const event = new FakeEvent();
		const promise = LoomPromise.fromEvent<string>(
			event,
			(value) => value === "yes",
		);

		event.fire("no");
		expect(promise.getStatus()).toBe(PromiseStatus.Started);
		expect(event.connectionCount).toBe(1);

		event.fire("yes");
		expect(await promise.expect()).toBe("yes");
		expect(event.connectionCount).toBe(0);
	});

	it("disconnects when cancelled", () => {
		const event = new FakeEvent();
		const promise = LoomPromise.fromEvent<string>(event);
		promise.cancel();
		expect(event.connectionCount).toBe(0);
	});
});

describe("unhandled rejections", () => {
	it("reaches registered handlers with the promise as `this`", async () => {
		const seen: unknown[] = [];
		let culprit: unknown;
		const disconnect = LoomPromise.onUnhandledRejection(function (
			this: LoomPromise<unknown>,
			reason,
		) {
			culprit = this;
			seen.push(reason);
		});

		const rejected = LoomPromise.reject("kaboom");
		await settleWatchdog();

		expect(seen).toEqual(["kaboom"]);
		expect(culprit).toBe(rejected);
		expect(warnSpy).not.toHaveBeenCalled();

		disconnect();
		LoomPromise.reject("after disconnect");
		await settleWatchdog();
		expect(seen).toEqual(["kaboom"]);
	});

	it("stays quiet when something observes the rejection", async () => {
		const handler = vi.fn();
		const disconnect = LoomPromise.onUnhandledRejection(handler);

		LoomPromise.reject("caught").catch(() => {});
		void LoomPromise.reject("awaited").await();
		await settleWatchdog();

		expect(handler).not.toHaveBeenCalled();
		expect(warnSpy).not.toHaveBeenCalled();
		disconnect();
	});

	it("falls back to the console when nothing is registered", async () => {
		LoomPromise.reject("loud");
		await settleWatchdog();
		expect(warnSpy).toHaveBeenCalledTimes(1);
		expect(String(warnSpy.mock.calls[0]?.[0])).toContain("loud");
	});
});

describe("Promise.Error", () => {
	it("chains through extend and keeps the kind", () => {
		const root = new LoomPromiseError({
			error: "root",
			kind: "ExecutionError",
			trace: "at root",
		});
		const wrapped = root.extend({ error: "wrapped" });

		expect(wrapped.error).toBe("wrapped");
		expect(wrapped.kind).toBe("ExecutionError");
		expect(wrapped.parent).toBe(root);
		expect(wrapped.getErrorChain()).toEqual([wrapped, root]);
		expect(String(wrapped)).toContain("-- Promise.Error(ExecutionError) --");
		expect(String(wrapped)).toContain("at root");
	});

	it("stringifies the error text and records when it was made", () => {
		const error = LoomPromiseError.new({ error: 404 });
		expect(error.error).toBe("404");
		expect(error.kind).toBeUndefined();
		expect(error.createdTick).toBeGreaterThan(0);
		expect(LoomPromiseError.new().error).toBe(
			"[This error has no error text.]",
		);
	});

	it("duck-types is and isKind", () => {
		expect(LoomPromiseError.is({ error: "x", extend: () => {} })).toBe(true);
		expect(LoomPromiseError.is({ error: "x" })).toBe(false);
		expect(LoomPromiseError.is("x")).toBe(false);

		const timedOut = new LoomPromiseError({ kind: "TimedOut" });
		expect(LoomPromiseError.isKind(timedOut, "TimedOut")).toBe(true);
		expect(LoomPromiseError.isKind(timedOut, "ExecutionError")).toBe(false);
		expect(LoomPromiseError.Kind.AlreadyCancelled).toBe("AlreadyCancelled");
	});
});
