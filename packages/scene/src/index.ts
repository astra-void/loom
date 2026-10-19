/**
 * Loom Scene IR — TypeScript mirror of the `loom-scene` Rust crate.
 *
 * The framework-agnostic representation of a Roblox GUI instance tree, plus the
 * shared layout I/O types and Roblox-truth defaults. Frontend adapters
 * (`@rbxts/react`, later `vide`/`luau`) produce this; the layout engine and DOM
 * renderer consume it. Keep in sync with `crates/loom-scene`.
 */

// ---------------------------------------------------------------------------
// Datatypes (plain, untagged; lowercase keys; byte-identical Rust <-> TS).
// ---------------------------------------------------------------------------

export interface UDim {
	scale: number;
	offset: number;
}
export interface UDim2 {
	x: UDim;
	y: UDim;
}
export interface Vector2 {
	x: number;
	y: number;
}
export interface Color3 {
	/** 0..1, NOT 0..255. */
	r: number;
	g: number;
	b: number;
}

// ---------------------------------------------------------------------------
// Property values.
// ---------------------------------------------------------------------------

/** A Roblox `Enum` item payload, e.g. `Enum.FillDirection.Vertical`. */
export interface EnumItemValue {
	enumType: string;
	name: string;
	value: number;
}

/** A `ColorSequence` keypoint (gradient ramp). */
export interface ColorSequenceKeypointValue {
	time: number;
	color: Color3;
}
export interface ColorSequenceValue {
	keypoints: ColorSequenceKeypointValue[];
}

/**
 * A `NumberSequence` keypoint — `UIGradient.Transparency`'s ramp. `envelope` is
 * the particle-only random spread, carried so the value round-trips.
 */
export interface NumberSequenceKeypointValue {
	time: number;
	value: number;
	envelope: number;
}
/**
 * A `NumberSequence` payload. TypeScript-only, like {@link ColorSequenceValue}:
 * the Rust engine degrades the tag to `Unknown` and ignores it, which is correct
 * — a transparency ramp changes how a node is painted, never where it lands.
 */
export interface NumberSequenceValue {
	keypoints: NumberSequenceKeypointValue[];
}

/**
 * A `Rect` datatype payload (`ImageLabel.SliceCenter`) — the two corners, in the
 * source image's own pixels.
 *
 * TypeScript-only, like {@link ColorSequenceValue}: the Rust engine degrades the
 * tag to `Unknown` and ignores it, which is correct — nothing about a 9-slice
 * window changes where a node lands, only how the renderer paints inside it.
 */
export interface RectValue {
	min: Vector2;
	max: Vector2;
}

/**
 * A `Font` datatype payload (`TextLabel.FontFace`). `family` is the font-family
 * asset URI, `weight` the Roblox 100–900 number (which is also the CSS one),
 * and `style` an `Enum.FontStyle` name.
 */
export interface FontValue {
	family: string;
	weight: number;
	style: string;
}

/** The KNOWN adjacently-tagged values — narrow with `switch (v.type)`. */
export type KnownProperty =
	| { type: "UDim2"; value: UDim2 }
	| { type: "UDim"; value: UDim }
	| { type: "Vector2"; value: Vector2 }
	| { type: "Color3"; value: Color3 }
	| { type: "ColorSequence"; value: ColorSequenceValue }
	| { type: "NumberSequence"; value: NumberSequenceValue }
	| { type: "Rect"; value: RectValue }
	| { type: "Font"; value: FontValue }
	| { type: "EnumItem"; value: EnumItemValue }
	| { type: "number"; value: number }
	| { type: "int"; value: number } // JS number, always whole-valued
	| { type: "bool"; value: boolean }
	| { type: "string"; value: string };

/**
 * A future/unknown `{type,value}` tag (mirrors the Rust untagged `Unknown` arm).
 * Getters return `undefined` for it, so consumers fall back to defaults.
 */
export interface UnknownProperty {
	type: string;
	value?: unknown;
}
export type PropertyValue = KnownProperty | UnknownProperty;

