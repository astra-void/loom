import { afterEach, describe, expect, it, vi } from "vitest";
import { CFrame, Color3, Rect, UDim2, Vector2, Vector3 } from "./datatypes";
import { Enum } from "./enums";
import { createInstance } from "./instance";
import {
	applyPrototypePatches,
	assert,
	ipairs,
	math,
	pairs,
	pcall,
	string,
	task,
	tonumber,
	tostring,
	typeIs,
	typeOf,
	xpcall,
} from "./luau";

describe("pcall", () => {
	it("returns [true, result] on success", () => {
		expect(pcall((a: number, b: number) => a + b, 2, 3)).toEqual([true, 5]);
	});

	it("returns [false, message] on thrown Error", () => {
		const [ok, message] = pcall(() => {
			throw new Error("boom");
		});
		expect(ok).toBe(false);
		expect(message).toBe("boom");
	});

	it("returns thrown non-Error values as-is", () => {
		expect(
			pcall(() => {
				throw "raw";
			}),
		).toEqual([false, "raw"]);
	});

	it("xpcall routes failures through the handler", () => {
		expect(
			xpcall(
				() => {
					throw new Error("bad");
				},
				(err) => `handled:${err}`,
			),
		).toEqual([false, "handled:bad"]);
	});
});

describe("typeOf / typeIs", () => {
	it("recognizes datatypes, enum items, and instances", () => {
		expect(typeOf(UDim2.new())).toBe("UDim2");
		expect(typeOf(Vector2.new())).toBe("Vector2");
		expect(typeOf(Vector3.new())).toBe("Vector3");
		expect(typeOf(Rect.new(0, 0, 10, 10))).toBe("Rect");
		expect(typeOf(CFrame.new())).toBe("CFrame");
		expect(typeOf(Color3.fromRGB(255, 0, 0))).toBe("Color3");
		expect(typeOf(Enum.KeyCode.Space)).toBe("EnumItem");
		expect(typeOf(createInstance("Frame"))).toBe("Instance");
		expect(typeOf(undefined)).toBe("nil");
		expect(typeOf({})).toBe("table");
		expect(typeOf([])).toBe("table");
		expect(typeOf(1)).toBe("number");
		expect(typeOf("x")).toBe("string");
		expect(typeIs(Vector2.new(), "Vector2")).toBe(true);
		expect(typeIs(Vector2.new(), "Vector3")).toBe(false);
	});
});

describe("tostring / tonumber", () => {
	it("stringifies Luau-style", () => {
		expect(tostring(undefined)).toBe("nil");
		expect(tostring(Enum.KeyCode.Space)).toBe("Enum.KeyCode.Space");
		expect(tostring(createInstance("Frame", "MyFrame"))).toBe("MyFrame");
	});

	it("parses numbers or returns undefined", () => {
		expect(tonumber("42")).toBe(42);
		expect(tonumber(" 1.5 ")).toBe(1.5);
		expect(tonumber("ff", 16)).toBe(255);
		expect(tonumber("nope")).toBeUndefined();
		expect(tonumber(true)).toBeUndefined();
	});
});

describe("pairs / ipairs", () => {
	it("iterates plain objects by key", () => {
		const seen = [...pairs({ a: 1, b: 2, c: undefined })];
		expect(seen).toEqual([
			["a", 1],
			["b", 2],
		]);
	});

	it("iterates Maps by entry", () => {
		const map = new Map([
			["x", 1],
			["y", 2],
		]);
		expect([...pairs(map)]).toEqual([
			["x", 1],
			["y", 2],
		]);
	});

	it("iterates arrays 1-based, ipairs stops at nil", () => {
		expect([...pairs(["a", "b"])]).toEqual([
			[1, "a"],
			[2, "b"],
		]);
		expect([...ipairs(["a", undefined, "c"])]).toEqual([[1, "a"]]);
	});
});

describe("math", () => {
	it("clamp", () => {
		expect(math.clamp(5, 0, 3)).toBe(3);
		expect(math.clamp(-1, 0, 3)).toBe(0);
		expect(math.clamp(2, 0, 3)).toBe(2);
	});

	it("round rounds halves away from zero", () => {
		expect(math.round(2.5)).toBe(3);
		expect(math.round(-2.5)).toBe(-3);
		expect(math.round(2.4)).toBe(2);
		expect(math.round(-2.4)).toBe(-2);
	});

	it("misc", () => {
		expect(math.huge).toBe(Number.POSITIVE_INFINITY);
		expect(math.sign(-4)).toBe(-1);
		expect(math.fmod(7, 3)).toBe(1);
		expect(math.deg(Math.PI)).toBeCloseTo(180);
		expect(math.rad(180)).toBeCloseTo(Math.PI);
		expect(math.noise()).toBe(0);
	});
});

