import { describe, expect, it } from "vitest";
import {
	Color3,
	ColorSequence,
	ColorSequenceKeypoint,
	DateTime,
	Font,
	NumberSequence,
	NumberSequenceKeypoint,
	Random,
	Rect,
	robloxEquals,
	toPropertyValue,
	UDim,
	UDim2,
	Vector2,
	Vector3,
} from "./datatypes";
import { Enum } from "./enums";
import { installGlobals } from "./index";
import { tostring } from "./luau";

describe("UDim2 constructor", () => {
	it("accepts the four-number roblox-ts form (xScale, xOffset, yScale, yOffset)", () => {
		// roblox-ts compiles `new UDim2(1, -22, 0, 2)` to this; component code
		// (e.g. the switch thumb's checked position) relies on it.
		const value = new UDim2(1, -22, 0, 2);
		expect(value.X).toBeInstanceOf(UDim);
		expect(value.X.Scale).toBe(1);
		expect(value.X.Offset).toBe(-22);
		expect(value.Y.Scale).toBe(0);
		expect(value.Y.Offset).toBe(2);
	});

	it("accepts the two-UDim form", () => {
		const value = new UDim2(new UDim(0.5, 4), new UDim(0.25, 8));
		expect(value.X.Scale).toBe(0.5);
		expect(value.X.Offset).toBe(4);
		expect(value.Y.Scale).toBe(0.25);
		expect(value.Y.Offset).toBe(8);
	});

	it("defaults to a zero UDim2", () => {
		const value = new UDim2();
		expect(value.X.Scale).toBe(0);
		expect(value.Y.Offset).toBe(0);
	});

	it("static helpers stay consistent", () => {
		expect(UDim2.new(1, 2, 3, 4).X.Offset).toBe(2);
		expect(UDim2.fromOffset(10, 20).X.Offset).toBe(10);
		expect(UDim2.fromScale(0.5, 1).Y.Scale).toBe(1);
	});

	it("add/sub operate component-wise", () => {
		const sum = new UDim2(1, 2, 3, 4).add(new UDim2(1, 1, 1, 1));
		expect(sum.X.Scale).toBe(2);
		expect(sum.Y.Offset).toBe(5);
	});
});

describe("ColorSequence constructor", () => {
	const red = Color3.fromRGB(255, 0, 0);
	const blue = Color3.fromRGB(0, 0, 255);

	it("accepts the two-color roblox-ts form", () => {
		// roblox-ts compiles `ColorSequence.new(a, b)` to `new ColorSequence(a, b)`,
		// which used to store the Color3 itself in Keypoints and blow up on encode.
		const value = new ColorSequence(red, blue);
		expect(value.Keypoints).toHaveLength(2);
		expect(value.Keypoints[0]?.Time).toBe(0);
		expect(value.Keypoints[0]?.Value).toBe(red);
		expect(value.Keypoints[1]?.Time).toBe(1);
		expect(value.Keypoints[1]?.Value).toBe(blue);
	});

	it("accepts one color as a flat ramp", () => {
		const value = new ColorSequence(red);
		expect(value.Keypoints.map((k) => k.Value)).toEqual([red, red]);
	});

	it("still accepts a keypoint list", () => {
		const keypoints = [
			new ColorSequenceKeypoint(0, red),
			new ColorSequenceKeypoint(0.5, blue),
			new ColorSequenceKeypoint(1, red),
		];
		expect(new ColorSequence(keypoints).Keypoints).toEqual(keypoints);
	});

	it("encodes to the gradient IR either way", () => {
		expect(toPropertyValue(new ColorSequence(red, blue))).toEqual({
			type: "ColorSequence",
			value: {
				keypoints: [
					{ time: 0, color: { r: 1, g: 0, b: 0 } },
					{ time: 1, color: { r: 0, g: 0, b: 1 } },
				],
			},
		});
	});
});