const KNOWN_TAGS = new Set<string>([
	"UDim2",
	"UDim",
	"Vector2",
	"Color3",
	"ColorSequence",
	"NumberSequence",
	"Rect",
	"Font",
	"EnumItem",
	"number",
	"int",
	"bool",
	"string",
]);
export function isKnown(p: PropertyValue | undefined): p is KnownProperty {
	return p !== undefined && KNOWN_TAGS.has(p.type);
}

// ---------------------------------------------------------------------------
// Scene node.
// ---------------------------------------------------------------------------

export interface SceneNode {
	className: string;
	name: string;
	/** Optional stable key; the engine synthesizes a layout-positional id when absent. */
	id?: string;
	/** Keys are Roblox PascalCase. Optional to match the Rust `serde(default)`. */
	properties?: Record<string, PropertyValue>;
	/** Sibling order = Roblox source order. Optional to match the Rust `serde(default)`. */
	children?: SceneNode[];
}

export interface Viewport {
	width: number;
	height: number;
}
export interface Rect {
	x: number;
	y: number;
	width: number;
	height: number;
}
/** Open per-node output: later milestones add optional fields additively. */
export interface LayoutNode {
	rect: Rect;
}
export interface LayoutResult {
	rects: Record<string, LayoutNode>;
}

// ---------------------------------------------------------------------------
// Class registry (mirrors loom_scene::class_meta).
// ---------------------------------------------------------------------------

const LAYER_COLLECTORS = new Set<string>([
	"ScreenGui",
	"SurfaceGui",
	"BillboardGui",
]);
const NON_LAYOUT = new Set<string>([
	"UICorner",
	"UIPadding",
	"UIListLayout",
	"UIGridLayout",
	"UIStroke",
	"UIShadow",
	"UIScale",
	"UIGradient",
	"UIPageLayout",
	"UITableLayout",
	"UISizeConstraint",
	"UITextSizeConstraint",
	"UIAspectRatioConstraint",
	"UIFlexItem",
]);
export const isLayerCollector = (className: string): boolean =>
	LAYER_COLLECTORS.has(className);
export const participatesInLayout = (className: string): boolean =>
	!NON_LAYOUT.has(className);

// ---------------------------------------------------------------------------
// Roblox-truth defaults (single source, mirrors loom_scene consts).
// ---------------------------------------------------------------------------

export const DEFAULTS = {
	size: { x: { scale: 0, offset: 0 }, y: { scale: 0, offset: 0 } } as UDim2,
	position: { x: { scale: 0, offset: 0 }, y: { scale: 0, offset: 0 } } as UDim2,
	anchorPoint: { x: 0, y: 0 } as Vector2,
	backgroundColor3: { r: 163 / 255, g: 162 / 255, b: 165 / 255 } as Color3,
	backgroundTransparency: 0,
	visible: true,
	zIndex: 1,
	// Real Roblox text default is fromRGB(27, 42, 53) (dark navy-grey), NOT black.
	textColor3: { r: 27 / 255, g: 42 / 255, b: 53 / 255 } as Color3,
	textSize: 14,
	textTransparency: 0,
	lineHeight: 1,
	imageTransparency: 0,
	/** White: `ImageColor3` multiplies the image, so white is "no tint". */
	imageColor3: { r: 1, g: 1, b: 1 } as Color3,
} as const;

// ---------------------------------------------------------------------------
// Degrade-never-error getters (absent OR wrong tag OR unknown tag => undefined).
// Tag-checked, NOT payload-shape-validated: the Rust serde layer at the wasm
// boundary is the real shape gate. Do not feed untrusted JSON straight in.
// ---------------------------------------------------------------------------

