/**
 * `instance.ts` — `LoomInstance`, the Proxy-based live Roblox instance.
 *
 * Every mounted GUI object is one of these: a property store + lazy signals
 * (per-property `GetPropertyChangedSignal` and Roblox events) + tree operations
 * (`FindFirstChild`, `IsA`, `Destroy`, …). React refs, event dispatch, motion's
 * direct property writes, and portal containers all share the same object.
 * Property writes mark the instance dirty so the scheduler re-flushes the world.
 */
import { DEFAULTS, fontSizeToPx } from "@loom-dev/scene";
import { Color3, Rect, UDim, UDim2, Vector2 } from "./datatypes";
import { Enum, enumName } from "./enums";
import { classChain, isA } from "./registry";
import { markDirty } from "./scheduler";
import type { LoomConnection } from "./signal";
import { LoomSignal } from "./signal";

/** Roblox events the proxy exposes as lazily created signals. */
export const EVENT_NAMES: ReadonlySet<string> = new Set([
	"Activated",
	"MouseButton1Click",
	"MouseButton1Down",
	"MouseButton1Up",
	"MouseButton2Click",
	"MouseButton2Down",
	"MouseButton2Up",
	"MouseWheelForward",
	"MouseWheelBackward",
	"InputBegan",
	"InputEnded",
	"InputChanged",
	"MouseEnter",
	"MouseLeave",
	"MouseMoved",
	"Focused",
	"FocusLost",
	"SelectionGained",
	"SelectionLost",
	"Changed",
	"ChildAdded",
	"ChildRemoved",
	"AncestryChanged",
	"AttributeChanged",
	"Destroying",
	// Tween.Completed — read straight off a freshly created tween
	// (`TweenService:Create(...).Completed:Connect(...)`), so it has to resolve
	// before anything has fired it.
	"Completed",
	// UIPageLayout's page-change events, for the same reason: they are connected
	// on mount, long before the first `JumpToIndex` fires one.
	"PageEnter",
	"PageLeave",
	"Stopped",
]);

/**
 * The public face of a live instance. Arbitrary Roblox properties fall through
 * the index signature (`inst.Text`, `inst.BackgroundColor3`, …); the declared
 * members are the tree/reflection API every class shares.
 */
export interface LoomInstance {
	[key: string]: unknown;
	readonly ClassName: string;
	Name: string;
	Parent: LoomInstance | undefined;
	readonly AbsolutePosition: Vector2;
	readonly AbsoluteSize: Vector2;
	readonly Changed: LoomSignal<[string]>;
	readonly ChildAdded: LoomSignal<[LoomInstance]>;
	readonly ChildRemoved: LoomSignal<[LoomInstance]>;
	readonly AncestryChanged: LoomSignal<
		[LoomInstance, LoomInstance | undefined]
	>;
	readonly AttributeChanged: LoomSignal<[string]>;
	readonly Destroying: LoomSignal<[]>;
	IsA(className: string): boolean;
	GetChildren(): LoomInstance[];
	GetDescendants(): LoomInstance[];
	FindFirstChild(name: string, recursive?: boolean): LoomInstance | undefined;
	FindFirstChildOfClass(className: string): LoomInstance | undefined;
	FindFirstAncestor(name: string): LoomInstance | undefined;
	FindFirstAncestorOfClass(className: string): LoomInstance | undefined;
	FindFirstAncestorWhichIsA(className: string): LoomInstance | undefined;
	WaitForChild(name: string, timeout?: number): LoomInstance | undefined;
	Clone(): LoomInstance | undefined;
	IsDescendantOf(ancestor: LoomInstance): boolean;
	GetPropertyChangedSignal(propertyName: string): LoomSignal<[]>;
	GetAttribute(attribute: string): unknown;
	GetAttributes(): Map<string, unknown>;
	SetAttribute(attribute: string, value: unknown): void;
	GetAttributeChangedSignal(attribute: string): LoomSignal<[]>;
	Destroy(): void;
	ClearAllChildren(): void;
	GetFullName(): string;
}

interface InstanceImpl {
	readonly id: string;
	readonly className: string;
	readonly props: Map<string, unknown>;
	parent: InstanceImpl | undefined;
	readonly children: InstanceImpl[];
	readonly propSignals: Map<string, LoomSignal<[]>>;
	readonly eventSignals: Map<string, LoomSignal<unknown[]>>;
	/**
	 * Attributes live beside the property store rather than in it: Roblox keeps
	 * the two namespaces apart — an attribute never shows up as a property, does
	 * not fire `Changed`, and is not something the renderer paints.
	 */
	readonly attributes: Map<string, unknown>;
	readonly attributeSignals: Map<string, LoomSignal<[]>>;
	destroyed: boolean;
	absolutePosition: Vector2;
	absoluteSize: Vector2;
	proxy: LoomInstance;
}

let nextId = 0;

/** proxy → impl; also the `isLoomInstance` membership set. */
const IMPLS = new WeakMap<object, InstanceImpl>();

/**
 * One class's read defaults. Thunks, so each read hands out its own datatype
 * instance rather than a shared mutable one.
 *
 * Where a number is already Roblox truth in `@loom-dev/scene`'s `DEFAULTS` it is
 * read from there rather than copied: the renderer and the layout engine paint
 * by those, and a second copy here could disagree with what is on screen, which
 * is the one thing a default must never do.
 */
type DefaultTable = Readonly<Record<string, () => unknown>>;

/** A runtime `Color3` out of the 0..1 channels `@loom-dev/scene` stores. */
function sceneColor(channels: { r: number; g: number; b: number }): Color3 {
	return new Color3(channels.r, channels.g, channels.b);
}

/**
 * `Enum.BorderMode.Outline`, the `GuiObject` default — looked up rather than
 * written down, because `enums.ts` owns the namespace and has no `BorderMode` in
 * it yet. Minting a stand-in item here would be worse than answering nothing:
 * once the enum lands, `frame.BorderMode == Enum.BorderMode.Outline` would be
 * comparing two objects that merely look alike. The property starts answering
 * the moment the enum exists, with no change needed here.
 */
