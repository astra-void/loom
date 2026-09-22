/// <reference path="./react-reconciler.d.ts" />
/**
 * `@loom-dev/react` — a custom React renderer for Roblox UI.
 *
 * A `react-reconciler` host config that creates and mutates live
 * `LoomInstance`s (the runtime's Proxy-based instance tree). React commits
 * mutate the instance tree; `resetAfterCommit` flushes the world synchronously
 * (encode → WASM layout → incremental DOM patch → layout feedback). Direct
 * property writes outside React (motion code via refs) mark instances dirty and
 * flush on the next scheduler frame through the same pipeline. `Event`/`Change`
 * props connect real signals, so the DOM session's input dispatch reaches app
 * handlers with Roblox `(rbx, ...args)` calling convention.
 */
import {
	initLayout,
	computeLayout as wasmComputeLayout,
} from "@loom-dev/layout";
import {
	createDomSession,
	type DomSession,
	fontShorthand,
	instanceFont,
	onFontsChanged,
	parseRichText,
	type ResolvedFont,
	type RichSegment,
	runFont,
	shapedTextWidth,
} from "@loom-dev/renderer";
import type {
	Color3,
	ColorSequence,
	Font,
	LoomConnection,
	LoomInstance,
	Rect,
	UDim,
	UDim2,
} from "@loom-dev/runtime";
import {
	createInstance as createLoomInstance,
	type EnumItem,
	enumName,
	flushDirtyNow,
	getEventSignal,
	getInternalId,
	getRawProperties,
	getService,
	isLoomInstance,
	markDirty,
	moveChildBefore,
	robloxEquals,
	setFeedbackProperty,
	setFlusher,
	setHitTester,
	setViewportSize,
	toPropertyValue,
	updateAbsoluteGeometry,
	Vector2,
} from "@loom-dev/runtime";
import type { LayoutResult, Viewport } from "@loom-dev/scene";
import {
	asBool,
	childrenOf,
	fontSizeToPx,
	type PropertyValue,
	participatesInLayout,
	prop,
	type SceneNode,
	scrollMetrics,
} from "@loom-dev/scene";
import type { Key, ReactElement, ReactNode, ReactPortal, Ref } from "react";
import Reconciler from "react-reconciler";
import { DefaultEventPriority } from "react-reconciler/constants.js";
import { type Bindable, isBinding } from "./binding.ts";

/**
 * Bindings: values that change outside React (animation, motion code) and are
 * written straight onto the instance instead of re-rendering. Re-exported so
 * `@rbxts/react`'s `useBinding` / `createBinding` and loom's own compatibility
 * shims all reach the same implementation — one `isBinding`, one identity.
 */
export {
	BINDING,
	type Bindable,
	type Binding,
	createBinding,
	isBinding,
	joinBindings,
	useBinding,
} from "./binding.ts";

type Props = Record<string, unknown>;

/** Roblox has no text nodes (text lives in a `Text` prop); these are dropped. */
interface TextInstance {
	readonly isText: true;
}
type HostNode = LoomInstance | TextInstance;
const TEXT_INSTANCE: TextInstance = { isText: true };

// --- host element + prop mapping ---------------------------------------------

// Roblox JSX intrinsics are lowercased class names; map back to real casing.
const CLASS_NAMES: Record<string, string> = {
	screengui: "ScreenGui",
	surfacegui: "SurfaceGui",
	billboardgui: "BillboardGui",
	frame: "Frame",
	scrollingframe: "ScrollingFrame",
	canvasgroup: "CanvasGroup",
	textlabel: "TextLabel",
	textbutton: "TextButton",
	textbox: "TextBox",
	imagelabel: "ImageLabel",
	imagebutton: "ImageButton",
	viewportframe: "ViewportFrame",
	videoframe: "VideoFrame",
	uilistlayout: "UIListLayout",
	uigridlayout: "UIGridLayout",
	uipadding: "UIPadding",
	uicorner: "UICorner",
	uistroke: "UIStroke",
	uishadow: "UIShadow",
	uigradient: "UIGradient",
	uiaspectratioconstraint: "UIAspectRatioConstraint",
	uisizeconstraint: "UISizeConstraint",
	uiscale: "UIScale",
	uiflexitem: "UIFlexItem",
	// Inert here — loom implements none of their behavior — but an app authored
	// for Roblox may still render one, and the fallback casing would mint
	// "Uipagelayout": an unknown class the engine lays out and paints as a plain
	// box. Named properly they land in the non-layout modifier set and disappear,
	// which is what a preview should show for a modifier it can't apply.
	uipagelayout: "UIPageLayout",
	uitablelayout: "UITableLayout",
	uitextsizeconstraint: "UITextSizeConstraint",
};
function classNameOf(type: string): string {
	return CLASS_NAMES[type] ?? type.charAt(0).toUpperCase() + type.slice(1);
}

/**
 * Prop-key prefixes for @rbxts/react's `React.Event.X` / `React.Change.X`
 * keyed-handler convention (`{ [React.Event.Activated]: fn }`). The preview's
 * @rbxts/react compatibility facade mints keys with these prefixes; the adapter
 * routes them to the same signal connections as `Event`/`Change` handler
 * tables.
 */
export const EVENT_PROP_PREFIX = "LoomEvent:";
export const CHANGE_PROP_PREFIX = "LoomChange:";

/**
 * The key `React.Tag` resolves to. Upstream, `Tag` is a lone symbol rather than
 * an indexed namespace — `props[React.Tag] = props.Tag` is all `createElement`
 * does with it — so this is one fixed key, not a prefix. Both spellings reach
 * the same place: `<frame Tag="x" />` and `<frame {...{[React.Tag]: "x"}} />`.
 */
export const TAG_PROP_KEY = "LoomTag";

// Props that are not Roblox instance properties (handled elsewhere / ignored).
const RESERVED = new Set([
	"children",
	"Name",
	"key",
	"ref",
	"Event",
	"Change",
	"Tag",
	TAG_PROP_KEY,
]);

/** Split `LoomEvent:`/`LoomChange:` keyed props out of a prop bag. */
function extractKeyedHandlers(props: Props): {
	events: Record<string, unknown>;
	changes: Record<string, unknown>;
} {
	const events: Record<string, unknown> = {};
	const changes: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(props)) {
		if (key.startsWith(EVENT_PROP_PREFIX)) {
			events[key.slice(EVENT_PROP_PREFIX.length)] = value;
		} else if (key.startsWith(CHANGE_PROP_PREFIX)) {
			changes[key.slice(CHANGE_PROP_PREFIX.length)] = value;
		}
	}
	return { events, changes };
}

function isKeyedHandlerProp(key: string): boolean {
	return (
		key.startsWith(EVENT_PROP_PREFIX) || key.startsWith(CHANGE_PROP_PREFIX)
	);
}

/** Instances hidden by Offscreen/Suspense (forced invisible in the IR). */
const HIDDEN = new WeakSet<LoomInstance>();

// --- adapter-owned signal connections ----------------------------------------

/** Connections this adapter made for one instance, keyed `"E:Name"`/`"C:Prop"`. */
const CONNECTIONS = new WeakMap<LoomInstance, Map<string, LoomConnection>>();

function connectionsOf(inst: LoomInstance): Map<string, LoomConnection> {
	let map = CONNECTIONS.get(inst);
	if (!map) {
		map = new Map();
		CONNECTIONS.set(inst, map);
	}
	return map;
}

/**
 * Reconcile one handler bag (`Event={{...}}` or `Change={{...}}`) against the
 * instance's live connections. Roblox calling convention: the instance comes
 * first, so `Event` handlers get `(inst, ...signalArgs)` — the DOM session
 * fires signals with the event args only — and `Change` handlers get `(inst)`.
 */
function syncHandlers(
	inst: LoomInstance,
	kind: "E" | "C",
	prevBag: unknown,
	nextBag: unknown,
): void {
	if (prevBag === nextBag) return;
	const prev = (prevBag ?? {}) as Record<string, unknown>;
	const next = (nextBag ?? {}) as Record<string, unknown>;
	const connections = connectionsOf(inst);
	for (const name of Object.keys(prev)) {
		if (next[name] === prev[name]) continue;
		const key = `${kind}:${name}`;
		connections.get(key)?.Disconnect();
		connections.delete(key);
	}
	for (const [name, handler] of Object.entries(next)) {
		if (typeof handler !== "function") continue;
		const key = `${kind}:${name}`;
		if (prev[name] === handler && connections.has(key)) continue;
		connections.get(key)?.Disconnect();
		const fn = handler as (...args: unknown[]) => void;
		const connection =
			kind === "E"
				? getEventSignal(inst, name).Connect((...args: unknown[]) =>
						fn(inst, ...args),
					)
				: inst.GetPropertyChangedSignal(name).Connect(() => fn(inst));
		connections.set(key, connection);
	}
}

