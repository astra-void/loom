/**
 * `@loom-dev/renderer` — framework-agnostic DOM mapping.
 *
 * Walks a {@link SceneNode} tree alongside a {@link LayoutResult} and produces
 * nested, absolutely-positioned `<div>`s. It reproduces the layout engine's id
 * scheme exactly: positional path (`"0"`, `"0/0"`, …) counting only
 * layout-participating children, overridden by `node.id` when present.
 *
 * Two entry points share the same per-node CSS mapping:
 * - {@link renderScene} — one-shot full rebuild (`replaceChildren`), used by the
 *   vide adapter and anything that only needs a static picture.
 * - {@link createDomSession} — keyed incremental patching plus pointer-input
 *   delegation, used by the react world. Elements persist across frames (so
 *   listeners/focus survive) and input events dispatch onto the live
 *   `LoomInstance` tree via `data-loom-id`.
 *
 * Roblox fidelity rules honored here:
 * - The layout root and any LayerCollector (ScreenGui/SurfaceGui/BillboardGui)
 *   are transparent containers — never background-painted.
 * - Children are positioned relative to their parent's rect.
 * - `Visible:false` hides via CSS (the node still occupies its computed rect).
 * - Text classes paint their `Text` in an aligned overlay layer; `UICorner` and
 *   `UIStroke` modifier children become border-radius / box-shadow.
 * - Image classes paint their `Image` in an `<img>` layer beneath the text.
 *   `rbxassetid://` values need a host-installed {@link setImageResolver}.
 */

import type { EnumItem, InputObject, LoomInstance } from "@loom-dev/runtime";
import {
	Enum,
	getEventSignal,
	getFocusedTextBox,
	getService,
	makeInputObject,
	registerTextBoxAdapter,
	setFocusedTextBox,
	setMouseLocation,
	unregisterTextBoxAdapter,
	Vector2,
	Vector3,
} from "@loom-dev/runtime";
import type {
	Color3,
	FontValue,
	LayoutResult,
	Rect,
	SceneNode,
} from "@loom-dev/scene";
import {
	asBool,
	asColor3,
	asColorSequence,
	asNumber,
	asString,
	asUDim,
	asVector2,
	childrenOf,
	findModifier,
	getBackgroundColor3,
	getBackgroundTransparency,
	getClipsDescendants,
	getFontFace,
	getFontName,
	getImage,
	getImageTransparency,
	getScaleType,
	getText,
	getTextColor3,
	getTextSize,
	getTextTransparency,
	getTextWrapped,
	getTextXAlignment,
	getTextYAlignment,
	getVisible,
	getZIndex,
	isLayerCollector,
	participatesInLayout,
} from "@loom-dev/scene";

const ZERO_RECT: Rect = { x: 0, y: 0, width: 0, height: 0 };
const TEXT_CLASSES = new Set(["TextLabel", "TextButton", "TextBox"]);
const IMAGE_CLASSES = new Set(["ImageLabel", "ImageButton"]);
const SANS =
	'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
const MONO = 'ui-monospace, "Roboto Mono", "SF Mono", Menlo, monospace';

function cssColor(c: Color3, transparency: number): string {
	const r = Math.round(c.r * 255);
	const g = Math.round(c.g * 255);
	const b = Math.round(c.b * 255);
	return `rgba(${r}, ${g}, ${b}, ${1 - transparency})`;
}

// --- font / alignment mapping ------------------------------------------------

/**
 * Roblox font name -> CSS font-family stack. Takes either a legacy `Enum.Font`
 * item name (`"GothamBold"`) or a `FontFace` family name (`"GothamSSm"`) —
 * both identify the family by prefix. Exported so the adapter can measure text
 * with the exact font the renderer will paint (AutomaticSize text bounds).
 */
export function fontFamily(name: string | undefined): string {
	if (!name) return SANS;
	if (name === "Code" || name === "Inconsolata") return MONO;
	if (name.startsWith("RobotoMono")) return MONO;
	if (name.startsWith("Gotham")) return `"Gotham", ${SANS}`;
	if (name.startsWith("SourceSans")) return `"Source Sans Pro", ${SANS}`;
	if (name.startsWith("Roboto")) return `"Roboto", ${SANS}`;
	if (name.startsWith("Arial")) return `Arial, ${SANS}`;
	return SANS;
}
/** Legacy `Enum.Font` item name -> CSS font-weight (the name folds one in). */
export function fontWeight(name: string | undefined): string {
	if (!name) return "400";
	if (name.includes("Black")) return "900";
	if (name.includes("Bold")) return "700";
	if (name.includes("Semibold")) return "600";
	if (name.includes("Medium")) return "500";
	if (name.includes("Light")) return "300";
	return "400";
}

/** What the text painters actually need: a CSS family, weight, and slant. */
export interface ResolvedFont {
	family: string;
	weight: string;
	italic: boolean;
}

/** `rbxasset://fonts/families/SourceSansPro.json` -> `SourceSansPro`. */
function familyName(uri: string): string {
	return (uri.split("/").pop() ?? uri).replace(/\.json$/i, "");
}

/**
 * Resolve the two ways a Roblox text instance can carry a typeface. `FontFace`
 * (the modern `Font` datatype) wins when both are set, matching the engine —
 * and it is the only one roblox-ts code written this decade tends to use.
 */
export function resolveFont(
	fontName: string | undefined,
	face: FontValue | undefined,
): ResolvedFont {
	if (face) {
		// Roblox clamps a Font's weight to the 100–900 scale; anything else came
		// from hand-built data, so fall back to regular rather than emit garbage.
		const weight =
			Number.isFinite(face.weight) && face.weight >= 100 && face.weight <= 900
				? String(Math.round(face.weight / 100) * 100)
				: "400";
		return {
			family: fontFamily(familyName(face.family)),
			weight,
			italic: face.style === "Italic",
		};
	}
	return {
		family: fontFamily(fontName),
		weight: fontWeight(fontName),
		italic: fontName?.includes("Italic") ?? false,
	};
}

/** {@link resolveFont} for a scene node. */
export function nodeFont(node: SceneNode): ResolvedFont {
	return resolveFont(getFontName(node), getFontFace(node));
}

/**
 * {@link resolveFont} for a live instance — the adapter measures text off the
 * instance, before the node is encoded.
 */