function borderModeOutline(): unknown {
	const borderMode = (Enum as unknown as Record<string, unknown>).BorderMode as
		| Record<string, unknown>
		| undefined;
	return borderMode?.Outline;
}

/**
 * The `GuiObject` properties every 2D class inherits. `BorderColor3` is the same
 * dark navy as the text default, but it is a *separate* engine constant — the
 * two happening to match is not a reason to make one follow the other.
 */
const GUI_OBJECT_DEFAULTS: DefaultTable = {
	Visible: () => DEFAULTS.visible,
	ZIndex: () => DEFAULTS.zIndex,
	BackgroundColor3: () => sceneColor(DEFAULTS.backgroundColor3),
	BackgroundTransparency: () => DEFAULTS.backgroundTransparency,
	BorderColor3: () => Color3.fromRGB(27, 42, 53),
	BorderSizePixel: () => 1,
	BorderMode: () => borderModeOutline(),
	Rotation: () => 0,
	LayoutOrder: () => 0,
	Active: () => false,
	/** New in 2023: `false` greys the object out and stops it taking input. */
	Interactable: () => true,
	/** Gamepad selection, off until an object opts in. */
	Selectable: () => false,
	ClipsDescendants: () => false,
	AnchorPoint: () => Vector2.zero,
	Position: () => new UDim2(),
	Size: () => new UDim2(),
};

/**
 * What `TextLabel`, `TextButton` and `TextBox` share. They have no common
 * ancestor below `GuiObject` — the engine declares the text properties on each
 * of the three — so the table is spread into all three rather than hung off a
 * class that does not exist.
 *
 * `TextBounds` is `(0, 0)` until something measures the text: the adapters
 * measure with the browser's own font metrics and write the result back, so a
 * label read before its first paint reports no bounds, exactly as one read
 * before the engine's first frame does.
 */
const TEXT_DEFAULTS: DefaultTable = {
	TextColor3: () => sceneColor(DEFAULTS.textColor3),
	TextTransparency: () => DEFAULTS.textTransparency,
	TextScaled: () => false,
	RichText: () => false,
	// `TextSize` (14) and `TextWrapped` (false) default too, but they are
	// answered by the alias readers further down — see `textSizeReader`.
	TextXAlignment: () => Enum.TextXAlignment.Center,
	TextYAlignment: () => Enum.TextYAlignment.Center,
	LineHeight: () => DEFAULTS.lineHeight,
	TextStrokeColor3: () => new Color3(0, 0, 0),
	TextStrokeTransparency: () => 1,
	TextBounds: () => Vector2.zero,
	TextFits: () => true,
};

/** What `ImageLabel` and `ImageButton` share, for the same reason. */
const IMAGE_DEFAULTS: DefaultTable = {
	Image: () => "",
	/** White: `ImageColor3` multiplies the image, so white is "no tint". */
	ImageColor3: () => sceneColor(DEFAULTS.imageColor3),
	ImageTransparency: () => DEFAULTS.imageTransparency,
	ScaleType: () => Enum.ScaleType.Stretch,
	SliceCenter: () => Rect.new(0, 0, 0, 0),
	SliceScale: () => 1,
	TileSize: () => UDim2.new(1, 0, 1, 0),
	/** A zero `ImageRectSize` is the engine's "no sprite window". */
	ImageRectOffset: () => Vector2.zero,
	ImageRectSize: () => Vector2.zero,
	/** Nothing has loaded before the DOM has fetched it. */
	IsLoaded: () => false,
};

/**
 * Class-aware read defaults for properties app code reads before ever writing.
 * Roblox reflection always yields a typed value; the props store starts empty,
 * so these keep `inst.Rotation += d` (Spinner motion),
 * `viewport.CanvasPosition.Y` (lattice ScrollArea metrics),
 * `descendant.Visible && …` (a drag's droppable hit test) and
 * `if label.Text ~= "" then` from seeing `undefined`.
 *
 * Keyed by the class that *declares* the property, and resolved up the class
 * chain, so a subclass overrides its base the way the engine's own defaults do
 * (`UIGridLayout` fills horizontally where a `UIListLayout` fills down).
 */
