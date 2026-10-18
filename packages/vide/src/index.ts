/**
 * `@loom-dev/vide` — a vide frontend adapter for loom.
 *
 * The second proof that the Scene IR is the real contract: vide is push-based
 * fine-grained reactivity (no VDOM, no reconciler — see `./reactive`), yet it
 * feeds the *exact same* `SceneNode` tree into the *same* WASM layout engine and
 * DOM renderer that `@loom-dev/react` uses. Nothing in `@loom-dev/layout` or
 * `@loom-dev/renderer` knows which frontend produced the tree.
 *
 * Authoring mirrors vide: `create("Frame")({ ...props, [1]: child })`, where
 * string keys are Roblox properties (a function value is a reactive binding) and
 * number keys are children (vide's array-part).
 */
import { computeLayout, initLayout } from "@loom-dev/layout";
import {
	fontShorthand,
	instanceFont,
	onFontsChanged,
	renderScene,
	shapedTextWidth,
} from "@loom-dev/renderer";
import { enumName, toPropertyValue } from "@loom-dev/runtime";
import {
	fontSizeToPx,
	type LayoutResult,
	type PropertyValue,
	participatesInLayout,
	prop,
	type SceneNode,
	type Viewport,
} from "@loom-dev/scene";
import { effect, root } from "./reactive";

export {
	cleanup,
	derive,
	effect,
	root,
	type Source,
	source,
} from "./reactive";

// --- authoring: create() -----------------------------------------------------

const VIDE_NODE = Symbol("loom.vide.node");

/** A vide element descriptor produced by `create`. */
export interface VideNode {
	readonly [VIDE_NODE]: true;
	readonly className: string;
	readonly props: Readonly<Record<string, unknown>>;
}

function isVideNode(value: unknown): value is VideNode {
	return (
		typeof value === "object" &&
		value !== null &&
		(value as { [VIDE_NODE]?: unknown })[VIDE_NODE] === true
	);
}

/**
 * `create("Frame")` returns a constructor taking a props table. String keys are
 * Roblox properties (a function value is bound reactively at mount); number keys
 * are children.
 */
export function create(
	className: string,
): (props?: Record<string, unknown>) => VideNode {
	return (props = {}) => ({ [VIDE_NODE]: true, className, props });
}

// --- live tree ---------------------------------------------------------------

/**
 * A resolved, mutable mirror of a `VideNode`. Reactive props write their current
 * value into `props`; `toScene` reads it. Children are grouped into slots so a
 * reactive (function) child can swap its subtree in place without disturbing its
 * siblings; a static child is a one-shot slot.
 */
interface LiveNode {
	className: string;
	name: string;
	id: string;
	props: Map<string, unknown>;
	children: ChildSlot[];
}

/** A positional group of children — its `nodes` are re-derived if reactive. */
interface ChildSlot {
	nodes: LiveNode[];
}

let nextId = 0;

/** Resolve a child value (a node, or nested arrays of nodes) to LiveNodes. */
function resolveChildren(value: unknown, schedule: () => void): LiveNode[] {
	if (isVideNode(value)) return [build(value, schedule)];
	if (Array.isArray(value)) {
		return value.flatMap((item) => resolveChildren(item, schedule));
	}
	return [];
}

function addChildSlot(
	parent: LiveNode,
	value: unknown,
	schedule: () => void,
): void {
	if (typeof value === "function") {
		// A reactive child (vide's control-flow pattern): rebuild this slot's
		// subtree whenever the function's sources change. The rebuilt nodes' own
		// reactive bindings nest under this effect, so they dispose on each re-run.
		const slot: ChildSlot = { nodes: [] };
		parent.children.push(slot);
		effect(() => {
			slot.nodes = resolveChildren((value as () => unknown)(), schedule);
			schedule();
		});
	} else {
		parent.children.push({ nodes: resolveChildren(value, schedule) });
	}
}

