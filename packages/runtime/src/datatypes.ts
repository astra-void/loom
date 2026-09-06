/**
 * `datatypes.ts` — Roblox datatypes for the browser preview.
 *
 * Minimal JS implementations of the Roblox GUI datatypes that component code
 * (`@rbxts/react`) constructs. The frontend adapters detect these via
 * `instanceof` and convert them into Scene IR property values. PascalCase
 * fields (`.X`, `.Scale`, `.R`) match Roblox's reflection so adapters read them
 * directly, and the lowercase arithmetic methods (`add`/`sub`/`mul`/`div`)
 * match roblox-ts's operator macro names.
 */
import { type PropertyValue, prop } from "@loom-dev/scene";
import { Enum, EnumItem, enumTypeName } from "./enums";

export class UDim {
	constructor(
		readonly Scale: number,
		readonly Offset: number,
	) {}
	static new(scale = 0, offset = 0): UDim {
		return new UDim(scale, offset);
	}
	/** roblox-ts `+` operator macro. */
	add(other: UDim): UDim {
		return new UDim(this.Scale + other.Scale, this.Offset + other.Offset);
	}
	/** roblox-ts `-` operator macro. */
	sub(other: UDim): UDim {
		return new UDim(this.Scale - other.Scale, this.Offset - other.Offset);
	}
	/** Roblox `tostring`: `"0.5, 10"`. */
	toString(): string {
		return `${this.Scale}, ${this.Offset}`;
	}
}

export class UDim2 {
	readonly X: UDim;
	readonly Y: UDim;
	/**
	 * Matches roblox-ts's two `UDim2.new` forms, both of which compile to
	 * `new UDim2(...)`: two `UDim`s (`new UDim2(xUDim, yUDim)`) or four numbers
	 * (`new UDim2(xScale, xOffset, yScale, yOffset)`). Component code uses the
	 * numeric form (e.g. `new UDim2(1, -22, 0, 2)`), so a `(UDim, UDim)`-only
	 * constructor would silently store the raw numbers and break layout.
	 */
	constructor(a: UDim | number = 0, b: UDim | number = 0, c = 0, d = 0) {
		if (a instanceof UDim && b instanceof UDim) {
			this.X = a;
			this.Y = b;
		} else {
			this.X = new UDim(a as number, b as number);
			this.Y = new UDim(c, d);
		}
	}
	static new(xScale = 0, xOffset = 0, yScale = 0, yOffset = 0): UDim2 {
		return new UDim2(new UDim(xScale, xOffset), new UDim(yScale, yOffset));
	}
	static fromScale(x = 0, y = 0): UDim2 {
		return new UDim2(new UDim(x, 0), new UDim(y, 0));
	}
	static fromOffset(x = 0, y = 0): UDim2 {
		return new UDim2(new UDim(0, x), new UDim(0, y));
	}
	/** roblox-ts `+` operator macro. */
	add(other: UDim2): UDim2 {
		return new UDim2(
			new UDim(this.X.Scale + other.X.Scale, this.X.Offset + other.X.Offset),
			new UDim(this.Y.Scale + other.Y.Scale, this.Y.Offset + other.Y.Offset),
		);
	}
	/** roblox-ts `-` operator macro. */
	sub(other: UDim2): UDim2 {
		return new UDim2(
			new UDim(this.X.Scale - other.X.Scale, this.X.Offset - other.X.Offset),
			new UDim(this.Y.Scale - other.Y.Scale, this.Y.Offset - other.Y.Offset),
		);
	}
	/** Interpolates both axes' scale *and* offset — the engine's own `Lerp`. */
	Lerp(other: UDim2, alpha: number): UDim2 {
		const axis = (from: UDim, to: UDim): UDim =>
			new UDim(
				from.Scale + (to.Scale - from.Scale) * alpha,
				from.Offset + (to.Offset - from.Offset) * alpha,
			);
		return new UDim2(axis(this.X, other.X), axis(this.Y, other.Y));
	}
	/** Roblox `tostring`: `"{0.5, 10}, {0, 20}"`. */
	toString(): string {
		return `{${this.X}}, {${this.Y}}`;
	}
}

export class Vector2 {
	constructor(
		readonly X: number,
		readonly Y: number,
	) {}
	static new(x = 0, y = 0): Vector2 {
		return new Vector2(x, y);
	}
	static readonly zero = new Vector2(0, 0);
	static readonly one = new Vector2(1, 1);
	static readonly xAxis = new Vector2(1, 0);
	static readonly yAxis = new Vector2(0, 1);
	get Magnitude(): number {
		return Math.sqrt(this.X * this.X + this.Y * this.Y);
	}
	/**
	 * The direction alone. A zero vector has none, and the engine answers `NAN`
	 * for it (verified) rather than zero — dividing by the magnitude, as here.
	 */
	get Unit(): Vector2 {
		const length = this.Magnitude;
		return new Vector2(this.X / length, this.Y / length);
	}
	Dot(other: Vector2): number {
		return this.X * other.X + this.Y * other.Y;
	}
	/** The z of the 3D cross product — a scalar, as in the engine. */
	Cross(other: Vector2): number {
		return this.X * other.Y - this.Y * other.X;
	}
	Lerp(other: Vector2, alpha: number): Vector2 {
		return new Vector2(
			this.X + (other.X - this.X) * alpha,
			this.Y + (other.Y - this.Y) * alpha,
		);
	}
	/** Per-component maximum, not the longer vector. */
	Max(other: Vector2): Vector2 {
		return new Vector2(Math.max(this.X, other.X), Math.max(this.Y, other.Y));
	}
	/** Per-component minimum. */
	Min(other: Vector2): Vector2 {
		return new Vector2(Math.min(this.X, other.X), Math.min(this.Y, other.Y));
	}
	Abs(): Vector2 {
		return new Vector2(Math.abs(this.X), Math.abs(this.Y));
	}
	/** roblox-ts `+` operator macro. */
	add(other: Vector2): Vector2 {
		return new Vector2(this.X + other.X, this.Y + other.Y);
	}
	/** roblox-ts `-` operator macro. */
	sub(other: Vector2): Vector2 {
		return new Vector2(this.X - other.X, this.Y - other.Y);
	}
	/** roblox-ts `*` operator macro (vector or scalar). */
	mul(other: Vector2 | number): Vector2 {
		return typeof other === "number"
			? new Vector2(this.X * other, this.Y * other)
			: new Vector2(this.X * other.X, this.Y * other.Y);
	}
	/** roblox-ts `/` operator macro (vector or scalar). */
	div(other: Vector2 | number): Vector2 {
		return typeof other === "number"
			? new Vector2(this.X / other, this.Y / other)
			: new Vector2(this.X / other.X, this.Y / other.Y);
	}
	/** Roblox `tostring`: `"2, 8"`. */
	toString(): string {
		return `${this.X}, ${this.Y}`;
	}
}

