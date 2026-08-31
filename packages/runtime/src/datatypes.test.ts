import { describe, expect, it } from "vitest";
import {
	Color3,
	ColorSequence,
	ColorSequenceKeypoint,
	Font,
	NumberSequence,
	NumberSequenceKeypoint,
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

describe("Rect constructor", () => {
	it("accepts the four-number roblox-ts form (minX, minY, maxX, maxY)", () => {
		// roblox-ts compiles `new Rect(54, 55, 200, 200)` to this; component
		// code (e.g. a 9-slice SliceCenter built from parsed CSS) relies on it.
		const value = new Rect(54, 55, 200, 200);
		expect(value.Min).toBeInstanceOf(Vector2);
		expect(value.Min.X).toBe(54);
		expect(value.Min.Y).toBe(55);
		expect(value.Max.X).toBe(200);
		expect(value.Max.Y).toBe(200);
		expect(value.Width).toBe(146);
		expect(value.Height).toBe(145);
	});

	it("accepts the two-Vector2 form", () => {
		const value = new Rect(new Vector2(8, 8), new Vector2(24, 24));
		expect(value.Min.X).toBe(8);
		expect(value.Max.X).toBe(24);
		expect(value.Width).toBe(16);
	});

	it("defaults to a zero Rect", () => {
		const value = new Rect();
		expect(value.Min.X).toBe(0);
		expect(value.Max.Y).toBe(0);
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