/** Build a `LiveNode` from a `VideNode`, wiring reactive props/children. */
function build(node: VideNode, schedule: () => void): LiveNode {
	const live: LiveNode = {
		className: node.className,
		name: node.className,
		id: `v${nextId++}`,
		props: new Map(),
		children: [],
	};
	for (const [key, value] of Object.entries(node.props)) {
		if (/^\d+$/.test(key)) {
			addChildSlot(live, value, schedule);
			continue;
		}
		if (key === "Name" && typeof value === "string") {
			live.name = value;
			continue;
		}
		if (typeof value === "function") {
			// A reactive prop: re-resolve and repaint whenever its sources change.
			effect(() => {
				live.props.set(key, (value as () => unknown)());
				schedule();
			});
		} else {
			live.props.set(key, value);
		}
	}
	return live;
}

// --- live tree → Scene IR ----------------------------------------------------

const TEXT_CLASSES = new Set(["TextLabel", "TextButton", "TextBox"]);
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

/** Is `AutomaticSize` covering the X axis, so the width is content-derived? */
function autoOnX(live: LiveNode): boolean {
	const auto = live.props.get("AutomaticSize");
	const name = enumName(auto);
	return name === "X" || name === "XY";
}

/**
 * Horizontal `UIPadding` on `live`, in pixels — the room it takes away from
 * whatever it holds. Offsets only, which is what the layout engine resolves a
 * scale inset to on an automatic axis. Mirrors the react adapter.
 */
function horizontalPadding(live: LiveNode): number {
	for (const slot of live.children) {
		for (const child of slot.nodes) {
			if (child.className !== "UIPadding") continue;
			const side = (name: string): number => {
				const udim = child.props.get(name) as { Offset?: unknown } | undefined;
				return typeof udim?.Offset === "number" ? udim.Offset : 0;
			};
			return side("PaddingLeft") + side("PaddingRight");
		}
	}
	return 0;
}

/**
 * The width `TextWrapped` text wraps at, or `undefined` when it does not wrap.
 * `TextWrap` is the engine's own deprecated alias for the same property, and
 * `TextWrapped` still wins when both are set.
 *
 * `room` is what the parent had left for its children (see {@link toScene}) and
 * `own` is this node's own width from the last layout:
 * - **X is not automatic** — the node's own width is fixed, so it is the
 *   constraint and the height grows to however many lines result.
 * - **X is automatic** — the node's width is the thing being computed, so
 *   wrapping against it would settle at one word per line. The room the nearest
 *   ancestor with a width of its own leaves is the constraint instead, which is
 *   what such a label does in Studio.
 *
 * Both come from the layout that last ran, so the first snapshot of a label
 * measures unwrapped; `paint` re-snapshots until the widths it measured against
 * are the ones the layout produced.
 */
function wrapWidth(
	live: LiveNode,
	room: number | undefined,
	own: number | undefined,
): number | undefined {
	const wrapped = live.props.get("TextWrapped") ?? live.props.get("TextWrap");
	if (wrapped !== true) return undefined;
	const width = autoOnX(live) ? room : own;
	return width !== undefined && width > 0 ? width : undefined;
}

/** Whether a row can shrink `item`. Mirrors the react adapter's `shrinksInRow`. */
function shrinksInRow(item: LiveNode, listFills: boolean): boolean {
	const flex = item.children
		.flatMap((slot) => slot.nodes)
		.find((child) => child.className === "UIFlexItem");
	if (!flex) return listFills;
	switch (enumName(flex.props.get("FlexMode"))) {
		case "Shrink":
		case "Fill":
			return true;
		case "Custom": {
			const ratio = flex.props.get("ShrinkRatio");
			return typeof ratio === "number" && ratio > 0;
		}
		default:
			return false;
	}
}

/**
 * A row item's width before flex grows or shrinks it. Mirrors the react
 * adapter's `basisWidth`: its `Size` (clamped by a `UISizeConstraint`) when that
 * is a width of its own, else what it was laid out at.
 */
function basisWidth(
	item: LiveNode,
	content: number,
	laidOut: number | undefined,
): number {
	const size = item.props.get("Size") as
		| { X?: { Scale?: unknown; Offset?: unknown } }
		| undefined;
	const x = size?.X;
	if (autoOnX(item) || typeof x?.Offset !== "number") return laidOut ?? 0;
	let width = x.Offset + (typeof x.Scale === "number" ? x.Scale : 0) * content;
	const constraint = item.children
		.flatMap((slot) => slot.nodes)
		.find((child) => child.className === "UISizeConstraint");
	const min = (constraint?.props.get("MinSize") as { X?: unknown } | undefined)
		?.X;
	const max = (constraint?.props.get("MaxSize") as { X?: unknown } | undefined)
		?.X;
	if (typeof max === "number") width = Math.min(width, max);
	if (typeof min === "number") width = Math.max(width, min);
	return Math.max(0, width);
}