export function asUDim2(p: PropertyValue | undefined): UDim2 | undefined {
	return p?.type === "UDim2"
		? ((p as KnownProperty).value as UDim2)
		: undefined;
}
export function asVector2(p: PropertyValue | undefined): Vector2 | undefined {
	return p?.type === "Vector2"
		? ((p as KnownProperty).value as Vector2)
		: undefined;
}
export function asColor3(p: PropertyValue | undefined): Color3 | undefined {
	return p?.type === "Color3"
		? ((p as KnownProperty).value as Color3)
		: undefined;
}
export function asUDim(p: PropertyValue | undefined): UDim | undefined {
	return p?.type === "UDim" ? ((p as KnownProperty).value as UDim) : undefined;
}
/**
 * An enum property, from either spelling the engine accepts.
 *
 * Roblox coerces a bare string on an enum property — `FlexMode = "Custom"` is
 * `Enum.UIFlexMode.Custom` — and roblox-ts types it that way, so component
 * libraries pass strings through freely (`valign="Center"`, `mode="Custom"`,
 * `align="Right"`). Reading only the `EnumItem` form made every one of those a
 * silent no-op: a `UIFlexItem` written with a string `FlexMode` took no share of
 * the row, and the control it wrapped came out zero wide.
 *
 * The string carries no enum type or numeric value, and nothing downstream reads
 * either — every consumer switches on `name` — so it is filled in as the name
 * with an empty type rather than guessed at.
 */
export function asEnum(
	p: PropertyValue | undefined,
): EnumItemValue | undefined {
	if (p?.type === "EnumItem")
		return (p as KnownProperty).value as EnumItemValue;
	if (p?.type === "string") {
		const name = (p as KnownProperty).value as string;
		return name === "" ? undefined : { enumType: "", name, value: 0 };
	}
	return undefined;
}
export function asColorSequence(
	p: PropertyValue | undefined,
): ColorSequenceValue | undefined {
	return p?.type === "ColorSequence"
		? ((p as KnownProperty).value as ColorSequenceValue)
		: undefined;
}
export function asNumberSequence(
	p: PropertyValue | undefined,
): NumberSequenceValue | undefined {
	return p?.type === "NumberSequence"
		? ((p as KnownProperty).value as NumberSequenceValue)
		: undefined;
}
/** A `Rect` datatype property (`SliceCenter`), in source-image pixels. */
export function asRect(p: PropertyValue | undefined): RectValue | undefined {
	return p?.type === "Rect"
		? ((p as KnownProperty).value as RectValue)
		: undefined;
}
export function asFont(p: PropertyValue | undefined): FontValue | undefined {
	return p?.type === "Font"
		? ((p as KnownProperty).value as FontValue)
		: undefined;
}
export function asNumber(p: PropertyValue | undefined): number | undefined {
	if (p?.type === "number") return (p as KnownProperty).value as number;
	// `int` is truncated at parse time in Rust (de_i64); mirror that here so the two
	// engines agree even on a malformed non-whole `int` payload.
	if (p?.type === "int") return asInt(p);
	return undefined;
}
export function asInt(p: PropertyValue | undefined): number | undefined {
	if (p?.type !== "int" && p?.type !== "number") return undefined;
	const v = (p as KnownProperty).value as number;
	// Match Rust i64_from_f64's half-open interval [-2^63, 2^63): lower bound
	// inclusive, upper exclusive. Out-of-range/non-finite -> undefined (= default).
	return Number.isFinite(v) && v >= -(2 ** 63) && v < 2 ** 63
		? Math.trunc(v)
		: undefined;
}
export function asBool(p: PropertyValue | undefined): boolean | undefined {
	return p?.type === "bool"
		? ((p as KnownProperty).value as boolean)
		: undefined;
}
export function asString(p: PropertyValue | undefined): string | undefined {
	return p?.type === "string"
		? ((p as KnownProperty).value as string)
		: undefined;
}

// Null-safe against sparse nodes (properties?/children? may be absent).
const props = (n: SceneNode): Record<string, PropertyValue> =>
	n.properties ?? {};
export const childrenOf = (n: SceneNode): SceneNode[] => n.children ?? [];

