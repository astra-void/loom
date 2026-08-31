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
import { Enum, EnumItem } from "./enums";

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
	 * Matches roblox-ts's two `Rect.new` forms, both of which compile to
	 * `new Rect(...)`: two `Vector2`s (`new Rect(min, max)`) or four numbers
	 * (`new Rect(minX, minY, maxX, maxY)`). Component code uses the numeric
	 * form (e.g. `new Rect(54, 55, 200, 200)`), so a `(Vector2, Vector2)`-only
	 * constructor would silently store the raw numbers and break slicing.
	 */
	constructor(a: Vector2 | number = 0, b: Vector2 | number = 0, c = 0, d = 0) {
		if (a instanceof Vector2) {
			this.Min = a;
			this.Max = b instanceof Vector2 ? b : Vector2.zero;
		} else {
			this.Min = new Vector2(a, typeof b === "number" ? b : 0);
			this.Max = new Vector2(c, d);
		}
		this.Width = this.Max.X - this.Min.X;
		this.Height = this.Max.Y - this.Min.Y;
	}
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
	// anything else (a handler table, a Roblox instance) keeps identity.
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
		return prop.enum({ enumType: v.EnumType, name: v.Name, value: v.Value });
	}
	if (typeof v === "number") return prop.number(v);
	if (typeof v === "boolean") return prop.bool(v);
	if (typeof v === "string") return prop.string(v);
	return undefined;
}