export class Vector3 {
	constructor(
		readonly X: number,
		readonly Y: number,
		readonly Z: number,
	) {}
	static new(x = 0, y = 0, z = 0): Vector3 {
		return new Vector3(x, y, z);
	}
	static readonly zero = new Vector3(0, 0, 0);
	static readonly one = new Vector3(1, 1, 1);
	static readonly xAxis = new Vector3(1, 0, 0);
	static readonly yAxis = new Vector3(0, 1, 0);
	static readonly zAxis = new Vector3(0, 0, 1);
	get Magnitude(): number {
		return Math.sqrt(this.X * this.X + this.Y * this.Y + this.Z * this.Z);
	}
	/** Direction only; `NAN` components for a zero vector, as in the engine. */
	get Unit(): Vector3 {
		const length = this.Magnitude;
		return new Vector3(this.X / length, this.Y / length, this.Z / length);
	}
	Dot(other: Vector3): number {
		return this.X * other.X + this.Y * other.Y + this.Z * other.Z;
	}
	Cross(other: Vector3): Vector3 {
		return new Vector3(
			this.Y * other.Z - this.Z * other.Y,
			this.Z * other.X - this.X * other.Z,
			this.X * other.Y - this.Y * other.X,
		);
	}
	Lerp(other: Vector3, alpha: number): Vector3 {
		return new Vector3(
			this.X + (other.X - this.X) * alpha,
			this.Y + (other.Y - this.Y) * alpha,
			this.Z + (other.Z - this.Z) * alpha,
		);
	}
	/** roblox-ts `+` operator macro. */
	add(other: Vector3): Vector3 {
		return new Vector3(this.X + other.X, this.Y + other.Y, this.Z + other.Z);
	}
	/** roblox-ts `-` operator macro. */
	sub(other: Vector3): Vector3 {
		return new Vector3(this.X - other.X, this.Y - other.Y, this.Z - other.Z);
	}
	/** roblox-ts `*` operator macro (vector or scalar). */
	mul(other: Vector3 | number): Vector3 {
		return typeof other === "number"
			? new Vector3(this.X * other, this.Y * other, this.Z * other)
			: new Vector3(this.X * other.X, this.Y * other.Y, this.Z * other.Z);
	}
	/** Roblox `tostring`: `"1, 2, 3"`. */
	toString(): string {
		return `${this.X}, ${this.Y}, ${this.Z}`;
	}
}

/** A Roblox `Rect` (axis-aligned rectangle between two corners). */
export class Rect {
	readonly Min: Vector2;
	readonly Max: Vector2;
	readonly Width: number;
	readonly Height: number;
	/**
	 * Both forms `Rect.new` takes, because roblox-ts compiles both to
	 * `new Rect(...)`: two `Vector2` corners (`new Rect(min, max)`) or four
	 * numbers (`new Rect(minX, minY, maxX, maxY)`). Component code writes the
	 * numeric form for `SliceCenter` — `new Rect(8, 8, 24, 24)` — and a
	 * `(Vector2, Vector2)`-only constructor would store those raw numbers in
	 * `Min`/`Max`, so `Min.X` reads back `undefined` and the 9-slice IR encodes
	 * `NaN` insets instead of a border.
	 *
	 * A lone `Vector2` leaves `Max` at the origin. The engine rejects that call
	 * outright, but an error thrown mid-render takes the whole scene down with
	 * it, and an empty rect at least keeps the rest of the tree drawing.
	 */
	constructor(
		a: Vector2 | number = 0,
		b: Vector2 | number = 0,
		maxX = 0,
		maxY = 0,
	) {
		if (a instanceof Vector2) {
			this.Min = a;
			this.Max = b instanceof Vector2 ? b : Vector2.zero;
		} else {
			this.Min = new Vector2(a, typeof b === "number" ? b : 0);
			this.Max = new Vector2(maxX, maxY);
		}
		this.Width = this.Max.X - this.Min.X;
		this.Height = this.Max.Y - this.Min.Y;
	}
	/** `Rect.new(minX, minY, maxX, maxY)` or `Rect.new(min, max)` vectors. */
	static new(
		a: Vector2 | number = 0,
		b: Vector2 | number = 0,
		maxX = 0,
		maxY = 0,
	): Rect {
		return new Rect(a, b, maxX, maxY);
	}
	/** Roblox `tostring`: `"1, 2, 5, 9"` — both corners, flattened. */
	toString(): string {
		return `${this.Min.X}, ${this.Min.Y}, ${this.Max.X}, ${this.Max.Y}`;
	}
}

/**
 * A position-only Roblox `CFrame` — enough for the 2D motion code lattice
 * runs (`CFrame.Lerp` interpolation targets). No rotation support.
 */
export class CFrame {
	readonly Position: Vector3;
	constructor(x = 0, y = 0, z = 0) {
		this.Position = new Vector3(x, y, z);
	}
	static new(x = 0, y = 0, z = 0): CFrame {
		return new CFrame(x, y, z);
	}
	get X(): number {
		return this.Position.X;
	}
	get Y(): number {
		return this.Position.Y;
	}
	get Z(): number {
		return this.Position.Z;
	}
	Lerp(other: CFrame, alpha: number): CFrame {
		return new CFrame(
			this.X + (other.X - this.X) * alpha,
			this.Y + (other.Y - this.Y) * alpha,
			this.Z + (other.Z - this.Z) * alpha,
		);
	}
	FuzzyEq(other: CFrame, epsilon = 1e-5): boolean {
		return (
			Math.abs(this.X - other.X) <= epsilon &&
			Math.abs(this.Y - other.Y) <= epsilon &&
			Math.abs(this.Z - other.Z) <= epsilon
		);
	}
}

/**
 * A Roblox `Font` — the modern typeface value behind `TextLabel.FontFace`,
 * which supersedes the legacy `Font` *enum*. `Family` is a font-family asset
 * URI (`rbxasset://fonts/families/SourceSansPro.json`); the renderer maps its
 * basename onto a CSS family stack, and `Weight.Value` is already the CSS
 * weight number.
 */
export class Font {
	constructor(
		readonly Family = "rbxasset://fonts/families/SourceSansPro.json",
		readonly Weight: EnumItem<"FontWeight"> = Enum.FontWeight.Regular,
		readonly Style: EnumItem<"FontStyle"> = Enum.FontStyle.Normal,
	) {}

	/** Roblox's convenience flag: true from `SemiBold` up, as in the engine. */
	get Bold(): boolean {
		return this.Weight.Value >= Enum.FontWeight.SemiBold.Value;
	}

	static new(
		family?: string,
		weight?: EnumItem<"FontWeight">,
		style?: EnumItem<"FontStyle">,
	): Font {
		return new Font(family, weight, style);
	}

	/**
	 * `Font.fromEnum(Enum.Font.GothamBold)` — the bridge from the legacy enum,
	 * whose names fold a family and a weight into one identifier.
	 */
	static fromEnum(item: EnumItem<"Font">): Font {
		return new Font(
			`rbxasset://fonts/families/${legacyFontFamily(item.Name)}.json`,
			legacyFontWeight(item.Name),
			item.Name.includes("Italic")
				? Enum.FontStyle.Italic
				: Enum.FontStyle.Normal,
		);
	}