describe("Color3.fromHex", () => {
	const channels = (color: Color3): [number, number, number] => [
		color.R,
		color.G,
		color.B,
	];

	it("converts the primaries exactly", () => {
		expect(channels(Color3.fromHex("#FF0000"))).toEqual([1, 0, 0]);
		expect(channels(Color3.fromHex("00FF00"))).toEqual([0, 1, 0]);
		expect(channels(Color3.fromHex("0000FF"))).toEqual([0, 0, 1]);
		expect(channels(Color3.fromHex("000000"))).toEqual([0, 0, 0]);
		expect(channels(Color3.fromHex("FFFFFF"))).toEqual([1, 1, 1]);
	});

	it("normalizes a mixed color the way fromRGB does", () => {
		const accent = Color3.fromHex("#6366F1");
		expect(accent.R).toBeCloseTo(99 / 255, 10);
		expect(accent.G).toBeCloseTo(102 / 255, 10);
		expect(accent.B).toBeCloseTo(241 / 255, 10);
		// The same channel conversion path, not a second one.
		expect(accent).toEqual(Color3.fromRGB(99, 102, 241));
	});

	it("accepts either case, with or without the leading #", () => {
		const expected = Color3.fromRGB(99, 102, 241);
		for (const hex of ["6366F1", "6366f1", "#6366F1", "#6366f1"]) {
			expect(Color3.fromHex(hex)).toEqual(expected);
		}
	});

	it("returns a new Color3 instance on every call", () => {
		const a = Color3.fromHex("#6366F1");
		const b = Color3.fromHex("#6366F1");
		expect(a).toBeInstanceOf(Color3);
		expect(a).not.toBe(b);
		expect(a).toEqual(b);
	});

	it("rejects everything that is not exactly six hex digits", () => {
		// CSS shorthand, alpha, `0x` notation, stray whitespace and non-hex digits
		// are all refused rather than silently reinterpreted.
		for (const hex of [
			"",
			"#",
			"FFF",
			"#FFF",
			"FFFFFFFF",
			"#FFFFFFFF",
			"GG0000",
			"0xFF0000",
			"##FF0000",
			" FF0000 ",
		]) {
			expect(() => Color3.fromHex(hex)).toThrow(
				`[loom] Color3.fromHex expected exactly 6 hexadecimal digits, received "${hex}"`,
			);
		}
	});

	it("leaves the rest of Color3 untouched", () => {
		expect(channels(Color3.new(0.25, 0.5, 0.75))).toEqual([0.25, 0.5, 0.75]);
		expect(channels(Color3.fromRGB(255, 128, 0))).toEqual([1, 128 / 255, 0]);
		const mid = Color3.fromHex("#000000").Lerp(Color3.fromHex("#FFFFFF"), 0.5);
		expect(channels(mid)).toEqual([0.5, 0.5, 0.5]);
		expect(toPropertyValue(Color3.fromHex("#FF0000"))).toEqual({
			type: "Color3",
			value: { r: 1, g: 0, b: 0 },
		});
	});

	it("reaches roblox-ts code through the installed global, unpatched", () => {
		// `installGlobals` installs the runtime's own constructor, so a static
		// added to the class is on the global by construction — no second patch,
		// and no risk of the two drifting.
		const target: Record<string, unknown> = {};
		installGlobals(target);
		expect(target.Color3).toBe(Color3);

		installGlobals();
		const Global = (globalThis as { Color3?: typeof Color3 }).Color3;
		expect(Global).toBe(Color3);
		expect(Global?.fromHex("#6366F1")).toBeInstanceOf(Color3);
		expect(Global?.fromHex("#6366F1")).toEqual(Color3.fromHex("#6366F1"));
		expect(Global?.fromHex("#FFFFFF")).toEqual(Color3.fromRGB(255, 255, 255));
	});

	it("ToHex is lowercase, unprefixed, and the inverse of fromHex", () => {
		// Every expectation here was read off a running engine (Studio):
		// `Color3.fromRGB(99, 102, 241):ToHex()` is "6366f1", lowercase and with
		// no leading "#".
		expect(Color3.fromRGB(99, 102, 241).ToHex()).toBe("6366f1");
		expect(Color3.new(1, 1, 1).ToHex()).toBe("ffffff");
		expect(Color3.new(0, 0, 0).ToHex()).toBe("000000");
		expect(Color3.new(0.5, 0.5, 0.5).ToHex()).toBe("808080");
		// Either case in, always lowercase out.
		expect(Color3.fromHex("#A1B2C3").ToHex()).toBe("a1b2c3");
	});

	it("ToHex rounds and clamps each channel exactly as the engine does", () => {
		// Studio: 0.002 -> "01" (0.51 rounds up), 1/510 -> "01" (a half rounds
		// away from zero), 0.999 -> "ff", and out-of-range channels clamp.
		expect(Color3.new(0.002, 0.6, 0.999).ToHex()).toBe("0199ff");
		expect(Color3.new(1 / 510, 0, 0).ToHex()).toBe("010000");
		expect(Color3.new(1.5, -0.2, 0).ToHex()).toBe("ff0000");
	});

	it("converts to and from HSV", () => {
		// Studio: Color3.fromRGB(200, 100, 50):ToHSV() is
		// (0.0555555634, 0.75, 0.784313738), and the round trip comes back.
		const [h, s, v] = Color3.fromRGB(200, 100, 50).ToHSV();
		expect(h).toBeCloseTo(0.055_555_5, 6);
		expect(s).toBeCloseTo(0.75, 6);
		expect(v).toBeCloseTo(0.784_313_7, 6);
		expect(Color3.fromHSV(h, s, v).ToHex()).toBe("c86432");
		expect(Color3.fromHSV(0, 0, 1).ToHex()).toBe("ffffff");
		expect(Color3.fromHSV(0.5, 1, 1).ToHex()).toBe("00ffff");
		// A grey has no hue, and the engine reports 0 rather than nothing.
		expect(Color3.new(0.5, 0.5, 0.5).ToHSV().slice(0, 2)).toEqual([0, 0]);
	});
});

