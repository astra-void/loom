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
 * - Text classes paint their `Text` in an aligned overlay layer; `UICorner`,
 *   `UIStroke` and `UIShadow` modifier children become border-radius and
 *   box-shadow layers.
 * - Image classes paint their `Image` in an `<img>` layer beneath the text, and
 *   `ImageColor3` tints it through an SVG multiply filter.
 *   `rbxassetid://` values need a host-installed {@link setImageResolver}.
 * - `RichText` markup is parsed into styled spans (see `./richtext.ts`); with
 *   the flag off the same string stays literal.
 */

import type { EnumItem, InputObject, LoomInstance } from "@loom-dev/runtime";
import {
	clearInputState,
	Enum,
	getEventSignal,
	getFocusedTextBox,
	getService,
	hasAnyEventConnection,
	makeInputObject,
	registerTextBoxAdapter,
	setFocusedTextBox,
	setKeyState,
	setMouseButtonState,
	setMouseLocation,
	setTextMeasurer,
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
	UDim,
} from "@loom-dev/scene";
import {
	asBool,
	asColor3,
	asColorSequence,
	asEnum,
	asNumber,
	asString,
	asUDim,
	asUDim2,
	asVector2,
	childrenOf,
	findModifier,
	getBackgroundColor3,
	getBackgroundTransparency,
	getClipsDescendants,
	getFontFace,
	getFontName,
	getImage,
	getImageColor3,
	getImageRect,
	getImageTransparency,
	getLineHeight,
	getResampleMode,
	getRichText,
	getScaleType,
	getSliceCenter,
	getSliceScale,
	getText,
	getTextColor3,
	getTextScaled,
	getTextSize,
	getTextTransparency,
	getTextWrapped,
	getTextXAlignment,
	getTextYAlignment,
	getTileSize,
	getVisible,
	getZIndex,
	isLayerCollector,
	participatesInLayout,
	type ScrollMetrics,
	scrollMetrics,
} from "@loom-dev/scene";
import {
	familyIsAvailable,
	familyStack,
	onFontsChanged,
	warnMissingFace,
} from "./fonts.ts";
import { parseRichText, type RichStyle } from "./richtext.ts";

// Font registration is part of the public surface: a browser has none of the
// engine's typefaces, so the host installs the ones it has.
export {
	clearRegisteredFonts,
	type FontFaceSource,
	type FontRegistration,
	familyIsAvailable,
	familyKey,
	onFontsChanged,
	registerFont,
} from "./fonts.ts";

import type { RichSegment } from "./richtext.ts";

// The rich-text parser is part of the public surface: the react adapter has to
// measure the *shown* text, not the markup, for AutomaticSize.
export {
	decodeEntities,
	parseRichText,
	type RichSegment,
	type RichStyle,
	richTextToPlain,
} from "./richtext.ts";

const ZERO_RECT: Rect = { x: 0, y: 0, width: 0, height: 0 };
const TEXT_CLASSES = new Set(["TextLabel", "TextButton", "TextBox"]);
const IMAGE_CLASSES = new Set(["ImageLabel", "ImageButton"]);
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
 *
 * A host-registered typeface wins (see `./fonts.ts`); without one the family
 * falls back to whatever the machine has, which is where the same scene starts
 * measuring differently per OS.
 */