	/** `Font.fromName("SourceSansPro", …)` — family by bare name, not URI. */
	static fromName(
		name: string,
		weight?: EnumItem<"FontWeight">,
		style?: EnumItem<"FontStyle">,
	): Font {
		return new Font(`rbxasset://fonts/families/${name}.json`, weight, style);
	}
}

/**
 * Legacy `Enum.Font` name → the family the modern datatype names it by.
 *
 * Most of the list names its own family (`Jura` is `Jura`), so only the ones
 * that rename are listed and {@link legacyFontFamily} falls through to the enum
 * name. The weight suffixes collapse onto one family — `GothamBold` is
 * `GothamSSm` at 700, which is what {@link legacyFontWeight} peels off.
 */
const LEGACY_FONT_FAMILIES: Record<string, string> = {
	SourceSans: "SourceSansPro",
	SourceSansBold: "SourceSansPro",
	SourceSansSemibold: "SourceSansPro",
	SourceSansLight: "SourceSansPro",
	SourceSansItalic: "SourceSansPro",
	Gotham: "GothamSSm",
	GothamMedium: "GothamSSm",
	GothamBold: "GothamSSm",
	GothamBlack: "GothamSSm",
	ArialBold: "Arial",
	ArimoBold: "Arimo",
	BuilderSansMedium: "BuilderSans",
	BuilderSansBold: "BuilderSans",
	BuilderSansExtraBold: "BuilderSans",
	Highway: "HighwayGothic",
	Code: "Inconsolata",
	Legacy: "LegacyArial",
};

/** The `FontFace` family a legacy `Enum.Font` item resolves to. */
function legacyFontFamily(name: string): string {
	return LEGACY_FONT_FAMILIES[name] ?? name;
}

function legacyFontWeight(name: string): EnumItem<"FontWeight"> {
	if (name.includes("Black")) return Enum.FontWeight.Heavy;
	if (name.includes("Bold")) return Enum.FontWeight.Bold;
	if (name.includes("Semibold")) return Enum.FontWeight.SemiBold;
	if (name.includes("Medium")) return Enum.FontWeight.Medium;
	if (name.includes("Light")) return Enum.FontWeight.Light;
	return Enum.FontWeight.Regular;
}

/** An inert Roblox `TweenInfo` bag: the shape `TweenService` reads. */
export class TweenInfo {
	constructor(
		readonly Time = 1,
		readonly EasingStyle: EnumItem<"EasingStyle"> = Enum.EasingStyle.Quad,
		readonly EasingDirection: EnumItem<"EasingDirection"> = Enum.EasingDirection
			.Out,
		readonly RepeatCount = 0,
		readonly Reverses = false,
		readonly DelayTime = 0,
	) {}
	static new(
		time?: number,
		easingStyle?: EnumItem<"EasingStyle">,
		easingDirection?: EnumItem<"EasingDirection">,
		repeatCount?: number,
		reverses?: boolean,
		delayTime?: number,
	): TweenInfo {
		return new TweenInfo(
			time,
			easingStyle,
			easingDirection,
			repeatCount,
			reverses,
			delayTime,
		);
	}
}

export class Color3 {
	/** Channels are 0..1, matching Roblox. */
	constructor(
		readonly R: number,
		readonly G: number,
		readonly B: number,
	) {}
	static new(r = 0, g = 0, b = 0): Color3 {
		return new Color3(r, g, b);
	}
	static fromRGB(r = 0, g = 0, b = 0): Color3 {
		// Roblox rounds and clamps each channel to 0..255 before normalizing.
		const c = (n: number): number =>
			Math.round(Math.min(255, Math.max(0, n))) / 255;
		return new Color3(c(r), c(g), c(b));
	}
	/**
	 * `Color3.fromHex("#6366F1")` — the hexadecimal form theme code writes.
	 *
	 * Strictly six RGB digits after at most one leading `#`, either case; the
	 * channels then go through {@link Color3.fromRGB}, so rounding and clamping
	 * stay on the one conversion path. Anything else throws rather than guessing:
	 * CSS shorthand (`#FFF`), an alpha channel (`#FFFFFFFF`), `0x` notation and
	 * surrounding whitespace are all rejected, because silently accepting them
	 * would render a color the same source never shows in Studio.
	 */
	static fromHex(hex: string): Color3 {
		const value = hex.startsWith("#") ? hex.slice(1) : hex;
		if (!/^[0-9a-fA-F]{6}$/.test(value)) {
			throw new Error(
				`[loom] Color3.fromHex expected exactly 6 hexadecimal digits, received "${hex}"`,
			);
		}
		return Color3.fromRGB(
			Number.parseInt(value.slice(0, 2), 16),
			Number.parseInt(value.slice(2, 4), 16),
			Number.parseInt(value.slice(4, 6), 16),
		);
	}
	/**
	 * `Color3.fromHSV(h, s, v)` — every component 0..1, hue wrapping at 1.
	 *
	 * Kept in floating point rather than routed through `fromRGB`: the engine
	 * does not quantize here either, and a round trip through `ToHSV` comes back
	 * to the colour it started from.
	 */
	static fromHSV(hue = 0, saturation = 0, value = 0): Color3 {
		const h = ((hue % 1) + 1) % 1;
		const s = Math.min(1, Math.max(0, saturation));
		const v = Math.min(1, Math.max(0, value));
		const sector = h * 6;
		const chroma = v * s;
		// The second-largest component, falling off either side of each sector.
		const middle = chroma * (1 - Math.abs((sector % 2) - 1));
		const floor = v - chroma;
		const [r, g, b] =
			sector < 1
				? [chroma, middle, 0]
				: sector < 2
					? [middle, chroma, 0]
					: sector < 3
						? [0, chroma, middle]
						: sector < 4
							? [0, middle, chroma]
							: sector < 5
								? [middle, 0, chroma]
								: [chroma, 0, middle];
		return new Color3(r + floor, g + floor, b + floor);
	}
	/**
	 * `Color3:ToHSV()` — hue, saturation and value, each 0..1, destructured by
	 * roblox-ts as a tuple: `const [h, s, v] = color.ToHSV()`.
	 *
	 * A grey has no hue to report, and the engine answers 0 for it (verified),
	 * rather than leaving it undefined as some conversions do.
	 */
	ToHSV(): [number, number, number] {
		const max = Math.max(this.R, this.G, this.B);
		const min = Math.min(this.R, this.G, this.B);
		const chroma = max - min;
		const hue =
			chroma === 0
				? 0
				: max === this.R
					? (((this.G - this.B) / chroma) % 6) / 6
					: max === this.G
						? ((this.B - this.R) / chroma + 2) / 6
						: ((this.R - this.G) / chroma + 4) / 6;
		return [hue < 0 ? hue + 1 : hue, max === 0 ? 0 : chroma / max, max];
	}
	/**
	 * `Color3:ToHex()` — six **lowercase** hexadecimal digits, no leading `#`.
	 *
	 * Verified against a running engine rather than guessed at: `ToHex` is
	 * lowercase, unbraced and unprefixed, and each channel is clamped to 0..1 and
	 * then rounded to the nearest 255th — the exact inverse of
	 * {@link Color3.fromRGB}, so `Color3.fromHex(c.ToHex())` is `c` again.
	 */
	ToHex(): string {
		const channel = (n: number): string =>
			Math.round(Math.min(1, Math.max(0, n)) * 255)
				.toString(16)
				.padStart(2, "0");
		return `${channel(this.R)}${channel(this.G)}${channel(this.B)}`;
	}
	Lerp(other: Color3, alpha: number): Color3 {
		return new Color3(
			this.R + (other.R - this.R) * alpha,
			this.G + (other.G - this.G) * alpha,
			this.B + (other.B - this.B) * alpha,
		);
	}
	/** Roblox `tostring`: `"1, 0, 0"` — the 0..1 components, not the hex. */
	toString(): string {
		return `${this.R}, ${this.G}, ${this.B}`;
	}
}