const CLASS_DEFAULTS: Readonly<Record<string, DefaultTable>> = {
	/**
	 * Every instance has it, and `Clone` is built on it: a non-archivable
	 * instance is skipped by a clone and by anything that serializes the tree.
	 */
	Instance: { Archivable: () => true },
	GuiObject: GUI_OBJECT_DEFAULTS,
	CanvasGroup: { GroupTransparency: () => 0 },
	ScrollingFrame: {
		CanvasPosition: () => Vector2.zero,
		AbsoluteWindowSize: () => Vector2.zero,
		AbsoluteCanvasSize: () => Vector2.zero,
		/**
		 * `{0, 0}, {2, 0}` — two windows tall, the engine's odd but real default.
		 *
		 * This is what *reflection* answers, and it is the honest answer. The
		 * layout engine and `scrollMetrics` both read an **absent** `CanvasSize`
		 * as no canvas of its own — children lay out in the window and the frame
		 * does not scroll — so a ScrollingFrame that never sets it scrolls in
		 * Studio and stands still here. Papering over that by reporting a value
		 * the paint side does not use would only hide it in a second place.
		 */
		CanvasSize: () => UDim2.new(0, 0, 2, 0),
		ScrollBarThickness: () => 12,
		ScrollBarImageColor3: () => new Color3(1, 1, 1),
		ScrollBarImageTransparency: () => 0,
		ScrollingEnabled: () => true,
		ScrollingDirection: () => Enum.ScrollingDirection.XY,
		AutomaticCanvasSize: () => Enum.AutomaticCanvasSize.None,
		ElasticBehavior: () => Enum.ElasticBehavior.WhenScrollable,
	},
	LayerCollector: {
		Enabled: () => true,
		ZIndexBehavior: () => Enum.ZIndexBehavior.Sibling,
	},
	ScreenGui: {
		DisplayOrder: () => 0,
		IgnoreGuiInset: () => false,
		ResetOnSpawn: () => true,
	},
	// The three text classes differ only in the placeholder string the engine
	// puts in `Text` — which is exactly the value `if label.Text ~= ""` trips on.
	TextLabel: { ...TEXT_DEFAULTS, Text: () => "Label" },
	TextButton: { ...TEXT_DEFAULTS, Text: () => "Button" },
	TextBox: { ...TEXT_DEFAULTS, Text: () => "TextBox" },
	ImageLabel: IMAGE_DEFAULTS,
	ImageButton: IMAGE_DEFAULTS,
	UIGridStyleLayout: {
		HorizontalAlignment: () => Enum.HorizontalAlignment.Left,
		VerticalAlignment: () => Enum.VerticalAlignment.Top,
		/**
		 * `Name`, not `LayoutOrder` — verified in Studio, and what the layout
		 * engine's `flow_order` already sorts by. Runtime and engine have to give
		 * the same answer here or a list reads one order and lays out another.
		 */
		SortOrder: () => Enum.SortOrder.Name,
	},
	UIListLayout: {
		Padding: () => new UDim(0, 0),
		FillDirection: () => Enum.FillDirection.Vertical,
	},
	// A grid flows across before it wraps down, and a page layout pages sideways:
	// both default to `Horizontal`, unlike the list. `UIGridLayout` has no
	// `Padding` at all — `CellPadding` is its spelling — so it gets none here.
	UIGridLayout: { FillDirection: () => Enum.FillDirection.Horizontal },
	UIPageLayout: {
		Padding: () => new UDim(0, 0),
		FillDirection: () => Enum.FillDirection.Horizontal,
	},
};

function classDefaultProperty(className: string, key: string): unknown {
	for (const cls of classChain(className)) {
		const fallback = CLASS_DEFAULTS[cls]?.[key];
		if (fallback !== undefined) return fallback();
	}
	return undefined;
}

/**
 * `ContentText` — what the engine actually lays out: `Text` with the rich-text
 * markup resolved away. Read-only and computed in Roblox, never stored, so it is
 * a reader rather than a default: a written `Text` has to move it, and nothing
 * ever writes `ContentText` itself.
 *
 * Only the tag *syntax* is undone here (tags dropped, the five XML entities
 * decoded), which is what `ContentText` promises; whether a run ends up bold or
 * red is the renderer's business, not this property's.
 */
const RICH_TEXT_TAG = /<[^<>]*>/g;
const XML_ENTITIES: Readonly<Record<string, string>> = {
	"&lt;": "<",
	"&gt;": ">",
	"&amp;": "&",
	"&quot;": '"',
	"&apos;": "'",
};

function contentText(self: LoomInstance): string {
	const text = self.Text;
	if (typeof text !== "string") return "";
	if (self.RichText !== true) return text;
	return text
		.replace(RICH_TEXT_TAG, "")
		.replace(
			/&(?:lt|gt|amp|quot|apos);/g,
			(entity) => XML_ENTITIES[entity] ?? entity,
		);
}

function getName(impl: InstanceImpl): string {
	return String(impl.props.get("Name") ?? impl.className);
}

function getOrCreatePropSignal(
	impl: InstanceImpl,
	key: string,
): LoomSignal<[]> {
	let signal = impl.propSignals.get(key);
	if (!signal) {
		signal = new LoomSignal();
		impl.propSignals.set(key, signal);
	}
	return signal;
}

function getOrCreateAttributeSignal(
	impl: InstanceImpl,
	attribute: string,
): LoomSignal<[]> {
	let signal = impl.attributeSignals.get(attribute);
	if (!signal) {
		signal = new LoomSignal();
		impl.attributeSignals.set(attribute, signal);
	}
	return signal;
}

function getOrCreateEventSignal(
	impl: InstanceImpl,
	name: string,
): LoomSignal<unknown[]> {
	let signal = impl.eventSignals.get(name);
	if (!signal) {
		signal = new LoomSignal();
		impl.eventSignals.set(name, signal);
	}
	return signal;
}

// --- shared instance methods -------------------------------------------------

function findFirstChildImpl(
	impl: InstanceImpl,
	name: string,
	recursive: boolean,
): InstanceImpl | undefined {
	for (const child of impl.children) {
		if (getName(child) === name) return child;
	}
	if (recursive) {
		for (const child of impl.children) {
			const found = findFirstChildImpl(child, name, true);
			if (found) return found;
		}
	}
	return undefined;
}

/**
 * Roblox rejects an attribute name outright rather than storing something the
 * datamodel cannot serialize: at most 100 characters, alphanumerics and
 * underscore only, and the `RBX` prefix is reserved for the engine. Throwing
 * matches it — a name a real place would refuse should not quietly work here and
 * fail once the code is in Studio.
 */
const ATTRIBUTE_NAME = /^[A-Za-z0-9_]{1,100}$/;

function assertAttributeName(impl: InstanceImpl, attribute: string): void {
	if (!ATTRIBUTE_NAME.test(attribute)) {
		throw new Error(
			`[loom] Attribute name "${attribute}" on ${METHODS.GetFullName(impl)} is invalid — ` +
				"up to 100 alphanumerics and underscores",
		);
	}
	if (attribute.startsWith("RBX")) {
		throw new Error(
			`[loom] Attribute name "${attribute}" on ${METHODS.GetFullName(impl)} is reserved — ` +
				"the RBX prefix belongs to the engine",
		);
	}
}

function collectDescendants(impl: InstanceImpl, out: LoomInstance[]): void {
	for (const child of impl.children) {
		out.push(child.proxy);
		collectDescendants(child, out);
	}
}