describe("string", () => {
	it("format supports %d %s %f %x %% and %.Nf", () => {
		expect(string.format("%d items", 3.7)).toBe("3 items");
		expect(string.format("%s!", "hi")).toBe("hi!");
		expect(string.format("%.2f", 1.2345)).toBe("1.23");
		expect(string.format("%x", 255)).toBe("ff");
		expect(string.format("100%%")).toBe("100%");
	});

	it("sub is 1-based inclusive with negative indices", () => {
		expect(string.sub("hello", 2, 4)).toBe("ell");
		expect(string.sub("hello", 2)).toBe("ello");
		expect(string.sub("hello", -3)).toBe("llo");
		expect(string.sub("hello", 4, 2)).toBe("");
	});

	it("find returns a 1-based [start, end] tuple, or an empty tuple when unmatched", () => {
		expect(string.find("hello world", "world", 1, true)).toEqual([7, 11]);
		expect(string.find("hello", "l")).toEqual([3, 3]);
		expect(string.find("hello", "z", 1, true)).toEqual([]);
		expect(string.find("aXa", "%d")).toEqual([]);
		expect(string.find("a7a", "%d")).toEqual([2, 2]);
	});

	it("an unmatched find is still destructurable (roblox-ts LuaTuple read)", () => {
		// `const [start] = string.find(...)` is the idiomatic roblox-ts read, and
		// lattice's combobox filter uses exactly that. Returning `undefined` here
		// threw "undefined is not iterable" and crashed the whole render.
		const [start, finish] = string.find("hello", "z", 1, true);
		expect(start).toBeUndefined();
		expect(finish).toBeUndefined();
	});

	it("gsub handles the lattice character-class pattern", () => {
		// packages/tabs sanitizes ids with this exact call.
		expect(string.gsub("Hello World!", "[^%w_%-]", "-")).toEqual([
			"Hello-World-",
			2,
		]);
		expect(string.gsub("a.b.c", ".", "-", 2)[0]).toBe("--b.c");
		expect(string.gsub("abc", "q", "-")).toEqual(["abc", 0]);
	});

	it("lower/upper/rep/split", () => {
		expect(string.lower("AbC")).toBe("abc");
		expect(string.upper("AbC")).toBe("ABC");
		expect(string.rep("ab", 3)).toBe("ababab");
		expect(string.split("a,b,c", ",")).toEqual(["a", "b", "c"]);
	});
});

describe("prototype patches", () => {
	it("installs size/isEmpty/remove/unorderedRemove/clear (0-based roblox-ts indices)", () => {
		applyPrototypePatches();
		type Patched<T> = T[] & {
			size(): number;
			isEmpty(): boolean;
			remove(index: number): T | undefined;
			unorderedRemove(index: number): T | undefined;
			clear(): void;
		};
		const arr = ["a", "b", "c"] as Patched<string>;
		expect(arr.size()).toBe(3);
		expect(arr.isEmpty()).toBe(false);
		expect(arr.remove(1)).toBe("b");
		expect(arr).toEqual(["a", "c"]);
		expect(arr.unorderedRemove(0)).toBe("a");
		expect(arr).toEqual(["c"]);
		arr.clear();
		expect(arr.isEmpty()).toBe(true);
		const str = "hello" as unknown as { size(): number };
		expect(str.size()).toBe(5);
	});

	it("installs the Luau string methods with 1-based indices", () => {
		applyPrototypePatches();
		type PatchedString = {
			lower(): string;
			upper(): string;
			sub(i?: number, j?: number): string;
			rep(n: number, sep?: string): string;
			find(
				pattern: string,
				init?: number,
				plain?: boolean,
			): [number, number] | [];
			gsub(
				pattern: string,
				replacement: string,
				maxCount?: number,
			): [string, number];
			format(...args: unknown[]): string;
		};
		const s = "Hello,World" as unknown as PatchedString;
		expect(s.lower()).toBe("hello,world");
		expect(s.upper()).toBe("HELLO,WORLD");
		// 1-based and inclusive: NOT slice(1, 5), and NOT the Annex B `<sub>`
		// wrapper that `String.prototype.sub` ships by default.
		expect(s.sub(1, 5)).toBe("Hello");
		expect(s.sub(-5)).toBe("World");
		expect(("ab" as unknown as PatchedString).rep(3)).toBe("ababab");
		expect(s.find("World")).toEqual([7, 11]);
		expect(s.find("nope")).toEqual([]);
		expect(s.gsub("l", "L")).toEqual(["HeLLo,WorLd", 3]);
		expect(("%d apples" as unknown as PatchedString).format(3)).toBe(
			"3 apples",
		);
	});

	it("leaves native String.prototype.split alone", () => {
		applyPrototypePatches();
		// Deliberately unpatched: `string.split` is implemented *with* the native
		// method, so overriding it would recurse forever. Native split already
		// matches Luau for a string separator.
		expect("a,b,c".split(",")).toEqual(["a", "b", "c"]);
		expect(string.split("a,b,c")).toEqual(["a", "b", "c"]);
	});
});