export const getSize = (n: SceneNode): UDim2 =>
	asUDim2(props(n).Size) ?? DEFAULTS.size;
export const getPosition = (n: SceneNode): UDim2 =>
	asUDim2(props(n).Position) ?? DEFAULTS.position;
export const getAnchorPoint = (n: SceneNode): Vector2 =>
	asVector2(props(n).AnchorPoint) ?? DEFAULTS.anchorPoint;
export const getVisible = (n: SceneNode): boolean =>
	asBool(props(n).Visible) ?? DEFAULTS.visible;
export const getZIndex = (n: SceneNode): number =>
	asInt(props(n).ZIndex) ?? DEFAULTS.zIndex;
export const getBackgroundColor3 = (n: SceneNode): Color3 =>
	asColor3(props(n).BackgroundColor3) ?? DEFAULTS.backgroundColor3;
export const getBackgroundTransparency = (n: SceneNode): number =>
	asNumber(props(n).BackgroundTransparency) ?? DEFAULTS.backgroundTransparency;
export const getClipsDescendants = (n: SceneNode): boolean =>
	asBool(props(n).ClipsDescendants) ?? false;

// --- text getters ----------------------------------------------------------
export const getText = (n: SceneNode): string | undefined =>
	asString(props(n).Text);
export const getTextColor3 = (n: SceneNode): Color3 =>
	asColor3(props(n).TextColor3) ?? DEFAULTS.textColor3;
/**
 * Legacy `FontSize` enum name (`"Size24"`) → its pixel size (`24`); undefined
 * for anything that is not a `SizeN` name. Roblox keeps `FontSize` and
 * `TextSize` linked — writing either updates the other — so loom reads
 * `FontSize` only as the fallback when `TextSize` is absent.
 */
export const fontSizeToPx = (name: string | undefined): number | undefined => {
	const digits = name?.match(/^Size(\d+)$/)?.[1];
	return digits === undefined ? undefined : Number(digits);
};
export const getTextSize = (n: SceneNode): number =>
	asNumber(props(n).TextSize) ??
	fontSizeToPx(asEnum(props(n).FontSize)?.name) ??
	DEFAULTS.textSize;
export const getTextTransparency = (n: SceneNode): number =>
	asNumber(props(n).TextTransparency) ?? DEFAULTS.textTransparency;
/**
 * `TextWrapped`, or the deprecated `TextWrap` it is an alias for. Roblox's own
 * docs call `TextWrap` "simply an alias for `TextWrapped`", so a tree that sets
 * only the old spelling wraps in the engine — and used to run off the edge in a
 * loom preview, which read the new spelling alone.
 */
export const getTextWrapped = (n: SceneNode): boolean =>
	asBool(props(n).TextWrapped) ?? asBool(props(n).TextWrap) ?? false;
export const getTextScaled = (n: SceneNode): boolean =>
	asBool(props(n).TextScaled) ?? false;
/**
 * The multiplier on the gap *between* lines — Studio clamps it to 1…3, and 1
 * (the default) is single spacing. It leaves a one-line label alone: the engine
 * spends the extra room between baselines, not above the first line or below the
 * last, so `n` lines measure `TextSize + (n - 1) * TextSize * LineHeight`.
 */
export const getLineHeight = (n: SceneNode): number => {
	const value = asNumber(props(n).LineHeight);
	if (value === undefined) return DEFAULTS.lineHeight;
	return Math.min(3, Math.max(1, value));
};
/** Enum item name, e.g. "Center"; default "Center" (Roblox TextLabel default). */
export const getTextXAlignment = (n: SceneNode): string =>
	asEnum(props(n).TextXAlignment)?.name ?? "Center";
export const getTextYAlignment = (n: SceneNode): string =>
	asEnum(props(n).TextYAlignment)?.name ?? "Center";
/** Whether `Text` is read as rich-text markup; default false (literal). */
export const getRichText = (n: SceneNode): boolean =>
	asBool(props(n).RichText) ?? false;
