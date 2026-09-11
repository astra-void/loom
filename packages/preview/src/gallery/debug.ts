/**
 * The gallery's debug mode — a plain-DOM panel over the stage that reports what
 * the preview is actually doing: which target is mounted and what it cost, the
 * logical viewport the scene laid out against, the shape of the live instance
 * tree, which typefaces it really got, the frame rate, what loom logged, and —
 * on hover or pinned with alt+click — the GuiObject under the pointer with its
 * ancestry, geometry, modifiers and properties.
 *
 * Deliberately read-only and outside the render path. Everything it shows is
 * pulled from the same public surfaces app code has — the runtime PlayerGui for
 * the tree, `GetGuiObjectsAtPosition` for the hit test, the renderer's own font
 * resolution for the typefaces, the mount's own box for the viewport — so it
 * never has to reach into a world, and a broken target still gets a working
 * panel. Nothing is observed, timed or walked while the panel is closed, which
 * is the state every non-debugging preview is in.
 *
 * Opened by `?debug=1`, the sidebar's `debug` button, or Ctrl+Alt+D; the shell
 * (`./gallery-shell.ts`) owns all three and drives this through {@link
 * DebugPanel}.
 */

import { familyIsAvailable, instanceFont } from "@loom-dev/renderer";
import {
	Color3,
	getRawProperties,
	getService,
	isDestroyed,
	isLoomInstance,
	type LoomInstance,
} from "@loom-dev/runtime";
import { currentBaseWidth } from "../viewport.ts";

/** What the shell knows about the target it just mounted. */
export interface DebugTarget {
	/** The target's relPath — the sidebar key and the `#/` route. */
	key: string;
	/** `preview.title`, when the module declared one. */
	title?: string;
	/** How long the target's `import()` took, in ms. */
	importMs?: number;
}

export interface DebugPanelOptions {
	/**
	 * Re-mount the active target (the panel's `remount` button). This is how the
	 * mount timings become available at all when the panel was opened *after* the
	 * target came up: they are measured across a mount, and a mount that already
	 * happened cannot be measured retroactively.
	 */
	remount?: () => void;
	/** Called when the panel closes itself (its `×`), so the shell can sync. */
	onClose?: () => void;
}

export interface DebugPanel {
	isOpen(): boolean;
	setOpen(open: boolean): void;
	toggle(): void;
	/** Everything the panel knows, as plain serialisable data. */
	snapshot(): DebugSnapshot;
	/** Write {@link DebugPanel.snapshot} out as a JSON file (the `json` button). */
	exportJson(): Promise<void>;
	/** The shell is mounting this target now (call just before `render`). */
	setTarget(target: DebugTarget | undefined): void;
	/** Mirror of the stage's error panel: the last failure, or none. */
	setError(message: string | undefined): void;
	/** Tear down every listener, timer and observer this panel owns. */
	dispose(): void;
}

/** How often the open panel re-reads the world. Twice a second reads live. */
const REFRESH_MS = 500;

/** Rolling window the frame counter averages over. */
const FPS_WINDOW_MS = 500;

/** Instance properties worth seeing first, in this order. */
const PRIORITY_PROPERTIES = [
	"Size",
	"Position",
	"AnchorPoint",
	"AutomaticSize",
	"ZIndex",
	"LayoutOrder",
	"Visible",
	"BackgroundColor3",
	"BackgroundTransparency",
	"Text",
	"TextSize",
	"TextColor3",
	"TextWrapped",
	"TextScaled",
	"FontFace",
	"Font",
	"Image",
	"ClipsDescendants",
];

/** Never a Roblox property — the adapter's own prop keys. */
const INTERNAL_PROPERTY_PREFIXES = ["LoomEvent:", "LoomChange:"];

/** Properties the panel shows in its own rows, so the list needn't repeat them. */
const PROPERTIES_SHOWN_ELSEWHERE = new Set(["Parent", "Name", "TextBounds"]);

/** Property rows past this are summarised as a `+N more` row. */
const MAX_PROPERTY_ROWS = 22;

/** Entries of the hit stack listed under the selected object. */
const MAX_HIT_STACK_ROWS = 6;

/** Text classes, whose typeface is worth a readout of its own. */
const TEXT_CLASSES = new Set(["TextLabel", "TextButton", "TextBox"]);

/** How a value is coloured. Purely presentational. */
type ValueKind = "num" | "str" | "bool" | "enum" | "class" | "muted";

export interface Size {
	width: number;
	height: number;
}

/**
 * The machine-readable form of everything the panel shows — what the `json`
 * button writes out, what `window.loomDebug.snapshot()` returns, and therefore
 * what a bug report or a screenshot harness can carry instead of a photo of a
 * panel.
 *
 * Serialisable by construction: plain numbers, strings and arrays, no live
 * instances, so `JSON.stringify` on it is total.
 */
export interface DebugSnapshot {
	capturedAt: string;
	url: string;
	target: {
		path?: string;
		title?: string;
		importMs?: number;
		firstFrameMs?: number;
		status: "ok" | "pending" | "error" | "none";
		error?: string;
	};
	viewport: {
		stage: Size;
		logical?: Size;
		camera?: Size;
		scale: number;
		baseWidth: number;
		devicePixelRatio?: number;
		theme: "light" | "dark";
	};
	scene?: {
		instances: number;
		guiObjects: number;
		hidden: number;
		depth: number;
		domNodes: number;
		classes: Record<string, number>;
		layers: LayerInfo[];
	};
	fonts: Array<{
		family: string;
		available: boolean;
		weights: string[];
		count: number;
	}>;
	frame: {
		fps: number;
		domUpdates: number;
		msSinceLastUpdate?: number;
		warnings: number;
		errors: number;
		lastLog?: string;
	};
	selected?: DebugNode & {
		path: string[];
		modifiers: string[];
		typeface?: DebugTypeface;
		properties: Record<string, string>;
	};
	/** The whole live tree, geometry included — the scene as it stands. */
	tree: DebugNode[];
}

/** The face a text instance actually resolved to, and whether it loaded. */
export interface DebugTypeface {
	family: string;
	weight: string;
	italic: boolean;
	available: boolean;
}

/** One instance in {@link DebugSnapshot.tree}. */
export interface DebugNode {
	name: string;
	className: string;
	visible?: boolean;
	absolutePosition?: { x: number; y: number };
	absoluteSize?: Size;
	children?: DebugNode[];
}