describe("assert", () => {
	it("returns the value when truthy, the way Luau does", () => {
		const value = { ok: true };
		expect(assert(value)).toBe(value);
		expect(assert("text", "unused")).toBe("text");
	});

	it("throws the given message when falsy", () => {
		expect(() => assert(undefined, "no config")).toThrow("no config");
		expect(() => assert(false)).toThrow("assertion failed!");
	});
});

describe("task", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("delay runs after the timeout and cancel prevents it", () => {
		vi.useFakeTimers();
		const ran = vi.fn();
		const cancelled = vi.fn();
		task.delay(0.05, ran);
		const handle = task.delay(0.05, cancelled);
		task.cancel(handle);
		vi.advanceTimersByTime(100);
		expect(ran).toHaveBeenCalledOnce();
		expect(cancelled).not.toHaveBeenCalled();
	});
});

describe("datatype arithmetic", () => {
	it("Vector2 add/sub/mul/div and Magnitude", () => {
		const v = Vector2.new(3, 4);
		expect(v.Magnitude).toBe(5);
		expect(v.add(Vector2.new(1, 1))).toEqual(Vector2.new(4, 5));
		expect(v.sub(Vector2.new(1, 1))).toEqual(Vector2.new(2, 3));
		expect(v.mul(2)).toEqual(Vector2.new(6, 8));
		expect(v.div(Vector2.new(3, 2))).toEqual(Vector2.new(1, 2));
		expect(Vector2.zero).toEqual(Vector2.new(0, 0));
		expect(Vector2.one).toEqual(Vector2.new(1, 1));
	});

	it("UDim2 add/sub", () => {
		const sum = UDim2.new(0.5, 10, 0, 4).add(UDim2.new(0.25, 5, 1, -4));
		expect(sum).toEqual(UDim2.new(0.75, 15, 1, 0));
		expect(sum.sub(UDim2.new(0.25, 5, 1, -4))).toEqual(
			UDim2.new(0.5, 10, 0, 4),
		);
	});

	it("CFrame Lerp/FuzzyEq and Rect dimensions", () => {
		const mid = CFrame.new(0, 0, 0).Lerp(CFrame.new(10, 20, 30), 0.5);
		expect(mid.Position).toEqual(Vector3.new(5, 10, 15));
		expect(mid.FuzzyEq(CFrame.new(5, 10, 15))).toBe(true);
		expect(mid.FuzzyEq(CFrame.new(5, 10, 16))).toBe(false);

		const rect = Rect.new(10, 20, 110, 70);
		expect(rect.Width).toBe(100);
		expect(rect.Height).toBe(50);
		const fromVectors = Rect.new(Vector2.new(1, 2), Vector2.new(4, 6));
		expect(fromVectors.Width).toBe(3);
		expect(fromVectors.Height).toBe(4);
	});

	it("Color3.Lerp interpolates channels", () => {
		const mixed = Color3.new(0, 0, 0).Lerp(Color3.new(1, 0.5, 0), 0.5);
		expect(mixed.R).toBeCloseTo(0.5);
		expect(mixed.G).toBeCloseTo(0.25);
		expect(mixed.B).toBe(0);
	});

	it("audited lattice Enum usages exist", () => {
		expect(Enum.UserInputType.MouseButton1.Name).toBe("MouseButton1");
		expect(Enum.KeyCode.PageDown.EnumType).toBe("KeyCode");
		expect(Enum.ScreenInsets.CoreUISafeInsets).toBeDefined();
		expect(Enum.ScrollingDirection.XY).toBeDefined();
		expect(Enum.TextTruncate.AtEnd).toBeDefined();
		expect(Enum.ZIndexBehavior.Sibling).toBeDefined();
		expect(Enum.AutomaticCanvasSize.Y).toBe(Enum.AutomaticSize.Y);
	});
});