// --- CollectionService tags ---------------------------------------------------

/** The tag currently applied by the `Tag` prop, so a change can retract it. */
const APPLIED_TAG = new WeakMap<LoomInstance, string>();

/** `props.Tag` or `props[React.Tag]` — the keyed form wins, as upstream. */
function tagOf(props: Props): string | undefined {
	const value = props[TAG_PROP_KEY] ?? props.Tag;
	return typeof value === "string" && value !== "" ? value : undefined;
}

/**
 * Reconcile the `Tag` prop against CollectionService. Roblox's tag registry is
 * a plain string index with change signals — nothing engine-bound — so the
 * runtime implements the real service and this writes to it, rather than
 * dropping the prop on the floor. Tags an instance did not get from this prop
 * are left alone: app code is free to `AddTag` on its own.
 */
function syncTag(inst: LoomInstance, prev: Props, next: Props): void {
	const before = tagOf(prev);
	const after = tagOf(next);
	if (before === after) return;
	const collection = getService("CollectionService") as unknown as {
		AddTag(instance: LoomInstance, tag: string): void;
		RemoveTag(instance: LoomInstance, tag: string): void;
	};
	if (before !== undefined) collection.RemoveTag(inst, before);
	if (after !== undefined) {
		collection.AddTag(inst, after);
		APPLIED_TAG.set(inst, after);
	} else {
		APPLIED_TAG.delete(inst);
	}
}

/** Disconnect every adapter-made connection (instance leaves the tree). */
function disposeInstance(inst: LoomInstance): void {
	unbindProps(inst);
	const tag = APPLIED_TAG.get(inst);
	if (tag !== undefined) {
		APPLIED_TAG.delete(inst);
		(
			getService("CollectionService") as unknown as {
				RemoveTag(instance: LoomInstance, tag: string): void;
			}
		).RemoveTag(inst, tag);
	}
	const connections = CONNECTIONS.get(inst);
	if (!connections) return;
	for (const connection of connections.values()) connection.Disconnect();
	connections.clear();
}

// --- bound props --------------------------------------------------------------

/** Live binding subscriptions per instance, keyed by the prop they drive. */
const BOUND = new WeakMap<LoomInstance, Map<string, () => void>>();

/** Drop the subscription (if any) behind one prop. */
function unbindProp(inst: LoomInstance, key: string): void {
	const bound = BOUND.get(inst);
	const unsubscribe = bound?.get(key);
	if (!unsubscribe) return;
	unsubscribe();
	bound?.delete(key);
}

/** Drop every binding subscription on an instance (it left the tree). */
function unbindProps(inst: LoomInstance): void {
	const bound = BOUND.get(inst);
	if (!bound) return;
	for (const unsubscribe of bound.values()) unsubscribe();
	bound.clear();
}

/**
 * Unbind a whole removed subtree, right now.
 *
 * `detachDeletedInstance` is React's own "this instance is gone" hook, but it
 * runs *after* the commit that removed the node — a spring driving a prop would
 * keep writing to a detached instance until then. `removeChild` is synchronous
 * with the deletion, so bindings are severed there instead; React only reports
 * the top of a deleted subtree, hence the walk.
 */
function unbindSubtree(inst: LoomInstance): void {
	unbindProps(inst);
	for (const child of inst.GetChildren()) unbindSubtree(child);
}

/**
 * Write one prop, resolving a binding to its current value and subscribing so
 * later values land on the instance directly. A bound write marks the instance
 * dirty and flushes on the next scheduler frame — no React commit per frame,
 * which is what makes 60fps motion affordable.
 *
 * `write` exists because `Name` is not a plain property assignment (it falls
 * back to the class name); everything else writes through the proxy.
 */
function applyProp(
	inst: LoomInstance,
	key: string,
	value: unknown,
	write: (resolved: unknown) => void = (resolved) => {
		inst[key] = resolved;
	},
): void {
	unbindProp(inst, key);
	if (!isBinding(value)) {
		write(value);
		return;
	}
	write(value.getValue());
	const unsubscribe = value.subscribe(write);
	let bound = BOUND.get(inst);
	if (!bound) {
		bound = new Map();
		BOUND.set(inst, bound);
	}
	bound.set(key, unsubscribe);
}

/** Merge a handler table with keyed-prop handlers (keyed props win). */
function mergeHandlerSources(
	bag: unknown,
	keyed: Record<string, unknown>,
): unknown {
	if (Object.keys(keyed).length === 0) return bag;
	return { ...((bag ?? {}) as Record<string, unknown>), ...keyed };
}

/** Diff-apply React props onto the live instance (plain props → proxy sets). */
function applyProps(inst: LoomInstance, prev: Props, next: Props): void {
	for (const key of Object.keys(prev)) {
		if (RESERVED.has(key) || isKeyedHandlerProp(key) || key in next) continue;
		unbindProp(inst, key);
		inst[key] = undefined; // dropped prop reverts to the class default
	}
	for (const [key, value] of Object.entries(next)) {
		if (RESERVED.has(key) || isKeyedHandlerProp(key)) continue;
		// Roblox `==`: a datatype rebuilt with the same components is not a
		// change, so a value written outside React survives the next render.
		if (!robloxEquals(prev[key], value)) applyProp(inst, key, value);
	}
	if (prev.Name !== next.Name) {
		applyProp(inst, "Name", next.Name, (resolved) => {
			inst.Name = typeof resolved === "string" ? resolved : inst.ClassName;
		});
	}
	const prevKeyed = extractKeyedHandlers(prev);
	const nextKeyed = extractKeyedHandlers(next);
	syncHandlers(
		inst,
		"E",
		mergeHandlerSources(prev.Event, prevKeyed.events),
		mergeHandlerSources(next.Event, nextKeyed.events),
	);
	syncHandlers(
		inst,
		"C",
		mergeHandlerSources(prev.Change, prevKeyed.changes),
		mergeHandlerSources(next.Change, nextKeyed.changes),
	);
	syncTag(inst, prev, next);
}

// --- encode: LoomInstance tree → Scene IR ------------------------------------

const TEXT_CLASSES = new Set(["TextLabel", "TextButton", "TextBox"]);

/** The layout modifiers that flow their siblings, and so report a content size. */
const FLOW_LAYOUT_CLASSES = new Set([
	"UIListLayout",
	"UIGridLayout",
	"UIPageLayout",
	"UITableLayout",
]);
let measureCtx: CanvasRenderingContext2D | null | undefined;
function getMeasureCtx(): CanvasRenderingContext2D | null {
	if (measureCtx === undefined) {
		measureCtx =
			typeof document !== "undefined"
				? document.createElement("canvas").getContext("2d")
				: null;
	}
	return measureCtx;
}

/**
 * Live-tree counterpart of `@loom-dev/scene`'s `getTextSize`: `TextSize` wins,
 * legacy `FontSize` fills in, 14 is the Roblox default. Kept in sync with the
 * vide adapter's copy.
 */
function liveTextSize(textSize: unknown, fontSize: unknown): number {
	if (typeof textSize === "number") return textSize;
	const name = enumName(fontSize);
	return fontSizeToPx(name) ?? 14;
}

/**
 * Live-tree counterpart of `@loom-dev/scene`'s `getLineHeight`, clamped to the
 * 1…3 Studio allows.
 */
function liveLineHeight(inst: LoomInstance): number {
	const value = inst.LineHeight;
	if (typeof value !== "number") return 1;
	return Math.min(3, Math.max(1, value));
}

/**
 * Measure an auto-sizing text node's pixel bounds with the same font the renderer
 * paints, and emit them as a `TextBounds` Vector2 the layout engine reads for
 * AutomaticSize (font metrics live browser-side, not in the WASM engine).
 */
function measureTextBounds(inst: LoomInstance): PropertyValue | undefined {
	if (!TEXT_CLASSES.has(inst.ClassName)) return undefined;
	const auto = inst.AutomaticSize;
	const autoName = enumName(auto);
	if (autoName !== "X" && autoName !== "Y" && autoName !== "XY")
		return undefined;
	// An empty TextBox displays its `PlaceholderText` — the renderer sets it on
	// the real `<input>` — so that is what the box has to be measured against.
	// Measuring the empty string instead collapses an `AutomaticSize.Y` input to
	// zero height, which is unclickable as well as invisible.
	const text = inst.Text;
	const raw =
		inst.ClassName === "TextBox" && text === "" ? inst.PlaceholderText : text;
	if (typeof raw !== "string" || raw === "") return undefined;
	const ctx = getMeasureCtx();
	if (!ctx) return undefined;

	const size = liveTextSize(inst.TextSize, inst.FontSize);
	const base = instanceFont(inst);
	// Rich text is measured as runs; plain text is the one-run case of the same
	// walk, so both go through `measureSegments`.
	const segments: RichSegment[] =
		inst.RichText === true
			? parseRichText(raw)
			: [{ kind: "text", text: raw, style: {} }];
	const wrapAt = wrapWidth(inst, autoName);
	MEASURED_WRAP.set(inst, wrapAt ?? 0);
	return prop.vector2(
		measureSegments(ctx, segments, base, size, wrapAt, liveLineHeight(inst)),
	);
}