export class ColorSequenceKeypoint {
	constructor(
		readonly Time: number,
		readonly Value: Color3,
	) {}
}

/** A Roblox `ColorSequence` (gradient color ramp). */
export class ColorSequence {
	readonly Keypoints: readonly ColorSequenceKeypoint[];
	/**
	 * Takes every form `ColorSequence.new` does, because roblox-ts compiles all
	 * of them to `new ColorSequence(...)`: a keypoint list, one color (a flat
	 * ramp), or a two-color ramp. A `(keypoints)`-only constructor would store a
	 * `Color3` in `Keypoints` and blow up when the gradient is encoded.
	 */
	constructor(a: Color3 | readonly ColorSequenceKeypoint[] = [], b?: Color3) {
		this.Keypoints = Array.isArray(a)
			? (a as readonly ColorSequenceKeypoint[])
			: [
					new ColorSequenceKeypoint(0, a as Color3),
					new ColorSequenceKeypoint(1, b ?? (a as Color3)),
				];
	}
	/** `ColorSequence.new(c)`, `.new(c0, c1)`, or `.new(keypoints)`. */
	static new(
		a: Color3 | readonly ColorSequenceKeypoint[],
		b?: Color3,
	): ColorSequence {
		return new ColorSequence(a, b);
	}
}

export class NumberSequenceKeypoint {
	constructor(
		readonly Time: number,
		readonly Value: number,
		readonly Envelope: number = 0,
	) {}
}

/**
 * A Roblox `NumberSequence` (a ramp of numbers over 0..1) — `UIGradient`'s
 * `Transparency`, `Pie`-style masks, particle curves.
 *
 * The Scene IR has no slot for one yet, so `toPropertyValue` still drops it and
 * the renderer paints the un-ramped value. It exists here because the datatype
 * has to *construct*: roblox-ts code builds these at render time, and a missing
 * global takes the whole scene down with a `ReferenceError` long before anything
 * could have consumed the ramp.
 */
export class NumberSequence {
	readonly Keypoints: readonly NumberSequenceKeypoint[];
	/**
	 * Every form `NumberSequence.new` takes, since roblox-ts compiles them all to
	 * `new NumberSequence(...)`: a keypoint list, one number (a flat ramp), or a
	 * two-number ramp — mirroring {@link ColorSequence}.
	 */
	constructor(a: number | readonly NumberSequenceKeypoint[] = 0, b?: number) {
		this.Keypoints = Array.isArray(a)
			? (a as readonly NumberSequenceKeypoint[])
			: [
					new NumberSequenceKeypoint(0, a as number),
					new NumberSequenceKeypoint(1, b ?? (a as number)),
				];
	}
	/** `NumberSequence.new(n)`, `.new(n0, n1)`, or `.new(keypoints)`. */
	static new(
		a: number | readonly NumberSequenceKeypoint[],
		b?: number,
	): NumberSequence {
		return new NumberSequence(a, b);
	}
}

// --- Random ------------------------------------------------------------------

/** 32-bit left rotate — the one primitive xoshiro is built out of. */
function rotl32(x: number, k: number): number {
	return ((x << k) | (x >>> (32 - k))) >>> 0;
}

/**
 * SplitMix32's finalizer, which is what turns a seed word into a lane of
 * xoshiro state. Dropping the raw seed into the lanes instead would leave the
 * low-entropy seeds real code actually passes — `new Random(1)`, `new Random(2)`
 * — drawing near-identical opening numbers, which is exactly the case a seeded
 * generator exists to get right.
 */
function splitMix32(z: number): number {
	let x = Math.imul(z ^ (z >>> 16), 0x21f0_aaad);
	x = Math.imul(x ^ (x >>> 15), 0x735a_2d97);
	return (x ^ (x >>> 15)) >>> 0;
}

/**
 * A seed as the two 32-bit halves of its int64 value, which is the type the
 * engine's `Random.new(seed)` declares. A fractional seed is therefore
 * truncated, and a non-finite one falls back to zero rather than poisoning
 * every lane with `NaN` and making the whole stream return `NaN` forever.
 */
function seedWords(seed: number): [number, number] {
	const value = Number.isFinite(seed) ? Math.trunc(seed) : 0;
	// `>>> 0` takes the low word modulo 2^32 and `Math.floor(v / 2^32)` the
	// high one, both in two's complement — so negative seeds stay distinct.
	return [value >>> 0, Math.floor(value / 4_294_967_296) >>> 0];
}

/**
 * The seed `new Random()` draws when the caller gives none. The engine's source
 * for it is unspecified; the browser's CSPRNG is the closest honest stand-in,
 * with the clock behind it for the contexts that expose no `crypto`.
 */
function entropySeed(): [number, number] {
	if (
		typeof crypto !== "undefined" &&
		typeof crypto.getRandomValues === "function"
	) {
		const words = crypto.getRandomValues(new Uint32Array(2));
		return [words[0] ?? 0, words[1] ?? 0];
	}
	const now = Date.now();
	return [now >>> 0, Math.floor(Math.random() * 4_294_967_296) >>> 0];
}

/**
 * A Roblox `Random` — a seeded pseudo-random stream.
 *
 * roblox-ts compiles `new Random(seed)` straight through to `Random.new(seed)`,
 * so this has to work as a JS constructor *and* carry the static the Luau form
 * names — the same double life `UDim2` leads.
 *
 * The draws come from an explicit xoshiro128** state rather than `Math.random`,
 * because being *seedable* is the entire point of the type: code seeds one to
 * lay out a procedural scene or to replay a shuffle, and `Math.random` cannot
 * be seeded at all, so a preview built on it would redraw a different scene on
 * every reload. What loom cannot promise is that the numbers match Studio's —
 * the engine's generator is not published and cannot be reproduced from
 * outside, so a seed is repeatable *here*, not identical to the engine's. A
 * layout baked against the engine's stream for a given seed will differ.
 */
