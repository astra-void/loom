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
} from "@loom-dev/renderer";
import type {
	Color3,
	ColorSequence,
	Font,
	LoomConnection,
	LoomInstance,
	UDim,
	UDim2,
} from "@loom-dev/runtime";
import {
	createInstance as createLoomInstance,
	EnumItem,
	flushDirtyNow,
	getEventSignal,
	getInternalId,
	getRawProperties,
	getService,
	isLoomInstance,
	markDirty,
	moveChildBefore,
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
	asEnum,
	asUDim2,
	childrenOf,
	fontSizeToPx,
	type PropertyValue,
	participatesInLayout,
	prop,
	type SceneNode,
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
		if (prev[key] !== value) applyProp(inst, key, value);
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
	const name = fontSize instanceof EnumItem ? fontSize.Name : undefined;
	return fontSizeToPx(name) ?? 14;
}

/**
 * Measure an auto-sizing text node's pixel bounds with the same font the renderer
 * paints, and emit them as a `TextBounds` Vector2 the layout engine reads for
 * AutomaticSize (font metrics live browser-side, not in the WASM engine).
 */
function measureTextBounds(inst: LoomInstance): PropertyValue | undefined {
	if (!TEXT_CLASSES.has(inst.ClassName)) return undefined;
	const auto = inst.AutomaticSize;
	const autoName = auto instanceof EnumItem ? auto.Name : undefined;
	if (autoName !== "X" && autoName !== "Y" && autoName !== "XY")
		return undefined;
	const text = inst.Text;
	if (typeof text !== "string" || text === "") return undefined;
	const ctx = getMeasureCtx();
	if (!ctx) return undefined;

	const size = liveTextSize(inst.TextSize, inst.FontSize);
	ctx.font = fontShorthand(instanceFont(inst), size);
	const lines = text.split("\n");
	let width = 0;
	for (const line of lines) {
		width = Math.max(width, ctx.measureText(line).width);
	}
	return prop.vector2({ x: Math.ceil(width), y: lines.length * size });
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
			const scene = this.encodeRoot();
			if (!scene) {
				this.session.clear();
				return;
			}
			const layout = this.computeLayout(scene, { width, height });
			this.session.patch(scene, layout);
			// Layout feedback: record absolute geometry, firing the
			// AbsolutePosition/AbsoluteSize signals only where it changed.
			for (const [id, entry] of Object.entries(layout.rects)) {
				const inst = this.byId.get(id);
				if (!inst) continue; // e.g. the synthetic "loom-root" wrapper
				updateAbsoluteGeometry(
					inst,
					Vector2.new(entry.rect.x, entry.rect.y),
					Vector2.new(entry.rect.width, entry.rect.height),
				);
			}
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
	 * - `AbsoluteWindowSize` = the frame's own laid-out rect (w, h). Loom draws
	 *   no native scrollbars (lattice paints its own thumb), so the window is
	 *   never reduced by `ScrollBarThickness`.
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
		if (node.className === "ScrollingFrame" && node.id && rect) {
			const inst = this.byId.get(node.id);
			if (inst) {
				const canvasSize = asUDim2(node.properties?.CanvasSize);
				const resolvedX = canvasSize
					? canvasSize.x.scale * rect.width + canvasSize.x.offset
					: 0;
				const resolvedY = canvasSize
					? canvasSize.y.scale * rect.height + canvasSize.y.offset
					: 0;
				let childMaxX = 0;
				let childMaxY = 0;
				for (const child of childrenOf(node)) {
					if (!participatesInLayout(child.className) || !child.id) continue;
					const childRect = layout.rects[child.id]?.rect;
					if (!childRect) continue;
					childMaxX = Math.max(
						childMaxX,
						childRect.x + childRect.width - rect.x,
					);
					childMaxY = Math.max(
						childMaxY,
						childRect.y + childRect.height - rect.y,
					);
				}
				const auto =
					asEnum(node.properties?.AutomaticCanvasSize)?.name ?? "None";
				const autoX = auto === "X" || auto === "XY";
				const autoY = auto === "Y" || auto === "XY";
				setFeedbackProperty(
					inst,
					"AbsoluteWindowSize",
					Vector2.new(rect.width, rect.height),
				);
				setFeedbackProperty(
					inst,
					"AbsoluteCanvasSize",
					Vector2.new(
						autoX ? Math.max(resolvedX, childMaxX) : resolvedX,
						autoY ? Math.max(resolvedY, childMaxY) : resolvedY,
					),
				);
			}
		}
		for (const child of childrenOf(node)) {
			this.applyScrollMetrics(child, layout);
		}
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

const hostConfig = {
	supportsMutation: true,
	supportsPersistence: false,
	supportsHydration: false,
	isPrimaryRenderer: true,
	noTimeout: -1 as const,
	scheduleTimeout: setTimeout,
	cancelTimeout: clearTimeout,

	createInstance(type: string, props: Props): LoomInstance {
		const instance = createLoomInstance(classNameOf(type));
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
	TextScaled?: Bindable<boolean>;
	TextXAlignment?: Bindable<EnumItem<"TextXAlignment">>;
	TextYAlignment?: Bindable<EnumItem<"TextYAlignment">>;
	/** The legacy font enum. `FontFace` wins when both are set, as in Roblox. */
	Font?: Bindable<EnumItem<"Font">>;
	FontFace?: Bindable<Font>;
	/** The legacy text-size enum. `TextSize` wins when both are set. */
	FontSize?: Bindable<EnumItem<"FontSize">>;
}

/** `ImageLabel`/`ImageButton` add the image props the `<img>` layer maps. */
export interface ImageGuiProps extends GuiProps {
	/**
	 * `rbxassetid://<id>`, or any URL an `<img>` can load. Asset ids need a
	 * resolver installed by the host — `@loom-dev/preview` ships one, so they
	 * paint under `loom preview` and stay blank elsewhere until one is set.
	 */
	Image?: Bindable<string>;
	ImageTransparency?: Bindable<number>;
	/** `Slice` and `Tile` are accepted but paint as `Stretch` for now. */
	ScaleType?: Bindable<EnumItem<"ScaleType">>;
	/** Accepted but unpainted: tinting needs more than one `<img>`. */
	ImageColor3?: Bindable<Color3>;
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
	/** Accepted but unrendered: lattice paints its own scrollbar thumb. */
	ScrollBarThickness?: Bindable<number>;
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
	key?: Key;
}

/** `UIStroke` props. */
export interface UIStrokeProps {
	Color?: Bindable<Color3>;
	Thickness?: Bindable<number>;
	Transparency?: Bindable<number>;
	ApplyStrokeMode?: Bindable<EnumItem<"ApplyStrokeMode">>;
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
			uipadding: UIPaddingProps;
			uiaspectratioconstraint: UIAspectRatioConstraintProps;
			uisizeconstraint: UISizeConstraintProps;
			uicorner: UICornerProps;
			uistroke: UIStrokeProps;
			uiscale: UIScaleProps;
			uiflexitem: UIFlexItemProps;
			uigradient: UIGradientProps;
		}
	}
}