describe("vector and UDim helpers", () => {
	it("Vector2 reports its unit, dot, cross and per-component extremes", () => {
		const v = Vector2.new(3, 4);
		expect(v.Magnitude).toBe(5);
		expect(v.Unit.X).toBeCloseTo(0.6, 6);
		expect(v.Unit.Y).toBeCloseTo(0.8, 6);
		expect(v.Dot(Vector2.new(1, 2))).toBe(11);
		expect(v.Cross(Vector2.new(1, 2))).toBe(2);
		expect(v.Lerp(Vector2.new(13, 14), 0.25)).toEqual(Vector2.new(5.5, 6.5));
		expect(v.Max(Vector2.new(5, 1))).toEqual(Vector2.new(5, 4));
		expect(v.Min(Vector2.new(5, 1))).toEqual(Vector2.new(3, 1));
		expect(Vector2.new(-3, 4).Abs()).toEqual(Vector2.new(3, 4));
		expect(Vector2.xAxis).toEqual(Vector2.new(1, 0));
		// The engine answers NAN for a zero vector's direction, not zero.
		expect(Number.isNaN(Vector2.zero.Unit.X)).toBe(true);
	});

	it("Vector3 crosses and dots like the engine", () => {
		expect(Vector3.new(1, 0, 0).Cross(Vector3.new(0, 1, 0))).toEqual(
			Vector3.new(0, 0, 1),
		);
		expect(Vector3.new(1, 2, 3).Dot(Vector3.new(4, 5, 6))).toBe(32);
		expect(Vector3.new(0, 3, 4).Unit.Y).toBeCloseTo(0.6, 6);
	});

	it("UDim2.Lerp interpolates scale and offset on both axes", () => {
		// Studio: {0,0},{0.5,10} lerped halfway to {1,100},{1,20} is
		// {0.5, 50}, {0.75, 15}.
		const mid = UDim2.new(0, 0, 0.5, 10).Lerp(UDim2.new(1, 100, 1, 20), 0.5);
		expect(mid.toString()).toBe("{0.5, 50}, {0.75, 15}");
	});

	it("Rect prints both corners flattened", () => {
		expect(Rect.new(1, 2, 5, 9).toString()).toBe("1, 2, 5, 9");
	});

	it("Rect encodes to the IR the 9-slice renderer reads", () => {
		expect(toPropertyValue(Rect.new(8, 8, 24, 24))).toEqual({
			type: "Rect",
			value: { min: { x: 8, y: 8 }, max: { x: 24, y: 24 } },
		});
	});
});

describe("Font", () => {
	it("defaults to regular Source Sans Pro", () => {
		const font = new Font();
		expect(font.Family).toBe("rbxasset://fonts/families/SourceSansPro.json");
		expect(font.Weight.Value).toBe(400);
		expect(font.Style.Name).toBe("Normal");
		expect(font.Bold).toBe(false);
	});

	it("reports Bold from SemiBold up, as the engine does", () => {
		expect(new Font(undefined, Enum.FontWeight.Medium).Bold).toBe(false);
		expect(new Font(undefined, Enum.FontWeight.SemiBold).Bold).toBe(true);
		expect(new Font(undefined, Enum.FontWeight.Heavy).Bold).toBe(true);
	});

	it("bridges the legacy Font enum", () => {
		const font = Font.fromEnum(Enum.Font.GothamBold);
		expect(font.Family).toBe("rbxasset://fonts/families/GothamSSm.json");
		expect(font.Weight).toBe(Enum.FontWeight.Bold);
		expect(Font.fromEnum(Enum.Font.SourceSansItalic).Style.Name).toBe("Italic");
	});

	it("encodes to the Font IR value", () => {
		const font = new Font(
			"rbxasset://fonts/families/GothamSSm.json",
			Enum.FontWeight.SemiBold,
			Enum.FontStyle.Italic,
		);
		expect(toPropertyValue(font)).toEqual({
			type: "Font",
			value: {
				family: "rbxasset://fonts/families/GothamSSm.json",
				weight: 600,
				style: "Italic",
			},
		});
	});
});

describe("UDim operator macros", () => {
	// roblox-ts compiles `a + b` on a UDim to `a.add(b)`; without these a real
	// project dies at render with "padding.add is not a function".
	it("adds and subtracts componentwise", () => {
		const a = new UDim(0.5, 10);
		const b = new UDim(0.25, 4);
		expect(a.add(b)).toEqual(new UDim(0.75, 14));
		expect(a.sub(b)).toEqual(new UDim(0.25, 6));
	});
});