export function instanceFont(inst: {
	readonly [key: string]: unknown;
}): ResolvedFont {
	const face = inst.FontFace as
		| {
				Family?: unknown;
				Weight?: { Value?: unknown };
				Style?: { Name?: unknown };
		  }
		| undefined;
	if (face && typeof face.Family === "string") {
		return resolveFont(undefined, {
			family: face.Family,
			weight: typeof face.Weight?.Value === "number" ? face.Weight.Value : 400,
			style: typeof face.Style?.Name === "string" ? face.Style.Name : "Normal",
		});
	}
	const legacy = inst.Font as { Name?: unknown } | undefined;
	return resolveFont(
		typeof legacy?.Name === "string" ? legacy.Name : undefined,
		undefined,
	);
}

/** CSS `font` shorthand for canvas measurement. */
export function fontShorthand(font: ResolvedFont, sizePx: number): string {
	return `${font.italic ? "italic " : ""}${font.weight} ${sizePx}px ${font.family}`;
}
const yAlignFlex = (a: string): string =>
	a === "Top" ? "flex-start" : a === "Bottom" ? "flex-end" : "center";
const xAlignText = (a: string): string =>
	a === "Left" ? "left" : a === "Right" ? "right" : "center";

// --- visual modifiers --------------------------------------------------------

/** `UICorner` -> border-radius (CornerRadius scale is relative to the shorter side). */
function applyCorner(
	s: CSSStyleDeclaration,
	node: SceneNode,
	rect: Rect,
): void {
	const corner = findModifier(node, "UICorner");
	if (!corner) return;
	const cr = asUDim(corner.properties?.CornerRadius) ?? { scale: 0, offset: 0 };
	const radius = cr.scale * Math.min(rect.width, rect.height) + cr.offset;
	if (radius > 0) s.borderRadius = `${radius}px`;
}

/** `UIStroke` -> an outset box-shadow ring (follows the corner radius). */
function applyStroke(s: CSSStyleDeclaration, node: SceneNode): void {
	const stroke = findModifier(node, "UIStroke");
	if (!stroke) return;
	const color = asColor3(stroke.properties?.Color) ?? { r: 0, g: 0, b: 0 };
	const thickness = asNumber(stroke.properties?.Thickness) ?? 1;
	const transparency = asNumber(stroke.properties?.Transparency) ?? 0;
	if (thickness > 0) {
		s.boxShadow = `0 0 0 ${thickness}px ${cssColor(color, transparency)}`;
	}
}

/**
 * `UIGradient` -> a CSS `linear-gradient` over the background. Roblox Rotation 0
 * is left->right (CSS 90deg). Transparency (a NumberSequence) is deferred; the
 * gradient overlays rather than multiplies the BackgroundColor3 (approximation).
 */
function applyGradient(s: CSSStyleDeclaration, node: SceneNode): void {
	const grad = findModifier(node, "UIGradient");
	if (!grad) return;
	if (asBool(grad.properties?.Enabled) === false) return;
	const seq = asColorSequence(grad.properties?.Color);
	if (!seq || seq.keypoints.length === 0) return;
	const rotation = asNumber(grad.properties?.Rotation) ?? 0;
	const stops = seq.keypoints
		.map((k) => `${cssColor(k.color, 0)} ${(k.time * 100).toFixed(3)}%`)
		.join(", ");
	s.backgroundImage = `linear-gradient(${90 + rotation}deg, ${stops})`;
}

/** Roblox classes that always sink pointer input regardless of `Active`. */
const POINTER_SINK_CLASSES = new Set([
	"TextButton",
	"ImageButton",
	"TextBox",
	"ScrollingFrame",
]);

/**
 * Whether a node should receive pointer input (CSS `pointer-events: auto`),
 * mirroring Roblox: GuiButtons, TextBoxes, and ScrollingFrames always sink,
 * plus any GuiObject with `Active = true`. Everything else (plain Frames,
 * labels, CanvasGroups, LayerCollectors, the root) is click-through so a
 * transparent container never blocks the interactive elements behind it.
 */
function sinksPointerInput(node: SceneNode): boolean {
	if (POINTER_SINK_CLASSES.has(node.className)) return true;
	return asBool(node.properties?.Active) === true;
}

/**
 * The full per-node box style (position, size, z-order, visibility, clipping,
 * background + modifiers) — the single CSS mapping both `renderScene` and the
 * incremental session share, so the two paths stay pixel-identical.
 */
function applyBoxStyle(
	s: CSSStyleDeclaration,
	node: SceneNode,
	rect: Rect,
	parentRect: Rect,
	isRoot: boolean,
): void {
	s.position = "absolute";
	s.left = `${rect.x - parentRect.x}px`;
	s.top = `${rect.y - parentRect.y}px`;
	s.width = `${rect.width}px`;
	s.height = `${rect.height}px`;
	// LayerCollectors z-order among themselves by DisplayOrder (default 0, may
	// be negative — lattice portals use 1000+stack); everything else by ZIndex.
	s.zIndex = String(
		isLayerCollector(node.className)
			? (asNumber(node.properties?.DisplayOrder) ?? 0)
			: getZIndex(node),
	);
	// Roblox input-sinking → CSS pointer-events. In Roblox only GuiButtons,
	// TextBoxes, ScrollingFrames, and objects with `Active = true` sink pointer
	// input; a transparent (or opaque-but-inactive) Frame and a LayerCollector
	// never block clicks from reaching the interactive elements behind them.
	// Painting every div `pointer-events: auto` broke that: a full-screen
	// transparent portal/positioning Frame (e.g. Combobox.Content's layer) sat
	// over the anchor input and swallowed its clicks/focus. Give the sinkers an
	// explicit `auto` (so they still receive under a `none` ancestor) and let
	// everything else fall through. Delegated pointer routing is unaffected —
	// it hit-tests the real event target and always fires UserInputService, so
	// outside-press dismissal keeps working.
	s.pointerEvents = sinksPointerInput(node) ? "auto" : "none";
	if (!getVisible(node)) s.display = "none";
	if (node.className === "ScrollingFrame" || getClipsDescendants(node)) {
		s.overflow = "hidden";
	}
	if (!isRoot && !isLayerCollector(node.className)) {
		s.background = cssColor(
			getBackgroundColor3(node),
			getBackgroundTransparency(node),
		);
		applyGradient(s, node);
		applyCorner(s, node, rect);
		applyStroke(s, node);
		// CanvasGroup.GroupTransparency fades the whole subtree as one — CSS
		// opacity on the container div is exactly that compositing model.
		const groupTransparency = asNumber(node.properties?.GroupTransparency);
		if (groupTransparency !== undefined) {
			const clamped = Math.min(1, Math.max(0, groupTransparency));
			if (clamped > 0) s.opacity = String(1 - clamped);
		}
		// GuiObject.Rotation: degrees clockwise around the element's center,
		// with layout (AbsolutePosition/AbsoluteSize) unaffected — matching CSS
		// transform semantics. Never applied to the root/LayerCollector divs.
		const rotation = asNumber(node.properties?.Rotation) ?? 0;
		if (rotation !== 0) {
			s.transform = `rotate(${rotation}deg)`;
			s.transformOrigin = "50% 50%";
		}
	}
}

