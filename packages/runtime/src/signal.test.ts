import { describe, expect, it, vi } from "vitest";
import { LoomSignal } from "./signal";

describe("LoomSignal", () => {
	it("delivers fires to connected listeners with arguments", () => {
		const signal = new LoomSignal<[number, string]>();
		const seen: [number, string][] = [];
		signal.Connect((n, s) => seen.push([n, s]));
		signal.fire(1, "a");
		signal.fire(2, "b");
		expect(seen).toEqual([
			[1, "a"],
			[2, "b"],
		]);
	});

	it("stops delivering after Disconnect and reports Connected", () => {
		const signal = new LoomSignal();
		const cb = vi.fn();
		const connection = signal.Connect(cb);
		expect(connection.Connected).toBe(true);
		signal.fire();
		connection.Disconnect();
		expect(connection.Connected).toBe(false);
		signal.fire();
		expect(cb).toHaveBeenCalledTimes(1);
		// Disconnect is idempotent.
		connection.Disconnect();
		expect(connection.Connected).toBe(false);
	});

	it("does not skip remaining listeners when one disconnects mid-fire", () => {
		const signal = new LoomSignal();
		const order: string[] = [];
		const a = signal.Connect(() => {
			order.push("a");
			a.Disconnect();
			b.Disconnect();
		});
		const b = signal.Connect(() => order.push("b"));
		signal.Connect(() => order.push("c"));
		signal.fire();
		// b was disconnected before its turn, c must still run.
		expect(order).toEqual(["a", "c"]);
	});

	it("runs every surviving listener exactly once when the list shifts mid-fire", () => {
		const signal = new LoomSignal();
		const counts = { a: 0, b: 0, c: 0 };
		// Disconnecting the already-run listener splices index 0 out from under
		// the iteration — the classic way a live-array loop double-runs `b`.
		const a = signal.Connect(() => {
			counts.a += 1;
			a.Disconnect();
		});
		signal.Connect(() => {
			counts.b += 1;
		});
		signal.Connect(() => {
			counts.c += 1;
		});
		signal.fire();
		expect(counts).toEqual({ a: 1, b: 1, c: 1 });
		signal.fire();
		expect(counts).toEqual({ a: 1, b: 2, c: 2 });
	});

	it("stops the dispatch when a listener calls disconnectAll", () => {
		const signal = new LoomSignal();
		const later = vi.fn();
		signal.Connect(() => signal.disconnectAll());
		signal.Connect(later);
		signal.fire();
		expect(later).not.toHaveBeenCalled();
		expect(signal.hasConnections).toBe(false);
	});

	it("does not fire listeners connected during the same fire", () => {
		const signal = new LoomSignal();
		const late = vi.fn();
		signal.Connect(() => signal.Connect(late));
		signal.fire();
		expect(late).not.toHaveBeenCalled();
		signal.fire();
		expect(late).toHaveBeenCalledTimes(1);
	});

	it("Once fires exactly once", () => {
		const signal = new LoomSignal();
		const cb = vi.fn();
		signal.Once(cb);
		signal.fire();
		signal.fire();
		expect(cb).toHaveBeenCalledTimes(1);
		expect(signal.hasConnections).toBe(false);
	});

	it("ConnectParallel delivers like Connect and hands back a live connection", () => {
		const signal = new LoomSignal<[number]>();
		const seen: number[] = [];
		const connection = signal.ConnectParallel((n) => seen.push(n));
		expect(connection.Connected).toBe(true);
		signal.fire(1);
		connection.Disconnect();
		signal.fire(2);
		expect(seen).toEqual([1]);
		expect(connection.Connected).toBe(false);
	});

	describe("listener error isolation", () => {
		it("reports a throwing listener and keeps dispatching to the rest", () => {
			const errorSpy = vi
				.spyOn(console, "error")
				.mockImplementation(() => undefined);
			const signal = new LoomSignal<[number]>({ name: "ChildAdded" });
			const boom = new Error("handler exploded");
			const seen: string[] = [];
			signal.Connect(() => seen.push("before"));
			signal.Connect(() => {
				throw boom;
			});
			signal.Connect(() => seen.push("after"));

			// The firer (a DOM handler, the frame loop) must not unwind.
			expect(() => signal.fire(1)).not.toThrow();
			expect(seen).toEqual(["before", "after"]);
			expect(errorSpy).toHaveBeenCalledTimes(1);
			const [message, reported] = errorSpy.mock.calls[0] as [string, unknown];
			expect(message).toContain("loom:");
			expect(message).toContain("ChildAdded");
			expect(reported).toBe(boom);
			errorSpy.mockRestore();
		});

		it("names an unlabelled signal as an anonymous RBXScriptSignal", () => {
			const errorSpy = vi
				.spyOn(console, "error")
				.mockImplementation(() => undefined);
			const signal = new LoomSignal();
			signal.Connect(() => {
				throw new Error("nope");
			});
			signal.fire();
			expect(errorSpy).toHaveBeenCalledOnce();
			expect(String(errorSpy.mock.calls[0]?.[0])).toContain(
				"anonymous RBXScriptSignal",
			);
			errorSpy.mockRestore();
		});

		it("keeps a throwing listener connected for the next fire", () => {
			const errorSpy = vi
				.spyOn(console, "error")
				.mockImplementation(() => undefined);
			const signal = new LoomSignal();
			let calls = 0;
			// Roblox does not sever a connection because its handler errored, and
			// neither does loom — the next click still reaches the same handler.
			const connection = signal.Connect(() => {
				calls += 1;
				throw new Error("still broken");
			});
			signal.fire();
			signal.fire();
			expect(calls).toBe(2);
			expect(connection.Connected).toBe(true);
			expect(errorSpy).toHaveBeenCalledTimes(2);
			errorSpy.mockRestore();
		});

		it("still unsubscribes a Once whose handler throws", () => {
			const errorSpy = vi
				.spyOn(console, "error")
				.mockImplementation(() => undefined);
			const signal = new LoomSignal();
			const cb = vi.fn(() => {
				throw new Error("once exploded");
			});
			signal.Once(cb);
			signal.fire();
			signal.fire();
			expect(cb).toHaveBeenCalledTimes(1);
			expect(signal.hasConnections).toBe(false);
			expect(errorSpy).toHaveBeenCalledTimes(1);
			errorSpy.mockRestore();
		});

		it("isolates a throw inside a nested fire of the same signal", () => {
			const errorSpy = vi
				.spyOn(console, "error")
				.mockImplementation(() => undefined);
			const signal = new LoomSignal<[number]>({ name: "Changed" });
			const seen: number[] = [];
			let reentered = false;
			signal.Connect((depth) => {
				if (reentered) throw new Error("inner exploded");
				reentered = true;
				signal.fire(depth + 1);
			});
			signal.Connect((depth) => seen.push(depth));

			expect(() => signal.fire(0)).not.toThrow();
			// The inner dispatch reached the second listener, and so did the outer
			// one after the inner throw was contained.
			expect(seen).toEqual([1, 0]);
			expect(errorSpy).toHaveBeenCalledTimes(1);
			errorSpy.mockRestore();
		});
	});

	describe("Wait", () => {
		it("resolves with the full fired argument tuple", async () => {
			const signal = new LoomSignal<[string, number, boolean]>();
			const promise = signal.Wait();
			signal.fire("hello", 7, true);
			await expect(promise).resolves.toEqual(["hello", 7, true]);
		});

		it("resolves with an empty tuple for an argument-less signal", async () => {
			const signal = new LoomSignal();
			const promise = signal.Wait();
			signal.fire();
			await expect(promise).resolves.toEqual([]);
		});

		it("unsubscribes itself after the first fire", async () => {
			const signal = new LoomSignal<[number]>();
			const promise = signal.Wait();
			expect(signal.hasConnections).toBe(true);
			signal.fire(1);
			expect(signal.hasConnections).toBe(false);
			// A later fire neither re-arms the waiter nor changes what it saw.
			signal.fire(2);
			await expect(promise).resolves.toEqual([1]);
			expect(signal.hasConnections).toBe(false);
		});

		it("stays pending until the signal fires", async () => {
			const signal = new LoomSignal<[string]>();
			const settled = vi.fn();
			signal.Wait().then(settled);
			await Promise.resolve();
			expect(settled).not.toHaveBeenCalled();
			signal.fire("late");
			await Promise.resolve();
			expect(settled).toHaveBeenCalledWith(["late"]);
		});
	});

	it("invokes the onConnect callback on every Connect", () => {
		const onConnect = vi.fn();
		const signal = new LoomSignal({ onConnect });
		signal.Connect(() => {});
		signal.Connect(() => {});
		expect(onConnect).toHaveBeenCalledTimes(2);
	});

	it("disconnectAll severs every connection", () => {
		const signal = new LoomSignal();
		const cb = vi.fn();
		const connection = signal.Connect(cb);
		signal.disconnectAll();
		expect(connection.Connected).toBe(false);
		expect(signal.hasConnections).toBe(false);
		signal.fire();
		expect(cb).not.toHaveBeenCalled();
	});
});