describe("NumberSequence constructor", () => {
	// Same three forms `NumberSequence.new` takes, all compiled to `new`.
	it("ramps between two numbers", () => {
		expect(new NumberSequence(0, 1).Keypoints).toEqual([
			new NumberSequenceKeypoint(0, 0),
			new NumberSequenceKeypoint(1, 1),
		]);
	});

	it("holds one number flat across the ramp", () => {
		expect(new NumberSequence(0.5).Keypoints).toEqual([
			new NumberSequenceKeypoint(0, 0.5),
			new NumberSequenceKeypoint(1, 0.5),
		]);
	});

	it("keeps an explicit keypoint list", () => {
		const keypoints = [
			new NumberSequenceKeypoint(0, 1),
			new NumberSequenceKeypoint(0.5, 0, 0.1),
			new NumberSequenceKeypoint(1, 1),
		];
		expect(new NumberSequence(keypoints).Keypoints).toEqual(keypoints);
		expect(keypoints[1]?.Envelope).toBe(0.1);
	});
});

describe("robloxEquals", () => {
	// Roblox datatypes are userdata with value semantics, so `==` compares
	// components. React's prop diff is built on that: without it, a component
	// that rebuilds `Position={UDim2.fromScale(.5,.5)}` every render re-applies
	// the property and overwrites whatever was written outside React.
	it("compares datatypes by value, not identity", () => {
		expect(robloxEquals(new UDim2(0, 4, 0.5, 8), new UDim2(0, 4, 0.5, 8))).toBe(
			true,
		);
		expect(robloxEquals(new UDim(0.5, 2), new UDim(0.5, 2))).toBe(true);
		expect(robloxEquals(new Vector2(1, 2), new Vector2(1, 2))).toBe(true);
		expect(robloxEquals(Color3.fromRGB(1, 2, 3), Color3.fromRGB(1, 2, 3))).toBe(
			true,
		);
		expect(
			robloxEquals(
				new ColorSequence(Color3.fromRGB(255, 0, 0)),
				new ColorSequence(Color3.fromRGB(255, 0, 0)),
			),
		).toBe(true);
		expect(
			robloxEquals(new NumberSequence(0, 1), new NumberSequence(0, 1)),
		).toBe(true);
	});

	it("still separates values that differ", () => {
		expect(robloxEquals(new UDim2(0, 4, 0, 0), new UDim2(0, 5, 0, 0))).toBe(
			false,
		);
		expect(robloxEquals(new Vector2(1, 2), new Vector2(2, 1))).toBe(false);
		expect(
			robloxEquals(new NumberSequence(0, 1), new NumberSequence(0, 0.5)),
		).toBe(false);
	});

	it("never equates different types", () => {
		expect(robloxEquals(new UDim(0, 4), new Vector2(0, 4))).toBe(false);
		expect(robloxEquals(new UDim2(), {})).toBe(false);
		expect(robloxEquals(new Vector2(1, 2), { X: 1, Y: 2 })).toBe(false);
	});

	it("falls back to identity for everything else", () => {
		const fn = () => {};
		expect(robloxEquals(fn, fn)).toBe(true);
		expect(robloxEquals("a", "a")).toBe(true);
		expect(robloxEquals(Number.NaN, Number.NaN)).toBe(true); // Object.is
		expect(robloxEquals({ a: 1 }, { a: 1 })).toBe(false);
		expect(robloxEquals(undefined, undefined)).toBe(true);
		expect(robloxEquals(undefined, null)).toBe(false);
	});

	it("keeps EnumItem singletons equal to themselves only", () => {
		expect(robloxEquals(Enum.FontWeight.Bold, Enum.FontWeight.Bold)).toBe(true);
		expect(robloxEquals(Enum.FontWeight.Bold, Enum.FontWeight.Regular)).toBe(
			false,
		);
	});
});

describe("tostring", () => {
	// Roblox datatypes are userdata with a `__tostring`; JS classes have none, so
	// `${vector}` printed "[object Object]" — visibly, in a label reading
	// "Range Slider ([object Object])".
	it("formats the datatypes the way the engine does", () => {
		expect(`${new Vector2(2, 8)}`).toBe("2, 8");
		expect(`${new UDim(0.5, 10)}`).toBe("0.5, 10");
		expect(`${new UDim2(0.5, 10, 0, 20)}`).toBe("{0.5, 10}, {0, 20}");
		expect(`${Color3.fromRGB(255, 0, 0)}`).toBe("1, 0, 0");
	});

	it("reaches them through Luau tostring too", () => {
		expect(tostring(new Vector2(2, 8))).toBe("2, 8");
		expect(tostring(undefined)).toBe("nil");
	});
});