// --- ScrollingFrame canvas ----------------------------------------------------

/**
 * The inner wrapper a ScrollingFrame's children mount into. Scrolling is a
 * pure visual `translate(-CanvasPosition)` on this wrapper (the frame itself
 * clips via `overflow: hidden`), so the children's own style snapshots stay
 * stable while the canvas moves.
 */
function makeCanvasWrapper(): HTMLDivElement {
	const el = document.createElement("div");
	const s = el.style;
	s.position = "absolute";
	s.left = "0";
	s.top = "0";
	s.width = "100%";
	s.height = "100%";
	return el;
}

/** The wrapper transform for a ScrollingFrame node's `CanvasPosition`. */
function canvasTransform(node: SceneNode): string {
	const canvasPosition = asVector2(node.properties?.CanvasPosition);
	const x = canvasPosition?.x ?? 0;
	const y = canvasPosition?.y ?? 0;
	return x === 0 && y === 0 ? "" : `translate(${-x}px, ${-y}px)`;
}

/** Build a text class's `Text` overlay layer, or `undefined` when empty. */
function createTextLayer(node: SceneNode): HTMLDivElement | undefined {
	if (!TEXT_CLASSES.has(node.className)) return undefined;
	const text = getText(node);
	if (text === undefined || text === "") return undefined;

	// Outer layer handles vertical alignment; the inner full-width element lets
	// `text-align` align every (wrapped) line over the whole label width.
	const layer = document.createElement("div");
	const s = layer.style;
	const font = nodeFont(node);
	s.position = "absolute";
	s.inset = "0";
	s.display = "flex";
	s.flexDirection = "column";
	s.justifyContent = yAlignFlex(getTextYAlignment(node));
	s.color = cssColor(getTextColor3(node), getTextTransparency(node));
	s.fontSize = `${getTextSize(node)}px`;
	s.fontFamily = font.family;
	s.fontWeight = font.weight;
	if (font.italic) s.fontStyle = "italic";
	s.lineHeight = "1"; // Roblox default LineHeight is 1.0
	s.overflow = "hidden";
	s.pointerEvents = "none";
	s.zIndex = String(getZIndex(node)); // share the unified ZIndex space with children

	const inner = document.createElement("div");
	inner.style.width = "100%";
	inner.style.textAlign = xAlignText(getTextXAlignment(node));
	inner.style.whiteSpace = getTextWrapped(node) ? "normal" : "nowrap";
	inner.textContent = text;
	layer.appendChild(inner);
	return layer;
}

/**
 * Fingerprint of every input `createTextLayer` reads, so the session rebuilds
 * the overlay only when a text-affecting prop actually changed.
 */
function textLayerKey(node: SceneNode): string {
	if (!TEXT_CLASSES.has(node.className)) return "";
	const text = getText(node);
	if (text === undefined || text === "") return "";
	const font = nodeFont(node);
	return [
		text,
		font.family,
		font.weight,
		font.italic ? 1 : 0,
		getTextSize(node),
		cssColor(getTextColor3(node), getTextTransparency(node)),
		getTextWrapped(node) ? 1 : 0,
		getTextXAlignment(node),
		getTextYAlignment(node),
		getZIndex(node),
	].join(" ");
}

// --- image layer -------------------------------------------------------------

/**
 * Turns an `Image` value the browser cannot load on its own — Roblox's
 * `rbxassetid://<id>` — into a URL an `<img>` can, returning `undefined` when
 * it cannot. May answer synchronously or with a promise.
 *
 * The renderer ships no default, deliberately. Resolving an asset id needs a
 * server hop: Roblox's thumbnail API sends no `Access-Control-Allow-Origin`, so
 * a browser cannot read it, and baking in some third party's CORS proxy would
 * route every consumer's asset traffic (and their users' IPs) through a service
 * neither loom nor they control. A host that *can* reach Roblox installs its
 * own with {@link setImageResolver} — `@loom-dev/preview` installs one backed
 * by its own dev server. Without a resolver, `rbxassetid://` images simply do
 * not paint; plain `http(s):`/`data:`/`blob:` URLs never need one.
 */
export type ImageResolver = (
	image: string,
) => string | undefined | Promise<string | undefined>;

let imageResolver: ImageResolver | undefined;
/** `Image` value → resolved URL, so a repaint never re-resolves. */
const resolvedImages = new Map<string, string>();
/** In-flight resolutions, so N nodes sharing an image make one call. */
const pendingImages = new Map<string, Promise<string | undefined>>();

/**
 * Install the resolver for `Image` values that are not already loadable URLs.
 * Pass `undefined` to clear it. Replacing the resolver drops the caches, since
 * a new resolver may map the same value somewhere else.
 */
export function setImageResolver(resolver: ImageResolver | undefined): void {
	imageResolver = resolver;
	resolvedImages.clear();
	pendingImages.clear();
}

/** URLs an `<img>` loads as-is; everything else has to go through the resolver. */
function directImageUrl(image: string): string | undefined {
	return /^(?:https?:|data:|blob:)/i.test(image) ? image : undefined;
}

function resolveImage(image: string): Promise<string | undefined> {
	const cached = resolvedImages.get(image);
	if (cached !== undefined) return Promise.resolve(cached);
	const inflight = pendingImages.get(image);
	if (inflight) return inflight;
	const resolver = imageResolver;
	if (!resolver) return Promise.resolve(undefined);

	const run = (async () => {
		try {
			const url = await resolver(image);
			if (typeof url === "string" && url !== "") {
				resolvedImages.set(image, url);
				return url;
			}
		} catch (err) {
			console.error(`loom: could not resolve Image "${image}":`, err);
		} finally {
			pendingImages.delete(image);
		}
		return undefined;
	})();
	pendingImages.set(image, run);
	return run;
}

