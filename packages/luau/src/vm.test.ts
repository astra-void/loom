// @vitest-environment node
// emscripten picks its loader by environment: under happy-dom it sees a
// `window` and fetches the .wasm over HTTP, which a test run cannot serve.
import { describe, expect, it, vi } from "vitest";
import {
	type HostClass,
	LuauError,
	LuauFunction,
	LuauTable,
	LuauVM,
	type LuauVMOptions,
	Suspend,
	tuple,
} from "./index.ts";

async function vm(options: LuauVMOptions = {}): Promise<LuauVM> {
	return LuauVM.create({ onError: () => {}, ...options });
}

function done(result: ReturnType<LuauVM["run"]>): unknown[] {
	if (result.status !== "done") {
		throw result.status === "error"
			? result.error
			: new Error("thread yielded");
	}
	return result.values;
}

class Point {
	constructor(
		readonly x: number,
		readonly y: number,
	) {}
}

const PointClass: HostClass<Point> = {
	name: "Point",
	index: (self, key) => {
		if (key === "X") return self.x;
		if (key === "Y") return self.y;
		throw new LuauError(`${String(key)} is not a valid member of Point`);
	},
	namecall: (self, method, args) => {
		if (method === "Dot") {
			const other = args[0] as Point;
			return self.x * other.x + self.y * other.y;
		}
		throw new LuauError(`${method} is not a valid member of Point`);
	},
	tostring: (self) => `${self.x}, ${self.y}`,
	eq: (a, b) => b instanceof Point && a.x === b.x && a.y === b.y,
	add: (a, b) =>
		new Point((a as Point).x + (b as Point).x, (a as Point).y + (b as Point).y),
	mul: (a, b) =>
		typeof b === "number"
			? new Point((a as Point).x * b, (a as Point).y * b)
			: new Point(
					(b as Point).x * (a as number),
					(b as Point).y * (a as number),
				),
};

const classify = (value: object) =>
	value instanceof Point ? PointClass : undefined;

describe("LuauVM values", () => {
	it("runs a script and returns its values", async () => {
		const L = await vm();
		const values = done(
			L.run(
				"local t = 0 for i = 1, 10 do t += i end return t, 'ok', true, nil",
			),
		);
		expect(values).toEqual([55, "ok", true, undefined]);
	});

	it("round-trips unicode and strings large enough to grow memory", async () => {
		const L = await vm();
		L.setGlobal("echo", (s: string) => s);
		expect(done(L.run("return echo('héllo 🙂'), #'🙂'"))).toEqual([
			"héllo 🙂",
			4,
		]);
		// ~6 MB of UTF-8: past the initial 16 MB heap once Luau copies it.
		const big = "가나다🙂".repeat(400_000);
		expect(L.load("local s = ... return s .. s").call(big)[0]).toBe(big + big);
	});

	it("passes arguments to host functions and returns tuples", async () => {
		const L = await vm();
		L.setGlobal("divmod", (a: number, b: number) =>
			tuple(Math.floor(a / b), a % b),
		);
		expect(done(L.run("local q, r = divmod(17, 5) return q, r"))).toEqual([
			3, 2,
		]);
	});

	it("copies JS arrays and objects in as tables, and reads tables back", async () => {
		const L = await vm();
		L.setGlobal("data", { list: [1, 2, 3], name: "x" });
		const [t] = done(
			L.run(
				"return { a = data.name, n = #data.list, [1] = 'one', [2] = 'two' }",
			),
		);
		expect(t).toBeInstanceOf(LuauTable);
		const table = t as LuauTable;
		expect(table.get("a")).toBe("x");
		expect(table.get("n")).toBe(3);
		expect(table.array()).toEqual(["one", "two"]);
		table.set("a", "changed");
		expect(table.get("a")).toBe("changed");
		expect(new Map(table.entries()).get("n")).toBe(3);
	});

	it("calls Luau functions from JS, including ones handed to a host function", async () => {
		const L = await vm();
		let callback: LuauFunction | undefined;
		L.setGlobal("onEvent", (fn: LuauFunction) => {
			callback = fn;
		});
		done(L.run("local n = 0 onEvent(function(by) n += by return n end)"));
		expect(callback).toBeInstanceOf(LuauFunction);
		expect(callback?.call(2)).toEqual([2]);
		expect(callback?.call(3)).toEqual([5]);
	});
});

describe("LuauVM errors", () => {
	it("raises a host function's exception into Luau, where pcall catches it", async () => {
		const L = await vm();
		L.setGlobal("fail", () => {
			throw new Error("host says no");
		});
		expect(done(L.run("return pcall(fail)"))).toEqual([false, "host says no"]);
	});

	it("keeps a raised table as the error value", async () => {
		const L = await vm();
		const fn = L.load("error({ code = 42 })");
		const error = (() => {
			try {
				fn.call();
			} catch (e) {
				return e;
			}
		})();
		expect(error).toBeInstanceOf(LuauError);
	});

	it("throws a syntax error from load", async () => {
		const L = await vm();
		expect(() => L.load("local = 1", "=broken")).toThrow(/broken:1/);
	});

	it("reports an error that escapes a script thread, with a traceback", async () => {
		const onError = vi.fn();
		const L = await vm({ onError });
		const result = L.run("local function boom() error('kaput') end\nboom()", {
			chunkname: "=Script",
		});
		expect(result.status).toBe("error");
		expect(onError).toHaveBeenCalledOnce();
		const error = onError.mock.calls[0]?.[0] as LuauError;
		expect(error.message).toMatch(/Script:1: kaput/);
		expect(error.traceback).toMatch(/Script:2/);
	});

	it("stops a runaway loop once its time budget runs out", async () => {
		const L = await vm({ budgetMs: 50 });
		const result = L.run("while true do end");
		expect(result.status).toBe("error");
		expect(result.status === "error" && result.error.message).toMatch(
			/time budget/,
		);
		// The VM is still usable afterwards.
		expect(done(L.run("return 1"))).toEqual([1]);
	});

	it("doesn't charge a stall in which Luau wasn't running", async () => {
		// A throttled or suspended page looks like this from the inside: one
		// long gap between safepoints. Loading a module tree in a hidden tab used
		// to fail here with a budget error and leave React's work loop broken.
		// Each 400ms stall costs at most 50ms of the budget, so three fit in 200.
		const L = await vm({ budgetMs: 200 });
		L.setGlobal("stall", () => busyWait(400));
		expect(
			done(L.run("local n = 0 for i = 1, 3 do stall() n += i end return n")),
		).toEqual([6]);
	});

	it("still stops a loop of slow calls", async () => {
		const L = await vm({ budgetMs: 100 });
		L.setGlobal("stall", () => busyWait(80));
		const result = L.run("while true do stall() end");
		expect(result.status === "error" && result.error.message).toMatch(
			/time budget/,
		);
	});
});