/**
 * The wrap width each auto-sizing wrapped text node was last measured against,
 * so the flush can tell when a fresh layout has invalidated that measurement.
 */
const MEASURED_WRAP = new WeakMap<LoomInstance, number>();

/** Is `AutomaticSize` covering the X axis, so the width is content-derived? */
function autoOnX(inst: LoomInstance): boolean {
	const auto = inst.AutomaticSize;
	const name = enumName(auto);
	return name === "X" || name === "XY";
}

/**
 * Horizontal `UIPadding` on `inst`, in pixels — the room it takes away from
 * whatever it holds.
 *
 * `widthRef` is what a scale inset resolves against, and it is the layout
 * engine's `padding_insets` rule that decides it: the node's own width when its
 * X axis is a real one, and **zero** when the axis is automatic, where a scale
 * inset would otherwise be circular (the width sets the padding sets the
 * width). Reading offsets only — as this did — is right for the automatic case
 * and wrong for the other: the engine takes the scale off, the measurement does
 * not, and the label is then measured against a width it never gets and painted
 * with more lines than the box it was given.
 */
function horizontalPadding(inst: LoomInstance, widthRef: number): number {
	const pad = inst.FindFirstChildOfClass("UIPadding");
	if (!pad) return 0;
	const side = (name: string): number => {
		const udim = pad[name] as { Offset?: unknown; Scale?: unknown } | undefined;
		const offset = typeof udim?.Offset === "number" ? udim.Offset : 0;
		const scale = typeof udim?.Scale === "number" ? udim.Scale : 0;
		return offset + scale * widthRef;
	};
	return side("PaddingLeft") + side("PaddingRight");
}

/**
 * The width `TextWrapped` text wraps at, or `undefined` when it does not wrap.
 * `TextWrap` is the engine's own deprecated alias for the same property.
 *
 * Which width depends on whether the X axis is automatic:
 * - **Not automatic** — the object's own width. It is fixed, so it is the
 *   constraint, and Y grows to however many lines result.
 * - **Automatic** — the width of the nearest ancestor that has one of its own,
 *   less the padding in between. The object's own width cannot be the constraint
 *   here, because it is the thing being computed: a label written
 *   `Size={UDim2.fromScale(0, 0)} AutomaticSize={XY} TextWrapped` would settle
 *   at one word per line, since wrapping at its current 0 width yields a
 *   widest-word measurement that then becomes the next constraint. Constraining
 *   by the container instead leaves a short label hugging its text (it never
 *   reaches the container's edge) and wraps a long one where the container ends,
 *   which is what such a label does in Studio.
 *
 * Widths come from the previous frame's `AbsoluteSize` — the same
 * one-frame-behind feedback the Absolute* signals ride on. The first pass
 * measures unwrapped, the resulting layout supplies a width, and the next pass
 * settles.
 */
function wrapWidth(inst: LoomInstance, autoName: string): number | undefined {
	if ((inst.TextWrapped ?? inst.TextWrap) !== true) return undefined;
	if (autoName !== "X" && autoName !== "XY") {
		const own = (inst.AbsoluteSize as { X?: number } | undefined)?.X ?? 0;
		return own > 0 ? own : undefined;
	}
	// The immediate parent is not enough on its own: a parent that is itself
	// `AutomaticSize` was sized *by this label*, so wrapping against it is the
	// same circle as wrapping against the label's own width, and the text never
	// wraps at all. The library idiom stacks two or three such containers (a
	// padded body inside a flex item inside a card), and the card — the one node
	// with a real width — is where the room actually runs out.
	let available = 0;
	let inset = 0;
	for (let node = inst.Parent; node; node = node.Parent) {
		// An automatic axis has no width for a scale inset to resolve against —
		// see `horizontalPadding` — and it is also the case where the walk keeps
		// climbing, so the two questions share the one answer.
		const auto = autoOnX(node);
		const own = auto
			? 0
			: ((node.AbsoluteSize as { X?: number } | undefined)?.X ?? 0);
		inset += horizontalPadding(node, own);
		if (!auto) {
			available = own;
			break;
		}
	}
	const width = available - inset;
	return width > 0 ? width : undefined;
}

/** One rich-text run's font, its tags applied over the label's own. */
/**
 * `TextBounds` for a text node: every run measured in the font its own tags ask
 * for, so a `<b>` or `<font size="24">` widens the line the way the engine's
 * shaper would. Measuring the whole string in the base font instead would
 * under-measure and clip the label.
 *
 * With `wrapAt` set the runs are laid into lines greedily at word boundaries,
 * which is what `TextWrapped` asks for; without it each `<br/>` or newline is
 * the only line break. Line height follows the tallest run on each line,
 * matching how Roblox grows a line to its largest glyph.
 */
function measureSegments(
	ctx: CanvasRenderingContext2D,
	segments: readonly RichSegment[],
	base: ResolvedFont,
	baseSize: number,
	wrapAt?: number,
	lineSpacing = 1,
): { x: number; y: number } {
	let width = 0;
	let height = 0;
	let lineWidth = 0;
	let lineHeight = baseSize;
	let lines = 0;
	const endLine = (): void => {
		width = Math.max(width, lineWidth);
		// `LineHeight` stretches the gap between lines, so it starts paying from
		// the second one — a single line is its own height whatever the multiplier.
		height += lines === 0 ? lineHeight : lineHeight * lineSpacing;
		lines += 1;
		lineWidth = 0;
		lineHeight = baseSize;
	};
	/** Add one unbreakable piece, wrapping first if it no longer fits. */
	const push = (piece: string, size: number): void => {
		if (piece === "") return;
		const pieceWidth = shapedTextWidth(ctx, piece);
		if (
			wrapAt !== undefined &&
			lineWidth > 0 &&
			lineWidth + pieceWidth > wrapAt
		) {
			// A run of spaces that would overflow is dropped rather than carried to
			// the start of the next line, as every text shaper does.
			endLine();
			if (piece.trim() === "") return;
		}
		lineWidth += pieceWidth;
		lineHeight = Math.max(lineHeight, size);
	};

	for (const segment of segments) {
		if (segment.kind === "break") {
			endLine();
			continue;
		}
		const size = segment.style.size ?? baseSize;
		ctx.font = fontShorthand(runFont(segment.style, base), size);
		// A literal newline inside a run breaks the line just like `<br/>`.
		const parts = segment.text.split("\n");
		for (let i = 0; i < parts.length; i++) {
			if (i > 0) endLine();
			const part = parts[i] ?? "";
			if (wrapAt === undefined) {
				push(part, size);
				continue;
			}
			// Split *keeping* the whitespace, so the gaps between words are measured
			// rather than assumed.
			for (const piece of part.split(/(\s+)/)) push(piece, size);
		}
	}
	endLine();
	return { x: width, y: height };
}

function encodeInstance(
	inst: LoomInstance,
	byId: Map<string, LoomInstance>,
): SceneNode {
	const id = getInternalId(inst);
	byId.set(id, inst);
	const node: SceneNode = {
		className: inst.ClassName,
		name: String(inst.Name ?? inst.ClassName),
		id,
	};
	const properties: Record<string, PropertyValue> = {};
	for (const [key, value] of getRawProperties(inst)) {
		if (key === "Name") continue; // the node name, not an IR property
		const pv = toPropertyValue(value);
		if (pv !== undefined) properties[key] = pv;
	}
	// Offscreen/Suspense hide forces invisibility regardless of the node's props.
	if (HIDDEN.has(inst)) properties.Visible = prop.bool(false);
	// Inject measured text bounds for auto-sizing text classes.
	const textBounds = measureTextBounds(inst);
	if (textBounds) properties.TextBounds = textBounds;
	if (Object.keys(properties).length > 0) node.properties = properties;
	const children = inst
		.GetChildren()
		.map((child) => encodeInstance(child, byId));
	if (children.length > 0) node.children = children;
	return node;
}

// --- the world ---------------------------------------------------------------