function destroyImpl(impl: InstanceImpl, detach: boolean): void {
	if (impl.destroyed) return;
	impl.eventSignals.get("Destroying")?.fire();
	if (detach && impl.parent) {
		const parent = impl.parent;
		const index = parent.children.indexOf(impl);
		if (index >= 0) parent.children.splice(index, 1);
		parent.eventSignals.get("ChildRemoved")?.fire(impl.proxy);
		markDirty(parent.proxy);
	}
	impl.parent = undefined;
	for (const child of [...impl.children]) destroyImpl(child, false);
	impl.children.length = 0;
	for (const signal of impl.propSignals.values()) signal.disconnectAll();
	for (const signal of impl.eventSignals.values()) signal.disconnectAll();
	for (const signal of impl.attributeSignals.values()) signal.disconnectAll();
	impl.propSignals.clear();
	impl.eventSignals.clear();
	impl.attributeSignals.clear();
	impl.destroyed = true;
}

/**
 * The pending half of {@link METHODS.WaitForChild}: a promise for a child that
 * is not there yet, resolved the moment one is.
 *
 * It watches two things, because the engine does: a child being *parented*
 * under the instance, and a child already under it being *renamed* into the
 * name being waited for. Watching only the first would leave
 * `WaitForChild("Panel")` hanging on a tree that builds its children first and
 * names them after, which is exactly how a reconciler builds one.
 *
 * Everything it connected is disconnected as soon as it settles, and `Destroy`
 * drops the signals wholesale, so a wait on a tree that goes away simply never
 * resolves — the same end the engine's yielded thread meets.
 */
function pendingChild(
	impl: InstanceImpl,
	name: string,
	timeout?: number,
): PromiseLike<LoomInstance | undefined> {
	let settle: (value: LoomInstance | undefined) => void = () => {};
	const pending = new Promise<LoomInstance | undefined>((resolve) => {
		settle = resolve;
	});
	const connections: LoomConnection[] = [];
	let timer: ReturnType<typeof setTimeout> | undefined;
	const finish = (value: LoomInstance | undefined): void => {
		for (const connection of connections) connection.Disconnect();
		connections.length = 0;
		if (timer !== undefined) clearTimeout(timer);
		settle(value);
	};
	const check = (): void => {
		const child = findFirstChildImpl(impl, name, false);
		if (child) finish(child.proxy);
	};
	const watchRenames = (child: InstanceImpl): void => {
		connections.push(getOrCreatePropSignal(child, "Name").Connect(check));
	};
	connections.push(
		getOrCreateEventSignal(impl, "ChildAdded").Connect((child) => {
			const childImpl = IMPLS.get(child as object);
			if (childImpl) watchRenames(childImpl);
			check();
		}),
	);
	for (const child of impl.children) watchRenames(child);
	if (timeout !== undefined && timeout > 0) {
		timer = setTimeout(() => finish(undefined), timeout * 1000);
	}
	return pending;
}

/**
 * The recursive half of {@link METHODS.Clone}. Builds the copy's subtree by
 * hand rather than through `Parent`: nothing is connected to a brand-new clone,
 * so firing `ChildAdded` and marking it dirty would only schedule a flush for a
 * tree that is not in the world yet.
 */
function cloneImpl(impl: InstanceImpl): InstanceImpl | undefined {
	if (impl.props.get("Archivable") === false) return undefined;
	const copy = IMPLS.get(createInstance(impl.className)) as InstanceImpl;
	for (const [key, value] of impl.props) copy.props.set(key, value);
	for (const [key, value] of impl.attributes) copy.attributes.set(key, value);
	for (const child of impl.children) {
		const childCopy = cloneImpl(child);
		if (!childCopy) continue;
		childCopy.parent = copy;
		copy.children.push(childCopy);
	}
	return copy;
}