/**
 * The width a row shrinks its items into: its own laid-out width, or a
 * `ScrollingFrame`'s canvas when that is fixed. `undefined` before the first
 * layout, and for a canvas the engine lets grow to its items (automatic, or with
 * no width), where nothing shrinks. Mirrors the react adapter's `flexRoom`.
 */
function shrinkableWidth(
	row: LiveNode,
	own: number | undefined,
): number | undefined {
	if (own === undefined || own <= 0) return undefined;
	if (row.className !== "ScrollingFrame") return own;
	const auto = enumName(row.props.get("AutomaticCanvasSize"));
	const x = (
		row.props.get("CanvasSize") as
			| { X?: { Scale?: unknown; Offset?: unknown } }
			| undefined
	)?.X;
	const canvas =
		(typeof x?.Offset === "number" ? x.Offset : 0) +
		(typeof x?.Scale === "number" ? x.Scale : 0) * own;
	return auto === "X" || auto === "XY" || canvas <= 0 ? undefined : canvas;
}

/**
 * The room a horizontal flex row leaves each item it can shrink, by id: the
 * row's `content` width less every other item's width before flex and the gaps
 * between them. `undefined` when `children` hold no horizontal list that
 * shrinks. Mirrors the react adapter's `flexRoom`.
 */
function flexRooms(
	children: LiveNode[],
	content: number,
	ctx: SnapshotContext,
): Map<string, number> | undefined {
	const list = children.find((child) => child.className === "UIListLayout");
	if (
		!list ||
		enumName(list.props.get("FillDirection")) !== "Horizontal" ||
		list.props.get("Wraps") === true
	)
		return undefined;
	const listFills = enumName(list.props.get("HorizontalFlex")) === "Fill";
	const items = children.filter(
		(child) =>
			participatesInLayout(child.className) &&
			child.props.get("Visible") !== false,
	);
	const pad = list.props.get("Padding") as
		| { Offset?: unknown; Scale?: unknown }
		| undefined;
	const gap =
		(typeof pad?.Offset === "number" ? pad.Offset : 0) +
		(typeof pad?.Scale === "number" ? pad.Scale : 0) * content;
	const bases = items.map((item) =>
		basisWidth(item, content, ctx.rects[item.id]?.rect.width),
	);
	const total = bases.reduce((sum, width) => sum + width, 0);
	const rooms = new Map<string, number>();
	items.forEach((item, i) => {
		if (!shrinksInRow(item, listFills)) return;
		const others = total - (bases[i] ?? 0);
		const room = content - others - gap * Math.max(0, items.length - 1);
		rooms.set(item.id, Math.max(room, 1));
	});
	return rooms;
}

/**
 * Measure an auto-sizing text node with the font the renderer paints and emit a
 * `TextBounds` Vector2 the layout engine reads for AutomaticSize (font metrics
 * live browser-side, not in the WASM engine). Mirrors the react adapter.
 *
 * With `wrapAt` set the words are laid into lines greedily, which is what
 * `TextWrapped` asks for; without it each newline is the only line break.
 */