export function fontFamily(name: string | undefined): string {
	// Every path that paints or measures a typeface comes through here, so it is
	// where an unbacked family gets noticed.
	warnMissingFace(name);
	return familyStack(name);
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
 * The font one `RichText` run paints in: the label's, with only what the run's
 * own tags named overridden — the compositing the engine does.
 *
 * Here rather than in an adapter because the run's *size* has to be converted
 * through its own face's metrics (see {@link cssFontSize}), so the paint and the
 * measurement have to agree on which face a run ended up with.
 */
export function runFont(style: RichStyle, base: ResolvedFont): ResolvedFont {
	const italic = style.italic === true || base.italic;
	const weight = style.weight ?? (style.bold === true ? "700" : undefined);
	if (style.family !== undefined) {
		// A `family` URI carries its own metrics; `resolveFont` reads it the same
		// way `FontFace` on the instance is read.
		return resolveFont(undefined, {
			family: style.family,
			weight: Number(weight ?? base.weight),
			style: italic ? "Italic" : "Normal",
		});
	}
	const named =
		style.face !== undefined ? resolveFont(style.face, undefined) : base;
	return {
		family: named.family,
		weight: weight ?? named.weight,
		italic,
	};
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

/**
 * The CSS `font-size` that makes a face occupy `textSize` the way the engine
 * does.
 *
 * `TextSize` is not a font size. Roblox fits the *whole face* into it — ascender
 * to descender — so a one-line label is exactly `TextSize` tall and the glyphs
 * inside are whatever is left after the face's own metrics take their share. CSS
 * `font-size` sets the em square instead, and a face's ascent + descent runs
 * past 1em: 1.17 for Roboto, 1.48 for Oswald, 1.05 for Inconsolata.
 *
 * Painting `font-size: TextSize` therefore drew every glyph too big by exactly
 * that ratio — 17% for Roboto, 47% for Oswald — so text measured (and wrapped)
 * that much wider than the engine's. Measured against Studio at `TextSize` 18,
 * Roboto: `Player Profile` 93 units in the engine against 105 here, the whole
 * body string 797 against 910. Every string, every size, the same ratio.
 *
 * The ratio is the face's, so it is read off the face the browser will actually
 * paint with. A browser with no `fontBoundingBox*` metrics (or a stub canvas)
 * reports NaN and keeps the old 1:1 mapping rather than guessing.
 */
const emScaleCache = new Map<string, number>();
// A face arriving after first paint changes the metrics behind an unchanged
// stack — the ratio belongs to the face, not to the name it was asked for.
onFontsChanged(() => emScaleCache.clear());

/** The reference size the ratio is read at, big enough to swamp the rounding
 * browsers do when they report the face box. */
const EM_PROBE_SIZE = 100;

/**
 * The ratio the *engine* uses, for the faces {@link registerFont} ships.
 *
 * `fontBoundingBoxAscent + Descent` is the browser's answer for "how tall is
 * this face", and it is not the number Roblox divides by — Roboto reports 1.17
 * there while the engine sizes the face as though it were 1.14. The difference
 * is small and entirely visible: it painted Roboto ~2.6% small, and since the
 * advances come off the same size, it measured every string that much narrow
 * before the half-pixel rounding pushed it back out again.
 *
 * Each entry is the size that reproduces `TextService:GetTextBoundsAsync`
 * exactly. Solved per family against the engine's own per-glyph advances at
 * `TextSize` 18 (24 glyphs: `iltmaenowsrfy.,␣AWCBFTgu`), taking the middle of
 * the range of sizes that round to all 24. 24 of the 28 land on every glyph;
 * the four that do not are noted below, and their fitted ratio is still closer
 * than the browser's.
 *
 * Keyed by the CSS family the face declares, since that is what survives into
 * {@link ResolvedFont}. A family with no entry — anything a project registered
 * itself, `Gotham` included — keeps the measured box, which is the previous
 * behaviour.
 */
const ENGINE_FACE_BOX: ReadonlyMap<string, number> = new Map([
	["Source Sans 3 Variable", 1.2212],
	["Roboto Variable", 1.14],
	["Roboto Mono Variable", 1.2707],
	["Roboto Condensed Variable", 1.1385],
	["Inconsolata Variable", 1.0001],
	["Arimo Variable", 1.0863],
	// Fredoka stands in for Fredoka One (see `open-fonts.ts`), so this is the
	// closest size for a face the engine does not actually draw with: 13/24.
	["Fredoka Variable", 1.1236],
	["Grenze Gotisch Variable", 1.4337],
	["Josefin Sans Variable", 0.9723],
	["Jura Variable", 1.155],
	// 16/24 — the bundled cut differs from the engine's beyond a size change.
	["Merriweather Variable", 1.221],
	["Nunito Variable", 1.3353], // 23/24
	["Oswald Variable", 1.4308], // 23/24
	["Amatic SC", 1.2234],
	["Bangers", 1.0334],
	["Creepster", 1.1378],
	["Denk One", 1.221], // 23/24
	["Fondamento", 1.3465],
	["Indie Flower", 1.412],
	["Kalam", 1.5501],
	["Luckiest Guy", 0.9724],
	["Michroma", 1.3843],
	["Patrick Hand", 1.3117],
	["Permanent Marker", 1.3862],
	["Sarpanch", 1.3644],
	["Special Elite", 0.9715],
	["Titillium Web", 1.4739],
	["Ubuntu", 1.0927],
]);

/** The first family in a CSS stack, unquoted — what the table is keyed by. */
function primaryFamily(stack: string): string {
	const first = stack.split(",")[0]?.trim() ?? "";
	return first.replace(/^["']|["']$/g, "");
}

function faceBoxPerEm(font: ResolvedFont): number {
	const key = `${font.italic ? "italic " : ""}${font.weight} ${font.family}`;
	const cached = emScaleCache.get(key);
	if (cached !== undefined) return cached;
	// Only when the browser can actually paint it. The table describes one
	// specific face, and it is reached by *name* — through a registration, which
	// is a claim about a file the page still has to fetch. When that fetch fails
	// (a dev server that will not serve it, a proxy in front of it) the browser
	// paints the fallback while this would go on sizing the text as though the
	// engine's face were there: every advance comes off the wrong glyphs, so
	// `wrapLines` breaks in places the engine does not and `AutomaticSize`
	// reports a box that does not match the text drawn in it. Measuring instead
	// describes whatever is really being painted, and the answer is recomputed
	// when the face lands, since a font-loading cycle drops this cache.
	const primary = primaryFamily(font.family);
	const known = ENGINE_FACE_BOX.get(primary);
	if (known !== undefined && familyIsAvailable(primary)) {
		emScaleCache.set(key, known);
		return known;
	}
	let ratio = 1;
	const ctx = measureContext();
	if (ctx) {
		ctx.font = `${font.italic ? "italic " : ""}${font.weight} ${EM_PROBE_SIZE}px ${font.family}`;
		// Any string does: these are the *face's* metrics, not the glyphs'.
		const metrics = ctx.measureText("Hg");
		const box = metrics.fontBoundingBoxAscent + metrics.fontBoundingBoxDescent;
		const measured = box / EM_PROBE_SIZE;
		// A face reporting something absurd is a face loom should not be resizing
		// text by; 1 is the old behaviour and a safe floor to fall back to.
		if (Number.isFinite(measured) && measured >= 0.5 && measured <= 3) {
			ratio = measured;
		}
	}
	emScaleCache.set(key, ratio);
	return ratio;
}

/** {@link faceBoxPerEm} applied: a Roblox `TextSize` as a CSS `font-size`. */
export function cssFontSize(font: ResolvedFont, textSize: number): number {
	if (!(textSize > 0)) return 0;
	return textSize / faceBoxPerEm(font);
}

/**
 * CSS `font` shorthand for canvas measurement, from a Roblox `TextSize` — the
 * size conversion in {@link cssFontSize} included, so measurement and paint
 * agree on how big the glyphs are.
 */
export function fontShorthand(font: ResolvedFont, textSize: number): string {
	return `${font.italic ? "italic " : ""}${font.weight} ${cssFontSize(font, textSize)}px ${font.family}`;
}

/**
 * How far the painted glyphs can fall outside the box the layout gave a label,
 * per vertical edge, for one font at one size.
 *
 * Normally none: {@link cssFontSize} sizes the font so the face box *is*
 * `TextSize`, which is the same thing measured here, so there is nothing left
 * over to hang out. What remains is the case that conversion cannot reach — the
 * face is read at {@link EM_PROBE_SIZE} and a browser is free to hint a 14px
 * line box to something other than 14/100ths of it. When that happens the label
 * is clipped to the engine's height (`TextSize + (n - 1) * TextSize *
 * LineHeight`) while the browser lays out taller lines, and the difference goes
 * under the knife: the last line loses its descenders (`activity` painted as
 * `activitv`), and at a large enough `TextSize` the first line loses the tops of
 * its ascenders.
 *
 * The amount is the same at both edges and — the pleasant part — independent of
 * both `LineHeight` and the number of lines. Lines 2..n sit on `TextSize *
 * LineHeight` of pitch in either renderer, so every line but the first cancels;
 * what is left over is one face box against one `TextSize`, split evenly above
 * and below. {@link createTextLayer} grows the clip rect by it.
 */
const bleedCache = new Map<string, number>();
// A face arriving after first paint changes the metrics behind an unchanged
// font stack, so the measurements keyed on that stack no longer describe it.
onFontsChanged(() => bleedCache.clear());

function textBleed(font: ResolvedFont, textSize: number): number {
	if (!(textSize > 0)) return 0;
	const key = fontShorthand(font, textSize);
	const cached = bleedCache.get(key);
	if (cached !== undefined) return cached;
	const ctx = measureContext();
	let bleed = 0;
	if (ctx) {
		ctx.font = key;
		// Any string does: these are the *face's* metrics, not the glyphs'.
		const metrics = ctx.measureText("Hg");
		const faceBox =
			metrics.fontBoundingBoxAscent + metrics.fontBoundingBoxDescent;
		// A browser without the metrics (or a stub canvas) reports NaN; no bleed is
		// the pre-existing behaviour, which is the right thing to fall back to.
		if (Number.isFinite(faceBox) && faceBox > textSize) {
			// A whole pixel over, at least: browsers report this box rounded while
			// laying the line out with the fractional original, so the overhang can
			// run a shade past what it says. Rounding rather than ceiling keeps the
			// answer off the float dust in `size * ratio`; a clip rect costs nothing
			// by being a pixel generous either way.
			bleed = Math.round((faceBox - textSize) / 2) + 1;
		}
	}
	bleedCache.set(key, bleed);
	return bleed;
}

// --- text measurement (TextService) ------------------------------------------

let measureCanvas: CanvasRenderingContext2D | null | undefined;
function measureContext(): CanvasRenderingContext2D | null {
	if (measureCanvas === undefined) {
		measureCanvas =
			typeof document !== "undefined"
				? document.createElement("canvas").getContext("2d")
				: null;
	}
	return measureCanvas;
}

/**
 * Width of one unbreakable run, measured the way the engine spends it: one
 * advance per glyph, each **rounded** to the half-pixel, plus the kerning
 * between them.
 *
 * `ctx.measureText(run)` is the browser's answer and it is not the engine's.
 * Every advance the engine reports is a multiple of 0.5 — a ten-`i` string is
 * exactly ten times one `i`, so the quantum is per glyph — and it kerns: `AV`
 * comes back 19.5 where its two glyphs are 10.5 and 10 on their own.
 *
 * Rounding is only correct once the glyphs are the right size, which is what
 * {@link ENGINE_FACE_BOX} fixed; before that the advances came out ~2.6% narrow
 * and rounding them lost half a pixel a glyph, which is why this snapped *up*
 * instead and ran wide. Against `GetTextBoundsAsync` (Roboto 18) over eleven
 * strings from single pairs to full 115-character lines, rounding at the
 * engine's size with kerning is exact on six and never off by more than 0.5;
 * snapping up without it was exact on five and off by 9 on the longest line.
 *
 * The kerning total is quantized once for the run rather than per pair: the
 * engine's own kerning for a line lands on a half pixel, and quantizing each
 * pair would round a hundred sub-half-pixel deltas away to nothing.
 *
 * Both caches are keyed by `ctx.font` — the shorthand carries family, weight,
 * style and size, which is exactly the cache key — and dropped when a
 * registered face loads, since the same shorthand then shapes with a different
 * face.
 */
interface GlyphMetrics {
	/** Half-pixel advance, the engine's unit. */
	advance: number;
	/** Unrounded width, kept so kerning can be read out of a pair. */
	raw: number;
}
const advanceCache = new Map<string, Map<string, GlyphMetrics>>();
const kernCache = new Map<string, Map<string, number>>();
onFontsChanged(() => {
	advanceCache.clear();
	kernCache.clear();
});
const graphemeSegmenter =
	typeof Intl.Segmenter === "function"
		? new Intl.Segmenter(undefined, { granularity: "grapheme" })
		: undefined;

function* graphemes(run: string): Iterable<string> {
	if (graphemeSegmenter === undefined) {
		// Older engines still get code points rather than UTF-16 halves.
		yield* run;
		return;
	}
	for (const item of graphemeSegmenter.segment(run)) yield item.segment;
}

/** Snap to the half pixel the engine reports every advance on. */
function halfPixel(width: number): number {
	return Math.round(width * 2) / 2;
}

export function shapedTextWidth(
	ctx: CanvasRenderingContext2D,
	run: string,
): number {
	const fontKey = ctx.font;
	let advances = advanceCache.get(fontKey);
	if (advances === undefined) {
		advances = new Map();
		advanceCache.set(fontKey, advances);
	}
	let kerns = kernCache.get(fontKey);
	if (kerns === undefined) {
		kerns = new Map();
		kernCache.set(fontKey, kerns);
	}
	const metricsOf = (glyph: string): GlyphMetrics => {
		let metrics = advances.get(glyph);
		if (metrics === undefined) {
			const raw = ctx.measureText(glyph).width;
			metrics = { advance: halfPixel(raw), raw };
			advances.set(glyph, metrics);
		}
		return metrics;
	};
	let total = 0;
	let kerning = 0;
	let previous: string | undefined;
	// Keep combining marks and emoji ZWJ sequences together. Measuring their code
	// points separately would turn one displayed glyph into several advances.
	for (const glyph of graphemes(run)) {
		const metrics = metricsOf(glyph);
		total += metrics.advance;
		if (previous !== undefined) {
			const pair = `${previous} ${glyph}`;
			let kern = kerns.get(pair);
			if (kern === undefined) {
				kern =
					ctx.measureText(previous + glyph).width -
					metricsOf(previous).raw -
					metrics.raw;
				kerns.set(pair, kern);
			}
			kerning += kern;
		}
		previous = glyph;
	}
	return total + halfPixel(kerning);
}

/**
 * A width function for one font at one `TextSize`, over the shared measuring
 * context — which every other measurer here reuses, so the font is re-asserted
 * rather than assumed to be whatever it was left as.
 */
function widthMeasurer(
	font: ResolvedFont,
	textSize: number,
): (piece: string) => number {
	const ctx = measureContext();
	if (!ctx) return () => 0;
	const shorthand = fontShorthand(font, textSize);
	return (piece) => {
		if (ctx.font !== shorthand) ctx.font = shorthand;
		return shapedTextWidth(ctx, piece);
	};
}

/**
 * Break a string into the lines the engine would break it into: greedy at word
 * boundaries, on {@link shapedTextWidth} advances, `\n` always breaking.
 *
 * This is the one place the wrap is decided. Measurement asks it how many lines
 * a label needs, and {@link createTextLayer} asks it where to put the breaks it
 * paints — because the browser, left to wrap the text itself, uses its own
 * kerned run widths and breaks a couple of words later than the engine does.
 * Against `TextService:GetTextBoundsAsync` (Roboto 18, the #11 paragraph, 50
 * widths from 320 to 1300) these advances land on the engine's line count 48
 * times; the browser's own wrapping managed 32. Sharing the answer is what
 * keeps a box from being a line taller than the text drawn inside it.
 *
 * A word longer than `wrapAt` stays on its own line rather than being split
 * mid-word — the same thing the measurement has always done, so the two agree
 * on that edge too.
 */
function wrapLines(
	text: string,
	wrapAt: number | undefined,
	widthOf: (piece: string) => number,
): { lines: string[]; widest: number } {
	const lines: string[] = [];
	let widest = 0;
	for (const paragraph of text.split("\n")) {
		if (wrapAt === undefined) {
			lines.push(paragraph);
			widest = Math.max(widest, widthOf(paragraph));
			continue;
		}
		let line = "";
		let lineWidth = 0;
		for (const piece of paragraph.split(/(\s+)/)) {
			if (piece === "") continue;
			const pieceWidth = widthOf(piece);
			if (lineWidth > 0 && lineWidth + pieceWidth > wrapAt) {
				lines.push(line);
				widest = Math.max(widest, lineWidth);
				// A run of spaces that lands on a break is spent on the break: the
				// next line starts at the margin, not indented by it.
				const breaks = piece.trim() === "";
				line = breaks ? "" : piece;
				lineWidth = breaks ? 0 : pieceWidth;
				continue;
			}
			line += piece;
			lineWidth += pieceWidth;
		}
		lines.push(line);
		widest = Math.max(widest, lineWidth);
	}
	return { lines, widest };
}

/**
 * Measure a plain string the way the engine's `TextService` does — the same font
 * resolution the renderer paints with, so what a component *reserves* for a
 * label and what the label then *occupies* come from one place.
 *
 * Wrapping is greedy at word boundaries, as in the layout engine's own text
 * path; `width` of 0 (Roblox's "no frame") means no wrapping at all. Rich-text
 * markup is not read here: `GetTextSize` does not read it in the engine either.
 */
export function measureText(request: {
	text: string;
	size: number;
	/** A legacy `Enum.Font` name (`"GothamBold"`), or nothing for the default. */
	font?: string;
	width?: number;
}): { x: number; y: number } {
	const size = request.size > 0 ? request.size : 0;
	if (request.text === "" || size === 0) {
		return { x: 0, y: request.text === "" ? 0 : size };
	}
	// Without a canvas (no DOM at all) the glyph widths are unknowable, but the
	// line *count* still is — so the height stays right and only the width
	// collapses, rather than the whole answer.
	const ctx = measureContext();
	if (ctx) ctx.font = fontShorthand(resolveFont(request.font, undefined), size);
	const { lines, widest } = wrapLines(
		request.text,
		request.width !== undefined && request.width > 0
			? request.width
			: undefined,
		(piece) => (ctx ? shapedTextWidth(ctx, piece) : 0),
	);
	// Every advance is already a multiple of 0.5, and the engine's own answer
	// keeps that half (`GetTextSize("Save", 24, …)` is 44.5) — ceiling it would
	// report one wider than Studio does.
	return { x: widest, y: lines.length * size };
}

// Hand the measurement to the runtime, which owns `TextService` but has no
// business knowing about canvases or font stacks. Both adapters load the
// renderer, so `TextService:GetTextSize` works under either one.
setTextMeasurer(measureText);

// --- TextScaled ---------------------------------------------------------------

/**
 * The window `TextScaled` searches when no `UITextSizeConstraint` narrows it.
 * The engine will grow text to 100 and shrink it to 1, and no further — a
 * `TextScaled` label in a very tall box does not end up with 400px glyphs.
 */
const TEXT_SCALED_MAX = 100;
const TEXT_SCALED_MIN = 1;

/**
 * Fingerprint -> the size the search settled on. The search costs a handful of
 * wrap passes and both the repaint fingerprint and the paint ask for it every
 * frame, so without this a scaled label re-measures itself twice a frame for as
 * long as it is on screen.
 */
const scaledSizeCache = new Map<string, number>();
// A face finishing its download changes every advance the search was decided
// on, so the answers it produced are no longer the ones it would produce.
onFontsChanged(() => scaledSizeCache.clear());

/**
 * The `TextSize` `TextScaled` resolves to: the largest whole size at which the
 * string still fits inside `width` x `height`.
 *
 * `TextScaled` ignores `TextSize` outright — the property is not a starting
 * point the engine scales *from*, it is simply not read — so this is the only
 * thing that decides how big the glyphs come out. Wrapping is on regardless of
 * `TextWrapped`, which is what the engine does too: scaling to fit a box means
 * fitting both axes, and a string that cannot break can only ever satisfy the
 * width by shrinking past the point of legibility.
 *
 * Measured through {@link wrapLines}, the same call the text overlay paints its
 * breaks with and the same one `TextService:GetTextSize` answers from — so the
 * size reported back and the size drawn are one number, not two that agree by
 * luck.
 *
 * Whole sizes rather than the engine's continuous scale: the search is a binary
 * one either way, and a fractional answer would report a `TextBounds` no
 * `GetTextSize` call could reproduce. Below `minSize` the text simply overflows
 * its box, which is exactly what `UITextSizeConstraint.MinTextSize` means.
 */
export function scaledTextSize(request: {
	text: string;
	font: ResolvedFont;
	width: number;
	height: number;
	/** `LineHeight`; the engine spends it only *between* lines (default 1). */
	lineHeight?: number;
	minSize?: number;
	maxSize?: number;
}): number {
	const min = Math.max(1, Math.floor(request.minSize ?? TEXT_SCALED_MIN));
	const max = Math.max(min, Math.floor(request.maxSize ?? TEXT_SCALED_MAX));
	const { text, width, height } = request;
	// No box yet (the first frame, before layout has run) or nothing to fit:
	// the floor, so the label paints at a legible size rather than at 100.
	if (text === "" || !(width > 0) || !(height > 0)) return min;
	const lineHeight = request.lineHeight ?? 1;
	const key = `${min}-${max} ${width}x${height} ${lineHeight} ${
		request.font.italic ? "italic " : ""
	}${request.font.weight} ${request.font.family} ${text}`;
	const cached = scaledSizeCache.get(key);
	if (cached !== undefined) return cached;

	const fits = (size: number): boolean => {
		const { lines, widest } = wrapLines(
			text,
			width,
			widthMeasurer(request.font, size),
		);
		// A word wider than the box survives `wrapLines` unbroken, so the widest
		// line is checked rather than assumed to be within the wrap width.
		if (widest > width) return false;
		// The block height the overlay actually paints: `LineHeight` is spent
		// between baselines only, so n lines occupy `size + (n - 1) * size * lh`.
		return size + (lines.length - 1) * size * lineHeight <= height;
	};
	let best = min;
	if (fits(max)) {
		best = max;
	} else {
		let lo = min;
		let hi = max;
		while (lo < hi) {
			const mid = Math.ceil((lo + hi) / 2);
			if (fits(mid)) lo = mid;
			else hi = mid - 1;
		}
		best = lo;
	}
	scaledSizeCache.set(key, best);
	return best;
}

/**
 * The size a text node's glyphs are painted at: `TextSize`, unless `TextScaled`
 * is on and the box decides instead.
 *
 * Every reader of a text node's size goes through here — the overlay layer, its
 * repaint fingerprint, the clip rect, and the TextBox `<input>` — so a scaled
 * label cannot end up measured at one size and painted at another.
 */
function effectiveTextSize(node: SceneNode, rect: Rect): number {
	if (!getTextScaled(node)) return getTextSize(node);
	// `UITextSizeConstraint` is the engine's way of bounding the search, and the
	// only reason a `TextScaled` label ever stops growing before it fills the box.
	const constraint = findModifier(node, "UITextSizeConstraint");
	return scaledTextSize({
		text: getText(node) ?? "",
		font: nodeFont(node),
		width: rect.width,
		height: rect.height,
		lineHeight: getLineHeight(node),
		minSize: asNumber(constraint?.properties?.MinTextSize),
		maxSize: asNumber(constraint?.properties?.MaxTextSize),
	});
}
const yAlignFlex = (a: string): string =>
	a === "Top" ? "flex-start" : a === "Bottom" ? "flex-end" : "center";
const xAlignText = (a: string): string =>
	a === "Left" ? "left" : a === "Right" ? "right" : "center";

// --- visual modifiers --------------------------------------------------------

/**
 * `UICorner` -> border-radius (a scale is relative to the shorter side).
 *
 * `CornerRadius` rounds all four corners; the per-corner `TopLeftRadius` …
 * `BottomRightRadius` override it one corner at a time, which is how a card
 * rounds only its top while its footer rounds only its bottom. Whatever comes
 * out here also shapes everything drawn from the same box — the `UIStroke` ring
 * and the `UIShadow` are box-shadows, so they follow the radius for free.
 */
function applyCorner(
	s: CSSStyleDeclaration,
	node: SceneNode,
	rect: Rect,
): void {
	const corner = findModifier(node, "UICorner");
	if (!corner) return;
	const shorter = Math.min(rect.width, rect.height);
	const all = asUDim(corner.properties?.CornerRadius);
	const radius = (name: string): number => {
		const udim = asUDim(corner.properties?.[name]) ?? all;
		if (!udim) return 0;
		return Math.max(0, udim.scale * shorter + udim.offset);
	};
	const tl = radius("TopLeftRadius");
	const tr = radius("TopRightRadius");
	const br = radius("BottomRightRadius");
	const bl = radius("BottomLeftRadius");
	if (tl === 0 && tr === 0 && br === 0 && bl === 0) {
		// Cleared rather than left alone: a radius that animates back to zero has
		// to square the box off again, not keep the last rounding it had.
		s.borderRadius = "";
		return;
	}
	s.borderRadius =
		tl === tr && tr === br && br === bl
			? `${tl}px`
			: `${tl}px ${tr}px ${br}px ${bl}px`;
}

/** A `UDim` resolved against a pixel basis, the Roblox way. */
const resolveUDim = (u: UDim | undefined, basis: number): number =>
	(u?.scale ?? 0) * basis + (u?.offset ?? 0);

/**
 * `UIStroke` -> a box-shadow ring `Thickness` pixels wide, following the corner
 * radius. `BorderStrokePosition` decides which side of the edge those pixels sit
 * on: `Outer` (the default, and what Roblox drew before the property existed)
 * spreads outward, `Inner` insets so the stroke eats into the object instead of
 * inflating it — a bordered header stays flush with the card around it rather
 * than overhanging it — and `Center` straddles the edge, half of the thickness
 * each way.
 */
function strokeShadow(node: SceneNode): string | undefined {
	const stroke = findModifier(node, "UIStroke");
	if (!stroke) return undefined;
	if (asBool(stroke.properties?.Enabled) === false) return undefined;
	const color = asColor3(stroke.properties?.Color) ?? { r: 0, g: 0, b: 0 };
	const thickness = asNumber(stroke.properties?.Thickness) ?? 1;
	const transparency = asNumber(stroke.properties?.Transparency) ?? 0;
	if (thickness <= 0 || transparency >= 1) return undefined;
	const paint = cssColor(color, transparency);
	switch (asEnum(stroke.properties?.BorderStrokePosition)?.name) {
		case "Inner":
			return `inset 0 0 0 ${thickness}px ${paint}`;
		case "Center": {
			const half = thickness / 2;
			return `0 0 0 ${half}px ${paint}, inset 0 0 0 ${half}px ${paint}`;
		}
		default:
			return `0 0 0 ${thickness}px ${paint}`;
	}
}

/** Roblox's `GuiObject.BorderSizePixel` default — a 1px border, not none. */
const DEFAULT_BORDER_SIZE = 1;
/** Roblox's `GuiObject.BorderColor3` default, `Color3.fromRGB(27, 42, 53)`. */
const DEFAULT_BORDER_COLOR: Color3 = { r: 27 / 255, g: 42 / 255, b: 53 / 255 };

/**
 * `BorderSizePixel` / `BorderColor3` / `BorderMode` -> a box-shadow ring — the
 * same trick {@link strokeShadow} plays, for the same reason: a CSS `border` is
 * part of the box model and would push the node's own content (and, with
 * `box-sizing: content-box`, its children) in by its thickness, while the
 * engine's border is pure paint over a rect the layout engine already decided.
 *
 * This is the legacy border every GuiObject has carried since before `UIStroke`
 * existed, and the part that surprises is that it is **on by default**: the
 * engine ships `BorderSizePixel = 1` with that dark slate `BorderColor3`, so a
 * Frame that sets nothing really does draw a thin outline in-game. loom read
 * none of the three properties, which made an unstyled Frame come out cleaner
 * in the preview than in the engine — and made `BorderSizePixel = 0`, the line
 * half of Roblox UI code opens with, look like it had done nothing.
 *
 * What keeps the default from being loud is that the engine spends
 * `BackgroundTransparency` on the border as well as the fill — one property for
 * the whole box — so the invisible container Frames real UI is built out of
 * stay borderless here too.
 *
 * `BorderMode` decides which side of the edge the pixels sit on, exactly as
 * `BorderStrokePosition` does for `UIStroke`: `Outline` (the default) paints
 * wholly outside the rect, `Inset` wholly inside it, and `Middle` straddles the
 * edge with half the thickness each way.
 */
function borderShadow(node: SceneNode): string | undefined {
	const thickness =
		asNumber(node.properties?.BorderSizePixel) ?? DEFAULT_BORDER_SIZE;
	if (!(thickness > 0)) return undefined;
	const transparency = getBackgroundTransparency(node);
	if (transparency >= 1) return undefined;
	const color = asColor3(node.properties?.BorderColor3) ?? DEFAULT_BORDER_COLOR;
	const paint = cssColor(color, transparency);
	switch (asEnum(node.properties?.BorderMode)?.name) {
		case "Inset":
			return `inset 0 0 0 ${thickness}px ${paint}`;
		case "Middle": {
			const half = thickness / 2;
			return `0 0 0 ${half}px ${paint}, inset 0 0 0 ${half}px ${paint}`;
		}
		default:
			return `0 0 0 ${thickness}px ${paint}`;
	}
}

/**
 * `UIShadow` -> a CSS drop shadow. Same compositing model in both engines: the
 * shadow paints outside the parent's box, behind its background, and follows
 * the corner radius — which is exactly what a non-inset `box-shadow` does.
 *
 * Two places the mapping approximates:
 * - Roblox `Spread` is a `UDim2` (independent x and y), CSS spread is one
 *   length. The two resolved axes are averaged; equal spread — what a shadow
 *   normally has — is therefore exact.
 * - `ZIndex` orders sibling `UIShadow`s against each other. Only the first
 *   shadow child is read (`findModifier`), so there are no siblings to order.
 */
function dropShadow(node: SceneNode, rect: Rect): string | undefined {
	const shadow = findModifier(node, "UIShadow");
	if (!shadow) return undefined;
	if (asBool(shadow.properties?.Enabled) === false) return undefined;
	const p = shadow.properties;
	const offset = asUDim2(p?.Offset);
	const spread = asUDim2(p?.Spread);
	const x = resolveUDim(offset?.x, rect.width);
	const y = resolveUDim(offset?.y, rect.height);
	const blur = resolveUDim(
		asUDim(p?.BlurRadius),
		Math.min(rect.width, rect.height),
	);
	const grow =
		(resolveUDim(spread?.x, rect.width) + resolveUDim(spread?.y, rect.height)) /
		2;
	const color = asColor3(p?.Color) ?? { r: 0, g: 0, b: 0 };
	const transparency = asNumber(p?.Transparency) ?? 0;
	if (transparency >= 1) return undefined;
	return `${x}px ${y}px ${Math.max(0, blur)}px ${grow}px ${cssColor(color, transparency)}`;
}

/**
 * The stroke ring, the legacy border and the drop shadow all land on one CSS
 * property, so they are emitted together. CSS paints earlier shadows on top, so
 * the order is the engine's depth order read outward: `UIStroke` is the modern
 * effect and wins the edge, `BorderSizePixel` sits under it on the same edge,
 * and the drop shadow spreads out behind them both.
 */
function applyShadows(
	s: CSSStyleDeclaration,
	node: SceneNode,
	rect: Rect,
): void {
	const layers = [
		strokeShadow(node),
		borderShadow(node),
		dropShadow(node, rect),
	].filter((layer): layer is string => layer !== undefined);
	// Assigned either way: a session patches the same element every frame, so a
	// stroke that is switched off has to take its ring with it.
	s.boxShadow = layers.join(", ");
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

/**
 * The input events a GuiObject can hear from the pointer. A node with a live
 * listener on any of them is hit-testable, `Active` or not — see the patch in
 * `patchNode`.
 */
// `MouseButton2Down`/`Up` and `MouseWheelForward`/`Backward` are dispatched from
// here but are not yet in the runtime's `EVENT_NAMES`, so a Luau-style
// `button.MouseButton2Down:Connect(...)` cannot resolve them off the proxy —
// only the react adapter's `Event` prop, which asks for the signal by name, can.
// Adding the four names there is all that is left.
const POINTER_EVENT_NAMES: readonly string[] = [
	"InputBegan",
	"InputChanged",
	"InputEnded",
	"MouseEnter",
	"MouseLeave",
	"MouseMoved",
	"MouseButton1Click",
	"MouseButton1Down",
	"MouseButton1Up",
	"MouseButton2Click",
	"MouseButton2Down",
	"MouseButton2Up",
	"MouseWheelForward",
	"MouseWheelBackward",
	"Activated",
];

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
	if (node.className === "ScrollingFrame") {
		// The session scrolls this frame from the touch gesture itself (there is
		// no wheel on a phone); the browser must not consume the drag as a page
		// pan first. Scoped to the frame so panning works everywhere else.
		s.touchAction = "none";
	}
	if (!isRoot && !isLayerCollector(node.className)) {
		s.background = cssColor(
			getBackgroundColor3(node),
			getBackgroundTransparency(node),
		);
		applyGradient(s, node);
		applyCorner(s, node, rect);
		applyShadows(s, node, rect);
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

// --- ScrollingFrame scroll bars ----------------------------------------------

/** Roblox's `ScrollBarThickness` default. */
const DEFAULT_SCROLL_BAR_THICKNESS = 12;
/**
 * The stand-in for Roblox's default bar sprites.
 *
 * The engine paints `TopImage`/`MidImage`/`BottomImage` — grey `rbxasset`
 * textures — tinted by `ScrollBarImageColor3`, whose own default is white. Loom
 * draws the bar rather than fetching those textures, so an untinted bar takes
 * the sprites' own grey (white would be an invisible bar on most backgrounds,
 * which is not what the engine shows); a frame that sets `ScrollBarImageColor3`
 * gets exactly the colour it asked for.
 */
const DEFAULT_SCROLL_BAR_COLOR: Color3 = { r: 0.6, g: 0.6, b: 0.6 };
/**
 * Roblox's maximum `ZIndex`. The engine draws a frame's scroll bars over its
 * canvas whatever the content's own ZIndex is, and this is the only value no
 * child can be painted above.
 */
const SCROLL_BAR_Z_INDEX = 2147483647;

/** One axis of a frame's scroll bar, in the frame's own pixel space. */
interface ScrollBar {
	axis: "X" | "Y";
	thickness: number;
	/** The bar's offset on the cross axis: left for "Y", top for "X". */
	cross: number;
	/** The track the thumb runs along — the window, less the other bar's corner. */
	length: number;
	/** Thumb offset from the track's start, and its length. */
	thumbAt: number;
	thumbLength: number;
	/** Canvas pixels one thumb pixel is worth — what a drag scrolls by. */
	ratio: number;
}

/**
 * The scroll bars a frame shows, laid out the way the engine lays its own out:
 * one per axis with more canvas than window, along the right/bottom edge,
 * `ScrollBarThickness` wide, running the length of the window less the corner
 * the other bar takes. The thumb is the window's share of that track — the
 * engine's rounded grey bar, no end buttons.
 *
 * Roblox hides a bar with nothing to scroll, and shows none at all when the
 * frame is `ScrollingEnabled = false` or its `ScrollBarThickness` is 0.
 * `ScrollingDirection` decides which axes can scroll, so it decides which bars
 * can appear.
 *
 * The bar is painted *over* the canvas (Roblox's `ScrollBarInset.None`), which
 * is why {@link scrollMetrics} reserves no thickness for it.
 */
function scrollBars(
	node: SceneNode,
	rect: Rect,
	metrics: ScrollMetrics,
): ScrollBar[] {
	if (asBool(node.properties?.ScrollingEnabled) === false) return [];
	const thickness =
		asNumber(node.properties?.ScrollBarThickness) ??
		DEFAULT_SCROLL_BAR_THICKNESS;
	if (!(thickness > 0)) return [];
	const direction = asEnum(node.properties?.ScrollingDirection)?.name ?? "XY";
	const scrollableX =
		direction === "Y" ? 0 : Math.max(0, metrics.canvas.x - metrics.window.x);
	const scrollableY =
		direction === "X" ? 0 : Math.max(0, metrics.canvas.y - metrics.window.y);
	const showX = scrollableX > 0;
	const showY = scrollableY > 0;

	const bar = (
		axis: "X" | "Y",
		cross: number,
		length: number,
		scrollable: number,
		visible: number,
		canvas: number,
	): ScrollBar => {
		// The thumb is the window's share of the canvas, never shorter than the
		// bar is wide — the engine keeps it grabbable however long the canvas gets.
		const thumbLength = Math.min(
			length,
			Math.max(thickness, length * (visible / canvas)),
		);
		const travel = length - thumbLength;
		const at = asVector2(node.properties?.CanvasPosition);
		const position = (axis === "Y" ? at?.y : at?.x) ?? 0;
		const progress =
			scrollable > 0 ? Math.min(1, Math.max(0, position / scrollable)) : 0;
		return {
			axis,
			thickness,
			cross,
			length,
			thumbAt: progress * travel,
			thumbLength,
			ratio: travel > 0 ? scrollable / travel : 0,
		};
	};

	const bars: ScrollBar[] = [];
	if (showY) {
		bars.push(
			bar(
				"Y",
				rect.width - thickness,
				Math.max(0, rect.height - (showX ? thickness : 0)),
				scrollableY,
				metrics.window.y,
				metrics.canvas.y,
			),
		);
	}
	if (showX) {
		bars.push(
			bar(
				"X",
				rect.height - thickness,
				Math.max(0, rect.width - (showY ? thickness : 0)),
				scrollableX,
				metrics.window.x,
				metrics.canvas.x,
			),
		);
	}
	return bars;
}

/**
 * The scroll-bar layer for a ScrollingFrame: a pointer-transparent overlay that
 * does NOT live in the canvas wrapper (the bars stay put while the canvas moves)
 * holding one grabbable thumb per visible bar.
 *
 * Returns `undefined` when nothing scrolls, which is also how the session knows
 * to drop the layer again.
 */
function createScrollBarLayer(
	node: SceneNode,
	rect: Rect,
	metrics: ScrollMetrics,
): HTMLDivElement | undefined {
	const bars = scrollBars(node, rect, metrics);
	if (bars.length === 0) return undefined;
	const layer = document.createElement("div");
	const s = layer.style;
	s.position = "absolute";
	s.inset = "0";
	s.pointerEvents = "none";
	s.zIndex = String(SCROLL_BAR_Z_INDEX);
	const color = cssColor(
		asColor3(node.properties?.ScrollBarImageColor3) ?? DEFAULT_SCROLL_BAR_COLOR,
		asNumber(node.properties?.ScrollBarImageTransparency) ?? 0,
	);
	for (const bar of bars) {
		const thumb = document.createElement("div");
		const t = thumb.style;
		const vertical = bar.axis === "Y";
		t.position = "absolute";
		t.left = `${vertical ? bar.cross : bar.thumbAt}px`;
		t.top = `${vertical ? bar.thumbAt : bar.cross}px`;
		t.width = `${vertical ? bar.thickness : bar.thumbLength}px`;
		t.height = `${vertical ? bar.thumbLength : bar.thickness}px`;
		t.background = color;
		// The engine's bar is a capsule: fully rounded ends, whatever the thickness.
		t.borderRadius = `${bar.thickness / 2}px`;
		// The thumb is the one part of the overlay that takes input, and the
		// browser must not turn a drag on it into a page pan (same reason the
		// frame itself opts out).
		t.pointerEvents = "auto";
		t.touchAction = "none";
		thumb.dataset.loomScrollbar = bar.axis;
		// The drag reads its scale straight off the thumb it grabbed rather than
		// re-deriving the track geometry from the DOM.
		thumb.dataset.loomScrollRatio = String(bar.ratio);
		layer.appendChild(thumb);
	}
	return layer;
}

/**
 * A ScrollingFrame's metrics from the layout that just ran, resolving its
 * children by the id scheme both tree walks share (an explicit `node.id`, else
 * the layout-positional path).
 */
function frameMetrics(
	node: SceneNode,
	rect: Rect,
	positionalPath: string,
	layout: LayoutResult,
): ScrollMetrics {
	return scrollMetrics(
		node,
		rect,
		(child, index) =>
			layout.rects[child.id ?? `${positionalPath}/${index}`]?.rect,
	);
}

/**
 * Change key for the scroll-bar layer: everything {@link createScrollBarLayer}
 * paints from, so the session rebuilds the bars on a real change only.
 */
function scrollBarKey(
	node: SceneNode,
	rect: Rect,
	metrics: ScrollMetrics,
): string {
	const bars = scrollBars(node, rect, metrics);
	if (bars.length === 0) return "";
	const color = cssColor(
		asColor3(node.properties?.ScrollBarImageColor3) ?? DEFAULT_SCROLL_BAR_COLOR,
		asNumber(node.properties?.ScrollBarImageTransparency) ?? 0,
	);
	const key = bars
		.map(
			(bar) =>
				`${bar.axis}:${bar.cross},${bar.thickness},${bar.thumbAt},${bar.thumbLength}`,
		)
		.join("|");
	return `${key}|${color}`;
}

/** Build a text class's `Text` overlay layer, or `undefined` when empty. */
function createTextLayer(
	node: SceneNode,
	/**
	 * The laid-out box the text lives in; zero-sized before the first layout.
	 * The width is what wrapping breaks against, and `TextScaled` needs the
	 * height too — it is fitting the string to the whole rect, not to a line.
	 */
	rect: Rect,
): HTMLDivElement | undefined {
	if (!TEXT_CLASSES.has(node.className)) return undefined;
	const text = getText(node);
	if (text === undefined || text === "") return undefined;

	const width = rect.width;
	// Outer layer handles vertical alignment; the inner full-width element lets
	// `text-align` align every (wrapped) line over the whole label width.
	const layer = document.createElement("div");
	const s = layer.style;
	const font = nodeFont(node);
	const textSize = effectiveTextSize(node, rect);
	s.position = "absolute";
	s.inset = "0";
	s.display = "flex";
	s.flexDirection = "column";
	s.justifyContent = yAlignFlex(getTextYAlignment(node));
	s.color = cssColor(getTextColor3(node), getTextTransparency(node));
	// `TextSize` is the height of the whole face, not the em — see
	// {@link cssFontSize}, which is also what every measurement here goes
	// through, so the box a label reserves and the glyphs painted into it come
	// out of the same number.
	s.fontSize = `${cssFontSize(font, textSize)}px`;
	s.fontFamily = font.family;
	s.fontWeight = font.weight;
	if (font.italic) s.fontStyle = "italic";
	const lineHeight = getLineHeight(node);
	// In pixels, off `TextSize` rather than as a multiplier of the (now smaller)
	// em: the engine spends `LineHeight` on `TextSize`, so a line of 18 at 1.4 is
	// 25.2 apart whatever the face's metrics did to the font size.
	s.lineHeight = `${lineHeight * textSize}px`;
	s.overflow = "hidden";
	s.pointerEvents = "none";
	s.zIndex = String(getZIndex(node)); // share the unified ZIndex space with children
	// The clip rect is the label's box grown by however far the face overhangs it
	// (see `textBleed`), and the padding hands the content box its original height
	// straight back — so the flex alignment above places the text exactly where it
	// did before, and the only thing that changed is what survives the clip.
	// Horizontally nothing moves: a label still clips its own text at its edges.
	const bleed = textBleed(font, textSize);
	if (bleed > 0) {
		s.boxSizing = "border-box";
		s.top = px(-bleed);
		s.bottom = px(-bleed);
		s.paddingTop = px(bleed);
		s.paddingBottom = px(bleed);
	}

	const inner = document.createElement("div");
	inner.style.width = "100%";
	// CSS gives *every* line box the full `line-height`, half of the extra above
	// the text and half below; Roblox spends it only between lines. Cropping the
	// leading off the two outer edges leaves the gaps intact and the block the
	// height the engine measures — a one-line label stays exactly `TextSize` tall
	// however high its `LineHeight` is.
	if (lineHeight !== 1) {
		const leading = ((lineHeight - 1) * textSize) / 2;
		inner.style.marginTop = `${-leading}px`;
		inner.style.marginBottom = `${-leading}px`;
	}
	inner.style.textAlign = xAlignText(getTextXAlignment(node));
	// `pre-wrap`/`pre` rather than `normal`/`nowrap`: the engine renders a string
	// literally. A newline in `Text` breaks the line — wrapped or not, `RichText`
	// or not, exactly as `<br/>` does — and a run of spaces is a run of spaces.
	// HTML's default collapses both, so text loom *measured* as several lines
	// (every measurer here splits on "\n") painted as one long run, leaving a box
	// built for a line count the paint never produced.
	// Wrapped text is broken here rather than by CSS. The browser wraps on its own
	// kerned run widths, which are a couple of percent narrower than the advances
	// the engine spends and the box was measured with — so a label could reserve
	// nine lines and paint eight, ending short of a box built for it. The breaks
	// now come from `wrapLines`, the same call the measurement made, and `pre`
	// keeps them. A label with no width yet has nothing to wrap against and falls
	// back to letting CSS do it.
	// `TextScaled` wraps whatever `TextWrapped` says: the size was chosen by
	// fitting the string to both axes of the box, and painting that size on one
	// unbroken line would run it straight out the side.
	const wrapped = getTextWrapped(node) || getTextScaled(node);
	const preBreak = wrapped && width > 0;
	inner.style.whiteSpace = wrapped && !preBreak ? "pre-wrap" : "pre";
	if (getRichText(node)) {
		paintRichText(inner, text, node, preBreak ? width : 0, textSize);
	} else {
		// `RichText = false` means the markup is not markup: `<b>` is two angle
		// brackets and a letter, and `textContent` is what shows it as such.
		inner.textContent = preBreak
			? wrapLines(text, width, widthMeasurer(font, textSize)).lines.join("\n")
			: text;
	}
	layer.appendChild(inner);
	return layer;
}

/**
 * The rich-text counterpart of {@link wrapLines}: the same greedy wrap, but the
 * line width carries across runs, and each run measures in the font `<font>`
 * gave it. Returns one string per segment, with `\n` where a break falls.
 *
 * A word split by a tag (`he<b>llo</b>`) counts as two pieces rather than one.
 * That is what the adapters' own segment measurement does, so a box and the
 * text painted into it still agree — which is the property that matters here.
 */
function breakRichSegments(
	segments: readonly RichSegment[],
	node: SceneNode,
	width: number,
	/** The size untagged runs paint at — `TextSize`, or what `TextScaled` chose. */
	baseTextSize: number,
): string[] {
	const baseFont = nodeFont(node);
	const out: string[] = [];
	let lineWidth = 0;
	for (const segment of segments) {
		if (segment.kind === "break") {
			out.push("");
			lineWidth = 0;
			continue;
		}
		const widthOf = widthMeasurer(
			runFont(segment.style, baseFont),
			segment.style.size ?? baseTextSize,
		);
		let built = "";
		const paragraphs = segment.text.split("\n");
		for (let i = 0; i < paragraphs.length; i += 1) {
			if (i > 0) {
				built += "\n";
				lineWidth = 0;
			}
			for (const piece of (paragraphs[i] ?? "").split(/(\s+)/)) {
				if (piece === "") continue;
				const pieceWidth = widthOf(piece);
				if (lineWidth > 0 && lineWidth + pieceWidth > width) {
					built += "\n";
					if (piece.trim() === "") {
						lineWidth = 0;
						continue;
					}
					built += piece;
					lineWidth = pieceWidth;
					continue;
				}
				built += piece;
				lineWidth += pieceWidth;
			}
		}
		out.push(built);
	}
	return out;
}

/**
 * Paint `RichText` markup into `inner` as one `<span>` per styled run.
 *
 * Every run inherits the layer's own font and color and overrides only what its
 * tags named, so `<font size="20">` inside a 14px label changes the size and
 * nothing else — the same compositing the engine does.
 *
 * `width` is the wrap width when the label is wrapped and laid out, and 0 when
 * it is not; a wrapped label gets its breaks put in rather than left to CSS.
 */
function paintRichText(
	inner: HTMLElement,
	text: string,
	node: SceneNode,
	width: number,
	/** The size untagged runs paint at — `TextSize`, or what `TextScaled` chose. */
	baseTextSize: number,
): void {
	const baseColor = getTextColor3(node);
	const baseTransparency = getTextTransparency(node);
	const baseFont = nodeFont(node);
	const segments = parseRichText(text);
	const broken =
		width > 0
			? breakRichSegments(segments, node, width, baseTextSize)
			: undefined;
	let index = -1;
	for (const segment of segments) {
		index += 1;
		if (segment.kind === "break") {
			inner.appendChild(document.createElement("br"));
			continue;
		}
		const { style } = segment;
		const span = document.createElement("span");
		const s = span.style;
		if (style.bold) s.fontWeight = "bold";
		if (style.weight !== undefined) s.fontWeight = style.weight;
		if (style.italic) s.fontStyle = "italic";
		// One `text-decoration`, so an underlined strikethrough keeps both.
		const lines = [
			style.underline ? "underline" : "",
			style.strike ? "line-through" : "",
		]
			.filter(Boolean)
			.join(" ");
		if (lines !== "") s.textDecoration = lines;
		if (style.uppercase) s.textTransform = "uppercase";
		if (style.smallcaps) s.fontVariant = "small-caps";
		// `<font size>` is a `TextSize` like the label's, so it converts through
		// the metrics of the face *this run* lands in. A run that only changes the
		// family needs it too: it inherits a `font-size` converted for the label's
		// face, which is the wrong number for a face with different metrics.
		const run = runFont(style, baseFont);
		if (style.size !== undefined || run.family !== baseFont.family) {
			s.fontSize = `${cssFontSize(run, style.size ?? baseTextSize)}px`;
		}
		// `family` (a font asset URI) wins over the legacy `face` name, matching
		// how `FontFace` wins over `Font` on the instance itself.
		if (style.family !== undefined) {
			s.fontFamily = fontFamily(familyName(style.family));
		} else if (style.face !== undefined) {
			s.fontFamily = fontFamily(style.face);
			if (style.weight === undefined && !style.bold) {
				s.fontWeight = fontWeight(style.face);
			}
		}
		// A run's own transparency replaces the label's, as in Roblox; a run that
		// only names a color keeps whatever transparency the label had.
		if (style.color !== undefined || style.transparency !== undefined) {
			const transparency = style.transparency ?? baseTransparency;
			s.color =
				style.color !== undefined
					? withAlpha(style.color, 1 - transparency)
					: cssColor(baseColor, transparency);
		}
		span.appendChild(document.createTextNode(broken?.[index] ?? segment.text));
		inner.appendChild(span);
	}
}

/**
 * A CSS color plus an alpha. `color-mix` would be the tidy way, but `opacity`
 * on the span would fade its background too — this only ever touches the text.
 */
function withAlpha(color: string, alpha: number): string {
	if (alpha >= 1) return color;
	const hex = /^#([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(color);
	if (hex) {
		const digits = hex[1] ?? "";
		const full =
			digits.length === 3
				? digits
						.split("")
						.map((d) => d + d)
						.join("")
				: digits;
		const r = Number.parseInt(full.slice(0, 2), 16);
		const g = Number.parseInt(full.slice(2, 4), 16);
		const b = Number.parseInt(full.slice(4, 6), 16);
		return `rgba(${r}, ${g}, ${b}, ${alpha})`;
	}
	const rgb = /^rgb\((.+)\)$/i.exec(color);
	return rgb ? `rgba(${rgb[1]}, ${alpha})` : color;
}

/**
 * Fingerprint of every input `createTextLayer` reads, so the session rebuilds
 * the overlay only when a text-affecting prop actually changed.
 */
function textLayerKey(node: SceneNode, rect: Rect): string {
	if (!TEXT_CLASSES.has(node.className)) return "";
	const text = getText(node);
	if (text === undefined || text === "") return "";
	const font = nodeFont(node);
	// The one number the whole layer is built from, and under `TextScaled` a
	// function of the box: a scaled label that only got shorter paints smaller
	// glyphs with nothing else about it having changed.
	const textSize = effectiveTextSize(node, rect);
	return [
		text,
		// Wrapped text carries its own line breaks now, so a label that only got
		// wider has to be repainted to break in the new places.
		rect.width,
		font.family,
		font.weight,
		font.italic ? 1 : 0,
		textSize,
		// `LineHeight` drives the layer's line spacing and the leading it crops off
		// the outer edges, so a scene that changes only that has to be repainted.
		getLineHeight(node),
		// Metrics, not a property: a face finishing its download changes what the
		// clip rect has to make room for while every prop above stays as it was.
		textBleed(font, textSize),
		cssColor(getTextColor3(node), getTextTransparency(node)),
		getTextWrapped(node) ? 1 : 0,
		// `TextScaled` turns wrapping on by itself, so it changes the paint even
		// where `TextWrapped` and the resolved size both came out the same.
		getTextScaled(node) ? 1 : 0,
		getRichText(node) ? 1 : 0,
		getTextXAlignment(node),
		getTextYAlignment(node),
		getZIndex(node),
	].join(" ");
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

// --- ImageColor3 tinting -----------------------------------------------------

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * Filter ids by tint, keyed on the 8-bit hex so a palette of a dozen icon
 * colors mints a dozen filters no matter how many elements use them. Filters
 * are never removed: they are three attributes each, shared document-wide, and
 * a scene that used a color once is likely to use it again.
 */
const tintFilterIds = new Map<string, string>();
let tintDefs: SVGSVGElement | undefined;

const hex2 = (channel: number): string =>
	Math.round(Math.min(1, Math.max(0, channel)) * 255)
		.toString(16)
		.padStart(2, "0");

/**
 * The SVG filter that multiplies an image by `color`, minted on first use.
 *
 * Roblox `ImageColor3` multiplies the image per channel and leaves alpha alone,
 * which is exactly one `feColorMatrix` — so this is the real operation, not an
 * approximation, and it holds for a full-color image as much as for a
 * monochrome glyph. (A `mask-image` + solid background would only match the
 * glyph case: it throws the image's own RGB away.)
 *
 * `color-interpolation-filters="sRGB"` is load-bearing. SVG filters default to
 * linearRGB, where the same multiply darkens differently than the engine's —
 * a mid-grey tint would come out visibly wrong.
 */
function tintFilterId(color: Color3): string {
	const hex = `${hex2(color.r)}${hex2(color.g)}${hex2(color.b)}`;
	const cached = tintFilterIds.get(hex);
	if (cached !== undefined) return cached;

	const id = `loom-tint-${hex}`;
	if (!tintDefs) {
		tintDefs = document.createElementNS(SVG_NS, "svg");
		tintDefs.setAttribute("aria-hidden", "true");
		// Out of flow and zero-sized: this element only carries <filter> defs.
		tintDefs.style.position = "absolute";
		tintDefs.style.width = "0";
		tintDefs.style.height = "0";
		tintDefs.style.overflow = "hidden";
		document.body.appendChild(tintDefs);
	}
	const filter = document.createElementNS(SVG_NS, "filter");
	filter.setAttribute("id", id);
	filter.setAttribute("color-interpolation-filters", "sRGB");
	const matrix = document.createElementNS(SVG_NS, "feColorMatrix");
	matrix.setAttribute("type", "matrix");
	matrix.setAttribute(
		"values",
		`${color.r} 0 0 0 0 0 ${color.g} 0 0 0 0 0 ${color.b} 0 0 0 0 0 1 0`,
	);
	filter.appendChild(matrix);
	tintDefs.appendChild(filter);
	tintFilterIds.set(hex, id);
	return id;
}

/** Whether a tint would change anything: white multiplies to the identity. */
const isTinted = (color: Color3): boolean =>
	color.r !== 1 || color.g !== 1 || color.b !== 1;

// --- natural size ------------------------------------------------------------

interface ImageSize {
	width: number;
	height: number;
}

/** Resolved URL → the image's own pixel size, once the browser has decoded it. */
const naturalSizes = new Map<string, ImageSize>();
const pendingSizes = new Map<string, Promise<ImageSize | undefined>>();

/**
 * The source image's own pixel size, which a 9-slice and a sprite window are
 * both expressed in: `SliceCenter` is a rectangle in image pixels, so the right
 * and bottom slices are only knowable as `naturalWidth - SliceCenter.Max.X`.
 *
 * Loaded off-DOM, once per URL, and shared by every node using it. A cross-origin
 * image gives up its dimensions without CORS (only its *pixels* are protected),
 * so this works for a Roblox CDN URL exactly as it does for a local one.
 */
function measureImage(url: string): Promise<ImageSize | undefined> {
	const cached = naturalSizes.get(url);
	if (cached) return Promise.resolve(cached);
	const inflight = pendingSizes.get(url);
	if (inflight) return inflight;
	const run = new Promise<ImageSize | undefined>((resolve) => {
		const probe = new Image();
		probe.onload = () => {
			const size = { width: probe.naturalWidth, height: probe.naturalHeight };
			if (size.width > 0 && size.height > 0) {
				naturalSizes.set(url, size);
				resolve(size);
			} else resolve(undefined);
		};
		probe.onerror = () => resolve(undefined);
		probe.src = url;
	}).finally(() => {
		pendingSizes.delete(url);
	});
	pendingSizes.set(url, run);
	return run;
}

/** Exposed for tests; nothing in a running page needs to forget an image size. */
export function clearImageSizeCache(): void {
	naturalSizes.clear();
	pendingSizes.clear();
}

// --- painting ----------------------------------------------------------------

/** `url(...)` with the two characters that could break out of the quotes escaped. */
const cssUrl = (url: string): string =>
	`url("${url.replace(/["\\]/g, "\\$&")}")`;

const px = (n: number): string => `${Math.round(n * 100) / 100}px`;

/**
 * A four-sided CSS value, collapsed to one when every side agrees — which is the
 * usual shape of a 9-slice border, and what a uniform panel should read as.
 */
function sides<T>(top: T, right: T, bottom: T, left: T): string {
	return top === right && right === bottom && bottom === left
		? String(top)
		: `${top} ${right} ${bottom} ${left}`;
}

/** Whether the paint needs the source image's own size before it can be exact. */
function needsNaturalSize(node: SceneNode): boolean {
	return getImageRect(node) !== undefined || getScaleType(node) === "Slice";
}

/** Whether the paint is computed against the node's own box. */
function needsNodeRect(node: SceneNode): boolean {
	return getImageRect(node) !== undefined;
}

let warnedTiledSprite = false;

/**
 * Paint `url` into an image layer: `ScaleType` and the `ImageRect` sprite window
 * become `background-*`, and `Slice` becomes a `border-image`.
 *
 * A background rather than an `<img>` because the sprite window, the tiling and
 * the 9-slice all need to place a *region* of the source, which `object-fit`
 * cannot express — and because CSS then does the arithmetic for the simple
 * cases: `100% 100%` / `contain` / `cover` are `Stretch` / `Fit` / `Crop`
 * exactly, with no measurement needed.
 *
 * `natural` is the source's own size, absent until it has loaded; the caller
 * repaints once it arrives. Without it a sliced or windowed image paints
 * stretched, which is what it looked like before this function could do better.
 */
function paintImage(
	el: HTMLElement,
	node: SceneNode,
	url: string,
	rect: Rect,
	natural: ImageSize | undefined,
): void {
	const s = el.style;
	// Every branch below owns a different subset of these, so clear them all
	// first: a repaint (a resolver answering, a natural size arriving) must not
	// inherit the previous branch's background.
	s.backgroundImage = "";
	s.backgroundSize = "";
	s.backgroundPosition = "";
	s.backgroundRepeat = "";
	s.borderStyle = "";
	s.borderWidth = "";
	s.borderImageSource = "";
	s.borderImageSlice = "";
	s.borderImageWidth = "";
	s.borderImageRepeat = "";
	s.overflow = "";
	el.replaceChildren();

	const scaleType = getScaleType(node);
	const source = cssUrl(url);
	const window = natural ? getImageRect(node) : undefined;

	// 9-slice: the corners keep their own pixel size (times `SliceScale`), the
	// edges stretch along one axis and the middle along both — which is precisely
	// `border-image` with `fill`. `border-width: 0` keeps the slice out of the
	// box model, and `border-image-width` in px then draws it over the padding
	// box, so the node's own size is unchanged by having a border image at all.
	const slice = natural ? sliceInsets(node, natural) : undefined;
	if (scaleType === "Slice" && slice) {
		const scale = Math.max(0, getSliceScale(node));
		s.borderStyle = "solid";
		s.borderWidth = "0";
		s.borderImageSource = source;
		// Unitless slice values are source pixels, which is the unit `SliceCenter`
		// is already in. `fill` keeps the middle region painted — without it the
		// centre of every sliced panel would be a hole.
		s.borderImageSlice = `${sides(slice.top, slice.right, slice.bottom, slice.left)} fill`;
		s.borderImageWidth = sides(
			px(slice.top * scale),
			px(slice.right * scale),
			px(slice.bottom * scale),
			px(slice.left * scale),
		);
		s.borderImageRepeat = "stretch";
		return;
	}

	s.backgroundImage = source;
	s.backgroundRepeat = "no-repeat";

	if (scaleType === "Tile") {
		const tile = getTileSize(node);
		// A UDim per axis, against the node's own size — which CSS can resolve
		// itself, so tiling needs no measurement of anything.
		s.backgroundSize = `calc(${tile.x.scale * 100}% + ${px(tile.x.offset)}) calc(${tile.y.scale * 100}% + ${px(tile.y.offset)})`;
		s.backgroundRepeat = "repeat";
		if (window && !warnedTiledSprite) {
			warnedTiledSprite = true;
			console.warn(
				`loom: ${node.className} "${node.name}" tiles an ImageRect window, ` +
					"which CSS backgrounds cannot crop — the whole image is tiled instead.",
			);
		}
		return;
	}

	if (!window || !natural) {
		s.backgroundSize =
			scaleType === "Fit"
				? "contain"
				: scaleType === "Crop"
					? "cover"
					: "100% 100%";
		s.backgroundPosition = "center";
		return;
	}

	// A sprite window, in two nested elements: an empty box the size the fit gives
	// the window, and the whole scaled sheet inside it, slid so the window's own
	// corner lands on that box's.
	//
	// A background cannot be cropped to a region — it paints the whole image
	// wherever it is put — so the neighbours of a sprite in a sheet would spill
	// across the node. The box clips them, and it has to be the *window's* box
	// rather than the node's: under `Fit` the window covers only part of the node,
	// and clipping to the node would leave the rest of the sheet on show.
	const fit =
		scaleType === "Fit"
			? Math.min(rect.width / window.size.x, rect.height / window.size.y)
			: scaleType === "Crop"
				? Math.max(rect.width / window.size.x, rect.height / window.size.y)
				: 0;
	const [scaleX, scaleY] =
		fit > 0
			? [fit, fit]
			: [rect.width / window.size.x, rect.height / window.size.y];
	// Fit and Crop centre what they leave over, as `contain`/`cover` do.
	const dx = (rect.width - window.size.x * scaleX) / 2;
	const dy = (rect.height - window.size.y * scaleY) / 2;
	s.backgroundImage = "";
	const box = document.createElement("div");
	const clip = box.style;
	clip.position = "absolute";
	clip.overflow = "hidden";
	clip.left = px(dx);
	clip.top = px(dy);
	clip.width = px(window.size.x * scaleX);
	clip.height = px(window.size.y * scaleY);
	const sheet = document.createElement("div");
	const inner = sheet.style;
	inner.position = "absolute";
	inner.backgroundImage = source;
	inner.backgroundRepeat = "no-repeat";
	inner.backgroundSize = "100% 100%";
	inner.width = px(natural.width * scaleX);
	inner.height = px(natural.height * scaleY);
	inner.left = px(-window.offset.x * scaleX);
	inner.top = px(-window.offset.y * scaleY);
	box.appendChild(sheet);
	el.appendChild(box);
}

/**
 * `SliceCenter` → the four `border-image-slice` insets, in source pixels.
 *
 * `undefined` when the rectangle says nothing usable — the default
 * `Rect.new(0, 0, 0, 0)` included. An empty centre would make the whole image a
 * border, which is not what a tree that never set `SliceCenter` is asking for;
 * the engine's own answer there is indistinguishable from a stretch.
 */
function sliceInsets(
	node: SceneNode,
	natural: ImageSize,
): { top: number; right: number; bottom: number; left: number } | undefined {
	const center = getSliceCenter(node);
	if (!center) return undefined;
	const left = Math.max(0, Math.min(center.min.x, natural.width));
	const top = Math.max(0, Math.min(center.min.y, natural.height));
	const right = Math.max(
		0,
		natural.width - Math.min(center.max.x, natural.width),
	);
	const bottom = Math.max(
		0,
		natural.height - Math.min(center.max.y, natural.height),
	);
	if (left + right >= natural.width || top + bottom >= natural.height) {
		return undefined;
	}
	return { top, right, bottom, left };
}

/**
 * Build an image class's `Image` layer, or `undefined` when there is none.
 *
 * Deferred (documented): tiling a sprite window (see the warning in
 * {@link paintImage}), and `SliceCenter` measured against a sprite window rather
 * than the whole image.
 */
function createImageLayer(
	node: SceneNode,
	rect: Rect,
): HTMLElement | undefined {
	if (!IMAGE_CLASSES.has(node.className)) return undefined;
	const image = getImage(node);
	if (image === undefined || image === "") return undefined;

	const el = document.createElement("div");
	// A background-painted div rather than an `<img>`: it is decorative either
	// way (a Roblox image carries no accessible name), and the marker keeps the
	// layer findable now that it is no longer the only `<img>` in the tree.
	el.setAttribute("aria-hidden", "true");
	el.dataset.loomLayer = "image";
	const s = el.style;
	s.position = "absolute";
	s.inset = "0";
	s.pointerEvents = "none";
	s.zIndex = String(getZIndex(node)); // shares the unified ZIndex space
	const transparency = getImageTransparency(node);
	if (transparency > 0) s.opacity = String(Math.max(0, 1 - transparency));
	const tint = getImageColor3(node);
	if (isTinted(tint)) s.filter = `url(#${tintFilterId(tint)})`;
	// `Pixelated` is the engine's own opt-out of smoothing when an image is
	// scaled up — pixel art, and every UI built on a 1px-per-texel sheet.
	if (getResampleMode(node) === "Pixelated") s.imageRendering = "pixelated";

	const known = directImageUrl(image) ?? resolvedImages.get(image);
	if (known !== undefined) startPaint(el, node, known, rect);
	else {
		// Unresolved: paint the empty layer now and fill it in when the resolver
		// answers. The element may be detached by then, which is harmless.
		void resolveImage(image).then((url) => {
			if (url !== undefined) startPaint(el, node, url, rect);
		});
	}
	return el;
}

/** Paint now, and again once the source's own size is known (when it matters). */
function startPaint(
	el: HTMLElement,
	node: SceneNode,
	url: string,
	rect: Rect,
): void {
	const natural = naturalSizes.get(url);
	paintImage(el, node, url, rect, natural);
	if (natural === undefined && needsNaturalSize(node)) {
		void measureImage(url).then((size) => {
			if (size) paintImage(el, node, url, rect, size);
		});
	}
}

/**
 * Fingerprint of every input `createImageLayer` reads, so the session rebuilds
 * the layer only when an image-affecting prop actually changed.
 *
 * The node's own size is part of it only for the paints that read it — a sprite
 * window resolves against the box in pixels, while a plain stretch, a tile and a
 * 9-slice are all expressed in CSS relative units and survive a resize untouched.
 */
function imageLayerKey(node: SceneNode, rect: Rect): string {
	if (!IMAGE_CLASSES.has(node.className)) return "";
	const image = getImage(node);
	if (image === undefined || image === "") return "";
	const tint = getImageColor3(node);
	const window = getImageRect(node);
	const center = getSliceCenter(node);
	const tile = getTileSize(node);
	return [
		image,
		getScaleType(node),
		getImageTransparency(node),
		getZIndex(node),
		`${tint.r},${tint.g},${tint.b}`,
		getResampleMode(node),
		window
			? `${window.offset.x},${window.offset.y},${window.size.x},${window.size.y}`
			: "",
		center
			? `${center.min.x},${center.min.y},${center.max.x},${center.max.y}`
			: "",
		getSliceScale(node),
		`${tile.x.scale},${tile.x.offset},${tile.y.scale},${tile.y.offset}`,
		needsNodeRect(node) ? `${rect.width}x${rect.height}` : "",
	].join(" ");
}

// --- keyboard mapping --------------------------------------------------------

/**
 * `KeyboardEvent.code` -> `Enum.KeyCode`.
 *
 * Keyed off `code`, never `key`: `code` names the *physical* key by its US-QWERTY
 * position and does not move when the OS layout does, which is exactly what
 * `Enum.KeyCode` is. On an AZERTY keyboard Roblox still calls the key left of Z
 * `Enum.KeyCode.A` and still walks a character forward with W — reading `key`
 * would have handed WASD movement to ZQSD and broken every keyboard-driven
 * scene the moment its author changed layout. It is also why the letters are
 * built from a loop over `KeyA`…`KeyZ` rather than from what was typed.
 *
 * Left unmapped, and so `Unknown` rather than guessed at: `IntlBackslash`,
 * `IntlRo`, `IntlYen` and the other layout-specific keys (the engine has no
 * item for the physical key, only for the character it produces on one layout),
 * the media/browser keys, and `F16`+ — `Enum.KeyCode` stops at `F15`.
 */
const KEY_CODE_MAP: Record<string, EnumItem<"KeyCode">> = (() => {
	const map: Record<string, EnumItem<"KeyCode">> = {
		Space: Enum.KeyCode.Space,
		Enter: Enum.KeyCode.Return,
		Escape: Enum.KeyCode.Escape,
		Tab: Enum.KeyCode.Tab,
		Backspace: Enum.KeyCode.Backspace,
		Delete: Enum.KeyCode.Delete,
		Insert: Enum.KeyCode.Insert,
		ArrowUp: Enum.KeyCode.Up,
		ArrowDown: Enum.KeyCode.Down,
		ArrowLeft: Enum.KeyCode.Left,
		ArrowRight: Enum.KeyCode.Right,
		Home: Enum.KeyCode.Home,
		End: Enum.KeyCode.End,
		PageUp: Enum.KeyCode.PageUp,
		PageDown: Enum.KeyCode.PageDown,
		// The punctuation keys, named for where they sit on a US board — the same
		// convention `code` uses and the same one the engine's items follow.
		Minus: Enum.KeyCode.Minus,
		Equal: Enum.KeyCode.Equals,
		BracketLeft: Enum.KeyCode.LeftBracket,
		BracketRight: Enum.KeyCode.RightBracket,
		Backslash: Enum.KeyCode.BackSlash,
		Semicolon: Enum.KeyCode.Semicolon,
		Quote: Enum.KeyCode.Quote,
		Backquote: Enum.KeyCode.Backquote,
		Comma: Enum.KeyCode.Comma,
		Period: Enum.KeyCode.Period,
		Slash: Enum.KeyCode.Slash,
		// Modifiers. The engine tells left from right, so `code` has to as well —
		// a shortcut bound to `LeftControl` must not fire on the right one.
		ShiftLeft: Enum.KeyCode.LeftShift,
		ShiftRight: Enum.KeyCode.RightShift,
		ControlLeft: Enum.KeyCode.LeftControl,
		ControlRight: Enum.KeyCode.RightControl,
		AltLeft: Enum.KeyCode.LeftAlt,
		AltRight: Enum.KeyCode.RightAlt,
		// Command on a Mac, the Windows key elsewhere; `Meta` in both engines.
		MetaLeft: Enum.KeyCode.LeftMeta,
		MetaRight: Enum.KeyCode.RightMeta,
		CapsLock: Enum.KeyCode.CapsLock,
		NumLock: Enum.KeyCode.NumLock,
		ScrollLock: Enum.KeyCode.ScrollLock,
		ContextMenu: Enum.KeyCode.Menu,
		PrintScreen: Enum.KeyCode.Print,
		Pause: Enum.KeyCode.Pause,
		Help: Enum.KeyCode.Help,
		// The keypad is a separate block in the engine, all the way down to its
		// own Enter — `NumpadEnter` is `KeypadEnter`, not `Return`.
		NumpadDecimal: Enum.KeyCode.KeypadPeriod,
		NumpadDivide: Enum.KeyCode.KeypadDivide,
		NumpadMultiply: Enum.KeyCode.KeypadMultiply,
		NumpadSubtract: Enum.KeyCode.KeypadMinus,
		NumpadAdd: Enum.KeyCode.KeypadPlus,
		NumpadEnter: Enum.KeyCode.KeypadEnter,
		NumpadEqual: Enum.KeyCode.KeypadEquals,
	};
	// Written out rather than indexed by a computed name: `Enum.KeyCode` also
	// carries `GetEnumItems`/`FromName`/`FromValue`, so a `keyof` index is a
	// union of items *and* methods and no longer types as one item.
	const LETTERS = [
		Enum.KeyCode.A,
		Enum.KeyCode.B,
		Enum.KeyCode.C,
		Enum.KeyCode.D,
		Enum.KeyCode.E,
		Enum.KeyCode.F,
		Enum.KeyCode.G,
		Enum.KeyCode.H,
		Enum.KeyCode.I,
		Enum.KeyCode.J,
		Enum.KeyCode.K,
		Enum.KeyCode.L,
		Enum.KeyCode.M,
		Enum.KeyCode.N,
		Enum.KeyCode.O,
		Enum.KeyCode.P,
		Enum.KeyCode.Q,
		Enum.KeyCode.R,
		Enum.KeyCode.S,
		Enum.KeyCode.T,
		Enum.KeyCode.U,
		Enum.KeyCode.V,
		Enum.KeyCode.W,
		Enum.KeyCode.X,
		Enum.KeyCode.Y,
		Enum.KeyCode.Z,
	];
	for (let i = 0; i < LETTERS.length; i += 1) {
		const item = LETTERS[i];
		if (item) map[`Key${String.fromCharCode(65 + i)}`] = item;
	}
	// The digit row and the keypad, in step: `Digit3` is `Three`, `Numpad3` is
	// `KeypadThree`, and the engine keeps the two apart.
	const DIGITS: readonly [EnumItem<"KeyCode">, EnumItem<"KeyCode">][] = [
		[Enum.KeyCode.Zero, Enum.KeyCode.KeypadZero],
		[Enum.KeyCode.One, Enum.KeyCode.KeypadOne],
		[Enum.KeyCode.Two, Enum.KeyCode.KeypadTwo],
		[Enum.KeyCode.Three, Enum.KeyCode.KeypadThree],
		[Enum.KeyCode.Four, Enum.KeyCode.KeypadFour],
		[Enum.KeyCode.Five, Enum.KeyCode.KeypadFive],
		[Enum.KeyCode.Six, Enum.KeyCode.KeypadSix],
		[Enum.KeyCode.Seven, Enum.KeyCode.KeypadSeven],
		[Enum.KeyCode.Eight, Enum.KeyCode.KeypadEight],
		[Enum.KeyCode.Nine, Enum.KeyCode.KeypadNine],
	];
	for (let i = 0; i < DIGITS.length; i += 1) {
		const pair = DIGITS[i];
		if (!pair) continue;
		map[`Digit${i}`] = pair[0];
		map[`Numpad${i}`] = pair[1];
	}
	// `Enum.KeyCode` stops at F15; F16-F24 exist in the DOM and stay `Unknown`.
	const FUNCTION_KEYS = [
		Enum.KeyCode.F1,
		Enum.KeyCode.F2,
		Enum.KeyCode.F3,
		Enum.KeyCode.F4,
		Enum.KeyCode.F5,
		Enum.KeyCode.F6,
		Enum.KeyCode.F7,
		Enum.KeyCode.F8,
		Enum.KeyCode.F9,
		Enum.KeyCode.F10,
		Enum.KeyCode.F11,
		Enum.KeyCode.F12,
		Enum.KeyCode.F13,
		Enum.KeyCode.F14,
		Enum.KeyCode.F15,
	];
	for (let i = 0; i < FUNCTION_KEYS.length; i += 1) {
		const item = FUNCTION_KEYS[i];
		if (item) map[`F${i + 1}`] = item;
	}
	return map;
})();

/**
 * Map a DOM keyboard event to the Roblox KeyCode it represents; a key the
 * engine has no item for reads `Unknown`, which is what an `InputObject` that
 * carries no key says anyway.
 */
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
 *
 * `size` is what the box is *painted* at, which is `TextSize` right up until
 * `TextScaled` takes over and picks its own — and a `TextBounds` measured at a
 * size the input is not wearing is a lie the auto-resize would size against.
 */
function updateTextBounds(
	inst: LoomInstance,
	text: string,
	size: number,
): void {
	const ctx = getTextMeasureCtx();
	if (!ctx) return;
	ctx.font = fontShorthand(instanceFont(inst), size);
	const lines = text.split("\n");
	let width = 0;
	for (const line of lines) {
		width = Math.max(width, shapedTextWidth(ctx, line));
	}
	const w = width;
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
	/**
	 * The size the input is painted at, which `TextScaled` makes a function of
	 * the node's box rather than of `TextSize`. Kept current by `patchTextBox`
	 * so the keystroke path can re-measure `TextBounds` without a layout rect.
	 */
	textSize: number;
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
	textSize: number,
): TextBoxBinding {
	const el = document.createElement(multiLine ? "textarea" : "input");
	const initialText = typeof inst.Text === "string" ? inst.Text : "";
	el.value = initialText;

	const binding: TextBoxBinding = {
		el,
		inst,
		multiLine,
		styleKey: "",
		textSize,
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
		updateTextBounds(inst, el.value, binding.textSize);
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
		// The keypad's Enter is its own `Enum.KeyCode` in the engine, but it is the
		// same key to anyone typing into a single-line box: both submit.
		const keyCode = keyCodeFromKeyboardEvent(e as KeyboardEvent);
		if (
			!multiLine &&
			(keyCode === Enum.KeyCode.Return || keyCode === Enum.KeyCode.KeypadEnter)
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

	updateTextBounds(inst, initialText, textSize);
	return binding;
}

/**
 * Inline style for the TextBox input element: full-size absolute overlay, no
 * chrome (transparent background, no border/outline), and the same font
 * mapping the text overlay layer uses — the input IS the text layer here.
 */
function applyTextBoxStyle(
	s: CSSStyleDeclaration,
	node: SceneNode,
	rect: Rect,
): void {
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
	s.fontSize = `${cssFontSize(font, effectiveTextSize(node, rect))}px`;
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
	const imageLayer = createImageLayer(node, rect);
	if (imageLayer) el.appendChild(imageLayer);

	const textLayer = createTextLayer(node, rect);
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

	// Scroll bars last: they sit over the canvas, not inside it.
	if (node.className === "ScrollingFrame") {
		const bars = createScrollBarLayer(
			node,
			rect,
			frameMetrics(node, rect, positionalPath, layout),
		);
		if (bars) el.appendChild(bars);
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
	imageEl: HTMLElement | undefined;
	styleKey: string;
	textKey: string;
	imageKey: string;
	/** Present only on TextBox nodes: the persistent input element. */
	input: TextBoxBinding | undefined;
	/** Present only on ScrollingFrame nodes: the -CanvasPosition child wrapper. */
	canvas: HTMLDivElement | undefined;
	/** Present only on a ScrollingFrame that has something to scroll. */
	scrollBars: HTMLDivElement | undefined;
	scrollBarKey: string;
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
 * - `MouseButton1Click`/`MouseButton2Click` → `()` (GuiButton classes only)
 * - `MouseButton1Down`/`Up`, `MouseButton2Down`/`Up` → `(x, y)` (GuiButton only)
 * - `MouseEnter`/`MouseLeave`/`MouseMoved` → `(x, y)` in mount-relative pixels
 * - `MouseWheelForward`/`MouseWheelBackward` → `(x, y)`
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
		rect: Rect,
	): void {
		const inst = options.resolveInstance(id);
		const multiLine = asBool(node.properties?.MultiLine) === true;
		const textSize = effectiveTextSize(node, rect);
		if (
			entry.input &&
			(entry.input.inst !== inst || entry.input.multiLine !== multiLine)
		) {
			entry.input.dispose();
			entry.input = undefined;
		}
		if (!entry.input && inst) {
			entry.input = createTextBoxBinding(inst, multiLine, textSize);
		}
		const binding = entry.input;
		if (!binding) return;
		const el = binding.el;

		// A `TextScaled` box re-fits itself whenever its rect moves, so the size the
		// keystroke path measures against has to follow the layout, not the props.
		const resized = binding.textSize !== textSize;
		binding.textSize = textSize;

		// Echo guard: only write `value` when the prop actually differs (an
		// external `Text` write) — a matching value means the change originated
		// from this input, and rewriting it would clobber the caret mid-typing.
		const text = getText(node) ?? "";
		if (!binding.applying && el.value !== text) {
			el.value = text;
			updateTextBounds(binding.inst, text, textSize);
		} else if (resized) {
			updateTextBounds(binding.inst, el.value, textSize);
		}
		const placeholder = asString(node.properties?.PlaceholderText) ?? "";
		if (el.placeholder !== placeholder) el.placeholder = placeholder;
		const readOnly = asBool(node.properties?.TextEditable) === false;
		if (el.readOnly !== readOnly) el.readOnly = readOnly;

		scratch.style.cssText = "";
		applyTextBoxStyle(scratch.style, node, rect);
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
				scrollBars: undefined,
				scrollBarKey: "",
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

		// Hit-testability, decided against the *live* instance and therefore after
		// the cached style string. Roblox raises a GuiObject's own input events
		// whether or not it is `Active` — `Active` governs whether the input is
		// *sunk*, not whether the object hears it — so a plain Frame that listens
		// for `InputBegan` (a slider handle, say) must be reachable by the pointer.
		// Frames with no listeners stay click-through, which is what keeps a
		// transparent full-screen positioning layer from swallowing the clicks
		// meant for what is underneath it.
		const pointerEvents =
			sinksPointerInput(node) ||
			hasAnyEventConnection(options.resolveInstance(id), POINTER_EVENT_NAMES)
				? "auto"
				: "none";
		if (el.style.pointerEvents !== pointerEvents) {
			el.style.pointerEvents = pointerEvents;
		}

		const imageKey = imageLayerKey(node, rect);
		if (imageKey !== entry.imageKey) {
			entry.imageEl?.remove();
			entry.imageEl =
				imageKey === "" ? undefined : createImageLayer(node, rect);
			entry.imageKey = imageKey;
		}

		// TextBox paints its text in a persistent input element, not the overlay.
		const isTextBox = node.className === "TextBox";
		const textKey = isTextBox ? "" : textLayerKey(node, rect);
		if (textKey !== entry.textKey) {
			entry.textEl?.remove();
			entry.textEl = textKey === "" ? undefined : createTextLayer(node, rect);
			entry.textKey = textKey;
		}

		if (isTextBox) patchTextBox(entry, node, id, rect);
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
			// The bars are geometry, not identity: rebuilt (cheaply, two divs at
			// most) whenever the thumb they describe moved or resized.
			const metrics = frameMetrics(node, rect, positionalPath, layout);
			const barKey = scrollBarKey(node, rect, metrics);
			if (barKey !== entry.scrollBarKey) {
				entry.scrollBars?.remove();
				entry.scrollBars =
					barKey === "" ? undefined : createScrollBarLayer(node, rect, metrics);
				entry.scrollBarKey = barKey;
			}
		} else if (entry.canvas) {
			entry.canvas.remove();
			entry.canvas = undefined;
			entry.scrollBars?.remove();
			entry.scrollBars = undefined;
			entry.scrollBarKey = "";
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
			syncChildren(
				el,
				entry.scrollBars
					? [...overlays, entry.canvas, entry.scrollBars]
					: [...overlays, entry.canvas],
			);
		} else {
			syncChildren(el, [...overlays, ...children]);
		}
		return el;
	}

	// --- input delegation ------------------------------------------------------

	/**
	 * On-screen pixels per layout pixel.
	 *
	 * The host may scale the whole mount down to fit a small screen (that is what
	 * the preview's `?base=` does: keep a wide logical viewport and paint it
	 * small — see `@loom-dev/preview`'s `viewport.ts`). Rects, and
	 * therefore everything Roblox reports as a position, live in the mount's
	 * *untransformed* layout space, while pointer events arrive in on-screen
	 * pixels. `getBoundingClientRect()` reflects CSS transforms and `offsetWidth`
	 * does not, so their ratio is exactly the factor between the two — with no
	 * knowledge of who applied the transform or how.
	 */
	function mountScale(renderedWidth: number): number {
		const layoutWidth = mount.offsetWidth;
		if (!(layoutWidth > 0) || !(renderedWidth > 0)) return 1;
		return renderedWidth / layoutWidth;
	}

	/** Pointer position relative to the mount's top-left (= layout rect space). */
	function relPoint(e: MouseEvent): { x: number; y: number } {
		const bounds = mount.getBoundingClientRect();
		const scale = mountScale(bounds.width);
		return {
			x: (e.clientX - bounds.left) / scale,
			y: (e.clientY - bounds.top) / scale,
		};
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

	/**
	 * Fire `name` on `inst` only if something is listening.
	 *
	 * `getEventSignal` mints the signal on demand, so calling it to dispatch
	 * would leave a live `LoomSignal` on every node the pointer has ever moved
	 * across. These events are per-move and per-chain — this asks first.
	 */
	function fireIfListening(
		inst: LoomInstance,
		name: string,
		...args: unknown[]
	): void {
		if (!hasAnyEventConnection(inst, [name])) return;
		getEventSignal(inst, name).fire(...args);
	}

	/**
	 * The GuiButton a press or release belongs to: the innermost one in the
	 * chain, which is how Roblox routes a click that landed on a button's own
	 * decorative label or icon back to the button itself.
	 */
	function buttonInChain(chain: LoomInstance[]): LoomInstance | undefined {
		return chain.find((inst) => inst.IsA("GuiButton"));
	}

	/**
	 * The `MouseButtonNDown`/`Up`/`Click` family a button reports this input
	 * under, or `undefined` for one it reports none for.
	 *
	 * A touch counts as MouseButton1: the engine drives a GuiButton's whole mouse
	 * family from a tap, which is why a phone can press a button loom's UI never
	 * gave a mouse. The middle button reports nothing — Roblox has no
	 * `MouseButton3Click` on GuiButton, only the raw `InputBegan`.
	 */
	function mouseButtonEventPrefix(
		type: EnumItem<"UserInputType">,
	): string | undefined {
		if (
			type === Enum.UserInputType.MouseButton1 ||
			type === Enum.UserInputType.Touch
		) {
			return "MouseButton1";
		}
		if (type === Enum.UserInputType.MouseButton2) return "MouseButton2";
		return undefined;
	}

	/**
	 * A button that is currently held, and what it was pressed on.
	 *
	 * Per button rather than one `pressed`: the engine tracks each mouse button's
	 * press separately, so a right-press followed by a left-release is two
	 * unrelated halves and must not activate anything. Keyed by the
	 * `UserInputType` name, which is also what `Touch` answers to — a finger is
	 * its own "button" here and gets the same press/release pairing.
	 */
	interface Press {
		/** The innermost instance under the press; absent on empty background. */
		target: LoomInstance | undefined;
		type: EnumItem<"UserInputType">;
	}
	const presses = new Map<string, Press>();
	let hoverChain: LoomInstance[] = [];

	/**
	 * Hand the held-button state back to `UserInputService`.
	 *
	 * A touch is not a mouse button — `IsMouseButtonPressed(MouseButton1)` is
	 * false on a phone in the engine too — so only the real buttons are reported.
	 */
	function reportButtonState(
		type: EnumItem<"UserInputType">,
		down: boolean,
	): void {
		if (type === Enum.UserInputType.Touch) return;
		setMouseButtonState(type, down);
	}

	/** Release every held button, e.g. when the session or the gesture ends. */
	function releasePresses(): void {
		for (const press of presses.values()) reportButtonState(press.type, false);
		presses.clear();
	}

	function onPointerDown(e: PointerEvent): void {
		const input = pointerInput(e, Enum.UserInputState.Begin);
		const { x, y } = relPoint(e);
		const chain = chainFromEvent(e);
		for (const inst of chain) {
			getEventSignal(inst, "InputBegan").fire(input);
		}
		getEventSignal(userInputService(), "InputBegan").fire(input, false);
		reportButtonState(input.UserInputType, true);
		// `MouseButton1Down`/`MouseButton2Down` are the button's own press half,
		// reported in mount-relative pixels the way `MouseEnter` is. Declared in
		// the runtime's event list all along and never once fired, which is the
		// worst state for an event to be in: `:Connect` succeeded, so a control
		// that dimmed itself on press looked wired and simply never dimmed.
		const prefix = mouseButtonEventPrefix(input.UserInputType);
		const button = buttonInChain(chain);
		if (prefix && button) fireIfListening(button, `${prefix}Down`, x, y);
		presses.set(input.UserInputType.Name, {
			target: chain[0],
			type: input.UserInputType,
		});
		// A press that landed on a scroll bar thumb is that thumb's drag, never
		// also the canvas's: the two would scroll the same frame opposite ways.
		if (beginThumbDrag(e, chain)) return;
		beginDragScroll(e, chain);
	}

	function onPointerUp(e: PointerEvent): void {
		const input = pointerInput(e, Enum.UserInputState.End);
		const { x, y } = relPoint(e);
		const chain = chainFromEvent(e);
		for (const inst of chain) {
			getEventSignal(inst, "InputEnded").fire(input);
		}
		reportButtonState(input.UserInputType, false);
		// A touch that turned into a scroll gesture is not a press — the finger
		// left the control — and neither is a drag of the scroll bar thumb.
		const scrolled =
			(drag?.pointerId === e.pointerId && drag.dragged) ||
			(thumb?.pointerId === e.pointerId && thumb.moved);
		if (drag?.pointerId === e.pointerId) drag = undefined;
		if (thumb?.pointerId === e.pointerId) thumb = undefined;
		const press = presses.get(input.UserInputType.Name);
		presses.delete(input.UserInputType.Name);
		const prefix = mouseButtonEventPrefix(input.UserInputType);
		const button = buttonInChain(chain);
		// The release half fires on whatever button the pointer came up over,
		// which is what the engine reports — press and release can be different
		// controls, and `MouseButtonNUp` describes the release, not the pair.
		if (prefix && button) fireIfListening(button, `${prefix}Up`, x, y);
		// The *click* is the pair: same button, pressed and released over the same
		// control, and not swallowed by a scroll. Only a primary press (or a tap)
		// activates a GuiButton in Roblox; a secondary one raises
		// `MouseButton2Click` and no `Activated`.
		const pressedOn = press?.target;
		if (!scrolled && pressedOn && chain.includes(pressedOn)) {
			if (
				input.UserInputType === Enum.UserInputType.MouseButton1 ||
				input.UserInputType === Enum.UserInputType.Touch
			) {
				// Roblox activates the pressed control even when the press landed on a
				// decorative child (label, icon): route to the nearest instance in the
				// chain with an Activated listener, falling back to the pressed one.
				const target =
					chain.find(
						(inst) => getEventSignal(inst, "Activated").hasConnections,
					) ?? pressedOn;
				getEventSignal(target, "Activated").fire(input, 1);
				if (button) getEventSignal(button, "MouseButton1Click").fire();
			} else if (input.UserInputType === Enum.UserInputType.MouseButton2) {
				if (button) fireIfListening(button, "MouseButton2Click");
			}
		}
		// Last, as it always has been: the global service hears the release after
		// the control it landed on has finished reacting to it.
		getEventSignal(userInputService(), "InputEnded").fire(input, false);
	}

	function onPointerMove(e: PointerEvent): void {
		const { x, y } = relPoint(e);
		dragScroll(e, x, y);
		dragThumb(e, x, y);
		setMouseLocation(Vector2.new(x, y));
		// `movementX/Y` are on-screen pixels like `clientX/Y`; Delta is reported
		// in the same space as Position.
		const scale = mountScale(mount.getBoundingClientRect().width);
		const input = makeInputObject({
			UserInputType: Enum.UserInputType.MouseMovement,
			UserInputState: Enum.UserInputState.Change,
			Position: Vector3.new(x, y, 0),
			Delta: Vector3.new(
				(e.movementX || 0) / scale,
				(e.movementY || 0) / scale,
				0,
			),
		});
		const chain = chainFromEvent(e);
		for (const inst of chain) {
			getEventSignal(inst, "InputChanged").fire(input);
			// `GuiObject.MouseMoved(x, y)` — every object the pointer is currently
			// over, the same chain `MouseEnter`/`MouseLeave` bracket and the same
			// mount-relative pixels. Declared but never dispatched until now, which
			// is the worst state for an event to be in: `:Connect` succeeded, so a
			// hover-tracking tooltip looked wired and simply never moved.
			fireIfListening(inst, "MouseMoved", x, y);
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

	// --- wheel / touch drag → ScrollingFrame.CanvasPosition ----------------------

	const clamp = (v: number, min: number, max: number): number =>
		Math.min(max, Math.max(min, v));

	/**
	 * Move `frame`'s canvas by (dx, dy) layout pixels, clamped per axis to
	 * `[0, canvas-window]` (metrics come from the world's post-layout feedback)
	 * and restricted to `ScrollingDirection`. The write goes through the instance
	 * proxy, so `GetPropertyChangedSignal("CanvasPosition")` listeners (lattice's
	 * thumb/metrics) fire and the next flush moves the canvas wrapper. Returns
	 * whether anything actually moved.
	 */
	function scrollFrameBy(frame: LoomInstance, dx: number, dy: number): boolean {
		if (frame.ScrollingEnabled === false) return false;
		const windowSize = frame.AbsoluteWindowSize;
		const canvasSize = frame.AbsoluteCanvasSize;
		const current = frame.CanvasPosition;
		if (
			!(windowSize instanceof Vector2) ||
			!(canvasSize instanceof Vector2) ||
			!(current instanceof Vector2)
		) {
			return false;
		}
		// Roblox default ScrollingDirection is XY; X/Y restrict to one axis.
		const direction =
			(frame.ScrollingDirection as { Name?: string } | undefined)?.Name ?? "XY";
		const nextX =
			direction === "Y"
				? current.X
				: clamp(current.X + dx, 0, Math.max(0, canvasSize.X - windowSize.X));
		const nextY =
			direction === "X"
				? current.Y
				: clamp(current.Y + dy, 0, Math.max(0, canvasSize.Y - windowSize.Y));
		if (nextX === current.X && nextY === current.Y) return false;
		frame.CanvasPosition = Vector2.new(nextX, nextY);
		return true;
	}

	/**
	 * The wheel: an `Enum.UserInputType.MouseWheel` input on `UserInputService`,
	 * `MouseWheelForward`/`MouseWheelBackward` on the objects under the pointer,
	 * and — where there is a ScrollingFrame under it — the scroll itself.
	 *
	 * The engine reports the wheel's direction in the input object's `Position.Z`
	 * as +1 (forward, away from the user) or -1 (backward), which is where every
	 * "zoom on scroll" handler reads it from; there is no pixel delta to report,
	 * so `Position.X/Y` carry the pointer as they do for mouse movement.
	 *
	 * The scroll itself goes to the nearest ScrollingFrame ancestor of the event
	 * target, and `preventDefault` runs only when it actually consumed something.
	 * Wheel deltas are on-screen pixels, canvas positions are layout pixels —
	 * hence the scale division, same as pointer coordinates.
	 */
	function onWheel(e: WheelEvent): void {
		const { x, y } = relPoint(e);
		const chain = chainFromEvent(e);
		// A trackpad's horizontal-only flick has no wheel direction to report; the
		// engine has no item for it either, so only the vertical axis speaks.
		const direction = e.deltaY < 0 ? 1 : e.deltaY > 0 ? -1 : 0;
		if (direction !== 0) {
			const input = makeInputObject({
				UserInputType: Enum.UserInputType.MouseWheel,
				UserInputState: Enum.UserInputState.Change,
				Position: Vector3.new(x, y, direction),
			});
			const name = direction > 0 ? "MouseWheelForward" : "MouseWheelBackward";
			for (const inst of chain) {
				fireIfListening(inst, "InputChanged", input);
				fireIfListening(inst, name, x, y);
			}
			getEventSignal(userInputService(), "InputChanged").fire(input, false);
		}
		const frame = chain.find((inst) => inst.IsA("ScrollingFrame"));
		if (!frame) return;
		const scale = mountScale(mount.getBoundingClientRect().width);
		if (scrollFrameBy(frame, e.deltaX / scale, e.deltaY / scale)) {
			e.preventDefault();
		}
	}

	/**
	 * Touch drag scrolling — the mobile counterpart of the wheel: there is no
	 * wheel on a phone, so without this a ScrollingFrame simply cannot be
	 * scrolled. The frame's element carries `touch-action: none` (see
	 * {@link applyNodeStyle}), so the browser hands the gesture over instead of
	 * panning the page with it; everywhere else in the scene native panning is
	 * left alone, so a preview embedded in a docs page never traps the reader.
	 *
	 * The canvas follows the finger (drag up = content up = canvas position
	 * down), and once the gesture passes {@link DRAG_SLOP} it stops being a tap:
	 * `dragged` suppresses the `Activated`/`MouseButton1Click` that pointerup
	 * would otherwise fire on whatever the finger started on.
	 */
	const DRAG_SLOP = 8;
	interface DragScroll {
		pointerId: number;
		frame: LoomInstance;
		/** Where the gesture started — the slop is measured from here, not per move. */
		startX: number;
		startY: number;
		lastX: number;
		lastY: number;
		dragged: boolean;
	}
	let drag: DragScroll | undefined;

	function beginDragScroll(e: PointerEvent, chain: LoomInstance[]): void {
		if (e.pointerType !== "touch") return;
		const frame = chain.find((inst) => inst.IsA("ScrollingFrame"));
		if (!frame || frame.ScrollingEnabled === false) return;
		const { x, y } = relPoint(e);
		drag = {
			pointerId: e.pointerId,
			frame,
			startX: x,
			startY: y,
			lastX: x,
			lastY: y,
			dragged: false,
		};
	}

	function dragScroll(e: PointerEvent, x: number, y: number): void {
		if (!drag || drag.pointerId !== e.pointerId) return;
		const dx = drag.lastX - x;
		const dy = drag.lastY - y;
		drag.lastX = x;
		drag.lastY = y;
		if (
			!drag.dragged &&
			Math.hypot(x - drag.startX, y - drag.startY) >= DRAG_SLOP
		) {
			drag.dragged = true;
		}
		scrollFrameBy(drag.frame, dx, dy);
	}

	// --- scroll bar thumb drag ---------------------------------------------------

	/**
	 * A grab on a scroll bar thumb (`data-loom-scrollbar`, painted by
	 * {@link createScrollBarLayer}). The canvas follows the thumb, not the
	 * pointer: the ratio is how many canvas pixels one thumb pixel is worth, and
	 * the position is mapped from where the grab started rather than accumulated
	 * per move, so a pointer that runs off the end of the track and comes back
	 * lands where the thumb would be.
	 */
	interface ThumbDrag {
		pointerId: number;
		frame: LoomInstance;
		axis: "X" | "Y";
		/** Pointer coordinate on the dragged axis when the thumb was grabbed. */
		origin: number;
		/** `CanvasPosition` on that axis at the same moment. */
		originCanvas: number;
		/** Canvas pixels per thumb pixel. */
		ratio: number;
		moved: boolean;
	}
	let thumb: ThumbDrag | undefined;

	function beginThumbDrag(e: PointerEvent, chain: LoomInstance[]): boolean {
		const target = e.target;
		if (!(target instanceof HTMLElement)) return false;
		const el = target.closest<HTMLElement>("[data-loom-scrollbar]");
		const axis = el?.dataset.loomScrollbar;
		if (!el || (axis !== "X" && axis !== "Y")) return false;
		const frame = chain.find((inst) => inst.IsA("ScrollingFrame"));
		if (!frame || frame.ScrollingEnabled === false) return false;
		const current = frame.CanvasPosition;
		if (!(current instanceof Vector2)) return false;
		const vertical = axis === "Y";
		const { x, y } = relPoint(e);
		thumb = {
			pointerId: e.pointerId,
			frame,
			axis,
			origin: vertical ? y : x,
			originCanvas: vertical ? current.Y : current.X,
			ratio: Number(el.dataset.loomScrollRatio) || 0,
			moved: false,
		};
		// Keep the moves coming once the pointer leaves the thumb — a drag that
		// slips sideways off a 12px bar must not stop scrolling. The capture goes
		// on the frame's element, not the thumb: every scroll repaints the bar,
		// and capture dies with the element it was taken on.
		const frameEl = el.closest<HTMLElement>("[data-loom-id]");
		frameEl?.setPointerCapture?.(e.pointerId);
		// A press that starts a drag is not the start of a text selection — the
		// engine has no such thing, and the browser would otherwise paint the
		// canvas blue as the pointer sweeps over it.
		e.preventDefault();
		return true;
	}

	function dragThumb(e: PointerEvent, x: number, y: number): void {
		if (!thumb || thumb.pointerId !== e.pointerId) return;
		const vertical = thumb.axis === "Y";
		const current = thumb.frame.CanvasPosition;
		if (!(current instanceof Vector2)) return;
		const target =
			thumb.originCanvas + ((vertical ? y : x) - thumb.origin) * thumb.ratio;
		const delta = target - (vertical ? current.Y : current.X);
		if (delta === 0) return;
		if (
			scrollFrameBy(thumb.frame, vertical ? 0 : delta, vertical ? delta : 0)
		) {
			thumb.moved = true;
		}
	}

	// --- keyboard delegation ---------------------------------------------------
	// Key events are global (window), mirroring Roblox: UserInputService fires
	// for every key with `gameProcessedEvent = true` while a TextBox is focused.
	// The renderer also owns the held-key state the service answers
	// `IsKeyDown`/`GetKeysPressed` from — it reports every transition through
	// `setKeyState`, and the service side never touches the DOM. That split is
	// the contract in `@loom-dev/runtime`'s `services.ts`.
	//
	// Element-level routing: keys additionally fire InputBegan/InputEnded on the
	// GuiService.SelectedObject instance (Roblox's selection-focused key routing,
	// and what lattice item components — tabs/radio-group/… — listen for) and on
	// the focused TextBox, which is the object the engine considers the keys to
	// be landing on while someone is typing into it. Neither routes to ancestors:
	// GuiObject input events do not bubble in the engine, and for a key there is
	// no geometry that would put a parent "under" the input the way a pointer
	// does.

	function keyInput(
		keyCode: EnumItem<"KeyCode">,
		state: EnumItem<"UserInputState">,
	): InputObject {
		return makeInputObject({
			UserInputType: Enum.UserInputType.Keyboard,
			UserInputState: state,
			KeyCode: keyCode,
		});
	}

	function selectedInstance(): LoomInstance | undefined {
		return getService("GuiService").SelectedObject as LoomInstance | undefined;
	}

	/** The GuiObjects a key is routed to, at most two and never duplicated. */
	function keyTargets(): LoomInstance[] {
		const targets: LoomInstance[] = [];
		const selected = selectedInstance();
		if (selected) targets.push(selected);
		const focused = getFocusedTextBox();
		if (focused && focused !== selected) targets.push(focused);
		return targets;
	}

	function onKeyDown(e: KeyboardEvent): void {
		const keyCode = keyCodeFromKeyboardEvent(e);
		const textBoxFocused = getFocusedTextBox() !== undefined;
		// The OS repeating a held key is not a second press, and the engine raises
		// no second `InputBegan` for it — a held movement key begins once and ends
		// once. `preventDefault` below still runs on the repeats: a held arrow that
		// stopped being swallowed halfway through would start scrolling the page.
		if (!e.repeat) {
			setKeyState(keyCode, true);
			const input = keyInput(keyCode, Enum.UserInputState.Begin);
			for (const inst of keyTargets()) {
				getEventSignal(inst, "InputBegan").fire(input);
			}
			getEventSignal(userInputService(), "InputBegan").fire(
				input,
				textBoxFocused,
			);
		}
		// Keep the page from scrolling under selection-driven Space/arrow input,
		// but never swallow keys while the user is typing in a TextBox.
		if (
			!textBoxFocused &&
			selectedInstance() &&
			(keyCode === Enum.KeyCode.Space || ARROW_KEY_CODES.has(keyCode))
		) {
			e.preventDefault();
		}
	}

	function onKeyUp(e: KeyboardEvent): void {
		const keyCode = keyCodeFromKeyboardEvent(e);
		setKeyState(keyCode, false);
		const input = keyInput(keyCode, Enum.UserInputState.End);
		for (const inst of keyTargets()) {
			getEventSignal(inst, "InputEnded").fire(input);
		}
		getEventSignal(userInputService(), "InputEnded").fire(
			input,
			getFocusedTextBox() !== undefined,
		);
	}

	/**
	 * Focus left the page. A browser stops delivering `keyup` the moment it does,
	 * so a key held through an alt-tab would read as held forever — the classic
	 * stuck-movement-key bug, which in a preview looks like loom is broken rather
	 * than like the tab changed. Same for a button held while a native drag or an
	 * OS window steals the pointer.
	 */
	function onWindowBlur(): void {
		clearInputState();
		presses.clear();
	}

	/**
	 * A right-click inside the scene belongs to the scene: Roblox has no browser
	 * context menu, and leaving the native one up would cover whatever the
	 * secondary click just opened.
	 */
	function onContextMenu(e: MouseEvent): void {
		e.preventDefault();
	}

	/** A cancelled gesture (browser took it over, finger left the surface). */
	function onPointerCancel(e: PointerEvent): void {
		if (drag?.pointerId === e.pointerId) drag = undefined;
		if (thumb?.pointerId === e.pointerId) thumb = undefined;
		// No `pointerup` is coming, so the press has to be retired here or the
		// button reads as held for the rest of the session.
		releasePresses();
	}

	// Roblox has no double-tap zoom; without this every tap on a phone waits
	// ~300ms for a second one before the scene sees it. Panning and pinch-zoom
	// stay native (a preview embedded in a docs page must not trap the reader) —
	// only ScrollingFrames opt out, so their drag scrolls the canvas instead.
	mount.style.touchAction = "manipulation";
	mount.addEventListener("contextmenu", onContextMenu);
	mount.addEventListener("pointerdown", onPointerDown);
	mount.addEventListener("pointercancel", onPointerCancel);
	mount.addEventListener("pointerup", onPointerUp);
	mount.addEventListener("pointermove", onPointerMove);
	mount.addEventListener("pointerover", onPointerOver);
	mount.addEventListener("pointerout", onPointerOut);
	// passive:false — the handler preventDefaults consumed scrolls so the page
	// doesn't scroll underneath a scrolling frame.
	mount.addEventListener("wheel", onWheel, { passive: false });
	window.addEventListener("keydown", onKeyDown);
	window.addEventListener("keyup", onKeyUp);
	window.addEventListener("blur", onWindowBlur);

	function removeEntry(entry: SessionEntry): void {
		entry.input?.dispose();
		entry.input = undefined;
		entry.el.remove();
	}

	function clear(): void {
		for (const entry of entries.values()) removeEntry(entry);
		entries.clear();
		releasePresses();
		drag = undefined;
		thumb = undefined;
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
			mount.removeEventListener("pointercancel", onPointerCancel);
			mount.removeEventListener("pointerup", onPointerUp);
			mount.removeEventListener("pointermove", onPointerMove);
			mount.removeEventListener("pointerover", onPointerOver);
			mount.removeEventListener("pointerout", onPointerOut);
			mount.removeEventListener("wheel", onWheel);
			window.removeEventListener("keydown", onKeyDown);
			window.removeEventListener("keyup", onKeyUp);
			window.removeEventListener("blur", onWindowBlur);
			// The session owned the held-key state; a re-mount must not inherit a
			// key that was down when the old one went away.
			clearInputState();
			clear();
		},
	};
}