const METHODS = {
	IsA(impl: InstanceImpl, className: string): boolean {
		return isA(impl.className, className);
	},
	GetChildren(impl: InstanceImpl): LoomInstance[] {
		return impl.children.map((child) => child.proxy);
	},
	GetDescendants(impl: InstanceImpl): LoomInstance[] {
		const out: LoomInstance[] = [];
		collectDescendants(impl, out);
		return out;
	},
	FindFirstChild(
		impl: InstanceImpl,
		name: string,
		recursive = false,
	): LoomInstance | undefined {
		return findFirstChildImpl(impl, name, recursive)?.proxy;
	},
	FindFirstChildOfClass(
		impl: InstanceImpl,
		className: string,
	): LoomInstance | undefined {
		for (const child of impl.children) {
			if (child.className === className) return child.proxy;
		}
		return undefined;
	},
	FindFirstAncestor(
		impl: InstanceImpl,
		name: string,
	): LoomInstance | undefined {
		for (let cur = impl.parent; cur; cur = cur.parent) {
			if (getName(cur) === name) return cur.proxy;
		}
		return undefined;
	},
	FindFirstAncestorOfClass(
		impl: InstanceImpl,
		className: string,
	): LoomInstance | undefined {
		for (let cur = impl.parent; cur; cur = cur.parent) {
			if (cur.className === className) return cur.proxy;
		}
		return undefined;
	},
	FindFirstAncestorWhichIsA(
		impl: InstanceImpl,
		className: string,
	): LoomInstance | undefined {
		for (let cur = impl.parent; cur; cur = cur.parent) {
			if (isA(cur.className, className)) return cur.proxy;
		}
		return undefined;
	},
	/**
	 * Present-or-pending, because the browser has no way to yield.
	 *
	 * Roblox blocks the calling thread until a child of that name exists. A child
	 * that is already there comes back directly, which is what every synchronous
	 * caller in a preview does (`LocalPlayer.WaitForChild("PlayerGui")`), and one
	 * that is not comes back as a thenable that resolves when it is parented — or
	 * renamed into place, which the engine also honours — so
	 * `await panel.WaitForChild("Button")` reads like the Luau it was compiled
	 * from. With a `timeout` the thenable resolves to `undefined` once it expires,
	 * as the engine's does; without one it waits forever, and the warning stands
	 * in for the engine's own "Infinite yield possible" notice.
	 *
	 * The declared return type stays `LoomInstance` because that is what the
	 * caller ends up holding either way. Synchronous code that reaches straight
	 * through a *pending* result reads `undefined` members off the thenable
	 * rather than the child's — no worse than the `undefined` this used to return
	 * outright, and the warning says which case it hit.
	 */
	WaitForChild(
		impl: InstanceImpl,
		name: string,
		timeout?: number,
	): LoomInstance | undefined {
		const found = findFirstChildImpl(impl, name, false);
		if (found) return found.proxy;
		console.warn(
			`[loom] WaitForChild("${name}") on ${METHODS.GetFullName(impl)}: ` +
				"child is not there yet — the browser cannot yield, so this returns a " +
				"thenable to await rather than the instance",
		);
		return pendingChild(impl, name, timeout) as unknown as LoomInstance;
	},
	/**
	 * Roblox `Clone`: a deep copy of the instance and its descendants, with
	 * properties and attributes carried over, `Parent` left `nil`, and no event
	 * connections — the copy is a fresh instance that nothing is listening to.
	 *
	 * `Archivable = false` is skipped, which is the flag's whole purpose: a
	 * non-archivable descendant is left out of the copy, and a non-archivable
	 * *root* clones to `nil`.
	 *
	 * Property values are shared rather than re-made: every Roblox datatype is
	 * immutable, so sharing one is indistinguishable from copying it. The one
	 * thing the engine does that this does not is re-point an instance-valued
	 * property at the clone of what it referenced — rare in a GUI tree, and
	 * guessing at it would be worse than leaving the reference where it was.
	 */
	Clone(impl: InstanceImpl): LoomInstance | undefined {
		return cloneImpl(impl)?.proxy;
	},
	IsDescendantOf(impl: InstanceImpl, ancestor: LoomInstance): boolean {
		const ancestorImpl = IMPLS.get(ancestor);
		if (!ancestorImpl) return false;
		for (let cur = impl.parent; cur; cur = cur.parent) {
			if (cur === ancestorImpl) return true;
		}
		return false;
	},
	GetPropertyChangedSignal(
		impl: InstanceImpl,
		propertyName: string,
	): LoomSignal<[]> {
		return getOrCreatePropSignal(impl, propertyName);
	},
	GetAttribute(impl: InstanceImpl, attribute: string): unknown {
		return impl.attributes.get(attribute);
	},
	GetAttributes(impl: InstanceImpl): Map<string, unknown> {
		// A copy, for the reason `GetChildren` returns one: the caller gets a
		// snapshot it can hold onto, not a live view of the store.
		return new Map(impl.attributes);
	},
	SetAttribute(impl: InstanceImpl, attribute: string, value: unknown): void {
		assertAttributeName(impl, attribute);
		// `nil` removes the attribute, which is how Roblox spells "unset" — there
		// is no separate remove call, and a removal still notifies.
		if (value === undefined || value === null) {
			if (!impl.attributes.delete(attribute)) return;
		} else {
			if (
				impl.attributes.has(attribute) &&
				impl.attributes.get(attribute) === value
			) {
				return;
			}
			impl.attributes.set(attribute, value);
		}
		impl.attributeSignals.get(attribute)?.fire();
		impl.eventSignals.get("AttributeChanged")?.fire(attribute);
	},
	GetAttributeChangedSignal(
		impl: InstanceImpl,
		attribute: string,
	): LoomSignal<[]> {
		return getOrCreateAttributeSignal(impl, attribute);
	},
	Destroy(impl: InstanceImpl): void {
		destroyImpl(impl, true);
	},
	ClearAllChildren(impl: InstanceImpl): void {
		for (const child of [...impl.children]) destroyImpl(child, true);
	},
	GetFullName(impl: InstanceImpl): string {
		const names: string[] = [];
		for (let cur: InstanceImpl | undefined = impl; cur; cur = cur.parent) {
			if (cur.className !== "DataModel") names.unshift(getName(cur));
		}
		return names.join(".");
	},
} as const;

type MethodTable = Record<
	string,
	(impl: InstanceImpl, ...args: never[]) => unknown
>;

// --- class extension hooks ---------------------------------------------------

/** A method registered for one class (and inherited by subclasses). */
export type ClassMethod = (self: LoomInstance, ...args: never[]) => unknown;

const CLASS_METHODS = new Map<string, Record<string, ClassMethod>>();

/**
 * Register extra methods for a class (services use this: `GetService`,
 * `GetGuiInset`, `BindAction`, …). Methods are visible on every instance whose
 * class chain contains `className` and receive the proxy as `self`.
 */
export function registerClassMethods(
	className: string,
	methods: Record<string, ClassMethod>,
): void {
	const existing = CLASS_METHODS.get(className);
	CLASS_METHODS.set(className, { ...existing, ...methods });
}

function findClassMethod(
	className: string,
	key: string,
): ClassMethod | undefined {
	for (const cls of classChain(className)) {
		const methods = CLASS_METHODS.get(cls);
		const method = methods?.[key];
		if (method) return method;
	}
	return undefined;
}

/** A property write interceptor (e.g. `GuiService.SelectedObject`). */
export type PropertyInterceptor = (
	self: LoomInstance,
	value: unknown,
	setRaw: (value: unknown) => void,
) => void;

const PROPERTY_INTERCEPTORS = new Map<
	string,
	Map<string, PropertyInterceptor>
>();

/**
 * Intercept writes to `className.propertyName`. The interceptor decides when
 * (and whether) to call `setRaw`, which performs the normal store + signal +
 * dirty-mark path.
 */