/** Layout function shape (`@loom-dev/layout`'s `computeLayout`); injectable. */
export type ComputeLayout = (
	root: SceneNode,
	viewport: Viewport,
) => LayoutResult;

export interface WorldOptions {
	/** Override the layout engine (tests inject a stub to skip WASM). */
	computeLayout?: ComputeLayout;
}

/**
 * The live pipeline behind one mount: the runtime PlayerGui as root container,
 * the DOM session, and the flush plumbing between them.
 */
export interface World {
	/**
	 * The world's root container: the runtime `Players.LocalPlayer.PlayerGui`
	 * instance — the same object lattice-style code resolves via
	 * `WaitForChild("PlayerGui")`, so portals into PlayerGui land in this world.
	 */
	readonly rootInstance: LoomInstance;
	/**
	 * The world-created default `ScreenGui` under PlayerGui. Non-LayerCollector
	 * React root children mount here, so sibling portal ScreenGuis order
	 * against app content by `DisplayOrder`.
	 */
	readonly defaultGui: LoomInstance;
	/** Encode → layout → DOM patch → layout feedback, right now. */
	flushSync(): void;
	/** Tear down the session, resize observer, and this world's instances. */
	dispose(): void;
}

// If layout feedback keeps triggering synchronous React commits past this
// depth, the remaining work is deferred to the next scheduler frame.
const MAX_FLUSH_DEPTH = 8;

// How many times one flush will re-measure wrapped text against the width the
// layout it just ran produced. Two is the settling case (measure unwrapped →
// learn the width → measure wrapped); the rest is headroom for a label whose
// wrapping changes the width it wraps against. Past it the flush gives up and
// leaves the instance dirty for the next frame, which is where this used to
// resolve every time.
const MAX_WRAP_PASSES = 4;

const WORLDS = new Set<WorldImpl>();
let flusherInstalled = false;
/** Which world currently backs `PlayerGui.GetGuiObjectsAtPosition`. */
let hitTesterOwner: WorldImpl | undefined;
/** Which world currently claims the runtime PlayerGui (last world wins). */
let playerGuiOwner: WorldImpl | undefined;

/** The runtime `Players.LocalPlayer.PlayerGui` (pre-built by the services). */
function resolvePlayerGui(): LoomInstance {
	const player = getService("Players").LocalPlayer as LoomInstance | undefined;
	const gui = player?.FindFirstChildOfClass("PlayerGui");
	// The Players service pre-builds this tree; the fallback only guards a
	// hand-rolled runtime where the service was replaced.
	return gui ?? createLoomInstance("PlayerGui", "PlayerGui");
}

class WorldImpl implements World {
	readonly rootInstance: LoomInstance;
	readonly defaultGui: LoomInstance;
	private readonly mount: HTMLElement;
	private readonly session: DomSession;
	private readonly computeLayout: ComputeLayout;
	private readonly observer: ResizeObserver | undefined;
	private readonly stopFontWatch: () => void;
	private readonly byId = new Map<string, LoomInstance>();
	private readonly warnedNonLayer = new WeakSet<LoomInstance>();
	private depth = 0;
	private warnedDepth = false;
	private disposed = false;

	constructor(mount: HTMLElement, options?: WorldOptions) {
		this.mount = mount;
		this.computeLayout = options?.computeLayout ?? wasmComputeLayout;
		// The world root IS the runtime PlayerGui, so app code that resolves
		// `Players.LocalPlayer.WaitForChild("PlayerGui")` (lattice's portal
		// container chain) and this world agree on the same container instance.
		this.rootInstance = resolvePlayerGui();
		if (playerGuiOwner && !playerGuiOwner.disposed) {
			console.warn(
				"loom react: a new world is claiming Players.LocalPlayer.PlayerGui " +
					"while another world still owns it — the newest world wins " +
					"(matching the last-world-wins hit-tester rule)",
			);
		}
		playerGuiOwner = this;
		// App content that isn't itself a LayerCollector mounts under this
		// default ScreenGui, so portal ScreenGuis are siblings ordered by
		// DisplayOrder (Roblox: only LayerCollectors render under PlayerGui).
		this.defaultGui = createLoomInstance("ScreenGui", "LoomDefaultGui");
		this.defaultGui.ResetOnSpawn = false;
		this.defaultGui.Parent = this.rootInstance;
		this.session = createDomSession(mount, {
			resolveInstance: (id) => this.byId.get(id),
		});
		if (typeof ResizeObserver === "function") {
			this.observer = new ResizeObserver(() => {
				if (this.disposed) return;
				setViewportSize(Vector2.new(mount.clientWidth, mount.clientHeight));
				this.flushSync();
			});
			this.observer.observe(mount);
		}
		// Every `AutomaticSize` text bound was measured against the faces the
		// browser had at the time, so a face arriving later — a host registering
		// one, or a `@font-face` finishing its download — invalidates the layout
		// that came out of it.
		this.stopFontWatch = onFontsChanged(() => {
			if (this.disposed) return;
			this.flushSync();
		});
		WORLDS.add(this);
		if (!flusherInstalled) {
			flusherInstalled = true;
			// One scheduler flusher for every world: motion-driven dirty writes
			// (and `flushDirtyNow` from React commits) land here.
			setFlusher(() => {
				for (const world of [...WORLDS]) world.flushSync();
			});
		}
		// `PlayerGui.GetGuiObjectsAtPosition` resolves against this world's
		// instance tree (last-constructed world wins when several exist).
		setHitTester((x, y) => this.hitTest(x, y));
		hitTesterOwner = this;
	}

	/**
	 * Rect-based hit test over the live instance tree (layout geometry, not
	 * DOM): every visible GuiObject whose absolute rect contains the point,
	 * topmost first — ScreenGui DisplayOrder desc, then ZIndex desc, then tree
	 * depth desc. Non-`Active` instances are included (Roblox includes them);
	 * `Visible === false` hides an instance and its whole subtree.
	 */
	private hitTest(x: number, y: number): LoomInstance[] {
		interface Hit {
			inst: LoomInstance;
			displayOrder: number;
			zIndex: number;
			depth: number;
		}
		const hits: Hit[] = [];
		const visit = (
			inst: LoomInstance,
			depth: number,
			displayOrder: number,
		): void => {
			if (inst.Visible === false) return;
			let order = displayOrder;
			if (inst.IsA("LayerCollector")) {
				order = typeof inst.DisplayOrder === "number" ? inst.DisplayOrder : 0;
			}
			if (inst.IsA("GuiObject")) {
				const pos = inst.AbsolutePosition;
				const size = inst.AbsoluteSize;
				if (
					x >= pos.X &&
					x < pos.X + size.X &&
					y >= pos.Y &&
					y < pos.Y + size.Y
				) {
					hits.push({
						inst,
						displayOrder: order,
						zIndex: typeof inst.ZIndex === "number" ? inst.ZIndex : 1,
						depth,
					});
				}
			}
			for (const child of inst.GetChildren()) visit(child, depth + 1, order);
		};
		for (const child of this.rootInstance.GetChildren()) visit(child, 0, 0);
		hits.sort(
			(a, b) =>
				b.displayOrder - a.displayOrder ||
				b.zIndex - a.zIndex ||
				b.depth - a.depth,
		);
		return hits.map((hit) => hit.inst);
	}

	/**
	 * Scene root: PlayerGui's LayerCollector children as sibling full-viewport
	 * subtrees. A single layer encodes directly as the scene root (the layout
	 * engine force-fills the top node); several get a synthetic transparent
	 * wrapper, and each layer an explicit full-viewport `Size` when the app set
	 * none (the engine only force-fills the TOP node — a nested ScreenGui would
	 * otherwise fall back to the {0,0},{0,0} Size default and collapse).
	 * Non-LayerCollector children of PlayerGui warn once and are skipped
	 * (Roblox doesn't render them either); the world's own default ScreenGui is
	 * elided while empty.
	 */
	private encodeRoot(): SceneNode | undefined {
		this.byId.clear();
		const layers: SceneNode[] = [];
		for (const child of this.rootInstance.GetChildren()) {
			if (!child.IsA("LayerCollector")) {
				if (!this.warnedNonLayer.has(child)) {
					this.warnedNonLayer.add(child);
					console.warn(
						`loom react: "${String(child.Name)}" (${child.ClassName}) is ` +
							"parented directly to PlayerGui but is not a LayerCollector — " +
							"skipped (put it inside a ScreenGui)",
					);
				}
				continue;
			}
			if (child === this.defaultGui && child.GetChildren().length === 0) {
				continue;
			}
			const node = encodeInstance(child, this.byId);
			if (!node.properties?.Size) {
				node.properties = {
					...node.properties,
					Size: prop.udim2({
						x: { scale: 1, offset: 0 },
						y: { scale: 1, offset: 0 },
					}),
				};
			}
			layers.push(node);
		}
		const first = layers[0];
		if (!first) return undefined;
		if (layers.length === 1) return first;
		return {
			className: "Folder",
			name: "PlayerGui",
			id: "loom-root",
			children: layers,
		};
	}