/** Block the thread for `ms`, like a host call that takes long. */
function busyWait(ms: number): void {
	const end = performance.now() + ms;
	while (performance.now() < end) {
		// spin
	}
}

describe("LuauVM host userdata", () => {
	it("exposes a classified object as userdata with its class's metamethods", async () => {
		const L = await vm({ classify });
		L.setGlobal("a", new Point(1, 2));
		L.setGlobal("b", new Point(3, 4));
		const values = done(
			L.run(
				`
				local sum = a + b
				return typeof(a), type(a), a.X, a:Dot(b), tostring(sum), 2 * a == Point2, sum
			`,
				{ globals: { Point2: new Point(2, 4) } },
			),
		);
		expect(values.slice(0, 6)).toEqual([
			"Point",
			"userdata",
			1,
			11,
			"4, 6",
			true,
		]);
		expect(values[6]).toEqual(new Point(4, 6));
	});

	it("hands back the same userdata for the same object", async () => {
		const L = await vm({ classify });
		const p = new Point(0, 0);
		L.setGlobal("get", () => p);
		expect(
			done(
				L.run(
					"local t = { [get()] = true } return rawequal(get(), get()), t[get()]",
				),
			),
		).toEqual([true, true]);
	});

	it("turns a missing member into a Luau error", async () => {
		const L = await vm({ classify });
		L.setGlobal("p", new Point(0, 0));
		expect(done(L.run("return pcall(function() return p.Z end)"))).toEqual([
			false,
			"Z is not a valid member of Point",
		]);
	});

	it("locks the metatable", async () => {
		const L = await vm({ classify });
		L.setGlobal("p", new Point(0, 0));
		expect(done(L.run("return getmetatable(p)"))).toEqual([
			"The metatable is locked",
		]);
	});

	it("lets go of an object once Luau collects its userdata", async () => {
		const L = await vm({ classify });
		L.setGlobal("make", () => new Point(1, 1));
		done(L.run("for i = 1, 100 do local p = make() end"));
		expect(L.liveHostObjects).toBeGreaterThan(0);
		L.collect();
		expect(L.liveHostObjects).toBe(0);
	});
});

describe("LuauVM threads", () => {
	const wait = (ms: number) =>
		new Suspend((resume) => {
			setTimeout(() => resume(ms), ms);
		});

	it("suspends a script on a host Suspend and resumes it with the results", async () => {
		const L = await vm();
		const log: unknown[] = [];
		L.setGlobal("wait", wait);
		L.setGlobal("log", (v: unknown) => {
			log.push(v);
		});
		const result = L.run("log('before') local waited = wait(5) log(waited)");
		expect(result.status).toBe("yielded");
		expect(log).toEqual(["before"]);
		await vi.waitFor(() => expect(log).toEqual(["before", 5]));
	});

	it("resumes a yielded coroutine directly, whoever resumed it first", async () => {
		const L = await vm();
		const log: unknown[] = [];
		L.setGlobal("wait", wait);
		L.setGlobal("log", (v: unknown) => {
			log.push(v);
		});
		done(
			L.run(`
				coroutine.wrap(function() log('inner start') wait(5) log('inner end') end)()
				log('outer continues')
			`),
		);
		expect(log).toEqual(["inner start", "outer continues"]);
		await vi.waitFor(() =>
			expect(log).toEqual(["inner start", "outer continues", "inner end"]),
		);
	});

	it("spawns a Luau function in its own thread", async () => {
		const L = await vm();
		L.setGlobal("wait", wait);
		const fn = L.load("local x = ... wait(1) return x * 2");
		expect(fn.spawn(21).status).toBe("yielded");
		expect(() => fn.call(21)).toThrow(LuauError);
	});
});

describe("LuauVM sandbox", () => {
	it("gives each script its own globals and freezes the shared ones", async () => {
		const L = await vm();
		L.setGlobal("shared", 1);
		done(L.run("leaked = true"));
		expect(
			done(L.run("return leaked, shared, pcall(function() math.pi = 3 end)")),
		).toEqual([undefined, 1, false, expect.stringMatching(/readonly/)]);
		expect(() => L.setGlobal("late", 1)).toThrow(/frozen/);
	});

	it("passes per-script globals", async () => {
		const L = await vm();
		expect(done(L.run("return script", { globals: { script: "me" } }))).toEqual(
			["me"],
		);
	});
});
