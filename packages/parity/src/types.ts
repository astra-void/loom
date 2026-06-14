/**
 * Shared wire format for Loom <-> Roblox geometry/visual parity.
 *
 * Both capture sides (the in-browser Loom runtime and the Roblox Studio dump
 * plugin) serialise their rendered GUI tree into a {@link ParitySnapshot}. The
 * snapshot deliberately mirrors the shape of `PreviewLayoutDebugPayload`
 * (rect == AbsolutePosition + AbsoluteSize) so the existing layout-debug JSON
 * schema stays the canonical geometry contract, extended here with the visual
 * properties and a stable match path.
 */

/** A 2D vector in GUI pixels (Roblox `Vector2` / Loom `AbsolutePosition`). */
export interface ParityVec2 {
	x: number;
	y: number;
}

/** An RGB colour with channels in the `0..1` range (Roblox `Color3`). */
export interface ParityColor3 {
	r: number;
	g: number;
	b: number;
}

/**
 * Visual properties captured per instance. Every field is optional because not
 * every GuiObject exposes every property (a `Frame` has no `Text`, an
 * `ImageLabel` has no `TextColor3`, etc.).
 */
export interface ParityVisualProps {
	backgroundColor3?: ParityColor3;
	backgroundTransparency?: number;
	imageColor3?: ParityColor3;
	imageTransparency?: number;
	textColor3?: ParityColor3;
	textTransparency?: number;
	text?: string;
	textSize?: number;
	rotation?: number;
	visible?: boolean;
}

/** A single GuiObject in the captured tree. */
export interface ParityNode {
	/** Name of this instance (Roblox `Instance.Name`). */
	name: string;
	/** Roblox `ClassName` (Loom maps its host `nodeType` to the same string). */
	className: string;
	/** AbsolutePosition in GUI pixels, relative to the capture root viewport. */
	absolutePosition: ParityVec2;
	/** AbsoluteSize in GUI pixels. */
	absoluteSize: ParityVec2;
	/** Resolved render order (Roblox `ZIndex`). */
	zIndex?: number;
	/** Visual properties; absent when the capture side could not read any. */
	visual?: ParityVisualProps;
	children: ParityNode[];
}

/** A full capture from one side (Loom or Roblox). */
export interface ParitySnapshot {
	source: "loom" | "roblox";
	/** The viewport the tree was laid out against. Scale sizes depend on it. */
	viewport: ParityVec2;
	/** ISO timestamp of capture, stamped by the caller (optional). */
	capturedAt?: string;
	/** Optional free-form label, e.g. the scene/story name. */
	scene?: string;
	roots: ParityNode[];
}

export type ParitySeverity = "high" | "medium" | "low";

export type ParityNodeStatus =
	| "matched"
	| "missing-in-loom"
	| "missing-in-roblox";

/** A single mismatched field on an otherwise matched node. */
export interface ParityFieldDiff {
	field: string;
	loom: unknown;
	roblox: unknown;
	/** Numeric magnitude of the divergence, where the field is numeric. */
	delta?: number;
	severity: ParitySeverity;
}

/** The diff verdict for one tree position. */
export interface ParityNodeDiff {
	/** Stable match key: the disambiguated Name path from the root. */
	key: string;
	name: string;
	className: string;
	status: ParityNodeStatus;
	fields: ParityFieldDiff[];
	maxSeverity: ParitySeverity | null;
}

/** Per-axis / per-field tolerances. Anything within tolerance is "identical". */
export interface ParityTolerance {
	/** AbsolutePosition tolerance, GUI px. */
	positionPx: number;
	/** AbsoluteSize tolerance, GUI px. */
	sizePx: number;
	/** Rotation tolerance, degrees. */
	rotationDeg: number;
	/** Colour channel tolerance, 0..1. */
	color: number;
	/** Transparency / alpha tolerance, 0..1. */
	transparency: number;
}

export interface ParityReport {
	generatedAt?: string;
	scene?: string;
	viewport: {
		loom: ParityVec2;
		roblox: ParityVec2;
		mismatch: boolean;
	};
	tolerance: ParityTolerance;
	summary: {
		totalLoom: number;
		totalRoblox: number;
		matched: number;
		nodesWithDiffs: number;
		missingInLoom: number;
		missingInRoblox: number;
		bySeverity: Record<ParitySeverity, number>;
	};
	/** Nodes that diverge (clean matches are summarised, not listed). */
	nodes: ParityNodeDiff[];
}