function measureTextBounds(
	live: LiveNode,
	wrapAt?: number,
): PropertyValue | undefined {
	if (!TEXT_CLASSES.has(live.className)) return undefined;
	const auto = live.props.get("AutomaticSize");
	const autoName = enumName(auto);
	if (autoName !== "X" && autoName !== "Y" && autoName !== "XY")
		return undefined;
	const text = live.props.get("Text");
	if (typeof text !== "string" || text === "") return undefined;
	const ctx = getMeasureCtx();
	if (!ctx) return undefined;

	// `TextSize` wins, legacy `FontSize` fills in, 14 is the Roblox default —
	// same precedence as `@loom-dev/scene`'s `getTextSize` and the react adapter.
	const rawSize = live.props.get("TextSize");
	const rawFontSize = live.props.get("FontSize");
	const size =
		typeof rawSize === "number"
			? rawSize
			: (fontSizeToPx(enumName(rawFontSize)) ?? 14);
	ctx.font = fontShorthand(
		instanceFont({
			Font: live.props.get("Font"),
			FontFace: live.props.get("FontFace"),
		}),
		size,
	);
	// `LineHeight` stretches the gap between lines, so it starts paying from the
	// second one — same rule as `@loom-dev/scene`'s `getLineHeight`.
	const rawLineHeight = live.props.get("LineHeight");
	const lineHeight =
		typeof rawLineHeight === "number"
			? Math.min(3, Math.max(1, rawLineHeight))
			: 1;

	let width = 0;
	let height = 0;
	let lines = 0;
	const endLine = (lineWidth: number): void => {
		width = Math.max(width, lineWidth);
		height += lines === 0 ? size : size * lineHeight;
		lines += 1;
	};
	for (const line of text.split("\n")) {
		if (wrapAt === undefined) {
			endLine(shapedTextWidth(ctx, line));
			continue;
		}
		let lineWidth = 0;
		// Split *keeping* the whitespace, so the gaps between words are measured
		// rather than assumed.
		for (const piece of line.split(/(\s+)/)) {
			if (piece === "") continue;
			const pieceWidth = shapedTextWidth(ctx, piece);
			if (lineWidth > 0 && lineWidth + pieceWidth > wrapAt) {
				endLine(lineWidth);
				lineWidth = 0;
				// A run of spaces that would overflow is dropped rather than carried
				// to the start of the next line, as every text shaper does.
				if (piece.trim() === "") continue;
			}
			lineWidth += pieceWidth;
		}
		endLine(lineWidth);
	}
	return prop.vector2({ x: width, y: height });
}

/** What one snapshot of the live tree needs from the layout that last ran. */
interface SnapshotContext {
	/** Rects from the previous layout — where wrapped text learns its room. */
	readonly rects: LayoutResult["rects"];
	/** id → the wrap width each measured text node was measured against. */
	readonly wrap: Map<string, number>;
}

/**
 * Snapshot the live tree as Scene IR (called fresh on every paint). `room` is
 * what the parent has left for its children: the width of the nearest ancestor
 * that has one of its own, less every `UIPadding` in between.
 */
function toScene(
	live: LiveNode,
	ctx: SnapshotContext,
	room?: number,
): SceneNode {
	const node: SceneNode = {
		className: live.className,
		name: live.name,
		id: live.id,
	};
	const properties: Record<string, PropertyValue> = {};
	for (const [key, value] of live.props) {
		const pv = toPropertyValue(value);
		if (pv !== undefined) properties[key] = pv;
	}
	const own = ctx.rects[live.id]?.rect.width;
	const wrapAt = wrapWidth(live, room, own);
	const textBounds = measureTextBounds(live, wrapAt);
	if (textBounds) {
		properties.TextBounds = textBounds;
		ctx.wrap.set(live.id, wrapAt ?? 0);
	}
	if (Object.keys(properties).length > 0) node.properties = properties;
	const children = live.children.flatMap((slot) => slot.nodes);
	if (children.length > 0) {
		// An auto-sized node was itself sized by what is inside it, so it passes
		// its parent's room down untouched; a node with a width of its own becomes
		// the constraint. Either way its own padding comes off.
		const base = autoOnX(live) ? room : own;
		const inner =
			base === undefined ? undefined : base - horizontalPadding(live);
		// An item a horizontal flex row can shrink is sized by the row, so it
		// gets the room the row leaves it rather than the whole content box.
		const canvas = shrinkableWidth(live, own);
		const rooms =
			autoOnX(live) || canvas === undefined
				? undefined
				: flexRooms(children, canvas - horizontalPadding(live), ctx);
		node.children = children.map((child) =>
			toScene(child, ctx, rooms?.get(child.id) ?? inner),
		);
	}
	return node;
}

/** Whether two snapshots measured their wrapped text against the same widths. */
function sameWrap(a: Map<string, number>, b: Map<string, number>): boolean {
	if (a.size !== b.size) return false;
	for (const [id, width] of a) if (b.get(id) !== width) return false;
	return true;
}

// How many times one paint will re-snapshot wrapped text against the width the
// layout it just ran produced. Two is the settling case (measure unwrapped →
// learn the width → measure wrapped); the rest is headroom for a label whose
// wrapping changes the width it wraps against. Mirrors the react adapter.
const MAX_WRAP_PASSES = 4;