/** `ScaleType` → the `object-fit` that reproduces it. */
function objectFit(scaleType: string): string {
	if (scaleType === "Fit") return "contain";
	if (scaleType === "Crop") return "cover";
	// Stretch, plus Slice/Tile until the renderer implements them.
	return "fill";
}

/**
 * Build an image class's `Image` layer, or `undefined` when there is none.
 *
 * Deferred (documented): `Slice`/`Tile` scale types, `ImageColor3` tinting, and
 * `ImageRectOffset`/`ImageRectSize` sprite windows — each needs more than one
 * `<img>` and a fit.
 */
function createImageLayer(node: SceneNode): HTMLImageElement | undefined {
	if (!IMAGE_CLASSES.has(node.className)) return undefined;
	const image = getImage(node);
	if (image === undefined || image === "") return undefined;

	const el = document.createElement("img");
	el.alt = ""; // decorative: Roblox images carry no accessible name
	el.draggable = false;
	const s = el.style;
	s.position = "absolute";
	s.inset = "0";
	s.width = "100%";
	s.height = "100%";
	s.objectFit = objectFit(getScaleType(node));
	s.pointerEvents = "none";
	s.zIndex = String(getZIndex(node)); // shares the unified ZIndex space
	const transparency = getImageTransparency(node);
	if (transparency > 0) s.opacity = String(Math.max(0, 1 - transparency));

	const known = directImageUrl(image) ?? resolvedImages.get(image);
	if (known !== undefined) {
		el.src = known;
		return el;
	}
	// Unresolved: paint the empty layer now and fill in the src when the
	// resolver answers. The element may be detached by then, which is harmless.
	void resolveImage(image).then((url) => {
		if (url !== undefined) el.src = url;
	});
	return el;
}

/**
 * Fingerprint of every input `createImageLayer` reads, so the session rebuilds
 * the layer only when an image-affecting prop actually changed.
 */
function imageLayerKey(node: SceneNode): string {
	if (!IMAGE_CLASSES.has(node.className)) return "";
	const image = getImage(node);
	if (image === undefined || image === "") return "";
	return [
		image,
		getScaleType(node),
		getImageTransparency(node),
		getZIndex(node),
	].join(" ");
}

// --- keyboard mapping --------------------------------------------------------

/** `KeyboardEvent.code` → `Enum.KeyCode` (unknown codes map to `Unknown`). */
const KEY_CODE_MAP: Record<string, EnumItem<"KeyCode">> = (() => {
	const map: Record<string, EnumItem<"KeyCode">> = {
		Space: Enum.KeyCode.Space,
		Enter: Enum.KeyCode.Return,
		NumpadEnter: Enum.KeyCode.Return,
		Escape: Enum.KeyCode.Escape,
		Tab: Enum.KeyCode.Tab,
		Backspace: Enum.KeyCode.Backspace,
		Delete: Enum.KeyCode.Delete,
		ArrowUp: Enum.KeyCode.Up,
		ArrowDown: Enum.KeyCode.Down,
		ArrowLeft: Enum.KeyCode.Left,
		ArrowRight: Enum.KeyCode.Right,
		Home: Enum.KeyCode.Home,
		End: Enum.KeyCode.End,
		PageUp: Enum.KeyCode.PageUp,
		PageDown: Enum.KeyCode.PageDown,
	};
	for (let i = 0; i < 26; i += 1) {
		const letter = String.fromCharCode(65 + i) as keyof typeof Enum.KeyCode;
		map[`Key${letter}`] = Enum.KeyCode[letter];
	}
	return map;
})();

/** Map a DOM keyboard event to the Roblox KeyCode it represents. */
export function keyCodeFromKeyboardEvent(
	e: KeyboardEvent,
): EnumItem<"KeyCode"> {
	return KEY_CODE_MAP[e.code] ?? Enum.KeyCode.Unknown;
}

const ARROW_KEY_CODES: ReadonlySet<EnumItem<"KeyCode">> = new Set([
	Enum.KeyCode.Up,
	Enum.KeyCode.Down,
	Enum.KeyCode.Left,
	Enum.KeyCode.Right,
]);

// --- TextBox <input> support -------------------------------------------------

let textMeasureCtx: CanvasRenderingContext2D | null | undefined;
function getTextMeasureCtx(): CanvasRenderingContext2D | null {
	if (textMeasureCtx === undefined) {
		textMeasureCtx =
			typeof document !== "undefined"
				? document.createElement("canvas").getContext("2d")
				: null;
	}
	return textMeasureCtx;
}

/**
 * Measure `text` with the same canvas-font mapping the text overlay paints and
 * write it to `inst.TextBounds` (a `Vector2`) — only when it actually changed,
 * so the property signal and dirty-mark don't loop. Lattice's textarea reads
 * `TextBox.TextBounds` for auto-resize.
 */
function updateTextBounds(inst: LoomInstance, text: string): void {
	const ctx = getTextMeasureCtx();
	if (!ctx) return;
	const size = typeof inst.TextSize === "number" ? inst.TextSize : 14;
	const font = inst.Font as { Name?: string } | undefined;
	const fontName = typeof font?.Name === "string" ? font.Name : undefined;
	ctx.font = `${fontWeight(fontName)} ${size}px ${fontFamily(fontName)}`;
	const lines = text.split("\n");
	let width = 0;
	for (const line of lines) {
		width = Math.max(width, ctx.measureText(line).width);
	}
	const w = Math.ceil(width);
	const h = text === "" ? 0 : lines.length * size;
	const current = inst.TextBounds as { X?: number; Y?: number } | undefined;
	if (current && current.X === w && current.Y === h) return;
	inst.TextBounds = Vector2.new(w, h);
}

/** The persistent `<input>`/`<textarea>` behind one TextBox scene node. */
interface TextBoxBinding {
	el: HTMLInputElement | HTMLTextAreaElement;
	inst: LoomInstance;
	multiLine: boolean;
	styleKey: string;
	/** Reentrancy guard: a DOM `input` event is being applied to `Text`. */
	applying: boolean;
	/** Set right before a programmatic/Enter blur so FocusLost sees it. */
	enterPressed: boolean;
	dispose(): void;
}