	flushSync(): void {
		if (this.disposed) return;
		if (this.depth >= MAX_FLUSH_DEPTH) {
			if (!this.warnedDepth) {
				this.warnedDepth = true;
				console.warn(
					"loom react: layout feedback exceeded flush depth " +
						`${MAX_FLUSH_DEPTH} — deferring further work to the next frame`,
				);
			}
			markDirty(this.rootInstance);
			return;
		}
		this.depth += 1;
		try {
			const width = this.mount.clientWidth;
			const height = this.mount.clientHeight;
			if (width === 0 || height === 0) return; // wait for the mount to be sized
			// Wrapped text is measured against a width that only exists once the
			// layout below has run, so the first encode of a label is unwrapped.
			// Settling that here rather than on the next frame is the whole point
			// of the loop: patching the unwrapped pass puts a label wider than its
			// container into the DOM, and during a live window resize — where every
			// frame is a fresh width — that stale pass is what stays on screen, as
			// text running out of its card and under the next one.
			let scene = this.encodeRoot();
			if (!scene) {
				this.session.clear();
				return;
			}
			let layout = this.computeLayout(scene, { width, height });
			for (let pass = 1; ; pass++) {
				// Absolute geometry has to land before the re-measure: `wrapWidth`
				// reads `AbsoluteSize` off the ancestors this layout just sized.
				this.applyAbsoluteGeometry(layout);
				if (!this.wrappedTextIsStale()) break;
				if (pass >= MAX_WRAP_PASSES) {
					// Not settling — leave the labels dirty and try again next frame
					// rather than spinning here inside a React commit.
					this.remarkStaleWrappedText();
					break;
				}
				scene = this.encodeRoot();
				if (!scene) {
					this.session.clear();
					return;
				}
				layout = this.computeLayout(scene, { width, height });
			}
			this.session.patch(scene, layout);
			// ScrollingFrame metrics feedback (AbsoluteWindowSize /
			// AbsoluteCanvasSize) — change-gated writes, no dirty re-mark.
			this.applyScrollMetrics(scene, layout);
		} catch (err) {
			// A malformed scene or DOM error must never escape the commit phase;
			// degrade to a logged, contained failure.
			console.error("loom react:", err);
		} finally {
			this.depth -= 1;
		}
	}

	/**
	 * Post-layout ScrollingFrame metrics feedback, walked over the scene tree
	 * just laid out:
	 * - `AbsoluteWindowSize` = the frame's own laid-out rect (w, h). The renderer
	 *   paints the scroll bar over the canvas (Roblox's `ScrollBarInset.None`),
	 *   so the window is never reduced by `ScrollBarThickness`.
	 * - `AbsoluteCanvasSize`: `CanvasSize` (UDim2) resolved against the window
	 *   rect per axis; when `AutomaticCanvasSize` is X/Y/XY the affected axis
	 *   grows to the union bounding box of the laid-out direct children
	 *   (`max(child.edge) - frame.origin`), i.e. `max(resolved, children)`.
	 * Writes go through {@link setFeedbackProperty}: property signals fire only
	 * on real change and the instance is NOT re-marked dirty, so the feedback
	 * loop converges exactly like `updateAbsoluteGeometry`.
	 */
	private applyScrollMetrics(node: SceneNode, layout: LayoutResult): void {
		const rect = node.id ? layout.rects[node.id]?.rect : undefined;
		this.applyContentSize(node, layout);
		if (node.className === "ScrollingFrame" && node.id && rect) {
			const inst = this.byId.get(node.id);
			if (inst) {
				// The renderer paints the scroll bar from these same numbers, so
				// both read them out of one place (see `scrollMetrics`). Every node
				// this adapter encodes carries an explicit id, so the positional
				// fallback is never needed here.
				const metrics = scrollMetrics(node, rect, (child) =>
					child.id ? layout.rects[child.id]?.rect : undefined,
				);
				setFeedbackProperty(
					inst,
					"AbsoluteWindowSize",
					Vector2.new(metrics.window.x, metrics.window.y),
				);
				setFeedbackProperty(
					inst,
					"AbsoluteCanvasSize",
					Vector2.new(metrics.canvas.x, metrics.canvas.y),
				);
			}
		}
		for (const child of childrenOf(node)) {
			this.applyScrollMetrics(child, layout);
		}
	}

	/**
	 * Record absolute geometry from a layout, firing the
	 * AbsolutePosition/AbsoluteSize signals only where it changed.
	 */
	private applyAbsoluteGeometry(layout: LayoutResult): void {
		for (const [id, entry] of Object.entries(layout.rects)) {
			const inst = this.byId.get(id);
			if (!inst) continue; // e.g. the synthetic "loom-root" wrapper
			updateAbsoluteGeometry(
				inst,
				Vector2.new(entry.rect.x, entry.rect.y),
				Vector2.new(entry.rect.width, entry.rect.height),
			);
		}
	}

	/**
	 * Every auto-sizing text node whose wrap width is no longer the one it was
	 * measured against — the layout that just ran moved the container it wraps
	 * inside, so its `TextBounds` is stale and the next encode has to re-measure.
	 */
	private *staleWrappedText(): Generator<LoomInstance> {
		for (const inst of this.byId.values()) {
			if (!TEXT_CLASSES.has(inst.ClassName)) continue;
			const auto = inst.AutomaticSize;
			const autoName = enumName(auto);
			if (autoName === undefined || autoName === "None") continue;
			const recorded = MEASURED_WRAP.get(inst);
			if (recorded === undefined) continue;
			if ((wrapWidth(inst, autoName) ?? 0) !== recorded) yield inst;
		}
	}

	private wrappedTextIsStale(): boolean {
		for (const _ of this.staleWrappedText()) return true;
		return false;
	}

	/** The give-up path: settle these on a later frame instead of this flush. */
	private remarkStaleWrappedText(): void {
		for (const inst of this.staleWrappedText()) markDirty(inst);
	}

	/**
	 * `UIListLayout`/`UIGridLayout`'s `AbsoluteContentSize`: the extent of what
	 * the layout actually laid out, which is the union bounding box of the
	 * flowed children — the same quantity the engine measured to place them.
	 *
	 * The layout modifier gets no rect of its own (it does not participate in
	 * layout), so the value is derived from the *parent's* children here rather
	 * than emitted per node. `Visible = false` children are excluded, matching
	 * the engine: they take neither a slot nor a gap, so they must not stretch
	 * the reported content either.
	 *
	 * This is a real dependency, not a diagnostic. A dropdown that sizes itself
	 * from `Change={{ AbsoluteContentSize }}` collapses to zero height without
	 * it, and everything inside is clipped away — including the click targets.
	 */
	private applyContentSize(node: SceneNode, layout: LayoutResult): void {
		const flow = childrenOf(node).find((child) =>
			FLOW_LAYOUT_CLASSES.has(child.className),
		);
		if (!flow?.id) return;
		const inst = this.byId.get(flow.id);
		if (!inst) return;

		let minX = Number.POSITIVE_INFINITY;
		let minY = Number.POSITIVE_INFINITY;
		let maxX = Number.NEGATIVE_INFINITY;
		let maxY = Number.NEGATIVE_INFINITY;
		for (const child of childrenOf(node)) {
			if (!participatesInLayout(child.className) || !child.id) continue;
			if (asBool(child.properties?.Visible) === false) continue;
			const childRect = layout.rects[child.id]?.rect;
			if (!childRect) continue;
			minX = Math.min(minX, childRect.x);
			minY = Math.min(minY, childRect.y);
			maxX = Math.max(maxX, childRect.x + childRect.width);
			maxY = Math.max(maxY, childRect.y + childRect.height);
		}
		const empty = minX === Number.POSITIVE_INFINITY;
		setFeedbackProperty(
			inst,
			"AbsoluteContentSize",
			empty ? Vector2.zero : Vector2.new(maxX - minX, maxY - minY),
		);
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		WORLDS.delete(this);
		if (hitTesterOwner === this) {
			hitTesterOwner = undefined;
			setHitTester(undefined);
		}
		this.observer?.disconnect();
		this.stopFontWatch();
		this.session.dispose();
		// PlayerGui is the shared runtime instance — never Destroy it. Tear down
		// only what this world owns: its default ScreenGui, and (while still the
		// owner) detach whatever children remain so the next world starts clean.
		this.defaultGui.Destroy();
		if (playerGuiOwner === this) {
			playerGuiOwner = undefined;
			for (const child of this.rootInstance.GetChildren()) {
				child.Parent = undefined;
			}
		}
	}
}