export function registerPropertyInterceptor(
	className: string,
	propertyName: string,
	interceptor: PropertyInterceptor,
): void {
	let forClass = PROPERTY_INTERCEPTORS.get(className);
	if (!forClass) {
		forClass = new Map();
		PROPERTY_INTERCEPTORS.set(className, forClass);
	}
	forClass.set(propertyName, interceptor);
}

function findInterceptor(
	className: string,
	key: string,
): PropertyInterceptor | undefined {
	for (const cls of classChain(className)) {
		const interceptor = PROPERTY_INTERCEPTORS.get(cls)?.get(key);
		if (interceptor) return interceptor;
	}
	return undefined;
}

/** A derived property read (e.g. `UIPageLayout.CurrentPage`). */
export type PropertyReader = (self: LoomInstance) => unknown;

const PROPERTY_READERS = new Map<string, Map<string, PropertyReader>>();

/**
 * Register a **derived** read for `className.propertyName` — a property whose
 * value is computed from the tree rather than stored.
 *
 * The read-only Roblox properties that reference other instances need this:
 * `UIPageLayout.CurrentPage` is a GuiObject, which the Scene IR cannot carry as
 * a property value, so the runtime keeps the *index* and derives the instance
 * here. A reader wins over the raw store, which is the point — one source of
 * truth, no way for the two to drift.
 */
export function registerPropertyReader(
	className: string,
	propertyName: string,
	reader: PropertyReader,
): void {
	let forClass = PROPERTY_READERS.get(className);
	if (!forClass) {
		forClass = new Map();
		PROPERTY_READERS.set(className, forClass);
	}
	forClass.set(propertyName, reader);
}

function findPropertyReader(
	className: string,
	key: string,
): PropertyReader | undefined {
	for (const cls of classChain(className)) {
		const reader = PROPERTY_READERS.get(cls)?.get(key);
		if (reader) return reader;
	}
	return undefined;
}

/** The instance's own stored value for `key`, with no default behind it. */
function rawProperty(self: LoomInstance, key: string): unknown {
	return IMPLS.get(self)?.props.get(key);
}

/**
 * `TextWrapped` and its deprecated alias `TextWrap`. The engine holds *one*
 * property under two names — Roblox's own docs call `TextWrap` "simply an alias"
 * — so both spellings have to answer the same thing.
 *
 * A reader rather than a default, and one that reads the raw store rather than
 * the proxy, because a class default now answers where `undefined` used to:
 * consumers written as `TextWrapped ?? TextWrap` (the react adapter measures its
 * wrap width that way) would take the default `false` as an answer and never
 * look at the alias, and a label that set only `TextWrap` would stop wrapping.
 */
function textWrappedReader(self: LoomInstance): unknown {
	return (
		rawProperty(self, "TextWrapped") ?? rawProperty(self, "TextWrap") ?? false
	);
}

/**
 * `TextSize`, or the legacy `FontSize` enum it is linked to — writing either
 * moves both in the engine, and the pixel size lives in the enum item's name
 * (`Size24` → 24). Same reasoning as {@link textWrappedReader}: without this a
 * label that only ever set `FontSize` would read (and measure at) the 14px
 * default.
 *
 * Only this direction is answered. Going the other way — `TextSize = 13` making
 * `FontSize` read something — has no truthful answer, since the enum has no item
 * for most sizes.
 */
function textSizeReader(self: LoomInstance): unknown {
	const size = rawProperty(self, "TextSize");
	if (typeof size === "number") return size;
	return (
		fontSizeToPx(enumName(rawProperty(self, "FontSize"))) ?? DEFAULTS.textSize
	);
}

// Derived and aliased reads, registered on each of the three text classes: they
// share no ancestor below `GuiObject`, which every other 2D class also inherits.
for (const className of ["TextLabel", "TextButton", "TextBox"]) {
	registerPropertyReader(className, "ContentText", contentText);
	registerPropertyReader(className, "TextWrapped", textWrappedReader);
	registerPropertyReader(className, "TextWrap", textWrappedReader);
	registerPropertyReader(className, "TextSize", textSizeReader);
}

// --- TextBox focus adapter ---------------------------------------------------

/** DOM-side focus behavior for one TextBox (wired by the renderer in Phase 3). */
export interface TextBoxAdapter {
	CaptureFocus(): void;
	ReleaseFocus(enterPressed?: boolean): void;
	IsFocused(): boolean;
}

const TEXTBOX_ADAPTERS = new WeakMap<LoomInstance, TextBoxAdapter>();
const TEXTBOX_METHOD_NAMES: ReadonlySet<string> = new Set([
	"CaptureFocus",
	"ReleaseFocus",
	"IsFocused",
]);
let warnedNoTextBoxAdapter = false;

/** Attach the DOM focus adapter for a TextBox instance. */
export function registerTextBoxAdapter(
	inst: LoomInstance,
	adapter: TextBoxAdapter,
): void {
	TEXTBOX_ADAPTERS.set(inst, adapter);
}

/** Detach the DOM focus adapter (the input element left the DOM). */
export function unregisterTextBoxAdapter(inst: LoomInstance): void {
	TEXTBOX_ADAPTERS.delete(inst);
}

function makeTextBoxMethod(
	impl: InstanceImpl,
	key: string,
): (...args: unknown[]) => unknown {
	return (...args: unknown[]): unknown => {
		const adapter = TEXTBOX_ADAPTERS.get(impl.proxy);
		if (!adapter) {
			if (!warnedNoTextBoxAdapter) {
				warnedNoTextBoxAdapter = true;
				console.warn(
					`[loom] TextBox.${key}() called before a text adapter was attached — no-op`,
				);
			}
			return key === "IsFocused" ? false : undefined;
		}
		switch (key) {
			case "CaptureFocus":
				return adapter.CaptureFocus();
			case "ReleaseFocus":
				return adapter.ReleaseFocus(...(args as [boolean?]));
			case "IsFocused":
				return adapter.IsFocused();
			default:
				return undefined;
		}
	};
}