/**
 * Create the live `<input>` (or `<textarea>` when `MultiLine`) for a TextBox:
 * DOM `input` → `inst.Text` (through the proxy, so `Change.Text` handlers and
 * the dirty-mark fire), focus/blur → `Focused`/`FocusLost(enterPressed)`,
 * Enter on a single-line box blurs with `enterPressed = true`, and the runtime
 * TextBox adapter (`CaptureFocus`/`ReleaseFocus`/`IsFocused`) drives this
 * element.
 */
function createTextBoxBinding(
	inst: LoomInstance,
	multiLine: boolean,
): TextBoxBinding {
	const el = document.createElement(multiLine ? "textarea" : "input");
	const initialText = typeof inst.Text === "string" ? inst.Text : "";
	el.value = initialText;

	const binding: TextBoxBinding = {
		el,
		inst,
		multiLine,
		styleKey: "",
		applying: false,
		enterPressed: false,
		dispose(): void {
			unregisterTextBoxAdapter(inst);
			if (getFocusedTextBox() === inst) setFocusedTextBox(undefined);
			el.remove();
		},
	};

	const onInput = (): void => {
		binding.applying = true;
		try {
			inst.Text = el.value;
		} finally {
			binding.applying = false;
		}
		updateTextBounds(inst, el.value);
	};
	const onFocus = (): void => {
		// Roblox default: ClearTextOnFocus is true unless explicitly disabled.
		if (inst.ClearTextOnFocus !== false && el.value !== "") {
			el.value = "";
			onInput();
		}
		setFocusedTextBox(inst);
		getEventSignal(inst, "Focused").fire();
	};
	const onBlur = (): void => {
		const enterPressed = binding.enterPressed;
		binding.enterPressed = false;
		if (getFocusedTextBox() === inst) setFocusedTextBox(undefined);
		const input = enterPressed
			? makeInputObject({
					UserInputType: Enum.UserInputType.Keyboard,
					UserInputState: Enum.UserInputState.End,
					KeyCode: Enum.KeyCode.Return,
				})
			: undefined;
		getEventSignal(inst, "FocusLost").fire(enterPressed, input);
	};
	const onKeyDown = (e: Event): void => {
		if (
			!multiLine &&
			keyCodeFromKeyboardEvent(e as KeyboardEvent) === Enum.KeyCode.Return
		) {
			binding.enterPressed = true;
			el.blur();
		}
	};
	el.addEventListener("input", onInput);
	el.addEventListener("focus", onFocus);
	el.addEventListener("blur", onBlur);
	el.addEventListener("keydown", onKeyDown);

	registerTextBoxAdapter(inst, {
		CaptureFocus: () => el.focus(),
		ReleaseFocus: (enterPressed?: boolean) => {
			if (enterPressed) binding.enterPressed = true;
			el.blur();
		},
		IsFocused: () => document.activeElement === el,
	});

	updateTextBounds(inst, initialText);
	return binding;
}

/**
 * Inline style for the TextBox input element: full-size absolute overlay, no
 * chrome (transparent background, no border/outline), and the same font
 * mapping the text overlay layer uses — the input IS the text layer here.
 */
function applyTextBoxStyle(s: CSSStyleDeclaration, node: SceneNode): void {
	const font = nodeFont(node);
	s.position = "absolute";
	s.inset = "0";
	s.width = "100%";
	s.height = "100%";
	s.boxSizing = "border-box";
	s.padding = "0";
	s.margin = "0";
	s.background = "transparent";
	s.border = "none";
	s.outline = "none";
	s.resize = "none";
	s.color = cssColor(getTextColor3(node), getTextTransparency(node));
	s.fontSize = `${getTextSize(node)}px`;
	s.fontFamily = font.family;
	s.fontWeight = font.weight;
	if (font.italic) s.fontStyle = "italic";
	s.textAlign = xAlignText(getTextXAlignment(node));
	s.zIndex = String(getZIndex(node));
}

// --- one-shot tree walk (renderScene) ----------------------------------------

function renderNode(
	node: SceneNode,
	positionalPath: string,
	isRoot: boolean,
	layout: LayoutResult,
	parentRect: Rect,
): HTMLDivElement | undefined {
	const resolvedId = node.id ?? positionalPath;
	const entry = layout.rects[resolvedId];
	if (!entry) return undefined; // not laid out (shouldn't happen for layout nodes)
	const rect = entry.rect;

	const el = document.createElement("div");
	el.dataset.loomClass = node.className;
	el.dataset.loomName = node.name;
	applyBoxStyle(el.style, node, rect, parentRect, isRoot);

	// Image first: Roblox paints the image behind the label's own text.
	const imageLayer = createImageLayer(node);
	if (imageLayer) el.appendChild(imageLayer);

	const textLayer = createTextLayer(node);
	if (textLayer) el.appendChild(textLayer);

	// ScrollingFrame children live in the canvas wrapper (see makeCanvasWrapper)
	// so the one-shot and incremental paths produce identical DOM.
	let childHost: HTMLElement = el;
	if (node.className === "ScrollingFrame") {
		const canvas = makeCanvasWrapper();
		canvas.style.transform = canvasTransform(node);
		el.appendChild(canvas);
		childHost = canvas;
	}

	let i = 0;
	for (const child of childrenOf(node)) {
		if (!participatesInLayout(child.className)) continue; // skip modifiers
		const childEl = renderNode(
			child,
			`${positionalPath}/${i}`,
			false,
			layout,
			rect,
		);
		if (childEl) childHost.appendChild(childEl);
		i += 1;
	}
	return el;
}

/** Render (replacing any prior content) a scene + its computed layout into `mount`. */
export function renderScene(
	root: SceneNode,
	layout: LayoutResult,
	mount: HTMLElement,
): void {
	mount.replaceChildren();
	const el = renderNode(root, "0", true, layout, ZERO_RECT);
	if (el) mount.appendChild(el);
}

// --- incremental DOM session -------------------------------------------------

/** What `createDomSession` needs from its caller (the react world). */
export interface DomSessionOptions {
	/** Resolve a scene node id (`data-loom-id`) back to its live instance. */
	resolveInstance(id: string): LoomInstance | undefined;
}