/**
 * Create a world on `mount`. With the default WASM layout engine, await
 * {@link initLayout} (or use {@link render}) before the first flush; tests
 * inject `options.computeLayout` and skip WASM entirely.
 */
export function createWorld(mount: HTMLElement, options?: WorldOptions): World {
	return new WorldImpl(mount, options);
}

// --- host config -------------------------------------------------------------

const HOST_CONTEXT = {};

/**
 * A reconciler container: the world (root mounts) or a raw `LoomInstance`
 * (portal containers — `createPortal(children, container)`).
 */
type HostContainer = World | LoomInstance;

/**
 * Where a container-level child actually parents. Portal containers take the
 * child directly. For the world root, LayerCollectors (lattice's portal-made
 * `<screengui DisplayOrder={…}>` layers, or an app's own top-level ScreenGui)
 * become PlayerGui siblings; anything else mounts under the world's default
 * ScreenGui so it stays inside a renderable layer.
 */
function containerTarget(
	container: HostContainer,
	child: LoomInstance,
): LoomInstance {
	if (isLoomInstance(container)) return container;
	return child.IsA("LayerCollector")
		? container.rootInstance
		: container.defaultGui;
}

/** The slice of a React fiber {@link nameFromKey} walks. */
interface KeyedFiber {
	key: string | null;
	return: KeyedFiber | null;
}

/**
 * The `Name` React-Lua gives a new host instance: its element's `key`, or else
 * the key of the nearest keyed ancestor fiber, component or host alike
 * (`ReactRobloxHostConfig.createInstance`, a deviation kept for Roact
 * compatibility). roblox-ts code leans on it — `<frame key="Content">` is how
 * `FindFirstChild("Content")` finds anything — so without it every instance
 * kept its class name. An explicit `Name` prop is applied afterwards and wins.
 */
function nameFromKey(fiber: KeyedFiber | null | undefined): string | undefined {
	for (let node = fiber; node; node = node.return) {
		if (node.key !== null && node.key !== undefined) return node.key;
	}
	return undefined;
}

const hostConfig = {
	supportsMutation: true,
	supportsPersistence: false,
	supportsHydration: false,
	isPrimaryRenderer: true,
	noTimeout: -1 as const,
	scheduleTimeout: setTimeout,
	cancelTimeout: clearTimeout,

	createInstance(
		type: string,
		props: Props,
		_root: HostContainer,
		_context: object,
		fiber: KeyedFiber,
	): LoomInstance {
		const instance = createLoomInstance(classNameOf(type));
		const name = nameFromKey(fiber);
		if (name !== undefined) instance.Name = name;
		applyProps(instance, {}, props);
		return instance;
	},
	createTextInstance(): TextInstance {
		return TEXT_INSTANCE;
	},

	appendInitialChild(parent: LoomInstance, child: HostNode): void {
		if (!isLoomInstance(child)) return;
		child.Parent = parent;
	},
	appendChild(parent: LoomInstance, child: HostNode): void {
		if (!isLoomInstance(child)) return;
		moveChildBefore(parent, child);
	},
	appendChildToContainer(container: HostContainer, child: HostNode): void {
		if (!isLoomInstance(child)) return;
		moveChildBefore(containerTarget(container, child), child);
	},
	insertBefore(parent: LoomInstance, child: HostNode, before: HostNode): void {
		if (!isLoomInstance(child)) return;
		moveChildBefore(parent, child, isLoomInstance(before) ? before : undefined);
	},
	insertInContainerBefore(
		container: HostContainer,
		child: HostNode,
		before: HostNode,
	): void {
		if (!isLoomInstance(child)) return;
		// `before` may live in the other target (defaultGui vs PlayerGui);
		// moveChildBefore appends last when `before` isn't a sibling.
		moveChildBefore(
			containerTarget(container, child),
			child,
			isLoomInstance(before) ? before : undefined,
		);
	},
	removeChild(_parent: LoomInstance, child: HostNode): void {
		if (!isLoomInstance(child)) return;
		unbindSubtree(child);
		child.Parent = undefined;
	},
	removeChildFromContainer(_container: HostContainer, child: HostNode): void {
		if (!isLoomInstance(child)) return;
		unbindSubtree(child);
		child.Parent = undefined;
	},
	clearContainer(container: HostContainer): void {
		if (isLoomInstance(container)) {
			// Portal container: React only clears root containers, but stay safe.
			for (const child of container.GetChildren()) child.Parent = undefined;
			return;
		}
		// Shared PlayerGui root: clear this world's content but keep (and empty)
		// the world-owned default ScreenGui itself.
		for (const child of container.defaultGui.GetChildren()) {
			child.Parent = undefined;
		}
		for (const child of container.rootInstance.GetChildren()) {
			if (child !== container.defaultGui) child.Parent = undefined;
		}
	},

	finalizeInitialChildren(): boolean {
		return false;
	},
	prepareUpdate(
		_instance: LoomInstance,
		_type: string,
		oldProps: Props,
		newProps: Props,
	): Props | null {
		return shallowChanged(oldProps, newProps) ? newProps : null;
	},
	commitUpdate(
		instance: LoomInstance,
		_payload: unknown,
		_type: string,
		prevProps: Props,
		nextProps: Props,
	): void {
		applyProps(instance, prevProps, nextProps);
	},
	commitTextUpdate(): void {},
	// Required under supportsMutation: Offscreen/Suspense toggle these to hide/show
	// a subtree (a missing method throws and tears the subtree down).
	hideInstance(instance: LoomInstance): void {
		HIDDEN.add(instance);
		markDirty(instance);
	},
	unhideInstance(instance: LoomInstance): void {
		HIDDEN.delete(instance);
		markDirty(instance);
	},
	hideTextInstance(): void {},
	unhideTextInstance(): void {},
	shouldSetTextContent(): boolean {
		return false;
	},

	getRootHostContext(): object {
		return HOST_CONTEXT;
	},
	getChildHostContext(): object {
		return HOST_CONTEXT;
	},
	/** Refs receive the live `LoomInstance` proxy (IsA, signals, prop writes). */
	getPublicInstance(instance: LoomInstance): LoomInstance {
		return instance;
	},

	prepareForCommit(): null {
		return null;
	},
	resetAfterCommit(): void {
		// Every mutating commit marked instances dirty; flush them through the
		// world pipeline synchronously so layout feedback lands in this commit.
		flushDirtyNow();
	},
	preparePortalMount(): void {},
	getCurrentEventPriority(): number {
		return DefaultEventPriority;
	},

	getInstanceFromNode(): null {
		return null;
	},
	beforeActiveInstanceBlur(): void {},
	afterActiveInstanceBlur(): void {},
	prepareScopeUpdate(): void {},
	getInstanceFromScope(): null {
		return null;
	},
	detachDeletedInstance(instance: HostNode): void {
		if (!isLoomInstance(instance)) return;
		disposeInstance(instance);
	},
};

function shallowChanged(a: Props, b: Props): boolean {
	const ak = Object.keys(a);
	const bk = Object.keys(b);
	if (ak.length !== bk.length) return true;
	for (const k of ak) if (a[k] !== b[k]) return true;
	return false;
}

const reconciler = Reconciler(hostConfig);

// --- public API --------------------------------------------------------------

/**
 * Render `children` into `container` — a live `LoomInstance` (typically
 * `Players.LocalPlayer.PlayerGui`) — from anywhere in a mounted tree, exactly
 * like `ReactRoblox.createPortal`. The children parent into `container`
 * through the normal host-config path, so a `<screengui DisplayOrder={…}>`
 * portal child becomes a PlayerGui sibling layer z-ordered by DisplayOrder.
 */
export function createPortal(
	children: ReactNode,
	container: LoomInstance,
	key?: string | null,
): ReactPortal {
	if (!isLoomInstance(container)) {
		throw new TypeError("createPortal: container must be a LoomInstance");
	}
	return reconciler.createPortal(
		children,
		container,
		null,
		key ?? null,
	) as ReactPortal;
}

export interface LoomRoot {
	/** Unmount the tree and dispose the world (session, observer, instances). */
	unmount(): void;
}

/** `LoomRoot` plus the world handle (tests and tooling introspect it). */
export interface MountedWorld extends LoomRoot {
	readonly world: World;
}

/**
 * Mount a React element tree into a fresh world on `mount`, synchronously.
 * The default layout engine requires {@link initLayout} to have resolved —
 * use {@link render} unless you inject `options.computeLayout`.
 */