// --- mount -------------------------------------------------------------------

const HOST_ID = "loom-root";

/** The outer preview viewport (`#loom-root`), created if the host page lacks it. */
function resolveHost(target?: HTMLElement): HTMLElement {
	if (target) return target;
	const existing = document.getElementById(HOST_ID);
	if (existing) return existing;
	const el = document.createElement("div");
	el.id = HOST_ID;
	el.style.position = "relative";
	el.style.width = "100vw";
	el.style.height = "100vh";
	el.style.overflow = "hidden";
	document.body.appendChild(el);
	return el;
}

/** The layout pass a mount runs; the WASM engine unless one is injected. */
export type ComputeLayout = (
	root: SceneNode,
	viewport: Viewport,
) => LayoutResult;

export interface MountOptions {
	/** Replace the WASM layout engine (tests). Skips {@link initLayout}. */
	computeLayout?: ComputeLayout;
}

/**
 * Mount a vide component into the preview DOM and return an unmount function.
 * `component` is run once to build the tree; reactive props/children drive
 * subsequent repaints. Each mount gets its own container under `#loom-root`, so
 * independent mounts don't clobber each other (the renderer replaces its own
 * container's children every commit). The tree is laid out (WASM) and rendered
 * with a ResizeObserver re-laying-out on viewport changes — same as react.
 */
export function mount(
	component: () => VideNode,
	target?: HTMLElement,
	options?: MountOptions,
): () => void {
	const host = document.createElement("div");
	host.style.position = "absolute";
	host.style.inset = "0";
	resolveHost(target).appendChild(host);

	const layoutOf = options?.computeLayout ?? computeLayout;

	return root((dispose) => {
		let ready = false;
		let scheduled = false;
		let disposed = false;
		let live: LiveNode | undefined;
		/** The rects the last paint produced — this one's wrap widths come from it. */
		let rects: LayoutResult["rects"] = {};

		const paint = (): void => {
			scheduled = false;
			if (disposed || !ready || !live) return;
			const width = host.clientWidth;
			const height = host.clientHeight;
			if (width === 0 || height === 0) return; // wait for the mount to be sized
			try {
				// Wrapped text is measured against a width that only exists once the
				// layout has run, so the first snapshot of a label is unwrapped.
				// Rendering that pass would put a label wider than its container into
				// the DOM, and during a live window resize — where every frame brings
				// a fresh width — the stale pass is what stays on screen. So keep
				// re-snapshotting until the widths measured against are the ones the
				// layout produced, and render once, with the settled result.
				let scene: SceneNode | undefined;
				let layout: LayoutResult | undefined;
				let measured: Map<string, number> | undefined;
				for (let pass = 0; pass < MAX_WRAP_PASSES; pass++) {
					const wrap = new Map<string, number>();
					const next = toScene(live, { rects, wrap });
					// The snapshot this pass would lay out is the one already laid
					// out: nothing moved, so it has settled.
					if (measured && sameWrap(measured, wrap)) break;
					scene = next;
					measured = wrap;
					layout = layoutOf(scene, { width, height });
					rects = layout.rects;
				}
				if (!scene || !layout) return;
				renderScene(scene, layout, host);
			} catch (err) {
				// Never let a malformed scene escape an effect or the RO callback.
				console.error("loom vide:", err);
			}
		};
		const schedule = (): void => {
			if (scheduled) return;
			scheduled = true;
			queueMicrotask(paint);
		};

		// Build inside this root so the reactive bindings are disposable.
		live = build(component(), schedule);

		const observer = new ResizeObserver(() => paint());
		observer.observe(host);
		// Text bounds were measured against the faces the browser had at the time,
		// so a face arriving later invalidates the layout that came out of them.
		const stopFontWatch = onFontsChanged(() => paint());
		if (options?.computeLayout) {
			ready = true;
			paint();
		} else {
			void initLayout().then(() => {
				ready = true;
				paint();
			});
		}

		return () => {
			disposed = true; // a queued microtask paint must not resurrect the DOM
			observer.disconnect();
			stopFontWatch();
			dispose();
			host.remove();
		};
	});
}