// --- property writes ---------------------------------------------------------

function rawSet(impl: InstanceImpl, key: string, value: unknown): void {
	if (impl.props.get(key) === value) return;
	impl.props.set(key, value);
	impl.propSignals.get(key)?.fire();
	impl.eventSignals.get("Changed")?.fire(key);
	markDirty(impl.proxy);
}

function fireAncestryChanged(
	impl: InstanceImpl,
	parentProxy: LoomInstance | undefined,
): void {
	impl.eventSignals.get("AncestryChanged")?.fire(impl.proxy, parentProxy);
	for (const child of impl.children) {
		fireAncestryChanged(child, parentProxy);
	}
}

function setParent(impl: InstanceImpl, value: unknown): void {
	const newParent =
		value === undefined || value === null
			? undefined
			: IMPLS.get(value as object);
	if (value !== undefined && value !== null && !newParent) {
		throw new TypeError(
			`${getName(impl)}.Parent must be a LoomInstance or undefined`,
		);
	}
	if (newParent === impl.parent) return;
	for (let cur = newParent; cur; cur = cur.parent) {
		if (cur === impl) {
			throw new Error(
				`Setting ${getName(impl)}.Parent would create a circular reference`,
			);
		}
	}
	const oldParent = impl.parent;
	if (oldParent) {
		const index = oldParent.children.indexOf(impl);
		if (index >= 0) oldParent.children.splice(index, 1);
	}
	impl.parent = newParent;
	if (oldParent) oldParent.eventSignals.get("ChildRemoved")?.fire(impl.proxy);
	if (newParent) {
		newParent.children.push(impl);
		newParent.eventSignals.get("ChildAdded")?.fire(impl.proxy);
	}
	impl.propSignals.get("Parent")?.fire();
	fireAncestryChanged(impl, newParent?.proxy);
	if (oldParent) markDirty(oldParent.proxy);
	if (newParent) markDirty(newParent.proxy);
	markDirty(impl.proxy);
}

// --- the proxy ---------------------------------------------------------------

function getTrap(impl: InstanceImpl, key: string | symbol): unknown {
	if (typeof key !== "string") return undefined;
	switch (key) {
		case "ClassName":
			return impl.className;
		case "Parent":
			return impl.parent?.proxy;
		case "AbsolutePosition":
			return impl.absolutePosition;
		case "AbsoluteSize":
			return impl.absoluteSize;
		case "toString":
			// Debug/`tostring` friendliness: `String(inst)` yields the Name.
			return () => getName(impl);
		default:
			break;
	}
	if (Object.hasOwn(METHODS, key)) {
		const method = (METHODS as MethodTable)[key];
		if (method)
			return (...args: unknown[]) => method(impl, ...(args as never[]));
	}
	if (EVENT_NAMES.has(key) || impl.eventSignals.has(key)) {
		return getOrCreateEventSignal(impl, key);
	}
	if (TEXTBOX_METHOD_NAMES.has(key) && isA(impl.className, "TextBox")) {
		return makeTextBoxMethod(impl, key);
	}
	// `BindableEvent` is the one Roblox class whose whole purpose is a signal an
	// app owns rather than one the engine raises, and roblox-ts UI code leans on
	// it for exactly that (a `useRef(new Instance("BindableEvent"))` that a label
	// fires and an input listens to). Class-scoped, not another `EVENT_NAMES`
	// entry: `Event` and `Fire` are common enough words that every other class
	// would start answering for them.
	if (isA(impl.className, "BindableEvent")) {
		if (key === "Event") return getOrCreateEventSignal(impl, "Event");
		if (key === "Fire") {
			return (...args: unknown[]) =>
				getOrCreateEventSignal(impl, "Event").fire(...args);
		}
	}
	const classMethod = findClassMethod(impl.className, key);
	if (classMethod) {
		return (...args: unknown[]) =>
			classMethod(impl.proxy, ...(args as never[]));
	}
	const reader = findPropertyReader(impl.className, key);
	if (reader) return reader(impl.proxy);
	const value = impl.props.get(key);
	if (value !== undefined) return value;
	return classDefaultProperty(impl.className, key);
}

function setTrap(
	impl: InstanceImpl,
	key: string | symbol,
	value: unknown,
): void {
	if (typeof key !== "string") return;
	if (key === "Parent") {
		setParent(impl, value);
		return;
	}
	const interceptor = findInterceptor(impl.className, key);
	if (interceptor) {
		interceptor(impl.proxy, value, (raw) => rawSet(impl, key, raw));
		return;
	}
	rawSet(impl, key, value);
}

/**
 * Create a live instance. `Name` defaults to the class name, matching Roblox
 * `Instance.new`.
 */
export function createInstance(className: string, name?: string): LoomInstance {
	const props = new Map<string, unknown>();
	props.set("Name", name ?? className);
	const impl: InstanceImpl = {
		id: `i${++nextId}`,
		className,
		props,
		parent: undefined,
		children: [],
		propSignals: new Map(),
		eventSignals: new Map(),
		attributes: new Map(),
		attributeSignals: new Map(),
		destroyed: false,
		absolutePosition: Vector2.zero,
		absoluteSize: Vector2.zero,
		proxy: undefined as unknown as LoomInstance,
	};
	const proxy = new Proxy({} as Record<string | symbol, unknown>, {
		get(_target, key) {
			return getTrap(impl, key);
		},
		set(_target, key, value) {
			setTrap(impl, key, value);
			return true;
		},
	}) as unknown as LoomInstance;
	impl.proxy = proxy;
	IMPLS.set(proxy, impl);
	return proxy;
}

/** Whether `value` is a live `LoomInstance` proxy. */
export function isLoomInstance(value: unknown): value is LoomInstance {
	return (
		typeof value === "object" && value !== null && IMPLS.has(value as object)
	);
}