/** Legacy `Font` enum item name, e.g. "GothamBold"; undefined when unset. */
export const getFontName = (n: SceneNode): string | undefined =>
	asEnum(props(n).Font)?.name;
/** `FontFace` (the modern `Font` datatype); undefined when unset. */
export const getFontFace = (n: SceneNode): FontValue | undefined =>
	asFont(props(n).FontFace);

// --- image getters ---------------------------------------------------------
/** The raw `Image` value (`rbxassetid://…` or a URL); undefined when unset. */
export const getImage = (n: SceneNode): string | undefined =>
	asString(props(n).Image);
export const getImageTransparency = (n: SceneNode): number =>
	asNumber(props(n).ImageTransparency) ?? DEFAULTS.imageTransparency;
/** The tint the image is multiplied by; default white (i.e. untinted). */
export const getImageColor3 = (n: SceneNode): Color3 =>
	asColor3(props(n).ImageColor3) ?? DEFAULTS.imageColor3;
/** Enum item name, e.g. "Fit"; default "Stretch" (the Roblox default). */
export const getScaleType = (n: SceneNode): string =>
	asEnum(props(n).ScaleType)?.name ?? "Stretch";
/**
 * The sprite window inside the source image — `ImageRectOffset` /
 * `ImageRectSize`, in image pixels — or `undefined` for the whole image.
 *
 * Roblox reads a zero `ImageRectSize` as "no window", which is its default, and
 * loom reads a zero (or negative) extent on *either* axis the same way: half a
 * window has no meaning, and the whole image is the answer the engine gives.
 */
export const getImageRect = (
	n: SceneNode,
): { offset: Vector2; size: Vector2 } | undefined => {
	const size = asVector2(props(n).ImageRectSize);
	if (!size || size.x <= 0 || size.y <= 0) return undefined;
	return {
		offset: asVector2(props(n).ImageRectOffset) ?? { x: 0, y: 0 },
		size,
	};
};
/** `SliceCenter` — the 9-slice center, in source-image pixels. */
export const getSliceCenter = (n: SceneNode): RectValue | undefined =>
	asRect(props(n).SliceCenter);
/** `SliceScale`; default 1 (borders at their own pixel size). */
export const getSliceScale = (n: SceneNode): number =>
	asNumber(props(n).SliceScale) ?? 1;
/**
 * `TileSize`, the size of one tile relative to the node — default
 * `{1,0},{1,0}`, i.e. one tile filling the node.
 */
export const getTileSize = (n: SceneNode): UDim2 =>
	asUDim2(props(n).TileSize) ?? {
		x: { scale: 1, offset: 0 },
		y: { scale: 1, offset: 0 },
	};
/** `ResampleMode` enum item name; default "Default" (smooth scaling). */
export const getResampleMode = (n: SceneNode): string =>
	asEnum(props(n).ResampleMode)?.name ?? "Default";

// --- ScrollingFrame metrics ------------------------------------------------

/** A `ScrollingFrame`'s post-layout metrics — Roblox's two `Absolute*` readouts. */
export interface ScrollMetrics {
	/** `AbsoluteWindowSize`: the viewable area. */
	window: Vector2;
	/** `AbsoluteCanvasSize`: the scrollable extent the window looks at. */
	canvas: Vector2;
}

/**
 * A `ScrollingFrame`'s window/canvas metrics from its laid-out rect.
 *
 * The single source for the numbers both the react adapter (which feeds them
 * back to app code as `AbsoluteWindowSize`/`AbsoluteCanvasSize`) and the DOM
 * renderer (which sizes the scroll bar thumb from them) need — two readings of
 * the same frame would show a bar that does not agree with the metrics the
 * component sizing itself against them saw.
 *
 * - The window is the frame's own rect. Loom paints its scroll bars *over* the
 *   canvas, Roblox's `ScrollBarInset.None`, so no thickness is reserved.
 * - The canvas is `CanvasSize` resolved against that window per axis; where
 *   `AutomaticCanvasSize` covers an axis it grows to the union bounding box of
 *   the laid-out children, i.e. `max(resolved, children)`.
 *
 * `childRect` resolves a layout child to its rect (the caller owns the id
 * scheme: an explicit `node.id`, or the layout-positional path).
 */