export class Random {
	private s0 = 0;
	private s1 = 0;
	private s2 = 0;
	private s3 = 0;

	constructor(seed?: number) {
		const [low, high] = seed === undefined ? entropySeed() : seedWords(seed);
		let counter = low | 0;
		const lane = (): number => {
			counter = (counter + 0x9e37_79b9) | 0;
			return splitMix32(counter ^ high);
		};
		this.s0 = lane();
		this.s1 = lane();
		this.s2 = lane();
		this.s3 = lane();
		// xoshiro never escapes an all-zero state. SplitMix32 essentially never
		// hands one back, but a generator silently stuck returning 0 forever is
		// worth the one branch to rule out.
		if ((this.s0 | this.s1 | this.s2 | this.s3) === 0) this.s0 = 1;
	}

	/** `Random.new(seed)` — the name the Luau constructor goes by. */
	static new(seed?: number): Random {
		return new Random(seed);
	}

	/**
	 * `NextNumber()` draws over `[0, 1)`; `NextNumber(min, max)` over
	 * `[min, max)` — half-open at the top, as the engine documents it.
	 */
	NextNumber(): number;
	NextNumber(min: number, max: number): number;
	NextNumber(min?: number, max?: number): number {
		const unit = this.nextDouble();
		if (min === undefined || max === undefined) return unit;
		return min + (max - min) * unit;
	}

	/**
	 * `NextInteger(min, max)` — uniform over the **inclusive** range, both ends
	 * reachable, as in the engine. An empty range has no integer to answer with
	 * and throws, which is what Studio does rather than inventing a value.
	 */
	NextInteger(min: number, max: number): number {
		if (min > max) {
			throw new Error(
				`[loom] Random:NextInteger expected min <= max, received (${min}, ${max})`,
			);
		}
		// `Math.min` covers the one-in-2^53 rounding where the scaled double
		// reaches the span exactly and would land a step past `max`.
		return Math.min(max, min + Math.floor(this.nextDouble() * (max - min + 1)));
	}

	/**
	 * `NextUnitVector()` — a direction drawn uniformly over the sphere, which is
	 * not the same as drawing each component uniformly: doing that and
	 * normalizing bunches the results toward the cube's corners. Sampling the
	 * height first and then the angle around it keeps the density even.
	 */
	NextUnitVector(): Vector3 {
		const z = this.NextNumber(-1, 1);
		const angle = this.NextNumber(0, 2 * Math.PI);
		const radius = Math.sqrt(1 - z * z);
		return new Vector3(radius * Math.cos(angle), radius * Math.sin(angle), z);
	}

	/**
	 * `NextGaussian(mean, standardDeviation)` — a normal draw by Box–Muller,
	 * defaulting to the standard normal exactly as the engine's overload does.
	 */
	NextGaussian(mean = 0, standardDeviation = 1): number {
		// `Math.log(0)` is -Infinity, so redraw the (vanishingly rare) zero
		// rather than letting one land an Infinity in a caller's layout.
		let unit = this.nextDouble();
		while (unit === 0) unit = this.nextDouble();
		return (
			mean +
			standardDeviation *
				Math.sqrt(-2 * Math.log(unit)) *
				Math.cos(2 * Math.PI * this.nextDouble())
		);
	}

	/**
	 * `Shuffle(array)` — a Fisher–Yates shuffle **in place**, returning nothing,
	 * the way the engine's `Random:Shuffle(t)` rewrites the table handed to it
	 * instead of answering a copy. roblox-ts arrays are real JS arrays in the
	 * browser, so this walks 0-based over the whole array; the engine walks the
	 * 1-based array part of the table, which is the same pass.
	 */
	Shuffle<T>(array: T[]): void {
		for (let i = array.length - 1; i > 0; i--) {
			const j = this.NextInteger(0, i);
			// `noUncheckedIndexedAccess` widens both reads to `T | undefined`;
			// `i` and `j` are in range by construction, so the casts are safe and
			// an array that genuinely holds `undefined` still swaps correctly.
			const held = array[i] as T;
			array[i] = array[j] as T;
			array[j] = held;
		}
	}

	/**
	 * `Clone()` — a fork of the stream, not a reseed. The copy carries the state
	 * the original has already reached and advances independently from there, so
	 * replaying a sequence means cloning *before* the draws; re-`new`ing the
	 * seed only reproduces it if nothing has drawn yet.
	 */
	Clone(): Random {
		const clone = new Random(0);
		clone.s0 = this.s0;
		clone.s1 = this.s1;
		clone.s2 = this.s2;
		clone.s3 = this.s3;
		return clone;
	}

	/** One xoshiro128** step: advances the lanes, returns the next 32 bits. */
	private nextUint32(): number {
		const result = Math.imul(rotl32(Math.imul(this.s1, 5), 7), 9) >>> 0;
		const t = this.s1 << 9;
		this.s2 ^= this.s0;
		this.s3 ^= this.s1;
		this.s1 ^= this.s2;
		this.s0 ^= this.s3;
		this.s2 ^= t;
		this.s3 = rotl32(this.s3, 11);
		// `^=` and `<<` hand back *signed* 32-bit results; normalizing keeps
		// every lane an unsigned word, which is what the doubles are built from.
		this.s0 >>>= 0;
		this.s1 >>>= 0;
		this.s2 >>>= 0;
		this.s3 >>>= 0;
		return result;
	}

	/**
	 * A double over `[0, 1)` carrying the full 53 bits of mantissa, built from
	 * two draws. One 32-bit draw would quantize every number to a multiple of
	 * 2^-32, which shows up as visible banding the moment a `NextNumber` result
	 * drives a position or an alpha.
	 */
	private nextDouble(): number {
		const high = this.nextUint32() >>> 5; // 27 bits
		const low = this.nextUint32() >>> 6; // 26 bits
		return (high * 67_108_864 + low) / 9_007_199_254_740_992;
	}
}

// --- DateTime ----------------------------------------------------------------

/**
 * The table `DateTime:ToLocalTime()` and `:ToUniversalTime()` hand back: the
 * calendar fields broken out, PascalCase like every other Roblox reflection
 * name, with `Month` and `Day` 1-based rather than JS's zero-based month.
 */
export interface DateTimeTable {
	Year: number;
	Month: number;
	Day: number;
	Hour: number;
	Minute: number;
	Second: number;
	Millisecond: number;
}

/** Zero-pad to `width` digits, keeping a leading `-` outside the padding. */
function padNumber(value: number, width: number): string {
	const sign = value < 0 ? "-" : "";
	return sign + String(Math.abs(Math.trunc(value))).padStart(width, "0");
}