/** The runtime-internal stable id (`"i1"`, `"i2"`, …) the renderer keys on. */
export function getInternalId(inst: LoomInstance): string {
	const impl = IMPLS.get(inst);
	if (!impl) throw new Error("getInternalId: value is not a LoomInstance");
	return impl.id;
}

/**
 * Whether the instance has a live listener on any of `names`, *without*
 * creating the signals — the point being to ask cheaply, per node, per frame.
 *
 * The renderer uses it to decide hit-testing: Roblox raises a GuiObject's own
 * input events whether or not it is `Active` (`Active` governs sinking), so an
 * element the app listens on has to be reachable by the pointer even when it
 * would otherwise be click-through.
 */
export function hasAnyEventConnection(
	inst: LoomInstance | undefined,
	names: readonly string[],
): boolean {
	const impl = inst === undefined ? undefined : IMPLS.get(inst);
	if (!impl) return false;
	for (const name of names) {
		if (impl.eventSignals.get(name)?.hasConnections) return true;
	}
	return false;
}

/**
 * The event signal for `name`, created lazily — the dispatch side of the
 * proxy's event properties. The DOM bridge fires input events through this.
 */
export function getEventSignal(
	inst: LoomInstance,
	name: string,
): LoomSignal<unknown[]> {
	const impl = IMPLS.get(inst);
	if (!impl) throw new Error("getEventSignal: value is not a LoomInstance");
	return getOrCreateEventSignal(impl, name);
}

/**
 * The instance's raw property store (live, do not mutate) — the encode side of
 * the world walks this to build Scene IR properties.
 */
export function getRawProperties(
	inst: LoomInstance,
): ReadonlyMap<string, unknown> {
	const impl = IMPLS.get(inst);
	if (!impl) throw new Error("getRawProperties: value is not a LoomInstance");
	return impl.props;
}

/** Whether the instance has been `Destroy()`ed (encode skips dead nodes). */
export function isDestroyed(inst: LoomInstance): boolean {
	const impl = IMPLS.get(inst);
	if (!impl) throw new Error("isDestroyed: value is not a LoomInstance");
	return impl.destroyed;
}

/**
 * Reparent `child` under `parent` (when needed) and place it immediately before
 * `before` in the children array — the reconciler's `insertBefore`. Children
 * order drives Scene IR sibling order, so a reorder marks the parent dirty.
 * When `before` is absent (or not a child of `parent`), the child lands last.
 */
export function moveChildBefore(
	parent: LoomInstance,
	child: LoomInstance,
	before?: LoomInstance,
): void {
	const parentImpl = IMPLS.get(parent);
	const childImpl = IMPLS.get(child);
	if (!parentImpl || !childImpl) {
		throw new Error("moveChildBefore: values must be LoomInstances");
	}
	// Full reparent path first (signals, cycle checks) when not already a child.
	if (childImpl.parent !== parentImpl) child.Parent = parent;
	const children = parentImpl.children;
	const from = children.indexOf(childImpl);
	if (from < 0) return; // reparent failed (destroyed child) — nothing to order
	children.splice(from, 1);
	const beforeImpl = before ? IMPLS.get(before) : undefined;
	const to = beforeImpl ? children.indexOf(beforeImpl) : -1;
	if (to >= 0) children.splice(to, 0, childImpl);
	else children.push(childImpl);
	markDirty(parent);
}

/**
 * Write a property without firing signals or marking dirty — construction-time
 * plumbing for the service tree (`RunService.Heartbeat`, initial props, …).
 */
export function setRawProperty(
	inst: LoomInstance,
	key: string,
	value: unknown,
): void {
	const impl = IMPLS.get(inst);
	if (!impl) throw new Error("setRawProperty: value is not a LoomInstance");
	impl.props.set(key, value);
}

/** Feedback-write equality: `Vector2`s compare by components, not identity. */
function feedbackEquals(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (a instanceof Vector2 && b instanceof Vector2) {
		return a.X === b.X && a.Y === b.Y;
	}
	return false;
}

/**
 * Post-layout feedback write (`AbsoluteWindowSize`/`AbsoluteCanvasSize`/…):
 * store the value and fire the property + `Changed` signals, but do NOT mark
 * the instance dirty — feedback runs inside a flush, and re-marking would
 * schedule flushes forever. Change-gated like {@link updateAbsoluteGeometry}:
 * an identical value (Vector2 by components, including the class read
 * default when the store is empty) is a complete no-op.
 */
export function setFeedbackProperty(
	inst: LoomInstance,
	key: string,
	value: unknown,
): void {
	const impl = IMPLS.get(inst);
	if (!impl) {
		throw new Error("setFeedbackProperty: value is not a LoomInstance");
	}
	const current =
		impl.props.get(key) ?? classDefaultProperty(impl.className, key);
	if (feedbackEquals(current, value)) return;
	impl.props.set(key, value);
	impl.propSignals.get(key)?.fire();
	impl.eventSignals.get("Changed")?.fire(key);
}

/**
 * Layout feedback: record the instance's absolute geometry after a flush and
 * fire the `AbsolutePosition`/`AbsoluteSize` property signals — but only for
 * the components that actually changed.
 */
export function updateAbsoluteGeometry(
	inst: LoomInstance,
	position: Vector2,
	size: Vector2,
): void {
	const impl = IMPLS.get(inst);
	if (!impl) {
		throw new Error("updateAbsoluteGeometry: value is not a LoomInstance");
	}
	const prevPosition = impl.absolutePosition;
	if (prevPosition.X !== position.X || prevPosition.Y !== position.Y) {
		impl.absolutePosition = position;
		impl.propSignals.get("AbsolutePosition")?.fire();
	}
	const prevSize = impl.absoluteSize;
	if (prevSize.X !== size.X || prevSize.Y !== size.Y) {
		impl.absoluteSize = size;
		impl.propSignals.get("AbsoluteSize")?.fire();
	}
}