export function scrollMetrics(
	node: SceneNode,
	rect: Rect,
	childRect: (child: SceneNode, index: number) => Rect | undefined,
): ScrollMetrics {
	const canvasSize = asUDim2(props(node).CanvasSize);
	const resolvedX = canvasSize
		? canvasSize.x.scale * rect.width + canvasSize.x.offset
		: 0;
	const resolvedY = canvasSize
		? canvasSize.y.scale * rect.height + canvasSize.y.offset
		: 0;
	const auto = asEnum(props(node).AutomaticCanvasSize)?.name ?? "None";
	const autoX = auto === "X" || auto === "XY";
	const autoY = auto === "Y" || auto === "XY";
	let childMaxX = 0;
	let childMaxY = 0;
	if (autoX || autoY) {
		let index = 0;
		for (const child of childrenOf(node)) {
			if (!participatesInLayout(child.className)) continue;
			const r = childRect(child, index);
			index += 1;
			if (!r) continue;
			childMaxX = Math.max(childMaxX, r.x + r.width - rect.x);
			childMaxY = Math.max(childMaxY, r.y + r.height - rect.y);
		}
	}
	return {
		window: { x: rect.width, y: rect.height },
		canvas: {
			x: autoX ? Math.max(resolvedX, childMaxX) : resolvedX,
			y: autoY ? Math.max(resolvedY, childMaxY) : resolvedY,
		},
	};
}

/** First child of the given Roblox class (e.g. a `UICorner`/`UIStroke` modifier). */
export const findModifier = (
	n: SceneNode,
	className: string,
): SceneNode | undefined =>
	childrenOf(n).find((c) => c.className === className);

// ---------------------------------------------------------------------------
// Ergonomic typed builders (adapters never hand-write tags).
// ---------------------------------------------------------------------------

export const udim = (scale: number, offset: number): UDim => ({
	scale,
	offset,
});
export const udim2 = (
	sx: number,
	ox: number,
	sy: number,
	oy: number,
): UDim2 => ({
	x: { scale: sx, offset: ox },
	y: { scale: sy, offset: oy },
});
export const vector2 = (x: number, y: number): Vector2 => ({ x, y });
export const color3 = (r: number, g: number, b: number): Color3 => ({
	r,
	g,
	b,
});
export const color3FromRGB = (r: number, g: number, b: number): Color3 => ({
	r: r / 255,
	g: g / 255,
	b: b / 255,
});

export const prop = {
	udim2: (v: UDim2): PropertyValue => ({ type: "UDim2", value: v }),
	udim: (v: UDim): PropertyValue => ({ type: "UDim", value: v }),
	vector2: (v: Vector2): PropertyValue => ({ type: "Vector2", value: v }),
	color3: (v: Color3): PropertyValue => ({ type: "Color3", value: v }),
	colorSequence: (v: ColorSequenceValue): PropertyValue => ({
		type: "ColorSequence",
		value: v,
	}),
	numberSequence: (v: NumberSequenceValue): PropertyValue => ({
		type: "NumberSequence",
		value: v,
	}),
	rect: (v: RectValue): PropertyValue => ({ type: "Rect", value: v }),
	font: (v: FontValue): PropertyValue => ({ type: "Font", value: v }),
	enum: (v: EnumItemValue): PropertyValue => ({ type: "EnumItem", value: v }),
	number: (v: number): PropertyValue => ({ type: "number", value: v }),
	int: (v: number): PropertyValue => ({ type: "int", value: Math.trunc(v) }),
	bool: (v: boolean): PropertyValue => ({ type: "bool", value: v }),
	string: (v: string): PropertyValue => ({ type: "string", value: v }),
};