/** A persistent, incrementally-patched DOM view of one scene tree. */
export interface DomSession {
	/** Reconcile the DOM against a new scene + layout (keyed by node id). */
	patch(root: SceneNode, layout: LayoutResult): void;
	/** Remove every element the session owns (the "no root" world state). */
	clear(): void;
	/** `clear()` plus input-listener teardown; the session is dead afterwards. */
	dispose(): void;
}

interface SessionEntry {
	el: HTMLDivElement;
	textEl: HTMLDivElement | undefined;
	imageEl: HTMLImageElement | undefined;
	styleKey: string;
	textKey: string;
	imageKey: string;
	/** Present only on TextBox nodes: the persistent input element. */
	input: TextBoxBinding | undefined;
	/** Present only on ScrollingFrame nodes: the -CanvasPosition child wrapper. */
	canvas: HTMLDivElement | undefined;
}

/** Reorder `el`'s children to exactly `desired`, touching only mismatches. */
function syncChildren(el: HTMLElement, desired: readonly HTMLElement[]): void {
	let cursor = el.firstChild;
	for (const child of desired) {
		if (cursor === child) {
			cursor = cursor.nextSibling;
			continue;
		}
		el.insertBefore(child, cursor);
	}
	while (cursor) {
		const next = cursor.nextSibling;
		(cursor as ChildNode).remove();
		cursor = next;
	}
}

/**
 * Create a persistent DOM session on `mount`: keyed incremental patching (same
 * CSS mapping as {@link renderScene}, but elements survive across patches so
 * listeners and focus persist) plus delegated pointer input that dispatches
 * Roblox events (`InputBegan`/`InputEnded`/`Activated`/`MouseEnter`/…) onto the
 * live instance tree and the global `UserInputService` signals.
 *
 * Event argument shapes (the react adapter prepends the instance itself):
 * - `InputBegan`/`InputEnded`/`InputChanged` → `(inputObject)`
 * - `Activated` → `(inputObject, clickCount)`
 * - `MouseButton1Click` → `()` (GuiButton classes only)
 * - `MouseEnter`/`MouseLeave` → `(x, y)` in mount-relative pixels
 */
