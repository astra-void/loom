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
export function asEnum(
	p: PropertyValue | undefined,
): EnumItemValue | undefined {
	return p?.type === "EnumItem"
		? ((p as KnownProperty).value as EnumItemValue)
		: undefined;
}
export function asColorSequence(
	p: PropertyValue | undefined,
): ColorSequenceValue | undefined {
	return p?.type === "ColorSequence"
		? ((p as KnownProperty).value as ColorSequenceValue)
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
export const getTextWrapped = (n: SceneNode): boolean =>
	asBool(props(n).TextWrapped) ?? false;
export const getTextScaled = (n: SceneNode): boolean =>
	asBool(props(n).TextScaled) ?? false;
/** Enum item name, e.g. "Center"; default "Center" (Roblox TextLabel default). */
export const getTextXAlignment = (n: SceneNode): string =>
	asEnum(props(n).TextXAlignment)?.name ?? "Center";
export const getTextYAlignment = (n: SceneNode): string =>
	asEnum(props(n).TextYAlignment)?.name ?? "Center";
/** Legacy `Font` enum item name, e.g. "GothamBold"; undefined when unset. */
export const getFontName = (n: SceneNode): string | undefined =>
	asEnum(props(n).Font)?.name;
/** `FontFace` (the modern `Font` datatype); undefined when unset. */
export const getFontFace = (n: SceneNode): FontValue | undefined =>
	asFont(props(n).FontFace);

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
	font: (v: FontValue): PropertyValue => ({ type: "Font", value: v }),
	enum: (v: EnumItemValue): PropertyValue => ({ type: "EnumItem", value: v }),
	number: (v: number): PropertyValue => ({ type: "number", value: v }),
	int: (v: number): PropertyValue => ({ type: "int", value: Math.trunc(v) }),
	bool: (v: boolean): PropertyValue => ({ type: "bool", value: v }),
	string: (v: string): PropertyValue => ({ type: "string", value: v }),
};
