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
import { fontShorthand, instanceFont, renderScene } from "@loom-dev/renderer";
import { EnumItem, toPropertyValue } from "@loom-dev/runtime";
import {
	fontSizeToPx,
	type PropertyValue,
	prop,
	type SceneNode,
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

/**
 * Measure an auto-sizing text node with the font the renderer paints and emit a
 * `TextBounds` Vector2 the layout engine reads for AutomaticSize (font metrics
 * live browser-side, not in the WASM engine). Mirrors the react adapter.
 */
function measureTextBounds(live: LiveNode): PropertyValue | undefined {
	if (!TEXT_CLASSES.has(live.className)) return undefined;
	const auto = live.props.get("AutomaticSize");
	const autoName = auto instanceof EnumItem ? auto.Name : undefined;
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
			: (fontSizeToPx(
					rawFontSize instanceof EnumItem ? rawFontSize.Name : undefined,
				) ?? 14);
	ctx.font = fontShorthand(
		instanceFont({
			Font: live.props.get("Font"),
			FontFace: live.props.get("FontFace"),
		}),
		size,
	);
	const lines = text.split("\n");
	let width = 0;
	for (const line of lines)
		width = Math.max(width, ctx.measureText(line).width);
	return prop.vector2({ x: Math.ceil(width), y: lines.length * size });
}

/** Snapshot the live tree as Scene IR (called fresh on every paint). */
function toScene(live: LiveNode): SceneNode {
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
	const textBounds = measureTextBounds(live);
	if (textBounds) properties.TextBounds = textBounds;
	if (Object.keys(properties).length > 0) node.properties = properties;
	const children = live.children.flatMap((slot) => slot.nodes);
	if (children.length > 0) node.children = children.map(toScene);
	return node;
}

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
): () => void {
	const host = document.createElement("div");
	host.style.position = "absolute";
	host.style.inset = "0";
	resolveHost(target).appendChild(host);

	return root((dispose) => {
		let ready = false;
		let scheduled = false;
		let disposed = false;
		let live: LiveNode | undefined;

		const paint = (): void => {
			scheduled = false;
			if (disposed || !ready || !live) return;
			const width = host.clientWidth;
			const height = host.clientHeight;
			if (width === 0 || height === 0) return; // wait for the mount to be sized
			try {
				const scene = toScene(live);
				renderScene(scene, computeLayout(scene, { width, height }), host);
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
		void initLayout().then(() => {
			ready = true;
			paint();
		});

		return () => {
			disposed = true; // a queued microtask paint must not resurrect the DOM
			observer.disconnect();
			dispose();
			host.remove();
		};
	});
}