/**
 * A Roblox `DateTime` — one instant, stored as a millisecond count since the
 * Unix epoch, with the calendar arithmetic and the formatting hung off it.
 *
 * Unlike every other datatype here there is no `DateTime.new`: the engine
 * exposes only the named factories (`now`, `fromUnixTimestamp`, `fromIsoDate`,
 * …) and roblox-ts's typings follow, so no compiled call ever reaches the
 * constructor. It stays public because a `DateTime` has to be constructible
 * from a millisecond count somewhere, and that is the honest signature for it.
 */
export class DateTime {
	/** Milliseconds since the Unix epoch — the one field the type stores. */
	readonly UnixTimestampMillis: number;

	constructor(unixTimestampMillis = 0) {
		// The engine's field is an int64 millisecond count, so a fractional
		// input (something `tick()`-derived, say) rounds here rather than
		// dragging a sub-millisecond remainder through every later conversion.
		this.UnixTimestampMillis = Math.round(unixTimestampMillis);
	}

	/**
	 * Whole seconds since the epoch, **floored** — an instant 1.5s after the
	 * epoch reports 1, and one 1.5s before it reports -2. Flooring rather than
	 * truncating keeps the value monotonic across the epoch, which truncation
	 * (answering -1 for two different seconds) does not.
	 */
	get UnixTimestamp(): number {
		return Math.floor(this.UnixTimestampMillis / 1000);
	}

	/** `DateTime.now()` — the browser's clock, to the millisecond. */
	static now(): DateTime {
		return new DateTime(Date.now());
	}

	/** `DateTime.fromUnixTimestamp(seconds)` — seconds since the epoch. */
	static fromUnixTimestamp(unixTimestamp: number): DateTime {
		return new DateTime(unixTimestamp * 1000);
	}

	/** `DateTime.fromUnixTimestampMillis(ms)` — milliseconds since the epoch. */
	static fromUnixTimestampMillis(unixTimestampMillis: number): DateTime {
		return new DateTime(unixTimestampMillis);
	}

	/**
	 * `DateTime.fromUniversalTime(y, mo, d, h, mi, s, ms)` — every argument
	 * optional and defaulting to the epoch, as the engine documents.
	 *
	 * Out-of-range fields roll over (month 13 is January of the next year), the
	 * way `os.time` and JS's own `Date` do. The engine rejects them instead, so
	 * a preview keeps rendering where Studio would have raised — the honest
	 * trade, since a thrown error inside a render takes the tree down with it.
	 */
	static fromUniversalTime(
		year = 1970,
		month = 1,
		day = 1,
		hour = 0,
		minute = 0,
		second = 0,
		millisecond = 0,
	): DateTime {
		// Built with setters rather than `Date.UTC`, whose two-digit years map
		// onto 1900+ — `fromUniversalTime(70, …)` means the year 70, not 1970.
		const date = new Date(0);
		date.setUTCFullYear(year, month - 1, day);
		date.setUTCHours(hour, minute, second, millisecond);
		return new DateTime(date.getTime());
	}

	/**
	 * `DateTime.fromLocalTime(...)` — the same fields read in the viewer's
	 * timezone. In the engine "local" is the player's machine; in a preview it
	 * is the browser's, which is the same promise.
	 */
	static fromLocalTime(
		year = 1970,
		month = 1,
		day = 1,
		hour = 0,
		minute = 0,
		second = 0,
		millisecond = 0,
	): DateTime {
		const date = new Date(0);
		date.setFullYear(year, month - 1, day);
		date.setHours(hour, minute, second, millisecond);
		return new DateTime(date.getTime());
	}

	/**
	 * `DateTime.fromIsoDate(iso)` — `undefined` (Luau's `nil`) when the string
	 * is not an ISO 8601 date. That is the engine's contract, and the reason
	 * calling code guards the result instead of using it straight.
	 *
	 * Checked against an explicit pattern before `Date.parse` sees it, because
	 * `Date.parse` also accepts a pile of implementation-defined formats
	 * ("December 17, 1995", "Mar 5 2020") that the engine refuses — letting
	 * those through would hand the preview a `DateTime` where Studio has `nil`.
	 *
	 * A string naming no zone is read as UTC. Left to JS, a bare *date* parses
	 * as UTC while a *date-time* parses as local, and that split would make the
	 * same ISO string mean different instants on different machines.
	 */
	static fromIsoDate(isoDate: string): DateTime | undefined {
		const match = ISO_8601_DATE.exec(isoDate);
		if (match === null) return undefined;
		// The ISO grammar admits a day the month does not have, and JS rolls it
		// over — "2024-02-30" parses as March 1st — where the engine answers nil.
		// Re-reading the calendar date back off its own parse catches that; the
		// date head is exactly ten characters, the pattern above guarantees it.
		const head = isoDate.slice(0, 10);
		const headMillis = Date.parse(head);
		if (Number.isNaN(headMillis)) return undefined;
		if (new Date(headMillis).toISOString().slice(0, 10) !== head) {
			return undefined;
		}
		const hasTime = match[1] !== undefined;
		const hasZone = match[2] !== undefined;
		const millis = Date.parse(hasTime && !hasZone ? `${isoDate}Z` : isoDate);
		return Number.isNaN(millis) ? undefined : new DateTime(millis);
	}

	/**
	 * `ToIsoDate()` — the instant in UTC as `YYYY-MM-DDTHH:MM:SSZ`.
	 *
	 * Second precision with no fractional part, which is the shape the engine
	 * prints: the milliseconds a `DateTime` carries are dropped here, and a
	 * caller that needs them reads `UnixTimestampMillis` or
	 * `ToUniversalTime().Millisecond`. Assembled by hand rather than from
	 * `Date#toISOString`, which always writes the `.000` back in.
	 */
	ToIsoDate(): string {
		const t = this.ToUniversalTime();
		const date = `${padNumber(t.Year, 4)}-${padNumber(t.Month, 2)}-${padNumber(t.Day, 2)}`;
		const time = `${padNumber(t.Hour, 2)}:${padNumber(t.Minute, 2)}:${padNumber(t.Second, 2)}`;
		return `${date}T${time}Z`;
	}

	/** `ToUniversalTime()` — the calendar fields in UTC. */
	ToUniversalTime(): DateTimeTable {
		const date = new Date(this.UnixTimestampMillis);
		return {
			Year: date.getUTCFullYear(),
			Month: date.getUTCMonth() + 1,
			Day: date.getUTCDate(),
			Hour: date.getUTCHours(),
			Minute: date.getUTCMinutes(),
			Second: date.getUTCSeconds(),
			Millisecond: date.getUTCMilliseconds(),
		};
	}

	/** `ToLocalTime()` — the same fields in the viewer's own timezone. */
	ToLocalTime(): DateTimeTable {
		const date = new Date(this.UnixTimestampMillis);
		return {
			Year: date.getFullYear(),
			Month: date.getMonth() + 1,
			Day: date.getDate(),
			Hour: date.getHours(),
			Minute: date.getMinutes(),
			Second: date.getSeconds(),
			Millisecond: date.getMilliseconds(),
		};
	}