export function createDomSession(
	mount: HTMLElement,
	options: DomSessionOptions,
): DomSession {
	const entries = new Map<string, SessionEntry>();
	// Scratch style declaration: the per-node style is computed here first and
	// only written to the live element when the serialized string changed.
	const scratch = document.createElement("div");

	function computeStyleKey(
		node: SceneNode,
		rect: Rect,
		parentRect: Rect,
		isRoot: boolean,
	): string {
		scratch.style.cssText = "";
		applyBoxStyle(scratch.style, node, rect, parentRect, isRoot);
		return scratch.style.cssText;
	}

	/** Create/refresh the persistent input element behind a TextBox node. */
	function patchTextBox(
		entry: SessionEntry,
		node: SceneNode,
		id: string,
	): void {
		const inst = options.resolveInstance(id);
		const multiLine = asBool(node.properties?.MultiLine) === true;
		if (
			entry.input &&
			(entry.input.inst !== inst || entry.input.multiLine !== multiLine)
		) {
			entry.input.dispose();
			entry.input = undefined;
		}
		if (!entry.input && inst) {
			entry.input = createTextBoxBinding(inst, multiLine);
		}
		const binding = entry.input;
		if (!binding) return;
		const el = binding.el;

		// Echo guard: only write `value` when the prop actually differs (an
		// external `Text` write) — a matching value means the change originated
		// from this input, and rewriting it would clobber the caret mid-typing.
		const text = getText(node) ?? "";
		if (!binding.applying && el.value !== text) {
			el.value = text;
			updateTextBounds(binding.inst, text);
		}
		const placeholder = asString(node.properties?.PlaceholderText) ?? "";
		if (el.placeholder !== placeholder) el.placeholder = placeholder;
		const readOnly = asBool(node.properties?.TextEditable) === false;
		if (el.readOnly !== readOnly) el.readOnly = readOnly;

		scratch.style.cssText = "";
		applyTextBoxStyle(scratch.style, node);
		const styleKey = scratch.style.cssText;
		if (styleKey !== binding.styleKey) {
			el.style.cssText = styleKey;
			binding.styleKey = styleKey;
		}
	}

	function patchNode(
		node: SceneNode,
		positionalPath: string,
		isRoot: boolean,
		layout: LayoutResult,
		parentRect: Rect,
		seen: Set<string>,
	): HTMLDivElement | undefined {
		const id = node.id ?? positionalPath;
		const laidOut = layout.rects[id];
		if (!laidOut) return undefined;
		const rect = laidOut.rect;

		let entry = entries.get(id);
		if (!entry) {
			const el = document.createElement("div");
			el.dataset.loomId = id;
			entry = {
				el,
				textEl: undefined,
				imageEl: undefined,
				styleKey: "",
				textKey: "",
				imageKey: "",
				input: undefined,
				canvas: undefined,
			};
			entries.set(id, entry);
		}
		seen.add(id);
		const el = entry.el;
		if (el.dataset.loomClass !== node.className) {
			el.dataset.loomClass = node.className;
		}
		if (el.dataset.loomName !== node.name) el.dataset.loomName = node.name;

		const styleKey = computeStyleKey(node, rect, parentRect, isRoot);
		if (styleKey !== entry.styleKey) {
			el.style.cssText = styleKey;
			entry.styleKey = styleKey;
		}

		const imageKey = imageLayerKey(node);
		if (imageKey !== entry.imageKey) {
			entry.imageEl?.remove();
			entry.imageEl = imageKey === "" ? undefined : createImageLayer(node);
			entry.imageKey = imageKey;
		}

		// TextBox paints its text in a persistent input element, not the overlay.
		const isTextBox = node.className === "TextBox";
		const textKey = isTextBox ? "" : textLayerKey(node);
		if (textKey !== entry.textKey) {
			entry.textEl?.remove();
			entry.textEl = textKey === "" ? undefined : createTextLayer(node);
			entry.textKey = textKey;
		}

		if (isTextBox) patchTextBox(entry, node, id);
		else if (entry.input) {
			entry.input.dispose();
			entry.input = undefined;
		}

		// ScrollingFrame: children mount into a persistent canvas wrapper shifted
		// by -CanvasPosition, so a scroll only touches one transform.
		if (node.className === "ScrollingFrame") {
			if (!entry.canvas) entry.canvas = makeCanvasWrapper();
			const transform = canvasTransform(node);
			if (entry.canvas.style.transform !== transform) {
				entry.canvas.style.transform = transform;
			}
		} else if (entry.canvas) {
			entry.canvas.remove();
			entry.canvas = undefined;
		}

		// Image first so it sits behind the text, matching renderNode.
		const overlays: HTMLElement[] = [];
		if (entry.imageEl) overlays.push(entry.imageEl);
		if (entry.input) overlays.push(entry.input.el);
		if (entry.textEl) overlays.push(entry.textEl);
		const children: HTMLElement[] = [];
		let i = 0;
		for (const child of childrenOf(node)) {
			if (!participatesInLayout(child.className)) continue;
			const childEl = patchNode(
				child,
				`${positionalPath}/${i}`,
				false,
				layout,
				rect,
				seen,
			);
			if (childEl) children.push(childEl);
			i += 1;
		}
		if (entry.canvas) {
			syncChildren(entry.canvas, children);
			syncChildren(el, [...overlays, entry.canvas]);
		} else {
			syncChildren(el, [...overlays, ...children]);
		}
		return el;
	}

	// --- input delegation ------------------------------------------------------

	/** Pointer position relative to the mount's top-left (= layout rect space). */
	function relPoint(e: MouseEvent): { x: number; y: number } {
		const bounds = mount.getBoundingClientRect();
		return { x: e.clientX - bounds.left, y: e.clientY - bounds.top };
	}

	/** Instance chain from the event target upward (innermost first). */
	function chainFromEvent(e: Event): LoomInstance[] {
		const chain: LoomInstance[] = [];
		const target = e.target;
		if (!(target instanceof Element)) return chain;
		let el: Element | null = target.closest("[data-loom-id]");
		while (el && mount.contains(el)) {
			const id = (el as HTMLElement).dataset.loomId;
			if (id) {
				const inst = options.resolveInstance(id);
				if (inst) chain.push(inst);
			}
			el = el.parentElement ? el.parentElement.closest("[data-loom-id]") : null;
		}
		return chain;
	}

	/**
	 * Roblox reports each mouse button as its own `UserInputType`, so the DOM
	 * `button` index has to be mapped rather than collapsed onto MouseButton1 —
	 * secondary-click consumers (ContextMenu) listen for MouseButton2 and would
	 * otherwise never fire. `pointerup` reports `button` too, so this holds for
	 * both ends of the press.
	 */
	function mouseButtonInputType(button: number): EnumItem<"UserInputType"> {
		if (button === 2) return Enum.UserInputType.MouseButton2;
		if (button === 1) return Enum.UserInputType.MouseButton3;
		return Enum.UserInputType.MouseButton1;
	}

	function pointerInput(
		e: PointerEvent,
		state: EnumItem<"UserInputState">,
	): InputObject {
		const { x, y } = relPoint(e);
		return makeInputObject({
			UserInputType:
				e.pointerType === "touch"
					? Enum.UserInputType.Touch
					: mouseButtonInputType(e.button),
			UserInputState: state,
			Position: Vector3.new(x, y, 0),
		});
	}

	const userInputService = (): LoomInstance => getService("UserInputService");

	let pressed: LoomInstance | undefined;
	let hoverChain: LoomInstance[] = [];

	function onPointerDown(e: PointerEvent): void {
		const input = pointerInput(e, Enum.UserInputState.Begin);
		const chain = chainFromEvent(e);
		for (const inst of chain) {
			getEventSignal(inst, "InputBegan").fire(input);
		}
		getEventSignal(userInputService(), "InputBegan").fire(input, false);
		pressed = chain[0];
	}

	function onPointerUp(e: PointerEvent): void {
		const input = pointerInput(e, Enum.UserInputState.End);
		const chain = chainFromEvent(e);
		for (const inst of chain) {
			getEventSignal(inst, "InputEnded").fire(input);
		}
		// Only a primary press activates a GuiButton in Roblox; a right-click
		// raises InputBegan/InputEnded and nothing else.
		const activates =
			input.UserInputType === Enum.UserInputType.MouseButton1 ||
			input.UserInputType === Enum.UserInputType.Touch;
		if (activates && pressed && chain.includes(pressed)) {
			// Roblox activates the pressed control even when the press landed on a
			// decorative child (label, icon): route to the nearest instance in the
			// chain with an Activated listener, falling back to the pressed one.
			const target =
				chain.find(
					(inst) => getEventSignal(inst, "Activated").hasConnections,
				) ?? pressed;
			getEventSignal(target, "Activated").fire(input, 1);
			const clickTarget = chain.find((inst) => inst.IsA("GuiButton"));
			if (clickTarget) {
				getEventSignal(clickTarget, "MouseButton1Click").fire();
			}
		}
		getEventSignal(userInputService(), "InputEnded").fire(input, false);
		pressed = undefined;
	}

	function onPointerMove(e: PointerEvent): void {
		const { x, y } = relPoint(e);
		setMouseLocation(Vector2.new(x, y));
		const input = makeInputObject({
			UserInputType: Enum.UserInputType.MouseMovement,
			UserInputState: Enum.UserInputState.Change,
			Position: Vector3.new(x, y, 0),
			Delta: Vector3.new(e.movementX || 0, e.movementY || 0, 0),
		});
		const chain = chainFromEvent(e);
		for (const inst of chain) {
			getEventSignal(inst, "InputChanged").fire(input);
		}
		getEventSignal(userInputService(), "InputChanged").fire(input, false);
	}

	/** Diff the hover chain: MouseLeave for departed, MouseEnter for arrived. */
	function updateHover(next: LoomInstance[], x: number, y: number): void {
		const nextSet = new Set(next);
		const prevSet = new Set(hoverChain);
		for (const inst of hoverChain) {
			if (!nextSet.has(inst)) getEventSignal(inst, "MouseLeave").fire(x, y);
		}
		for (const inst of next) {
			if (!prevSet.has(inst)) getEventSignal(inst, "MouseEnter").fire(x, y);
		}
		hoverChain = next;
	}

	function onPointerOver(e: PointerEvent): void {
		const { x, y } = relPoint(e);
		updateHover(chainFromEvent(e), x, y);
	}

	function onPointerOut(e: PointerEvent): void {
		const related = e.relatedTarget;
		// Leaving the mount entirely: no pointerover follows, clear the chain here.
		if (related instanceof Node && mount.contains(related)) return;
		const { x, y } = relPoint(e);
		updateHover([], x, y);
	}

	// --- wheel → ScrollingFrame.CanvasPosition -----------------------------------

	const clamp = (v: number, min: number, max: number): number =>
		Math.min(max, Math.max(min, v));

	/**
	 * Delegated wheel scrolling: the nearest ScrollingFrame ancestor of the
	 * event target consumes the delta, clamped per axis to `[0, canvas-window]`
	 * (metrics come from the world's post-layout feedback). The write goes
	 * through the instance proxy, so `GetPropertyChangedSignal("CanvasPosition")`
	 * listeners (lattice's thumb/metrics) fire and the next flush moves the
	 * canvas wrapper. `preventDefault` only when scroll was actually consumed.
	 */
	function onWheel(e: WheelEvent): void {
		const chain = chainFromEvent(e);
		const frame = chain.find((inst) => inst.IsA("ScrollingFrame"));
		if (!frame || frame.ScrollingEnabled === false) return;
		const windowSize = frame.AbsoluteWindowSize;
		const canvasSize = frame.AbsoluteCanvasSize;
		const current = frame.CanvasPosition;
		if (
			!(windowSize instanceof Vector2) ||
			!(canvasSize instanceof Vector2) ||
			!(current instanceof Vector2)
		) {
			return;
		}
		// Roblox default ScrollingDirection is XY; X/Y restrict to one axis.
		const direction =
			(frame.ScrollingDirection as { Name?: string } | undefined)?.Name ?? "XY";
		const nextX =
			direction === "Y"
				? current.X
				: clamp(
						current.X + e.deltaX,
						0,
						Math.max(0, canvasSize.X - windowSize.X),
					);
		const nextY =
			direction === "X"
				? current.Y
				: clamp(
						current.Y + e.deltaY,
						0,
						Math.max(0, canvasSize.Y - windowSize.Y),
					);
		if (nextX === current.X && nextY === current.Y) return;
		frame.CanvasPosition = Vector2.new(nextX, nextY);
		e.preventDefault();
	}

	// --- keyboard delegation ---------------------------------------------------
	// Key events are global (window), mirroring Roblox: UserInputService fires
	// for every key with `gameProcessedEvent = true` while a TextBox is focused.
	// Element-level routing: keys additionally fire InputBegan/InputEnded on the
	// GuiService.SelectedObject instance only (not its ancestors) — closest to
	// Roblox's selection-focused key routing, and what lattice item components
	// (tabs/radio-group/…) listen for.

	function keyInput(
		e: KeyboardEvent,
		state: EnumItem<"UserInputState">,
	): InputObject {
		return makeInputObject({
			UserInputType: Enum.UserInputType.Keyboard,
			UserInputState: state,
			KeyCode: keyCodeFromKeyboardEvent(e),
		});
	}

	function selectedInstance(): LoomInstance | undefined {
		return getService("GuiService").SelectedObject as LoomInstance | undefined;
	}

	function onKeyDown(e: KeyboardEvent): void {
		const input = keyInput(e, Enum.UserInputState.Begin);
		const textBoxFocused = getFocusedTextBox() !== undefined;
		const selected = selectedInstance();
		if (selected) getEventSignal(selected, "InputBegan").fire(input);
		getEventSignal(userInputService(), "InputBegan").fire(
			input,
			textBoxFocused,
		);
		// Keep the page from scrolling under selection-driven Space/arrow input,
		// but never swallow keys while the user is typing in a TextBox.
		if (
			!textBoxFocused &&
			selected &&
			(input.KeyCode === Enum.KeyCode.Space ||
				ARROW_KEY_CODES.has(input.KeyCode))
		) {
			e.preventDefault();
		}
	}

	function onKeyUp(e: KeyboardEvent): void {
		const input = keyInput(e, Enum.UserInputState.End);
		const selected = selectedInstance();
		if (selected) getEventSignal(selected, "InputEnded").fire(input);
		getEventSignal(userInputService(), "InputEnded").fire(
			input,
			getFocusedTextBox() !== undefined,
		);
	}

	/**
	 * A right-click inside the scene belongs to the scene: Roblox has no browser
	 * context menu, and leaving the native one up would cover whatever the
	 * secondary click just opened.
	 */
	function onContextMenu(e: MouseEvent): void {
		e.preventDefault();
	}

	mount.addEventListener("contextmenu", onContextMenu);
	mount.addEventListener("pointerdown", onPointerDown);
	mount.addEventListener("pointerup", onPointerUp);
	mount.addEventListener("pointermove", onPointerMove);
	mount.addEventListener("pointerover", onPointerOver);
	mount.addEventListener("pointerout", onPointerOut);
	// passive:false — the handler preventDefaults consumed scrolls so the page
	// doesn't scroll underneath a scrolling frame.
	mount.addEventListener("wheel", onWheel, { passive: false });
	window.addEventListener("keydown", onKeyDown);
	window.addEventListener("keyup", onKeyUp);

	function removeEntry(entry: SessionEntry): void {
		entry.input?.dispose();
		entry.input = undefined;
		entry.el.remove();
	}

	function clear(): void {
		for (const entry of entries.values()) removeEntry(entry);
		entries.clear();
		pressed = undefined;
		hoverChain = [];
	}

	return {
		patch(root: SceneNode, layout: LayoutResult): void {
			const seen = new Set<string>();
			const rootEl = patchNode(root, "0", true, layout, ZERO_RECT, seen);
			for (const [id, entry] of entries) {
				if (seen.has(id)) continue;
				removeEntry(entry);
				entries.delete(id);
			}
			if (rootEl && rootEl.parentElement !== mount) mount.appendChild(rootEl);
		},
		clear,
		dispose(): void {
			mount.removeEventListener("contextmenu", onContextMenu);
			mount.removeEventListener("pointerdown", onPointerDown);
			mount.removeEventListener("pointerup", onPointerUp);
			mount.removeEventListener("pointermove", onPointerMove);
			mount.removeEventListener("pointerover", onPointerOver);
			mount.removeEventListener("pointerout", onPointerOut);
			mount.removeEventListener("wheel", onWheel);
			window.removeEventListener("keydown", onKeyDown);
			window.removeEventListener("keyup", onKeyUp);
			clear();
		},
	};
}