describe("Rect constructor", () => {
	it("accepts the four-number roblox-ts form (minX, minY, maxX, maxY)", () => {
		// roblox-ts compiles `Rect.new(8, 8, 24, 24)` — the SliceCenter form —
		// to `new Rect(8, 8, 24, 24)`, which used to store the raw numbers in
		// Min/Max and encode NaN insets into the 9-slice IR.
		const value = new Rect(8, 8, 24, 24);
		expect(value.Min).toEqual(new Vector2(8, 8));
		expect(value.Max).toEqual(new Vector2(24, 24));
		expect(value.Width).toBe(16);
		expect(value.Height).toBe(16);
		expect(toPropertyValue(value)).toEqual({
			type: "Rect",
			value: { min: { x: 8, y: 8 }, max: { x: 24, y: 24 } },
		});
	});

	it("still accepts the two-Vector2 form existing callers write", () => {
		const value = new Rect(new Vector2(1, 2), new Vector2(4, 6));
		expect(value.Min).toEqual(new Vector2(1, 2));
		expect(value.Max).toEqual(new Vector2(4, 6));
		expect(value.Width).toBe(3);
		expect(value.Height).toBe(4);
	});

	it("leaves Max at the origin for a lone Vector2, and defaults to empty", () => {
		expect(new Rect(new Vector2(3, 4)).Max).toEqual(Vector2.zero);
		expect(new Rect().toString()).toBe("0, 0, 0, 0");
	});

	it("Rect.new and the constructor agree on every form", () => {
		expect(robloxEquals(Rect.new(1, 2, 5, 9), new Rect(1, 2, 5, 9))).toBe(true);
		expect(
			robloxEquals(
				Rect.new(new Vector2(1, 2), new Vector2(5, 9)),
				new Rect(1, 2, 5, 9),
			),
		).toBe(true);
		expect(robloxEquals(new Rect(1, 2, 5, 9), new Rect(1, 2, 5, 8))).toBe(
			false,
		);
	});
});

describe("Random", () => {
	const draw = (random: Random, count: number): number[] =>
		Array.from({ length: count }, () => random.NextNumber());

	it("repeats its sequence for a given seed", () => {
		// The whole reason for an explicit PRNG rather than Math.random: a seed
		// has to draw the same numbers on every reload, or a procedurally laid
		// out scene redraws differently each time the preview refreshes.
		expect(draw(new Random(12_345), 8)).toEqual(draw(new Random(12_345), 8));
		expect(draw(Random.new(12_345), 8)).toEqual(draw(new Random(12_345), 8));
	});

	it("separates adjacent low-entropy seeds", () => {
		// `new Random(1)` and `new Random(2)` are what real code passes; without
		// the SplitMix32 scramble they would open with near-identical draws.
		const first = draw(new Random(1), 6);
		const second = draw(new Random(2), 6);
		expect(first).not.toEqual(second);
		expect(first.some((n, i) => Math.abs(n - (second[i] ?? 0)) > 0.01)).toBe(
			true,
		);
		expect(draw(new Random(-1), 6)).not.toEqual(draw(new Random(1), 6));
	});

	it("truncates a fractional seed, as the engine's int64 parameter does", () => {
		expect(draw(new Random(7.9), 4)).toEqual(draw(new Random(7), 4));
		expect(draw(new Random(Number.NaN), 4)).toEqual(draw(new Random(0), 4));
	});

	it("draws an unseeded stream from entropy, not a fixed default", () => {
		expect(new Random().NextNumber()).not.toBe(new Random().NextNumber());
	});

	it("NextNumber covers [0, 1) and scales to [min, max)", () => {
		const random = new Random(31);
		let total = 0;
		for (let i = 0; i < 5000; i++) {
			const unit = random.NextNumber();
			expect(unit).toBeGreaterThanOrEqual(0);
			expect(unit).toBeLessThan(1);
			total += unit;
			const scaled = random.NextNumber(10, 20);
			expect(scaled).toBeGreaterThanOrEqual(10);
			expect(scaled).toBeLessThan(20);
		}
		// A uniform stream, not a constant or a drifting one.
		expect(total / 5000).toBeCloseTo(0.5, 1);
	});

	it("NextInteger is inclusive at both ends and stays uniform", () => {
		const random = new Random(7);
		const counts = new Map<number, number>();
		for (let i = 0; i < 3000; i++) {
			const roll = random.NextInteger(1, 6);
			expect(Number.isInteger(roll)).toBe(true);
			expect(roll).toBeGreaterThanOrEqual(1);
			expect(roll).toBeLessThanOrEqual(6);
			counts.set(roll, (counts.get(roll) ?? 0) + 1);
		}
		// Both 1 and 6 have to turn up: the range is closed at both ends.
		expect([...counts.keys()].sort((a, b) => a - b)).toEqual([
			1, 2, 3, 4, 5, 6,
		]);
		for (const count of counts.values()) expect(count).toBeGreaterThan(400);
	});

	it("NextInteger handles a single value and a negative range", () => {
		const random = new Random(3);
		expect(random.NextInteger(5, 5)).toBe(5);
		for (let i = 0; i < 200; i++) {
			const value = random.NextInteger(-3, -1);
			expect(value).toBeGreaterThanOrEqual(-3);
			expect(value).toBeLessThanOrEqual(-1);
		}
	});

	it("NextInteger refuses an empty range rather than inventing a value", () => {
		expect(() => new Random(1).NextInteger(5, 1)).toThrow(
			"[loom] Random:NextInteger expected min <= max, received (5, 1)",
		);
	});

	it("NextUnitVector returns unit-length Vector3s, repeatably", () => {
		const random = new Random(99);
		for (let i = 0; i < 100; i++) {
			const direction = random.NextUnitVector();
			expect(direction).toBeInstanceOf(Vector3);
			expect(direction.Magnitude).toBeCloseTo(1, 12);
		}
		expect(new Random(99).NextUnitVector()).toEqual(
			new Random(99).NextUnitVector(),
		);
	});

	it("NextUnitVector spreads over the sphere rather than one hemisphere", () => {
		const random = new Random(1234);
		let positiveZ = 0;
		for (let i = 0; i < 400; i++) {
			if (random.NextUnitVector().Z > 0) positiveZ++;
		}
		expect(positiveZ).toBeGreaterThan(150);
		expect(positiveZ).toBeLessThan(250);
	});

	it("NextGaussian is a repeatable standard normal by default", () => {
		expect(new Random(8).NextGaussian()).toBe(new Random(8).NextGaussian());
		const random = new Random(8);
		const samples = Array.from({ length: 4000 }, () => random.NextGaussian());
		const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
		const variance =
			samples.reduce((a, b) => a + (b - mean) ** 2, 0) / samples.length;
		expect(mean).toBeCloseTo(0, 1);
		expect(Math.sqrt(variance)).toBeCloseTo(1, 1);
		// A zero deviation collapses onto the mean exactly.
		expect(new Random(8).NextGaussian(10, 0)).toBe(10);
	});

	it("Shuffle rewrites the array it is handed, in place", () => {
		const array = [1, 2, 3, 4, 5, 6, 7, 8];
		const sorted = [...array];
		const returned = new Random(4).Shuffle(array);
		// The engine's Shuffle returns nothing; the array itself is the result.
		expect(returned).toBeUndefined();
		expect(array).not.toEqual(sorted);
		expect([...array].sort((a, b) => a - b)).toEqual(sorted);
	});

	it("Shuffle is a permutation, and the same one for the same seed", () => {
		const first = ["a", "b", "c", "d", "e", "f"];
		const second = [...first];
		new Random(2024).Shuffle(first);
		new Random(2024).Shuffle(second);
		expect(first).toEqual(second);
		expect([...first].sort()).toEqual(["a", "b", "c", "d", "e", "f"]);
	});

	it("Shuffle leaves empty and single-element arrays alone", () => {
		const empty: number[] = [];
		const single = [42];
		new Random(1).Shuffle(empty);
		new Random(1).Shuffle(single);
		expect(empty).toEqual([]);
		expect(single).toEqual([42]);
	});

	it("Clone forks the stream where it stands, and runs on independently", () => {
		const source = new Random(2024);
		source.NextNumber();
		source.NextNumber();
		const clone = source.Clone();
		// A fork of the stream, not a reseed: the clone opens where the original
		// stands, which is not where a freshly seeded generator would.
		const forked = draw(clone, 3);
		expect(forked).not.toEqual(draw(new Random(2024), 3));
		// Running the clone on does not move the original, which still has those
		// same three numbers waiting for it.
		for (let i = 0; i < 100; i++) clone.NextNumber();
		expect(draw(source, 3)).toEqual(forked);
	});

	it("is program state, not a scene property, and keeps identity semantics", () => {
		const random = new Random(1);
		expect(toPropertyValue(random)).toBeUndefined();
		expect(robloxEquals(random, random)).toBe(true);
		// Two generators on the same seed are still two mutable streams.
		expect(robloxEquals(new Random(1), new Random(1))).toBe(false);
	});
});