	/**
	 * `FormatUniversalTime(format, locale)` — the instant rendered in UTC
	 * against an LDML pattern. See {@link formatDateTime} for the tokens.
	 *
	 * `locale` is a required argument in the engine; it defaults here because a
	 * missing one would otherwise render `undefined` into `Intl` and throw, and
	 * `"en-us"` is the value every Roblox example passes.
	 */
	FormatUniversalTime(format: string, locale = "en-us"): string {
		return formatDateTime(
			this.ToUniversalTime(),
			this.UnixTimestampMillis,
			format,
			locale,
			"UTC",
		);
	}

	/** `FormatLocalTime(format, locale)` — the same, in the viewer's zone. */
	FormatLocalTime(format: string, locale = "en-us"): string {
		return formatDateTime(
			this.ToLocalTime(),
			this.UnixTimestampMillis,
			format,
			locale,
			undefined,
		);
	}
}

/**
 * ISO 8601 as `DateTime.fromIsoDate` accepts it: a calendar date, optionally
 * followed by a time and optionally by a zone designator. Group 1 captures the
 * time (so a bare date is distinguishable) and group 2 the zone, which is what
 * decides whether a `Z` has to be appended before parsing.
 */
const ISO_8601_DATE =
	/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

/** Every ASCII letter is a reserved LDML pattern character. */
const PATTERN_LETTER = /[A-Za-z]/;

/**
 * Locale-dependent formatters, cached because constructing one is an ICU
 * lookup and a clock label re-formatting every frame would otherwise build a
 * fresh one on each pass. Keyed by everything that changes the output; the set
 * of locales an app uses is tiny, so the map does not need eviction.
 */
const FORMATTER_CACHE = new Map<string, Intl.DateTimeFormat>();

/**
 * One locale-dependent piece of a formatted instant — a month or weekday name,
 * the AM/PM marker, a timezone label — pulled out of `Intl.DateTimeFormat` by
 * part rather than by formatting the whole date, so that the LDML pattern
 * decides where each piece lands instead of `Intl`'s locale-chosen ordering.
 */
function localePart(
	millis: number,
	locale: string,
	timeZone: string | undefined,
	options: Intl.DateTimeFormatOptions,
	part: string,
): string {
	const key = `${locale} ${timeZone ?? ""} ${JSON.stringify(options)}`;
	let formatter = FORMATTER_CACHE.get(key);
	if (formatter === undefined) {
		formatter = new Intl.DateTimeFormat(
			locale,
			timeZone === undefined ? options : { ...options, timeZone },
		);
		FORMATTER_CACHE.set(key, formatter);
	}
	const parts = formatter.formatToParts(new Date(millis));
	return parts.find((piece) => piece.type === part)?.value ?? "";
}

/** LDML widens a name token by repeating it: 3 short, 4 full, 5+ narrow. */
function nameWidth(count: number): "short" | "long" | "narrow" {
	if (count >= 5) return "narrow";
	if (count === 4) return "long";
	return "short";
}

/** One LDML token, `count` characters wide, against the broken-out fields. */
function formatToken(
	token: string,
	count: number,
	fields: DateTimeTable,
	millis: number,
	locale: string,
	timeZone: string | undefined,
): string {
	switch (token) {
		case "y":
			// LDML's odd one out: `yy` is the last two digits, every other width
			// is the full year zero-padded to that many places.
			return count === 2
				? padNumber(fields.Year % 100, 2)
				: padNumber(fields.Year, count);
		case "M":
		case "L":
			return count <= 2
				? padNumber(fields.Month, count)
				: localePart(
						millis,
						locale,
						timeZone,
						{ month: nameWidth(count) },
						"month",
					);
		case "d":
			return padNumber(fields.Day, count);
		case "E":
			return localePart(
				millis,
				locale,
				timeZone,
				{ weekday: nameWidth(count) },
				"weekday",
			);
		case "H":
			return padNumber(fields.Hour, count);
		case "h": {
			const hour = fields.Hour % 12;
			return padNumber(hour === 0 ? 12 : hour, count);
		}
		case "m":
			return padNumber(fields.Minute, count);
		case "s":
			return padNumber(fields.Second, count);
		case "S":
			// A fraction, so it is truncated to the requested digits and padded
			// out past three — never rounded, which LDML is explicit about.
			return padNumber(fields.Millisecond, 3)
				.slice(0, count)
				.padEnd(count, "0");
		case "a":
			return localePart(
				millis,
				locale,
				timeZone,
				{ hour: "numeric", hour12: true },
				"dayPeriod",
			);
		case "z":
			return localePart(
				millis,
				locale,
				timeZone,
				{ timeZoneName: count >= 4 ? "long" : "short" },
				"timeZoneName",
			);
		default:
			// A pattern letter loom does not implement, written back out as the
			// author typed it rather than dropped or guessed at — the same policy
			// `os.date` follows for an unknown strftime specifier.
			return token.repeat(count);
	}
}

/**
 * Format one instant against a Unicode **LDML** (UTS #35) pattern — the grammar
 * `DateTime:FormatLocalTime` takes in the engine, and emphatically *not*
 * strftime. The difference bites quietly rather than loudly: a strftime pattern
 * like `"%H:%M"` is not rejected, it is *misread* — `%` is literal text while
 * `H` and `M` are LDML's hour and **month**, so it comes back as `%14:%3`. The
 * engine does the same thing with it, which is the point of matching here.
 *
 * The tokens loom implements, each widened by repeating it:
 *
 * - `y` year — `yy` is the last two digits, `yyyy` pads to four
 * - `M` month — 1-2 digits, `MMM` short name, `MMMM` full, `MMMMM` narrow
 * - `L` stand-alone month — same output as `M` (see below)
 * - `d` day of month — `dd` zero-pads
 * - `E` day of week — `E`..`EEE` short name, `EEEE` full, `EEEEE` narrow
 * - `H` hour 0-23, `h` hour 1-12 — doubled to zero-pad
 * - `m` minute, `s` second — doubled to zero-pad
 * - `S` fractional second — `S` tenths, `SS` hundredths, `SSS` milliseconds
 * - `a` the AM/PM marker
 * - `z` timezone name — `zzzz` the long form
 *
 * Every other pattern letter (`G`, `Q`, `w`, `D`, `k`, `K`, `e`, `c`, `Z`, `X`,
 * `V`, `u`, …) is emitted verbatim. Text between single quotes is literal and
 * `''` is one apostrophe, as LDML specifies.
 *
 * `L` is LDML's *stand-alone* month, which differs from `M` only in languages
 * that inflect a month named on its own (the Slavic ones, mainly). `Intl`
 * exposes just the formatting form, so loom prints that for both: correct for
 * `en-us` and every locale that does not inflect, and the closest answer
 * available for the ones that do.
 */