export function mountSync(
	element: ReactElement,
	mount: HTMLElement,
	options?: WorldOptions,
): MountedWorld {
	const world = createWorld(mount, options);
	const root = reconciler.createContainer(
		world,
		0, // LegacyRoot — synchronous commits, simplest for a preview
		null,
		false,
		null,
		"",
		(error) => console.error("loom react:", error),
		null,
	);
	reconciler.updateContainer(element, root, null, null);
	// React defers passive effects (`useEffect`) to a later task. A preview mount
	// is meant to be finished when this returns — motion code that starts a
	// spring in an effect should be running before the first frame, not one task
	// after it — so they are flushed here.
	reconciler.flushPassiveEffects();
	return {
		world,
		unmount() {
			reconciler.updateContainer(null, root, null, null);
			// Effect *cleanups* are passive too: run them while the world is still
			// alive, so an unmounting component tears down against a live tree
			// rather than a disposed one.
			reconciler.flushPassiveEffects();
			world.dispose();
		},
	};
}

/**
 * Render a React element tree of Roblox host elements into `mount`, as live,
 * interactive DOM. Awaits the WASM layout engine, then flushes on every commit,
 * on scheduler frames (motion writes), and on mount resize.
 */
export async function render(
	element: ReactElement,
	mount: HTMLElement,
): Promise<LoomRoot> {
	await initLayout();
	return mountSync(element, mount);
}

// --- JSX intrinsics -----------------------------------------------------------

/** `Event={{ Activated: (rbx, input, clickCount) => … }}` handler bag. */
export type EventHandlers = Record<
	string,
	(rbx: LoomInstance, ...args: never[]) => void
>;
/** `Change={{ Text: (rbx) => … }}` per-property changed handler bag. */
export type ChangeHandlers = Record<string, (rbx: LoomInstance) => void>;

/**
 * Common GuiObject props. Enum props take the matching runtime `EnumItem`, and
 * every property accepts a {@link Bindable} — a plain value or a `Binding` of
 * one, so `Size={offset.map(…)}` animates without re-rendering.
 */
export interface GuiProps {
	Name?: Bindable<string>;
	Size?: Bindable<UDim2>;
	Position?: Bindable<UDim2>;
	AnchorPoint?: Bindable<Vector2>;
	BackgroundColor3?: Bindable<Color3>;
	BackgroundTransparency?: Bindable<number>;
	Visible?: Bindable<boolean>;
	ZIndex?: Bindable<number>;
	LayoutOrder?: Bindable<number>;
	/** Degrees, clockwise, around the element center (pure visual transform). */
	Rotation?: Bindable<number>;
	AutomaticSize?: Bindable<EnumItem<"AutomaticSize">>;
	ClipsDescendants?: Bindable<boolean>;
	Event?: EventHandlers;
	Change?: ChangeHandlers;
	/** CollectionService tag, applied for as long as the element is mounted. */
	Tag?: string;
	ref?: Ref<LoomInstance>;
	key?: Key;
	children?: ReactNode;
}

/**
 * `ScreenGui` (LayerCollector) props. `DisplayOrder` z-orders sibling layers
 * under PlayerGui; `IgnoreGuiInset` is a no-op (the runtime's `GetGuiInset()`
 * is zero) and `ZIndexBehavior.Sibling` is the renderer's native model — both
 * accepted so lattice-style layer code runs unchanged.
 */
export interface ScreenGuiProps extends GuiProps {
	DisplayOrder?: Bindable<number>;
	IgnoreGuiInset?: Bindable<boolean>;
	ResetOnSpawn?: Bindable<boolean>;
	Enabled?: Bindable<boolean>;
	ZIndexBehavior?: Bindable<EnumItem<"ZIndexBehavior">>;
	ScreenInsets?: Bindable<EnumItem<"ScreenInsets">>;
}

/** Text classes (TextLabel/TextButton/TextBox) add the `Text*` props. */
export interface TextGuiProps extends GuiProps {
	Text?: Bindable<string>;
	TextColor3?: Bindable<Color3>;
	TextSize?: Bindable<number>;
	TextTransparency?: Bindable<number>;
	TextWrapped?: Bindable<boolean>;
	/**
	 * The engine's own deprecated alias for `TextWrapped`, read as the same
	 * property. `TextWrapped` wins when both are set.
	 */
	TextWrap?: Bindable<boolean>;
	/** Multiplier on the gap between lines, 1…3. Single lines are unaffected. */
	LineHeight?: Bindable<number>;
	TextScaled?: Bindable<boolean>;
	TextXAlignment?: Bindable<EnumItem<"TextXAlignment">>;
	TextYAlignment?: Bindable<EnumItem<"TextYAlignment">>;
	/** The legacy font enum. `FontFace` wins when both are set, as in Roblox. */
	Font?: Bindable<EnumItem<"Font">>;
	FontFace?: Bindable<Font>;
	/** The legacy text-size enum. `TextSize` wins when both are set. */
	FontSize?: Bindable<EnumItem<"FontSize">>;
}

/** `ImageLabel`/`ImageButton` add the image props the image layer maps. */
export interface ImageGuiProps extends GuiProps {
	/**
	 * `rbxassetid://<id>`, or any URL a browser can load. Asset ids need a
	 * resolver installed by the host — `@loom-dev/preview` ships one, so they
	 * paint under `loom preview` and stay blank elsewhere until one is set.
	 */
	Image?: Bindable<string>;
	ImageTransparency?: Bindable<number>;
	/** All five: `Stretch`, `Fit`, `Crop`, `Slice` and `Tile`. */
	ScaleType?: Bindable<EnumItem<"ScaleType">>;
	/** Multiplies the image per channel; white (the default) is no tint. */
	ImageColor3?: Bindable<Color3>;
	/** The 9-slice centre, in the source image's own pixels. */
	SliceCenter?: Bindable<Rect>;
	/** Scales the sliced borders without touching the source. Default 1. */
	SliceScale?: Bindable<number>;
	/** One tile's size for `ScaleType.Tile`, against the node. Default `{1,0},{1,0}`. */
	TileSize?: Bindable<UDim2>;
	/** Sprite-sheet window: where it starts, and how big it is, in image pixels. */
	ImageRectOffset?: Bindable<Vector2>;
	/** A zero size (the default) means the whole image, as in Roblox. */
	ImageRectSize?: Bindable<Vector2>;
	/** `Pixelated` turns off smoothing when the image is scaled up. */
	ResampleMode?: Bindable<EnumItem<"ResamplerMode">>;
}

/** `TextBox` adds the editable-text props the DOM input maps. */
export interface TextBoxProps extends TextGuiProps {
	PlaceholderText?: Bindable<string>;
	PlaceholderColor3?: Bindable<Color3>;
	/** Roblox default is `true`: focusing clears the text. */
	ClearTextOnFocus?: Bindable<boolean>;
	TextEditable?: Bindable<boolean>;
	MultiLine?: Bindable<boolean>;
}

/** `ScrollingFrame` adds a scroll canvas. */
export interface ScrollingFrameProps extends GuiProps {
	CanvasSize?: Bindable<UDim2>;
	CanvasPosition?: Bindable<Vector2>;
	AutomaticCanvasSize?: Bindable<EnumItem<"AutomaticSize">>;
	ScrollingDirection?: Bindable<EnumItem<"ScrollingDirection">>;
	ScrollingEnabled?: Bindable<boolean>;
	/**
	 * Scroll bar chrome. The renderer paints the bar itself — arrows at the ends
	 * and a draggable thumb between them, `ScrollBarThickness` px along the
	 * frame's edge, in `ScrollBarImageColor3` — over the canvas, so the window it
	 * reports is never reduced by the bar (Roblox's `ScrollBarInset.None`).
	 * Setting `TopImage`/`BottomImage` drops the arrows: loom cannot paint an
	 * `rbxasset` sprite in their place.
	 */
	ScrollBarThickness?: Bindable<number>;
	ScrollBarImageColor3?: Bindable<Color3>;
	ScrollBarImageTransparency?: Bindable<number>;
}

/** `CanvasGroup` composites its subtree; `GroupTransparency` fades it as one. */
export interface CanvasGroupProps extends GuiProps {
	GroupTransparency?: Bindable<number>;
}