describe("DateTime", () => {
	// 2024-03-05T14:07:09.123Z — a Tuesday, afternoon, with a fraction on it.
	const stampMillis = Date.UTC(2024, 2, 5, 14, 7, 9, 123);
	const stamp = DateTime.fromUnixTimestampMillis(stampMillis);
	const pad = (value: number, width = 2): string =>
		String(value).padStart(width, "0");

	it("carries the epoch millis and reports floored seconds", () => {
		expect(DateTime.fromUnixTimestamp(1_700_000_000).UnixTimestampMillis).toBe(
			1_700_000_000_000,
		);
		expect(DateTime.fromUnixTimestamp(1_700_000_000).UnixTimestamp).toBe(
			1_700_000_000,
		);
		expect(DateTime.fromUnixTimestampMillis(1500).UnixTimestamp).toBe(1);
		// Floored, not truncated, so the count stays monotonic across the epoch.
		expect(DateTime.fromUnixTimestampMillis(-1500).UnixTimestamp).toBe(-2);
		expect(DateTime.fromUnixTimestampMillis(0).UnixTimestamp).toBe(0);
	});

	it("now() reads the browser clock", () => {
		const before = Date.now();
		const now = DateTime.now();
		expect(now.UnixTimestampMillis).toBeGreaterThanOrEqual(before);
		expect(now.UnixTimestampMillis).toBeLessThanOrEqual(Date.now());
	});

	it("fromUniversalTime defaults to the epoch and rolls over out-of-range fields", () => {
		expect(DateTime.fromUniversalTime().UnixTimestampMillis).toBe(0);
		expect(
			DateTime.fromUniversalTime(2024, 3, 5, 14, 7, 9, 123).UnixTimestampMillis,
		).toBe(stampMillis);
		// Month 13 is January of the next year, as os.time and Date both have it.
		const rolled = DateTime.fromUniversalTime(2024, 13, 1).ToUniversalTime();
		expect(rolled.Year).toBe(2025);
		expect(rolled.Month).toBe(1);
	});

	it("fromUniversalTime means the year it is given, not 1900 plus it", () => {
		// `Date.UTC(70, …)` is 1970; the engine's year 70 is the year 70.
		expect(DateTime.fromUniversalTime(70, 1, 1).ToUniversalTime().Year).toBe(
			70,
		);
		expect(DateTime.fromUniversalTime(70, 1, 1).ToIsoDate()).toBe(
			"0070-01-01T00:00:00Z",
		);
	});

	it("fromLocalTime round-trips through ToLocalTime in the viewer's zone", () => {
		const local = DateTime.fromLocalTime(2024, 3, 5, 14, 7, 9, 123);
		expect(local.ToLocalTime()).toEqual({
			Year: 2024,
			Month: 3,
			Day: 5,
			Hour: 14,
			Minute: 7,
			Second: 9,
			Millisecond: 123,
		});
		expect(DateTime.fromLocalTime().ToLocalTime().Year).toBe(1970);
	});

	it("ToUniversalTime breaks the instant into 1-based calendar fields", () => {
		expect(stamp.ToUniversalTime()).toEqual({
			Year: 2024,
			Month: 3,
			Day: 5,
			Hour: 14,
			Minute: 7,
			Second: 9,
			Millisecond: 123,
		});
	});

	it("ToIsoDate prints UTC to the second, with no fractional part", () => {
		expect(DateTime.fromUnixTimestampMillis(0).ToIsoDate()).toBe(
			"1970-01-01T00:00:00Z",
		);
		expect(stamp.ToIsoDate()).toBe("2024-03-05T14:07:09Z");
		// The dropped milliseconds are still on the object.
		expect(stamp.ToUniversalTime().Millisecond).toBe(123);
	});

	it("fromIsoDate parses the ISO forms, reading a missing zone as UTC", () => {
		expect(DateTime.fromIsoDate("2024-03-05T14:07:09Z")?.ToIsoDate()).toBe(
			"2024-03-05T14:07:09Z",
		);
		expect(
			DateTime.fromIsoDate("2024-03-05T14:07:09.123Z")?.UnixTimestampMillis,
		).toBe(stampMillis);
		// No zone designator: UTC, not the machine's timezone.
		expect(
			DateTime.fromIsoDate("2024-03-05T14:07:09")?.UnixTimestampMillis,
		).toBe(Date.UTC(2024, 2, 5, 14, 7, 9));
		expect(DateTime.fromIsoDate("2024-03-05")?.UnixTimestampMillis).toBe(
			Date.UTC(2024, 2, 5),
		);
		expect(DateTime.fromIsoDate("2024-03-05T14:07")?.UnixTimestampMillis).toBe(
			Date.UTC(2024, 2, 5, 14, 7),
		);
		expect(
			DateTime.fromIsoDate("2024-03-05T14:07:09+02:00")?.UnixTimestampMillis,
		).toBe(Date.UTC(2024, 2, 5, 12, 7, 9));
		expect(DateTime.fromIsoDate(stamp.ToIsoDate())?.UnixTimestamp).toBe(
			stamp.UnixTimestamp,
		);
	});

	it("fromIsoDate answers undefined for anything that is not an ISO date", () => {
		// Luau's nil. Everything here is either not ISO at all, or a shape
		// `Date.parse` would happily reinterpret on its own.
		for (const text of [
			"",
			"not a date",
			"December 17, 1995",
			"Mar 5 2020",
			"05/03/2024",
			"2024-3-5",
			"2024-03-05 14:07:09",
			"2024-13-01",
			"2024-02-30",
			"2024-03-05T25:00:00Z",
			"2024-03-05T14:07:09Zjunk",
		]) {
			expect(DateTime.fromIsoDate(text)).toBeUndefined();
		}
	});

	it("formats LDML numeric tokens, widening on repetition", () => {
		expect(stamp.FormatUniversalTime("yyyy-MM-dd")).toBe("2024-03-05");
		expect(stamp.FormatUniversalTime("y")).toBe("2024");
		expect(stamp.FormatUniversalTime("yy")).toBe("24");
		expect(stamp.FormatUniversalTime("yyyyy")).toBe("02024");
		expect(stamp.FormatUniversalTime("M/d")).toBe("3/5");
		expect(stamp.FormatUniversalTime("HH:mm:ss")).toBe("14:07:09");
		expect(stamp.FormatUniversalTime("H:m:s")).toBe("14:7:9");
	});

	it("formats the 12-hour clock and its day period", () => {
		expect(stamp.FormatUniversalTime("h:mm a")).toBe("2:07 PM");
		expect(stamp.FormatUniversalTime("hh")).toBe("02");
		// Midnight is 12 AM on a 12-hour clock, not 0.
		const midnight = DateTime.fromUniversalTime(2024, 3, 5);
		expect(midnight.FormatUniversalTime("h a")).toBe("12 AM");
		expect(midnight.FormatUniversalTime("H")).toBe("0");
	});

	it("formats month and weekday names at every width", () => {
		expect(stamp.FormatUniversalTime("MMM")).toBe("Mar");
		expect(stamp.FormatUniversalTime("MMMM")).toBe("March");
		expect(stamp.FormatUniversalTime("MMMMM")).toBe("M");
		// `L` is LDML's stand-alone month; Intl exposes only the format form, so
		// loom prints that for both — identical in en-us.
		expect(stamp.FormatUniversalTime("LLL")).toBe("Mar");
		expect(stamp.FormatUniversalTime("LLLL")).toBe("March");
		expect(stamp.FormatUniversalTime("LL")).toBe("03");
		expect(stamp.FormatUniversalTime("E")).toBe("Tue");
		expect(stamp.FormatUniversalTime("EEE")).toBe("Tue");
		expect(stamp.FormatUniversalTime("EEEE")).toBe("Tuesday");
		expect(stamp.FormatUniversalTime("EEEEE")).toBe("T");
	});

	it("honours the locale argument for the name tokens", () => {
		expect(stamp.FormatUniversalTime("MMMM", "fr-FR")).toBe("mars");
		expect(stamp.FormatUniversalTime("EEEE", "fr-FR")).toBe("mardi");
		// Numbers are locale-independent here: the pattern, not Intl, lays out.
		expect(stamp.FormatUniversalTime("yyyy-MM-dd", "fr-FR")).toBe("2024-03-05");
	});

	it("truncates the fractional second rather than rounding it", () => {
		expect(stamp.FormatUniversalTime("S")).toBe("1");
		expect(stamp.FormatUniversalTime("SS")).toBe("12");
		expect(stamp.FormatUniversalTime("SSS")).toBe("123");
		expect(stamp.FormatUniversalTime("SSSS")).toBe("1230");
		expect(
			DateTime.fromUnixTimestampMillis(
				Date.UTC(2024, 2, 5, 0, 0, 0, 7),
			).FormatUniversalTime("SSS"),
		).toBe("007");
	});

	it("names the timezone", () => {
		expect(stamp.FormatUniversalTime("z")).toBe("UTC");
		expect(stamp.FormatUniversalTime("zzzz")).toBe(
			"Coordinated Universal Time",
		);
	});

	it("treats quoted text as literal, with '' for an apostrophe", () => {
		expect(stamp.FormatUniversalTime("'at' HH:mm")).toBe("at 14:07");
		expect(stamp.FormatUniversalTime("''")).toBe("'");
		expect(stamp.FormatUniversalTime("h 'o''clock'")).toBe("2 o'clock");
		expect(stamp.FormatUniversalTime("EEEE, MMMM d, yyyy 'at' h:mm a")).toBe(
			"Tuesday, March 5, 2024 at 2:07 PM",
		);
	});

	it("writes an unimplemented pattern letter back out verbatim", () => {
		expect(stamp.FormatUniversalTime("QQ")).toBe("QQ");
		expect(stamp.FormatUniversalTime("G")).toBe("G");
		// LDML, not strftime: `%` is literal but H and M are read as hour and
		// *month*, so an os.date pattern comes back quietly mangled — which is
		// what the engine does with one too.
		expect(stamp.FormatUniversalTime("%H:%M")).toBe("%14:%3");
	});

	it("FormatLocalTime renders in the viewer's own timezone", () => {
		const local = stamp.ToLocalTime();
		expect(stamp.FormatLocalTime("yyyy-MM-dd HH:mm:ss")).toBe(
			`${local.Year}-${pad(local.Month)}-${pad(local.Day)} ${pad(
				local.Hour,
			)}:${pad(local.Minute)}:${pad(local.Second)}`,
		);
	});

	it("compares by instant and carries no IR encoding", () => {
		// An immutable value type, so two DateTimes on the same millisecond are
		// the same value — but no scene property holds one, so nothing encodes.
		expect(
			robloxEquals(
				DateTime.fromUnixTimestampMillis(stampMillis),
				DateTime.fromUnixTimestampMillis(stampMillis),
			),
		).toBe(true);
		expect(
			robloxEquals(
				DateTime.fromUnixTimestampMillis(stampMillis),
				DateTime.fromUnixTimestampMillis(stampMillis + 1),
			),
		).toBe(false);
		expect(robloxEquals(stamp, new UDim(0, 0))).toBe(false);
		expect(toPropertyValue(stamp)).toBeUndefined();
	});
});