function formatDateTime(
	fields: DateTimeTable,
	millis: number,
	pattern: string,
	locale: string,
	timeZone: string | undefined,
): string {
	const out: string[] = [];
	let i = 0;
	while (i < pattern.length) {
		const char = pattern.charAt(i);
		if (char === "'") {
			i++;
			// `''` is a literal apostrophe, whether or not a quote is open.
			if (pattern.charAt(i) === "'") {
				out.push("'");
				i++;
				continue;
			}
			while (i < pattern.length) {
				if (pattern.charAt(i) === "'") {
					if (pattern.charAt(i + 1) === "'") {
						out.push("'");
						i += 2;
						continue;
					}
					i++;
					break;
				}
				out.push(pattern.charAt(i));
				i++;
			}
			continue;
		}
		if (!PATTERN_LETTER.test(char)) {
			out.push(char);
			i++;
			continue;
		}
		let count = 0;
		while (pattern.charAt(i) === char) {
			count++;
			i++;
		}
		out.push(formatToken(char, count, fields, millis, locale, timeZone));
	}
	return out.join("");
}

/**
 * Roblox's `==` for the datatypes, which compare **by value**: in the engine
 * `UDim2.new(0, 0, 0, 0) == UDim2.new(0, 0, 0, 0)` is true, because they are
 * userdata with value semantics, not tables.
 *
 * That is not a detail — React's prop diff is built on `==`. A component that
 * rebuilds `Position={UDim2.fromScale(0.5, 0.5)}` every render hands React a
 * *new* object each time; under Roblox equality the diff sees no change and
 * leaves the property alone, so a value written outside React (a drag moving a
 * window, motion code on a ref) survives the next render. Compared by JS
 * reference instead, every render re-applies the prop and overwrites it — which
 * is precisely how a dragged window snapped back to where it started.
 *
 * Falls back to `Object.is` for everything else, so primitives, functions and
 * plain objects keep their usual identity semantics.
 */
export function robloxEquals(a: unknown, b: unknown): boolean {
	if (Object.is(a, b)) return true;
	if (
		typeof a !== "object" ||
		typeof b !== "object" ||
		a === null ||
		b === null
	)
		return false;
	// Different datatypes are never equal, and a datatype is never equal to a
	// plain object — `constructor` is the cheapest form of that check.
	if (a.constructor !== b.constructor) return false;
	if (a instanceof UDim && b instanceof UDim)
		return a.Scale === b.Scale && a.Offset === b.Offset;
	if (a instanceof UDim2 && b instanceof UDim2)
		return robloxEquals(a.X, b.X) && robloxEquals(a.Y, b.Y);
	if (a instanceof Vector2 && b instanceof Vector2)
		return a.X === b.X && a.Y === b.Y;
	if (a instanceof Vector3 && b instanceof Vector3)
		return a.X === b.X && a.Y === b.Y && a.Z === b.Z;
	if (a instanceof Color3 && b instanceof Color3)
		return a.R === b.R && a.G === b.G && a.B === b.B;
	if (a instanceof Rect && b instanceof Rect)
		return robloxEquals(a.Min, b.Min) && robloxEquals(a.Max, b.Max);
	if (a instanceof Font && b instanceof Font)
		return (
			a.Family === b.Family && a.Weight === b.Weight && a.Style === b.Style
		);
	// A `DateTime` is an immutable instant, so two of them naming the same
	// millisecond are the same value — the same reasoning as every datatype
	// above. `Random` deliberately gets no case: its state is mutable, two
	// generators that happen to sit on the same lanes are still two streams,
	// and identity is the only sane answer for one.
	if (a instanceof DateTime && b instanceof DateTime)
		return a.UnixTimestampMillis === b.UnixTimestampMillis;
	if (a instanceof ColorSequenceKeypoint && b instanceof ColorSequenceKeypoint)
		return a.Time === b.Time && robloxEquals(a.Value, b.Value);
	if (
		a instanceof NumberSequenceKeypoint &&
		b instanceof NumberSequenceKeypoint
	)
		return (
			a.Time === b.Time && a.Value === b.Value && a.Envelope === b.Envelope
		);
	if (a instanceof ColorSequence && b instanceof ColorSequence)
		return keypointsEqual(a.Keypoints, b.Keypoints);
	if (a instanceof NumberSequence && b instanceof NumberSequence)
		return keypointsEqual(a.Keypoints, b.Keypoints);
	// `EnumItem`s are singletons, so `Object.is` above already settled them, and
	// anything else (a handler table, a Roblox instance, a `Random`) keeps
	// identity.
	return false;
}

function keypointsEqual(a: readonly unknown[], b: readonly unknown[]): boolean {
	return a.length === b.length && a.every((kp, i) => robloxEquals(kp, b[i]));
}

/**
 * Encode a Roblox datatype instance (or primitive) as a Scene IR `PropertyValue` —
 * the canonical datatype→IR mapping shared by every frontend adapter (react, vide,
 * …). Unknown values (including Vector3/CFrame/TweenInfo, which the IR has no slot
 * for) return `undefined` so the property is dropped.
 *
 * `Random` and `DateTime` get no encoding on purpose: neither is a scene
 * property. A generator is mutable program state and an instant is something a
 * component turns into *text* before it ever reaches a property, so there is
 * nothing for the renderer to paint and nothing for the IR to carry.
 */
export function toPropertyValue(v: unknown): PropertyValue | undefined {
	if (v instanceof UDim2) {
		return prop.udim2({
			x: { scale: v.X.Scale, offset: v.X.Offset },
			y: { scale: v.Y.Scale, offset: v.Y.Offset },
		});
	}
	if (v instanceof UDim) return prop.udim({ scale: v.Scale, offset: v.Offset });
	if (v instanceof Vector2) return prop.vector2({ x: v.X, y: v.Y });
	if (v instanceof Color3) return prop.color3({ r: v.R, g: v.G, b: v.B });
	if (v instanceof ColorSequence) {
		return prop.colorSequence({
			keypoints: v.Keypoints.map((k) => ({
				time: k.Time,
				color: { r: k.Value.R, g: k.Value.G, b: k.Value.B },
			})),
		});
	}
	if (v instanceof Rect) {
		return prop.rect({
			min: { x: v.Min.X, y: v.Min.Y },
			max: { x: v.Max.X, y: v.Max.Y },
		});
	}
	if (v instanceof Font) {
		return prop.font({
			family: v.Family,
			weight: v.Weight.Value,
			style: v.Style.Name,
		});
	}
	if (v instanceof EnumItem) {
		// `EnumType` is the enum *object* (so that `item.EnumType == Enum.KeyCode`
		// holds, as in the engine); the IR wants the bare type name, which is what
		// `enumTypeName` peels off it.
		return prop.enum({
			enumType: enumTypeName(v),
			name: v.Name,
			value: v.Value,
		});
	}
	if (typeof v === "number") return prop.number(v);
	if (typeof v === "boolean") return prop.bool(v);
	if (typeof v === "string") return prop.string(v);
	return undefined;
}