/** `UIListLayout` props. */
export interface UIListLayoutProps {
	FillDirection?: Bindable<EnumItem<"FillDirection">>;
	HorizontalAlignment?: Bindable<EnumItem<"HorizontalAlignment">>;
	VerticalAlignment?: Bindable<EnumItem<"VerticalAlignment">>;
	/**
	 * Flex distribution, per axis. The one matching `FillDirection` spreads the
	 * leftover space along it; the other only means anything as `Fill`, which
	 * stretches children across the cross axis.
	 */
	HorizontalFlex?: Bindable<EnumItem<"UIFlexAlignment">>;
	VerticalFlex?: Bindable<EnumItem<"UIFlexAlignment">>;
	/** Break onto a new line when an item no longer fits (CSS `flex-wrap`). */
	Wraps?: Bindable<boolean>;
	SortOrder?: Bindable<EnumItem<"SortOrder">>;
	Padding?: Bindable<UDim>;
	key?: Key;
}

/** `UIGridLayout` props. */
export interface UIGridLayoutProps {
	CellSize?: Bindable<UDim2>;
	CellPadding?: Bindable<UDim2>;
	FillDirection?: Bindable<EnumItem<"FillDirection">>;
	FillDirectionMaxCells?: Bindable<number>;
	StartCorner?: Bindable<EnumItem<"StartCorner">>;
	HorizontalAlignment?: Bindable<EnumItem<"HorizontalAlignment">>;
	VerticalAlignment?: Bindable<EnumItem<"VerticalAlignment">>;
	SortOrder?: Bindable<EnumItem<"SortOrder">>;
	key?: Key;
}

/**
 * `UIPageLayout` props.
 *
 * The pages themselves are the layout's siblings: each keeps its own `Size` and
 * is displaced by a whole container-plus-`Padding` from its neighbour, so a
 * parent with `ClipsDescendants` shows exactly one. Which one is *state*, not a
 * prop — call `JumpToIndex` / `JumpTo` / `Next` / `Previous` on a ref, and read
 * it back as `CurrentPage`, exactly as in Roblox.
 */
export interface UIPageLayoutProps {
	FillDirection?: Bindable<EnumItem<"FillDirection">>;
	HorizontalAlignment?: Bindable<EnumItem<"HorizontalAlignment">>;
	VerticalAlignment?: Bindable<EnumItem<"VerticalAlignment">>;
	SortOrder?: Bindable<EnumItem<"SortOrder">>;
	/** The gap between one page and the next, along `FillDirection`. */
	Padding?: Bindable<UDim>;
	/** `Next`/`Previous` wrap around the ends instead of stopping at them. */
	Circular?: Bindable<boolean>;
	/**
	 * Accepted, and geometry-free: a loom preview shows the settled layout, so
	 * page changes are instant. Same for `TweenTime`/`EasingStyle`/
	 * `EasingDirection`, and for the gamepad/touch/scroll input flags, which a
	 * preview does not route.
	 */
	Animated?: Bindable<boolean>;
	TweenTime?: Bindable<number>;
	EasingStyle?: Bindable<EnumItem<"EasingStyle">>;
	EasingDirection?: Bindable<EnumItem<"EasingDirection">>;
	GamepadInputEnabled?: Bindable<boolean>;
	ScrollWheelInputEnabled?: Bindable<boolean>;
	TouchInputEnabled?: Bindable<boolean>;
	/**
	 * The only modifier that needs one: turning a page is a *method call*, so a
	 * pager is driven through a ref exactly as it is in Roblox.
	 */
	ref?: Ref<LoomInstance>;
	Name?: Bindable<string>;
	key?: Key;
}

/**
 * `UITableLayout` props. The layout's siblings are the table's *lines* — rows,
 * or columns under `MajorAxis.ColumnMajor` — and each line's own children are
 * the cells. A column is as wide as its widest cell and a row as tall as its
 * tallest, both measured against the table's own content box.
 */
export interface UITableLayoutProps {
	/** Are the direct children rows (the default) or columns? */
	MajorAxis?: Bindable<EnumItem<"TableMajorAxis">>;
	/** `X` is the gap between columns, `Y` the gap between rows. */
	Padding?: Bindable<UDim2>;
	/** Scale the columns proportionally so the table spans its container. */
	FillEmptySpaceColumns?: Bindable<boolean>;
	/** Same, for rows. */
	FillEmptySpaceRows?: Bindable<boolean>;
	FillDirection?: Bindable<EnumItem<"FillDirection">>;
	HorizontalAlignment?: Bindable<EnumItem<"HorizontalAlignment">>;
	VerticalAlignment?: Bindable<EnumItem<"VerticalAlignment">>;
	SortOrder?: Bindable<EnumItem<"SortOrder">>;
	key?: Key;
}

/** `UIPadding` props (each side a `UDim`). */
export interface UIPaddingProps {
	PaddingLeft?: Bindable<UDim>;
	PaddingRight?: Bindable<UDim>;
	PaddingTop?: Bindable<UDim>;
	PaddingBottom?: Bindable<UDim>;
	key?: Key;
}

/** `UIAspectRatioConstraint` props. */
export interface UIAspectRatioConstraintProps {
	AspectRatio?: Bindable<number>;
	AspectType?: Bindable<EnumItem<"AspectType">>;
	DominantAxis?: Bindable<EnumItem<"DominantAxis">>;
	key?: Key;
}

/** `UISizeConstraint` props. */
export interface UISizeConstraintProps {
	MinSize?: Bindable<Vector2>;
	MaxSize?: Bindable<Vector2>;
	key?: Key;
}

/** `UICorner` props. */
export interface UICornerProps {
	CornerRadius?: Bindable<UDim>;
	/** Per-corner radii. Each one overrides `CornerRadius` for its own corner. */
	TopLeftRadius?: Bindable<UDim>;
	TopRightRadius?: Bindable<UDim>;
	BottomLeftRadius?: Bindable<UDim>;
	BottomRightRadius?: Bindable<UDim>;
	key?: Key;
}

/** `UIStroke` props. */
export interface UIStrokeProps {
	Color?: Bindable<Color3>;
	Thickness?: Bindable<number>;
	Transparency?: Bindable<number>;
	Enabled?: Bindable<boolean>;
	ApplyStrokeMode?: Bindable<EnumItem<"ApplyStrokeMode">>;
	/** Which side of the edge the thickness sits on. Default `Outer`. */
	BorderStrokePosition?: Bindable<EnumItem<"BorderStrokePosition">>;
	key?: Key;
}

/** `UIShadow` props — the drop shadow Roblox paints under the parent. */
export interface UIShadowProps {
	Color?: Bindable<Color3>;
	/** Blur, as a UDim against the parent's shorter side. */
	BlurRadius?: Bindable<UDim>;
	/** Moves the shadow relative to the parent, per axis. */
	Offset?: Bindable<UDim2>;
	/** Grows or shrinks the shadow relative to the parent, per axis. */
	Spread?: Bindable<UDim2>;
	Transparency?: Bindable<number>;
	Enabled?: Bindable<boolean>;
	ZIndex?: Bindable<number>;
	key?: Key;
}

/** `UIScale` props. */
export interface UIScaleProps {
	Scale?: Bindable<number>;
	key?: Key;
}

/** `UIFlexItem` — one child's share of its list's leftover main-axis space. */
export interface UIFlexItemProps {
	FlexMode?: Bindable<EnumItem<"UIFlexMode">>;
	/** Only read for `FlexMode.Custom`; the weight this item grows by. */
	GrowRatio?: Bindable<number>;
	ShrinkRatio?: Bindable<number>;
	key?: Key;
}
/** `UIGradient` props (Transparency NumberSequence is deferred). */
export interface UIGradientProps {
	Color?: Bindable<ColorSequence>;
	Rotation?: Bindable<number>;
	Offset?: Bindable<Vector2>;
	Enabled?: Bindable<boolean>;
	key?: Key;
}

declare global {
	namespace JSX {
		interface IntrinsicElements {
			screengui: ScreenGuiProps;
			surfacegui: ScreenGuiProps;
			billboardgui: ScreenGuiProps;
			frame: GuiProps;
			scrollingframe: ScrollingFrameProps;
			canvasgroup: CanvasGroupProps;
			viewportframe: GuiProps;
			videoframe: GuiProps;
			textlabel: TextGuiProps;
			textbutton: TextGuiProps;
			textbox: TextBoxProps;
			imagelabel: ImageGuiProps;
			imagebutton: ImageGuiProps;
			uilistlayout: UIListLayoutProps;
			uigridlayout: UIGridLayoutProps;
			uipagelayout: UIPageLayoutProps;
			uitablelayout: UITableLayoutProps;
			uipadding: UIPaddingProps;
			uiaspectratioconstraint: UIAspectRatioConstraintProps;
			uisizeconstraint: UISizeConstraintProps;
			uicorner: UICornerProps;
			uistroke: UIStrokeProps;
			uishadow: UIShadowProps;
			uiscale: UIScaleProps;
			uiflexitem: UIFlexItemProps;
			uigradient: UIGradientProps;
		}
	}
}