interface Chip {
	text: string;
	kind?: ValueKind;
	title?: string;
	onSelect?: () => void;
}

interface Row {
	label: string;
	value?: string;
	kind?: ValueKind;
	/** A CSS colour painted as a swatch before the value. */
	swatch?: string;
	chips?: readonly Chip[];
	title?: string;
	onSelect?: () => void;
}

const now = (): number =>
	typeof performance === "object" ? performance.now() : Date.now();

/** A duration, kept to one decimal while that decimal still says something. */
const ms = (value: number | undefined): string =>
	value === undefined
		? "—"
		: `${value < 100 ? value.toFixed(1) : Math.round(value)} ms`;

function formatNumber(value: number): string {
	if (!Number.isFinite(value)) return String(value);
	return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function truncate(text: string, max = 64): string {
	return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * A number fit to be written down: four decimals, which is finer than any
 * layout question and short enough that a snapshot stays readable —
 * `10.300000011920929` says nothing `10.3` does not.
 */
function precise(value: number | undefined): number | undefined {
	if (value === undefined || !Number.isFinite(value)) return undefined;
	return Math.round(value * 1e4) / 1e4;
}

/** `Color3` → `#rrggbb`, the spelling a stylesheet and an eye both read. */
function colorHex(color: Color3): string {
	const channel = (v: number): string =>
		Math.round(Math.min(1, Math.max(0, v)) * 255)
			.toString(16)
			.padStart(2, "0");
	return `#${channel(color.R)}${channel(color.G)}${channel(color.B)}`;
}

/** A formatted property value: the text, how to colour it, and any swatch. */
export interface DebugCell {
	text: string;
	kind?: ValueKind;
	swatch?: string;
}

/**
 * One property value as a debug cell. Roblox datatypes (`UDim2`, `EnumItem`, …)
 * all carry a Roblox-shaped `toString`, so the interesting cases print
 * themselves; `Color3` is shown as hex with a swatch instead of its `0..1`
 * triple, which no one reads as a colour. Functions are dropped (an event bag is
 * not a property) and anything left unprintable degrades to `{…}` rather than a
 * wall of JSON.
 */
export function formatDebugCell(value: unknown): DebugCell | undefined {
	if (typeof value === "function") return undefined;
	if (value === undefined) return { text: "nil", kind: "muted" };
	if (value === null) return { text: "null", kind: "muted" };
	if (typeof value === "string") {
		return { text: `"${truncate(value)}"`, kind: "str" };
	}
	if (typeof value === "number") {
		return { text: formatNumber(value), kind: "num" };
	}
	if (typeof value === "boolean") return { text: String(value), kind: "bool" };
	if (value instanceof Color3) {
		const hex = colorHex(value);
		return { text: hex, kind: "enum", swatch: hex };
	}
	if (isLoomInstance(value)) {
		return {
			text: `${String(value.Name)} (${value.ClassName})`,
			kind: "class",
		};
	}
	if (typeof value === "object") {
		const keypoints = (value as { Keypoints?: unknown }).Keypoints;
		if (Array.isArray(keypoints)) {
			return { text: `${keypoints.length} keypoints`, kind: "muted" };
		}
		const text = String(value);
		if (text !== "[object Object]") {
			// `Enum.FillDirection.Vertical` and the like: the enum's own spelling.
			const enumish = text.startsWith("Enum.");
			return { text: truncate(text), kind: enumish ? "enum" : undefined };
		}
		try {
			const json = JSON.stringify(value);
			return {
				text: json === undefined || json.length > 64 ? "{…}" : json,
				kind: "muted",
			};
		} catch {
			return { text: "{…}", kind: "muted" };
		}
	}
	return { text: truncate(String(value)) };
}

/** {@link formatDebugCell}, text only. */
export function formatDebugValue(value: unknown): string | undefined {
	return formatDebugCell(value)?.text;
}

/** The runtime `Players.LocalPlayer.PlayerGui`, if a world has built one. */
function playerGui(): LoomInstance | undefined {
	try {
		const players = getService("Players") as unknown as {
			LocalPlayer?: LoomInstance;
		};
		return players.LocalPlayer?.FindFirstChildOfClass("PlayerGui");
	} catch {
		return undefined;
	}
}

/** `Workspace.CurrentCamera.ViewportSize` — what the world told the scene. */
function cameraSize(): Size | undefined {
	try {
		const workspace = getService("Workspace") as unknown as LoomInstance;
		const camera = workspace.CurrentCamera as LoomInstance | undefined;
		const size = camera?.ViewportSize as { X: number; Y: number } | undefined;
		return size ? { width: size.X, height: size.Y } : undefined;
	} catch {
		return undefined;
	}
}

/**
 * The mount the active root renders into: `#loom-root`'s last child (the shell
 * mounts one target at a time, and `createRoot` appends a container per root).
 * The host itself is the fallback, which is only ever the pre-mount state.
 */
function activeMount(): HTMLElement | undefined {
	const host = document.getElementById("loom-root");
	const last = host?.lastElementChild;
	return last instanceof HTMLElement ? last : (host ?? undefined);
}

/**
 * On-screen pixels per layout pixel, exactly as the renderer's own pointer
 * mapping computes it: `getBoundingClientRect()` reflects the `?base=` viewport
 * transform and `offsetWidth` does not, so their ratio *is* the factor — with
 * no knowledge of who applied the transform.
 */
function mountScale(mount: HTMLElement): number {
	const rendered = mount.getBoundingClientRect().width;
	const layout = mount.offsetWidth;
	if (!(rendered > 0) || !(layout > 0)) return 1;
	return rendered / layout;
}

/** The first family of a CSS stack, unquoted — what a browser tries first. */
function primaryFamily(stack: string): string {
	const first = stack.split(",")[0]?.trim() ?? stack;
	return first.replace(/^["']|["']$/g, "");
}

/** `640 × 480`, or an em dash when there is nothing to report. */
function formatSize(size: Size | undefined, unit = ""): string {
	if (!size) return "—";
	return `${formatNumber(size.width)} × ${formatNumber(size.height)}${unit}`;
}

/**
 * Every box a preview has at once: the stage the browser gave it, the *logical*
 * viewport the scene laid out against, what the world told
 * `Workspace.CurrentCamera`, and the factor between the first two. They agree
 * unless the page asked for a `?base=` viewport, and showing all four is how
 * you tell "the scene laid out small" from "the scene was painted small".
 */
function viewportMetrics(stage: HTMLElement): DebugSnapshot["viewport"] {
	const mount = activeMount();
	return {
		stage: { width: stage.clientWidth, height: stage.clientHeight },
		logical: mount
			? { width: mount.offsetWidth, height: mount.offsetHeight }
			: undefined,
		camera: cameraSize(),
		scale: mount ? mountScale(mount) : 1,
		baseWidth: currentBaseWidth(),
		devicePixelRatio:
			typeof devicePixelRatio === "number" ? devicePixelRatio : undefined,
		theme: document.documentElement.classList.contains("loom-theme-light")
			? "light"
			: "dark",
	};
}

/** One instance and its subtree, as plain serialisable data. */
function treeNode(inst: LoomInstance): DebugNode {
	const node: DebugNode = {
		name: String(inst.Name),
		className: inst.ClassName,
	};
	if (inst.IsA("GuiObject")) {
		const pos = inst.AbsolutePosition;
		const size = inst.AbsoluteSize;
		node.visible = inst.Visible !== false;
		node.absolutePosition = { x: precise(pos.X) ?? 0, y: precise(pos.Y) ?? 0 };
		node.absoluteSize = {
			width: precise(size.X) ?? 0,
			height: precise(size.Y) ?? 0,
		};
	}
	const children = inst.GetChildren().map(treeNode);
	if (children.length > 0) node.children = children;
	return node;
}

interface LayerInfo {
	name: string;
	className: string;
	displayOrder: number;
	enabled: boolean;
	instances: number;
}

interface FontUse {
	/** The family the browser tries first for this text. */
	family: string;
	/** Whether the browser can actually paint it, or fell back. */
	available: boolean;
	weights: Set<string>;
	count: number;
}

interface SceneStats {
	instances: number;
	depth: number;
	guiObjects: number;
	hidden: number;
	layers: LayerInfo[];
	/** Class name → count, descending. */
	classes: Array<[string, number]>;
	fonts: FontUse[];
}

/**
 * Walk the live PlayerGui tree once: counts, depth, per-layer detail, the class
 * histogram, and which typefaces the text in it actually resolved to.
 *
 * The font pass is the reason this walks instances rather than DOM: a family
 * loom *asked* for and a family the browser *has* are different things, and the
 * difference is invisible on screen (the fallback paints, just at other
 * metrics). {@link familyIsAvailable} is the renderer's own probe, and it
 * caches per font-loading cycle, so asking every refresh is cheap.
 */
function readSceneStats(gui: LoomInstance | undefined): SceneStats | undefined {
	if (!gui) return undefined;
	const classes = new Map<string, number>();
	const fonts = new Map<string, FontUse>();
	let instances = 0;
	let depth = 0;
	let guiObjects = 0;
	let hidden = 0;

	const noteFont = (inst: LoomInstance): void => {
		const resolved = instanceFont(inst as unknown as Record<string, unknown>);
		const family = primaryFamily(resolved.family);
		let use = fonts.get(family);
		if (!use) {
			use = {
				family,
				available: familyIsAvailable(family),
				weights: new Set(),
				count: 0,
			};
			fonts.set(family, use);
		}
		use.weights.add(resolved.italic ? `${resolved.weight}i` : resolved.weight);
		use.count += 1;
	};

	const visit = (inst: LoomInstance, level: number): number => {
		instances += 1;
		if (level > depth) depth = level;
		classes.set(inst.ClassName, (classes.get(inst.ClassName) ?? 0) + 1);
		if (inst.IsA("GuiObject")) {
			guiObjects += 1;
			if (inst.Visible === false) hidden += 1;
		}
		if (TEXT_CLASSES.has(inst.ClassName)) noteFont(inst);
		let count = 1;
		for (const child of inst.GetChildren()) count += visit(child, level + 1);
		return count;
	};

	const layers: LayerInfo[] = [];
	for (const layer of gui.GetChildren()) {
		const count = visit(layer, 1);
		layers.push({
			name: String(layer.Name),
			className: layer.ClassName,
			displayOrder:
				typeof layer.DisplayOrder === "number" ? layer.DisplayOrder : 0,
			enabled: layer.Enabled !== false,
			instances: count,
		});
	}
	return {
		instances,
		depth,
		guiObjects,
		hidden,
		layers,
		classes: [...classes].sort(
			(a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
		),
		fonts: [...fonts.values()].sort((a, b) => b.count - a.count),
	};
}

/** The `UI*` modifier children of an instance (UICorner, UIPadding, …). */
function modifiersOf(inst: LoomInstance): string[] {
	return inst
		.GetChildren()
		.filter((child) => child.ClassName.startsWith("UI"))
		.map((child) => child.ClassName);
}

/** The chain from the outermost layer down to `inst`, inclusive. */
function ancestorChain(inst: LoomInstance): LoomInstance[] {
	const chain: LoomInstance[] = [];
	let cursor: LoomInstance | undefined = inst;
	while (cursor && cursor.ClassName !== "PlayerGui") {
		chain.unshift(cursor);
		cursor = cursor.Parent;
	}
	return chain;
}

/** Whether an instance is still part of a live tree worth reporting on. */
function isLive(inst: LoomInstance): boolean {
	try {
		return !isDestroyed(inst) && inst.Parent !== undefined;
	} catch {
		return false;
	}
}

/**
 * Build the panel over `stage`. Returns closed; nothing runs until it opens.
 */
export function createDebugPanel(
	stage: HTMLElement,
	options: DebugPanelOptions = {},
): DebugPanel {
	// -------------------------------------------------------------------------
	// Chrome
	// -------------------------------------------------------------------------

	const panel = document.createElement("div");
	panel.id = "loom-debug";
	panel.className = "loom-debug";
	panel.hidden = true;

	const header = document.createElement("div");
	header.className = "loom-debug-header";
	const heading = document.createElement("span");
	heading.className = "loom-debug-heading";
	heading.textContent = "loom debug";
	const headerStat = document.createElement("span");
	headerStat.className = "loom-debug-stat";

	const action = (
		label: string,
		title: string,
		onClick: () => void,
	): HTMLButtonElement => {
		const button = document.createElement("button");
		button.type = "button";
		button.className = "loom-debug-action";
		button.textContent = label;
		button.title = title;
		button.addEventListener("click", onClick);
		return button;
	};

	const copyButton = action("copy", "copy this readout as text", () => {
		void copyReadout();
	});
	const jsonButton = action(
		"json",
		"download the whole readout, scene tree included, as JSON",
		() => {
			void exportJson();
		},
	);
	const remountButton = action(
		"↻",
		"re-mount the active target (measures the timings)",
		() => options.remount?.(),
	);
	remountButton.setAttribute("aria-label", "re-mount the active target");
	const closeButton = action("×", "close (Ctrl+Alt+D)", () => {
		setOpen(false);
		options.onClose?.();
	});
	closeButton.setAttribute("aria-label", "close the debug panel");
	header.append(
		heading,
		headerStat,
		copyButton,
		jsonButton,
		remountButton,
		closeButton,
	);

	const body = document.createElement("div");
	body.className = "loom-debug-body";
	panel.append(header, body);

	// The hover outline and its size badge, over the stage and never in the way
	// of the pointer.
	const highlight = document.createElement("div");
	highlight.className = "loom-debug-highlight";
	highlight.hidden = true;
	const highlightLabel = document.createElement("span");
	highlightLabel.className = "loom-debug-highlight-label";
	highlight.appendChild(highlightLabel);

	stage.append(highlight, panel);

	// -------------------------------------------------------------------------
	// Sections. Collapsible, because the whole readout is taller than a stage
	// and most of the time only one part of it is the question.
	// -------------------------------------------------------------------------

	const SECTIONS = [
		"target",
		"viewport",
		"scene",
		"fonts",
		"frame",
		"inspect",
	] as const;
	type SectionName = (typeof SECTIONS)[number];

	const COLLAPSE_STORAGE_KEY = "loom-debug-collapsed";

	function readCollapsed(): Set<string> {
		try {
			const raw = sessionStorage.getItem(COLLAPSE_STORAGE_KEY);
			return new Set(raw ? (JSON.parse(raw) as string[]) : []);
		} catch {
			return new Set();
		}
	}

	function writeCollapsed(): void {
		try {
			sessionStorage.setItem(
				COLLAPSE_STORAGE_KEY,
				JSON.stringify([...collapsed]),
			);
		} catch {
			// Storage refused; the panel just won't remember its folds.
		}
	}

	interface Section {
		root: HTMLElement;
		rows: HTMLElement;
		badge: HTMLElement;
		title: HTMLButtonElement;
	}

	const collapsed = readCollapsed();
	const sections = new Map<SectionName, Section>();
	/** The last rows rendered per section, for `copy`. */
	const rendered = new Map<SectionName, readonly Row[]>();

	for (const name of SECTIONS) {
		const root = document.createElement("div");
		root.className = "loom-debug-section";
		// The label column is sized per section: `scene` and `fonts` label their
		// rows with layer and family names, which a property-sized column cuts in
		// half (see `shell.css`).
		root.dataset.section = name;
		const title = document.createElement("button");
		title.type = "button";
		title.className = "loom-debug-title";
		const chevron = document.createElement("span");
		chevron.className = "loom-debug-chevron";
		chevron.textContent = "▾";
		const label = document.createElement("span");
		label.className = "loom-debug-section-name";
		label.textContent = name;
		const badge = document.createElement("span");
		badge.className = "loom-debug-badge";
		title.append(chevron, label, badge);
		title.addEventListener("click", () => {
			if (collapsed.has(name)) collapsed.delete(name);
			else collapsed.add(name);
			writeCollapsed();
			applyCollapse(name);
			refresh();
		});
		const rowsEl = document.createElement("div");
		rowsEl.className = "loom-debug-rows";
		root.append(title, rowsEl);
		body.appendChild(root);
		sections.set(name, { root, rows: rowsEl, badge, title });
		applyCollapse(name);
	}

	function applyCollapse(name: SectionName): void {
		const section = sections.get(name);
		if (!section) return;
		const isCollapsed = collapsed.has(name);
		section.root.classList.toggle("collapsed", isCollapsed);
		section.title.setAttribute("aria-expanded", String(!isCollapsed));
		// Dropped rather than hidden: a folded section holds no stale DOM, and
		// the next refresh rebuilds it from scratch when it opens again.
		if (isCollapsed) section.rows.replaceChildren();
		(section.title.firstElementChild as HTMLElement).textContent = isCollapsed
			? "▸"
			: "▾";
	}

	// -------------------------------------------------------------------------
	// State
	// -------------------------------------------------------------------------

	let open = false;
	let target: DebugTarget | undefined;
	let error: string | undefined;
	let mountStartedAt: number | undefined;
	let firstFrameMs: number | undefined;
	let updates = 0;
	let lastUpdateAt: number | undefined;
	let selected: LoomInstance | undefined;
	/** Everything under the pointer at the last hit test, topmost first. */
	let hitStack: LoomInstance[] = [];
	/** A pinned selection stops following the pointer (alt+click on the stage). */
	let pinned = false;
	let fps = 0;
	let frames = 0;
	let fpsWindowStart = 0;
	let warnings = 0;
	let errors = 0;
	let lastLog: string | undefined;
	let timer: ReturnType<typeof setInterval> | undefined;
	let rafHandle: number | undefined;
	let observer: MutationObserver | undefined;
	let restoreConsole: (() => void) | undefined;

	// -------------------------------------------------------------------------
	// Row rendering. Labels are stable between refreshes, so the row elements are
	// reused and only what changed is written — a wholesale rebuild twice a
	// second would drop any selection the reader was making inside the panel.
	// -------------------------------------------------------------------------

	function rowKey(row: Row): string {
		return [
			row.label,
			row.value ?? "",
			row.kind ?? "",
			row.swatch ?? "",
			row.chips?.map((chip) => `${chip.text}:${chip.kind ?? ""}`).join(",") ??
				"",
			row.onSelect ? "!" : "",
		].join("\u0000");
	}

	function fillChips(host: HTMLElement, chips: readonly Chip[]): void {
		while (host.children.length > chips.length) host.lastElementChild?.remove();
		for (const [index, chip] of chips.entries()) {
			let el = host.children[index] as HTMLElement | undefined;
			if (!el) {
				el = document.createElement("span");
				host.appendChild(el);
			}
			el.className = `loom-debug-chip${chip.kind ? ` k-${chip.kind}` : ""}${
				chip.onSelect ? " is-clickable" : ""
			}`;
			el.textContent = chip.text;
			if (chip.title) el.title = chip.title;
			el.onclick = chip.onSelect ? () => chip.onSelect?.() : null;
		}
	}

	function renderRows(container: HTMLElement, rows: readonly Row[]): void {
		for (const [index, row] of rows.entries()) {
			let el = container.children[index] as HTMLElement | undefined;
			if (!el) {
				el = document.createElement("div");
				el.append(
					document.createElement("span"),
					document.createElement("span"),
				);
				(el.firstElementChild as HTMLElement).className = "loom-debug-key";
				(el.lastElementChild as HTMLElement).className = "loom-debug-value";
				container.appendChild(el);
			}
			// The click handler closes over a live instance, so it is rewritten even
			// when the row's text is unchanged.
			el.onclick = row.onSelect ? () => row.onSelect?.() : null;
			const key = rowKey(row);
			if (el.dataset.key === key) continue;
			el.dataset.key = key;
			// A row with no label is a note (a hint, a `+N more`) and takes the
			// whole width rather than leaving an empty label column beside it.
			el.className = `loom-debug-row${row.onSelect ? " is-clickable" : ""}${
				row.label === "" ? " is-note" : ""
			}`;
			if (row.title) el.title = row.title;
			else el.removeAttribute("title");
			const keyEl = el.firstElementChild as HTMLElement;
			const valueEl = el.lastElementChild as HTMLElement;
			keyEl.textContent = row.label;
			// The column is fixed, so a long label (a layer or family name) needs
			// somewhere to say the rest of itself.
			if (row.label.length > 12) keyEl.title = row.label;
			else keyEl.removeAttribute("title");
			valueEl.className = `loom-debug-value${row.kind ? ` k-${row.kind}` : ""}`;
			if (row.chips) {
				valueEl.classList.add("loom-debug-chips");
				valueEl.textContent = "";
				fillChips(valueEl, row.chips);
				continue;
			}
			valueEl.classList.remove("loom-debug-chips");
			valueEl.textContent = "";
			if (row.swatch) {
				const swatch = document.createElement("span");
				swatch.className = "loom-debug-swatch";
				swatch.style.background = row.swatch;
				valueEl.appendChild(swatch);
			}
			valueEl.append(row.value ?? "");
		}
		while (container.children.length > rows.length) {
			container.lastElementChild?.remove();
		}
	}

	// -------------------------------------------------------------------------
	// Sections
	// -------------------------------------------------------------------------

	function targetRows(): Row[] {
		if (!target) {
			return [
				{ label: "target", value: "none selected", kind: "muted" },
				...errorRows(),
			];
		}
		return [
			{ label: "path", value: target.key, title: target.key },
			{ label: "title", value: target.title ?? "—", kind: "str" },
			{ label: "import", value: ms(target.importMs), kind: "num" },
			{ label: "first frame", value: ms(firstFrameMs), kind: "num" },
			{
				label: "status",
				value: error ? "error" : firstFrameMs === undefined ? "…" : "ok",
				kind: error ? "str" : "bool",
			},
			...errorRows(),
		];
	}

	function errorRows(): Row[] {
		if (error === undefined) return [];
		return [{ label: "error", value: truncate(error, 96), title: error }];
	}

	function viewportRows(view: DebugSnapshot["viewport"]): Row[] {
		return [
			{ label: "stage", value: formatSize(view.stage, " px"), kind: "num" },
			{ label: "logical", value: formatSize(view.logical, " px"), kind: "num" },
			{ label: "camera", value: formatSize(view.camera), kind: "num" },
			{
				label: "scale",
				value: view.scale === 1 ? "1 (unscaled)" : view.scale.toFixed(3),
				kind: "num",
			},
			{
				label: "base width",
				value: view.baseWidth > 0 ? `${view.baseWidth} px` : "off",
				kind: view.baseWidth > 0 ? "num" : "muted",
			},
			{
				label: "dpr",
				value:
					view.devicePixelRatio === undefined
						? "—"
						: formatNumber(view.devicePixelRatio),
				kind: "num",
			},
			{ label: "theme", value: view.theme, kind: "enum" },
		];
	}

	function sceneRows(stats: SceneStats | undefined): Row[] {
		if (!stats) {
			return [{ label: "scene", value: "no world mounted", kind: "muted" }];
		}
		const elements = document.querySelectorAll(
			"#loom-root [data-loom-id]",
		).length;
		const rows: Row[] = [
			{ label: "instances", value: String(stats.instances), kind: "num" },
			{
				label: "gui objects",
				value:
					stats.hidden > 0
						? `${stats.guiObjects} (${stats.hidden} hidden)`
						: String(stats.guiObjects),
				kind: "num",
			},
			{ label: "depth", value: String(stats.depth), kind: "num" },
			{ label: "dom nodes", value: String(elements), kind: "num" },
			{
				label: "classes",
				chips: stats.classes.map(([className, count]) => ({
					text: `${className} ${count}`,
					kind: "class" as const,
				})),
			},
		];
		for (const layer of stats.layers) {
			rows.push({
				label: layer.name,
				value: `${layer.className} · order ${layer.displayOrder} · ${layer.instances} inst${
					layer.enabled ? "" : " · disabled"
				}`,
				kind: layer.enabled ? undefined : "muted",
			});
		}
		return rows;
	}

	/**
	 * What the text in the scene is really painted with. A family loom asked for
	 * and a family the browser has are different things, and when they differ the
	 * layout is measured against metrics nobody chose — the quiet failure this
	 * row exists to make loud.
	 */
	function fontRows(stats: SceneStats | undefined): Row[] {
		if (!stats || stats.fonts.length === 0) {
			return [{ label: "", value: "no text in this scene", kind: "muted" }];
		}
		return stats.fonts.map((font) => ({
			label: font.family,
			value: `${font.count} · ${[...font.weights].sort().join("/")} · ${
				font.available ? "loaded" : "fallback"
			}`,
			kind: font.available ? undefined : "str",
			title: font.available
				? `${font.family} is loaded and being measured against`
				: `${font.family} is not loaded — text is painted and measured in the fallback face`,
		}));
	}

	function frameRows(): Row[] {
		const rows: Row[] = [
			{ label: "fps", value: fps > 0 ? String(fps) : "—", kind: "num" },
			{ label: "dom updates", value: String(updates), kind: "num" },
			{
				label: "last update",
				value: lastUpdateAt === undefined ? "—" : ms(now() - lastUpdateAt),
				kind: "num",
			},
			{
				label: "console",
				value:
					warnings + errors === 0
						? "quiet"
						: `${warnings} warn · ${errors} error`,
				kind: warnings + errors === 0 ? "muted" : "str",
			},
		];
		if (lastLog !== undefined) {
			rows.push({
				label: "last log",
				value: truncate(lastLog, 96),
				title: lastLog,
				kind: "muted",
			});
		}
		return rows;
	}

	function select(inst: LoomInstance | undefined, pin: boolean): void {
		selected = inst;
		pinned = pin && inst !== undefined;
		refresh();
	}

	function inspectRows(): Row[] {
		if (selected && !isLive(selected)) {
			selected = undefined;
			pinned = false;
		}
		const inst = selected;
		if (!inst) {
			return [
				{
					label: "",
					value: "hover the stage · alt+click to pin",
					kind: "muted",
				},
			];
		}
		const chain = ancestorChain(inst);
		const pos = inst.AbsolutePosition;
		const size = inst.AbsoluteSize;
		const rows: Row[] = [
			{
				label: "path",
				chips: chain.map((node) => ({
					text: String(node.Name),
					kind: node === inst ? ("class" as const) : undefined,
					title: `${node.ClassName} — click to select`,
					onSelect: () => select(node, true),
				})),
			},
			{ label: "class", value: inst.ClassName, kind: "class" },
			{
				label: "abs pos",
				value: `${formatNumber(pos.X)}, ${formatNumber(pos.Y)}`,
				kind: "num",
			},
			{
				label: "abs size",
				value: `${formatNumber(size.X)} × ${formatNumber(size.Y)}`,
				kind: "num",
			},
		];

		const modifiers = modifiersOf(inst);
		const children = inst.GetChildren().length - modifiers.length;
		if (modifiers.length > 0) {
			rows.push({
				label: "modifiers",
				chips: modifiers.map((className) => ({
					text: className,
					kind: "class" as const,
				})),
			});
		}
		if (children > 0) {
			rows.push({ label: "children", value: String(children), kind: "num" });
		}

		if (TEXT_CLASSES.has(inst.ClassName)) {
			const resolved = instanceFont(inst as unknown as Record<string, unknown>);
			const family = primaryFamily(resolved.family);
			const available = familyIsAvailable(family);
			rows.push({
				label: "typeface",
				value: `${family} ${resolved.weight}${resolved.italic ? " italic" : ""}`,
				kind: "enum",
				title: resolved.family,
			});
			rows.push({
				label: "face",
				value: available ? "loaded" : "fallback (not loaded)",
				kind: available ? "bool" : "str",
			});
		}

		rows.push(...propertyRows(inst));

		for (const other of hitStack.slice(1, 1 + MAX_HIT_STACK_ROWS)) {
			if (!isLive(other)) continue;
			rows.push({
				label: "under",
				value: `${String(other.Name)} (${other.ClassName})`,
				kind: "muted",
				title: "click to select",
				onSelect: () => select(other, true),
			});
		}
		return rows;
	}

	/** The inspected instance's property rows, priority ones first. */
	function propertyRows(inst: LoomInstance): Row[] {
		let props: ReadonlyMap<string, unknown>;
		try {
			props = getRawProperties(inst);
		} catch {
			return [];
		}
		const rest = [...props.keys()]
			.filter(
				(key) =>
					!PRIORITY_PROPERTIES.includes(key) &&
					!PROPERTIES_SHOWN_ELSEWHERE.has(key) &&
					!INTERNAL_PROPERTY_PREFIXES.some((prefix) => key.startsWith(prefix)),
			)
			.sort();
		const rows: Row[] = [];
		let dropped = 0;
		for (const key of [...PRIORITY_PROPERTIES, ...rest]) {
			if (!props.has(key)) continue;
			const cell = formatDebugCell(props.get(key));
			if (!cell) continue;
			if (rows.length >= MAX_PROPERTY_ROWS) {
				dropped += 1;
				continue;
			}
			rows.push({
				label: key,
				value: cell.text,
				kind: cell.kind,
				swatch: cell.swatch,
			});
		}
		if (dropped > 0) {
			rows.push({ label: "", value: `+${dropped} more`, kind: "muted" });
		}
		return rows;
	}

	// -------------------------------------------------------------------------
	// Refresh
	// -------------------------------------------------------------------------

	function paint(name: SectionName, rows: readonly Row[], badge: string): void {
		const section = sections.get(name);
		if (!section) return;
		rendered.set(name, rows);
		if (section.badge.textContent !== badge) section.badge.textContent = badge;
		if (collapsed.has(name)) return; // folded: nothing to lay out
		renderRows(section.rows, rows);
	}

	function refresh(): void {
		if (!open) return;
		try {
			// Walked even for folded sections: their badges keep reporting, and
			// that is what makes folding one worth doing.
			const stats = readSceneStats(playerGui());
			const view = viewportMetrics(stage);
			paint("target", targetRows(), target ? (error ? "error" : "ok") : "—");
			paint("viewport", viewportRows(view), formatSize(view.stage));
			paint(
				"scene",
				sceneRows(stats),
				stats ? `${stats.instances} inst` : "empty",
			);
			paint(
				"fonts",
				fontRows(stats),
				stats?.fonts.some((font) => !font.available)
					? "fallback"
					: `${stats?.fonts.length ?? 0}`,
			);
			paint("frame", frameRows(), fps > 0 ? `${fps} fps` : "—");
			paint(
				"inspect",
				inspectRows(),
				selected ? (pinned ? "pinned" : String(selected.ClassName)) : "—",
			);
			headerStat.textContent = fps > 0 ? `${fps} fps` : "";
			drawHighlight();
		} catch (err) {
			// A debug panel that throws would take the target down with it (the
			// shell's own uncaught-error handler paints the error panel), which is
			// the one thing this must never do.
			console.warn("[loom debug]", err);
		}
	}

	/** The whole readout as plain text — for pasting into an issue. */
	async function copyReadout(): Promise<void> {
		const lines: string[] = [];
		for (const name of SECTIONS) {
			lines.push(`## ${name}`);
			for (const row of rendered.get(name) ?? []) {
				const value = row.chips
					? row.chips.map((chip) => chip.text).join(", ")
					: (row.value ?? "");
				lines.push(`${(row.label || "-").padEnd(14)} ${value}`);
			}
			lines.push("");
		}
		const text = lines.join("\n");
		try {
			await navigator.clipboard.writeText(text);
			flash(copyButton, "copied");
		} catch {
			console.warn("[loom debug] clipboard refused; readout follows\n", text);
			flash(copyButton, "in console");
		}
	}

	/** Say what a button just did, then put its own label back. */
	function flash(button: HTMLButtonElement, message: string): void {
		const label = button.dataset.label ?? button.textContent ?? "";
		button.dataset.label = label;
		button.textContent = message;
		setTimeout(() => {
			button.textContent = label;
		}, 1400);
	}

	// -------------------------------------------------------------------------
	// Snapshot / JSON export
	// -------------------------------------------------------------------------

	/**
	 * Everything the panel knows, as plain data — the same reading, minus the
	 * formatting. This is what the `json` button writes out and what
	 * `window.loomDebug.snapshot()` hands to a console or a screenshot harness,
	 * so a report can carry the scene instead of a photograph of the panel.
	 */
	function snapshot(): DebugSnapshot {
		const gui = playerGui();
		const stats = readSceneStats(gui);
		const view = viewportMetrics(stage);
		const domNodes = document.querySelectorAll(
			"#loom-root [data-loom-id]",
		).length;
		return {
			capturedAt: new Date().toISOString(),
			url: location.href,
			target: {
				path: target?.key,
				title: target?.title,
				importMs: precise(target?.importMs),
				firstFrameMs: precise(firstFrameMs),
				status: error
					? "error"
					: !target
						? "none"
						: firstFrameMs === undefined
							? "pending"
							: "ok",
				error,
			},
			viewport: view,
			scene: stats && {
				instances: stats.instances,
				guiObjects: stats.guiObjects,
				hidden: stats.hidden,
				depth: stats.depth,
				domNodes,
				classes: Object.fromEntries(stats.classes),
				layers: stats.layers,
			},
			fonts:
				stats?.fonts.map((font) => ({
					family: font.family,
					available: font.available,
					weights: [...font.weights].sort(),
					count: font.count,
				})) ?? [],
			frame: {
				fps,
				domUpdates: updates,
				msSinceLastUpdate:
					lastUpdateAt === undefined
						? undefined
						: precise(now() - lastUpdateAt),
				warnings,
				errors,
				lastLog,
			},
			selected: selectedSnapshot(),
			tree: gui?.GetChildren().map(treeNode) ?? [],
		};
	}

	function selectedSnapshot(): DebugSnapshot["selected"] {
		const inst = selected;
		if (!inst || !isLive(inst)) return undefined;
		const properties: Record<string, string> = {};
		try {
			for (const [key, value] of getRawProperties(inst)) {
				if (INTERNAL_PROPERTY_PREFIXES.some((p) => key.startsWith(p))) continue;
				const cell = formatDebugCell(value);
				if (cell) properties[key] = cell.text;
			}
		} catch {
			// An instance that is no longer one has no properties to report.
		}
		let typeface: DebugTypeface | undefined;
		if (TEXT_CLASSES.has(inst.ClassName)) {
			const resolved = instanceFont(inst as unknown as Record<string, unknown>);
			const family = primaryFamily(resolved.family);
			typeface = {
				family,
				weight: resolved.weight,
				italic: resolved.italic,
				available: familyIsAvailable(family),
			};
		}
		return {
			...treeNode(inst),
			// The subtree is already in `tree`; the selection is one node.
			children: undefined,
			path: ancestorChain(inst).map((node) => String(node.Name)),
			modifiers: modifiersOf(inst),
			typeface,
			properties,
		};
	}

	/** `src/targets/CardScene.loom.tsx` → `CardScene`; no target → `scene`. */
	function exportBasename(): string {
		const file = target?.key.split("/").pop() ?? "scene";
		return file.replace(/\.loom\.tsx?$/i, "") || "scene";
	}

	/**
	 * Write the snapshot out as a file. A download rather than the clipboard:
	 * the tree makes this far too long to paste, and a file is what an issue or
	 * a diff between two runs actually wants. Falls back to the clipboard, then
	 * the console, wherever object URLs are not available.
	 */
	async function exportJson(): Promise<void> {
		let json: string;
		try {
			json = JSON.stringify(snapshot(), null, 2);
		} catch (err) {
			console.warn("[loom debug] could not serialise the snapshot", err);
			flash(jsonButton, "failed");
			return;
		}
		const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
		const name = `loom-debug-${exportBasename()}-${stamp}.json`;
		try {
			const url = URL.createObjectURL(
				new Blob([json], { type: "application/json" }),
			);
			const link = document.createElement("a");
			link.href = url;
			link.download = name;
			link.click();
			setTimeout(() => URL.revokeObjectURL(url), 10_000);
			flash(jsonButton, "saved");
			return;
		} catch {
			// No object URLs here (a sandboxed iframe, an exotic embedder).
		}
		try {
			await navigator.clipboard.writeText(json);
			flash(jsonButton, "copied");
		} catch {
			console.warn(`[loom debug] ${name}\n`, json);
			flash(jsonButton, "in console");
		}
	}

	// -------------------------------------------------------------------------
	// Hover inspection. The hit test is the world's own
	// (`PlayerGui.GetGuiObjectsAtPosition`), so what the panel calls the topmost
	// object under the pointer is what the scene would call it — including the
	// frames the DOM makes click-through, which no `elementFromPoint` can reach.
	// -------------------------------------------------------------------------

	function drawHighlight(): void {
		const inst = selected;
		const mount = activeMount();
		if (!inst || !mount || !open) {
			highlight.hidden = true;
			return;
		}
		const bounds = mount.getBoundingClientRect();
		const stageBounds = stage.getBoundingClientRect();
		const scale = mountScale(mount);
		const pos = inst.AbsolutePosition;
		const size = inst.AbsoluteSize;
		const top = bounds.top - stageBounds.top + pos.Y * scale;
		highlight.style.left = `${bounds.left - stageBounds.left + pos.X * scale}px`;
		highlight.style.top = `${top}px`;
		highlight.style.width = `${size.X * scale}px`;
		highlight.style.height = `${size.Y * scale}px`;
		highlight.classList.toggle("pinned", pinned);
		// The badge sits above the outline, unless the outline is against the top
		// of the stage — then it drops inside so it stays on screen.
		highlight.classList.toggle("label-inside", top < 20);
		const label = `${String(inst.Name)} · ${formatNumber(size.X)} × ${formatNumber(size.Y)}`;
		if (highlightLabel.textContent !== label) {
			highlightLabel.textContent = label;
		}
		highlight.hidden = false;
	}

	function hitTest(clientX: number, clientY: number): LoomInstance[] {
		const gui = playerGui();
		const mount = activeMount();
		if (!gui || !mount) return [];
		const bounds = mount.getBoundingClientRect();
		const scale = mountScale(mount);
		const at = (
			gui.GetGuiObjectsAtPosition as
				| ((x: number, y: number) => LoomInstance[])
				| undefined
		)?.((clientX - bounds.left) / scale, (clientY - bounds.top) / scale);
		return Array.isArray(at) ? at : [];
	}

	const onPointerMove = (event: PointerEvent): void => {
		if (!open) return;
		// Reading the panel is not inspecting: keep whatever was last selected on
		// screen while the pointer travels over the panel itself.
		if (event.target instanceof Node && panel.contains(event.target)) return;
		try {
			hitStack = hitTest(event.clientX, event.clientY);
			if (!pinned) selected = hitStack[0];
			refresh();
		} catch (err) {
			console.warn("[loom debug]", err);
		}
	};

	/**
	 * Alt+click pins the selection (and alt+click on a pinned object releases
	 * it). Stopped in the capture phase so the scene never sees the press — a
	 * plain click still belongs to whatever the target put under the pointer.
	 */
	const onPointerDown = (event: PointerEvent): void => {
		if (!open || !event.altKey) return;
		if (event.target instanceof Node && panel.contains(event.target)) return;
		event.preventDefault();
		event.stopPropagation();
		try {
			hitStack = hitTest(event.clientX, event.clientY);
			const hit = hitStack[0];
			select(hit, !(pinned && hit === selected));
		} catch (err) {
			console.warn("[loom debug]", err);
		}
	};

	const onKeyDown = (event: KeyboardEvent): void => {
		if (!open || event.key !== "Escape" || !pinned) return;
		select(undefined, false);
	};

	// -------------------------------------------------------------------------
	// Live measurement, all of it scoped to the open panel.
	// -------------------------------------------------------------------------

	function tickFps(): void {
		if (!open) return;
		const time = now();
		frames += 1;
		if (fpsWindowStart === 0) fpsWindowStart = time;
		const elapsed = time - fpsWindowStart;
		if (elapsed >= FPS_WINDOW_MS) {
			fps = Math.round((frames * 1000) / elapsed);
			frames = 0;
			fpsWindowStart = time;
		}
		rafHandle = requestAnimationFrame(tickFps);
	}

	function startObserving(): void {
		const host = document.getElementById("loom-root");
		if (!host || typeof MutationObserver !== "function") return;
		observer = new MutationObserver(() => {
			updates += 1;
			lastUpdateAt = now();
			if (firstFrameMs === undefined && mountStartedAt !== undefined) {
				firstFrameMs = lastUpdateAt - mountStartedAt;
			}
		});
		observer.observe(host, {
			subtree: true,
			childList: true,
			attributes: true,
			attributeFilter: ["style"],
		});
	}

	/**
	 * Count what loom logs while the panel is open. Its warnings are the ones
	 * that explain a scene — a world claiming PlayerGui from another, a
	 * non-LayerCollector skipped, layout feedback giving up — and they are
	 * invisible to anyone not already watching the console.
	 */
	function startWatchingConsole(): void {
		const original = { warn: console.warn, error: console.error };
		const record = (level: "warn" | "error", args: unknown[]): void => {
			if (level === "warn") warnings += 1;
			else errors += 1;
			const first = args[0];
			lastLog =
				first instanceof Error
					? first.message
					: typeof first === "string"
						? first
						: String(first);
		};
		console.warn = (...args: unknown[]): void => {
			record("warn", args);
			original.warn(...args);
		};
		console.error = (...args: unknown[]): void => {
			record("error", args);
			original.error(...args);
		};
		restoreConsole = () => {
			console.warn = original.warn;
			console.error = original.error;
		};
	}

	function setOpen(next: boolean): void {
		if (next === open) return;
		open = next;
		panel.hidden = !next;
		if (next) {
			updates = 0;
			lastUpdateAt = undefined;
			frames = 0;
			fpsWindowStart = 0;
			fps = 0;
			warnings = 0;
			errors = 0;
			lastLog = undefined;
			startObserving();
			startWatchingConsole();
			// A console handle while the panel is open: `loomDebug.snapshot()` is
			// the same object the `json` button writes, which is what makes the
			// export reachable from a devtools session or a headless harness.
			(window as unknown as Record<string, unknown>).loomDebug = {
				snapshot,
				select: (inst: LoomInstance) => select(inst, true),
			};
			stage.addEventListener("pointermove", onPointerMove, true);
			stage.addEventListener("pointerdown", onPointerDown, true);
			window.addEventListener("keydown", onKeyDown);
			if (typeof requestAnimationFrame === "function") tickFps();
			timer = setInterval(refresh, REFRESH_MS);
			refresh();
			return;
		}
		observer?.disconnect();
		observer = undefined;
		restoreConsole?.();
		restoreConsole = undefined;
		delete (window as unknown as Record<string, unknown>).loomDebug;
		stage.removeEventListener("pointermove", onPointerMove, true);
		stage.removeEventListener("pointerdown", onPointerDown, true);
		window.removeEventListener("keydown", onKeyDown);
		if (timer !== undefined) clearInterval(timer);
		timer = undefined;
		if (rafHandle !== undefined && typeof cancelAnimationFrame === "function") {
			cancelAnimationFrame(rafHandle);
		}
		rafHandle = undefined;
		selected = undefined;
		hitStack = [];
		pinned = false;
		highlight.hidden = true;
	}

	return {
		isOpen: () => open,
		setOpen,
		toggle: () => setOpen(!open),
		snapshot,
		exportJson,
		setTarget(next: DebugTarget | undefined): void {
			target = next;
			mountStartedAt = next ? now() : undefined;
			firstFrameMs = undefined;
			// The previous target's instances are gone; anything still selected
			// would report a detached tree.
			selected = undefined;
			hitStack = [];
			pinned = false;
			refresh();
		},
		setError(message: string | undefined): void {
			error = message;
			refresh();
		},
		dispose(): void {
			setOpen(false);
			panel.remove();
			highlight.remove();
		},
	};
}
