import {
	getPreviewHostMetadataByRuntimeName,
	type PreviewPlaceholderBehavior,
} from "../hosts/metadata";
import {
	FULL_SIZE_UDIM2,
	normalizePreviewNodeId,
	type SerializedUDim,
	type SerializedUDim2,
	type SerializedVector2,
	serializeUDim2,
	serializeVector2,
	toFiniteNumber,
	type UDim2Like,
	type Vector2Like,
	ZERO_UDIM2,
	ZERO_VECTOR2,
} from "../internal/robloxValues";

export type ComputedRect = {
	x: number;
	y: number;
	width: number;
	height: number;
};

export type MeasuredNodeSize = {
	height: number;
	width: number;
};

export type PreviewLayoutAxis = {
	offset: number;
	scale: number;
};

export type PreviewLayoutSize = {
	x: PreviewLayoutAxis;
	y: PreviewLayoutAxis;
};

export type PreviewLayoutVector = {
	x: number;
	y: number;
};

export type PreviewLayoutAxisConstraints = {
	max?: number;
	min?: number;
};

export type PreviewLayoutHostMetadata = {
	degraded: boolean;
	fullSizeDefault: boolean;
	placeholderBehavior: PreviewPlaceholderBehavior;
};

export type PreviewLayoutHostPolicy = PreviewLayoutHostMetadata;

export type PreviewLayoutConstraints = {
	height?: PreviewLayoutAxisConstraints;
	width?: PreviewLayoutAxisConstraints;
};

export type PreviewLayoutPositionMode = "absolute";
export type PreviewLayoutNodeKind = "host" | "layout" | "root";
export type PreviewLayoutSource =
	| "explicit-size"
	| "full-size-default"
	| "intrinsic-size"
	| "root-default";

export type PreviewLayoutSizeResolutionReason =
	| "explicit-size"
	| "full-size-default"
	| "intrinsic-measurement"
	| "intrinsic-empty"
	| "root-default";

export type PreviewLayoutSizeResolution = {
	hadExplicitSize: boolean;
	intrinsicSizeAvailable: boolean;
	reason: PreviewLayoutSizeResolutionReason;
};

export type PreviewLayoutStyleHints = {
	height?: string;
	width?: string;
};

export type PreviewLayoutNodeLayout = {
	anchorPoint: PreviewLayoutVector;
	constraints?: PreviewLayoutConstraints;
	position: PreviewLayoutSize;
	positionMode: PreviewLayoutPositionMode;
	size?: PreviewLayoutSize;
};

export type PreviewLayoutNode = {
	debugLabel?: string;
	hostMetadata?: PreviewLayoutHostMetadata;
	id: string;
	intrinsicSize?: MeasuredNodeSize | null;
	kind: PreviewLayoutNodeKind;
	layout: PreviewLayoutNodeLayout;
	nodeType: string;
	parentId?: string;
	styleHints?: PreviewLayoutStyleHints;
};

export type PreviewLayoutDebugNode = {
	children: PreviewLayoutDebugNode[];
	debugLabel?: string;
	hostPolicy: PreviewLayoutHostPolicy;
	id: string;
	intrinsicSize: MeasuredNodeSize | null;
	kind: PreviewLayoutNodeKind;
	layoutSource: PreviewLayoutSource;
	nodeType: string;
	parentConstraints: ComputedRect | null;
	parentId?: string;
	provenance: {
		detail: string;
		source: "fallback" | "wasm";
	};
	rect: ComputedRect | null;
	sizeResolution: PreviewLayoutSizeResolution;
	styleHints?: PreviewLayoutStyleHints;
};

export type PreviewLayoutDebugPayload = {
	dirtyNodeIds: string[];
	roots: PreviewLayoutDebugNode[];
	viewport: {
		height: number;
		width: number;
	};
};

export type PreviewLayoutResult = {
	debug: PreviewLayoutDebugPayload;
	dirtyNodeIds: string[];
	rects: Record<string, ComputedRect>;
};

export type RegisteredNode = PreviewLayoutNode;

export type RobloxLayoutNodeInput = {
	anchorPoint?: Vector2Like;
	id: string;
	kind?: PreviewLayoutNodeKind;
	nodeType: string;
	parentId?: string;
	position?: UDim2Like;
	size?: UDim2Like;
};

export type RobloxLayoutRegistrationInput = RobloxLayoutNodeInput & {
	canMeasure?: boolean;
	debugLabel?: string;
	hostMetadata?: PreviewLayoutHostMetadata;
	intrinsicSize?: MeasuredNodeSize | null;
	measure?: () => MeasuredNodeSize | null;
	measurementVersion?: number;
	styleHints?: PreviewLayoutStyleHints;
};

export const SYNTHETIC_ROOT_ID = "__loom_preview_root__";

function toLayoutAxis(value: SerializedUDim): PreviewLayoutAxis {
	return {
		offset: value.Offset,
		scale: value.Scale,
	};
}

function toLayoutSize(value: SerializedUDim2): PreviewLayoutSize {
	return {
		x: toLayoutAxis(value.X),
		y: toLayoutAxis(value.Y),
	};
}

function toLayoutVector(value: SerializedVector2): PreviewLayoutVector {
	return {
		x: value.X,
		y: value.Y,
	};
}

function toFiniteAxisValue(value: unknown): number | undefined {
	if (value === undefined || value === null) {
		return undefined;
	}

	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeConstraints(
	value: unknown,
): PreviewLayoutConstraints | undefined {
	if (!value || typeof value !== "object") {
		return undefined;
	}

	const record = value as {
		height?: { max?: number; min?: number } | null;
		width?: { max?: number; min?: number } | null;
	};

	const height = record.height
		? {
				max: toFiniteAxisValue(record.height.max),
				min: toFiniteAxisValue(record.height.min),
			}
		: undefined;
	const width = record.width
		? {
				max: toFiniteAxisValue(record.width.max),
				min: toFiniteAxisValue(record.width.min),
			}
		: undefined;

	if (!height && !width) {
		return undefined;
	}

	return {
		height:
			height && (height.max !== undefined || height.min !== undefined)
				? height
				: undefined,
		width:
			width && (width.max !== undefined || width.min !== undefined)
				? width
				: undefined,
	};
}

function normalizeIntrinsicSize(
	size: MeasuredNodeSize | null | undefined,
): MeasuredNodeSize | null {
	if (!size) {
		return null;
	}

	return {
		height: Math.max(0, toFiniteNumber(size.height, 0)),
		width: Math.max(0, toFiniteNumber(size.width, 0)),
	};
}

function normalizeStyleHints(
	hints: PreviewLayoutStyleHints | undefined,
): PreviewLayoutStyleHints | undefined {
	if (!hints) {
		return undefined;
	}

	const height = typeof hints.height === "string" ? hints.height : undefined;
	const width = typeof hints.width === "string" ? hints.width : undefined;

	if (!height && !width) {
		return undefined;
	}

	return { height, width };
}

function normalizeHostMetadata(
	metadata: Partial<PreviewLayoutHostMetadata> | null | undefined,
	runtimeName?: string,
): PreviewLayoutHostMetadata | undefined {
	const fallback = runtimeName
		? getPreviewHostMetadataByRuntimeName(runtimeName)
		: undefined;
	if (!metadata && !fallback) {
		return undefined;
	}

	return {
		degraded: metadata?.degraded ?? fallback?.degraded ?? false,
		fullSizeDefault:
			metadata?.fullSizeDefault ?? fallback?.fullSizeDefault ?? false,
		placeholderBehavior:
			metadata?.placeholderBehavior === "container" ||
			metadata?.placeholderBehavior === "opaque" ||
			metadata?.placeholderBehavior === "none"
				? metadata.placeholderBehavior
				: (fallback?.placeholderBehavior ?? "none"),
	};
}

const DEFAULT_HOST_POLICY: PreviewLayoutHostPolicy = {
	degraded: false,
	fullSizeDefault: false,
	placeholderBehavior: "none",
};

function createHostPolicy(
	metadata: Partial<PreviewLayoutHostMetadata> | null | undefined,
	runtimeName?: string,
): PreviewLayoutHostPolicy {
	return normalizeHostMetadata(metadata, runtimeName) ?? DEFAULT_HOST_POLICY;
}

export function resolveNodeHostPolicy(
	node: Pick<PreviewLayoutNode, "hostMetadata" | "nodeType">,
): PreviewLayoutHostPolicy {
	return createHostPolicy(node.hostMetadata, node.nodeType);
}

function createSizeResolution(
	hadExplicitSize: boolean,
	intrinsicSizeAvailable: boolean,
	reason: PreviewLayoutSizeResolutionReason,
): PreviewLayoutSizeResolution {
	return {
		hadExplicitSize,
		intrinsicSizeAvailable,
		reason,
	};
}

type PreviewResolvedNodeSize = {
	layoutSource: PreviewLayoutSource;
	resolvedSize: PreviewLayoutSize;
	sizeResolution: PreviewLayoutSizeResolution;
};

export function createViewportRect(
	width: number,
	height: number,
): ComputedRect {
	return {
		height,
		width,
		x: 0,
		y: 0,
	};
}

function resolveAxis(udim: PreviewLayoutAxis, parentAxisSize: number): number {
	return parentAxisSize * udim.scale + udim.offset;
}

function clampAxis(
	value: number,
	constraints: PreviewLayoutAxisConstraints | undefined,
): number {
	let next = value;

	if (constraints?.min !== undefined) {
		next = Math.max(next, constraints.min);
	}

	if (constraints?.max !== undefined) {
		next = Math.min(next, constraints.max);
	}

	return next;
}

function createMeasuredSizeLayout(
	measuredSize: MeasuredNodeSize,
): PreviewLayoutSize {
	return {
		x: {
			offset: measuredSize.width,
			scale: 0,
		},
		y: {
			offset: measuredSize.height,
			scale: 0,
		},
	};
}

export function normalizeRootScreenGuiNode(
	node: PreviewLayoutNode,
): PreviewLayoutNode {
	if (node.nodeType !== "ScreenGui" || node.parentId !== undefined) {
		return node;
	}

	return {
		...node,
		kind: "root",
		layout: {
			...node.layout,
			anchorPoint: toLayoutVector(ZERO_VECTOR2),
			position: toLayoutSize(ZERO_UDIM2),
			size: toLayoutSize(FULL_SIZE_UDIM2),
		},
	};
}

export function createEmptyLayoutDebugPayload(viewport: {
	height: number;
	width: number;
}): PreviewLayoutDebugPayload {
	return {
		dirtyNodeIds: [],
		roots: [],
		viewport,
	};
}

export function createEmptyLayoutResult(viewport: {
	height: number;
	width: number;
}): PreviewLayoutResult {
	return {
		debug: createEmptyLayoutDebugPayload(viewport),
		dirtyNodeIds: [],
		rects: {},
	};
}

export function adaptRobloxNodeInput(
	input: RobloxLayoutRegistrationInput,
	parentId: string | undefined,
): PreviewLayoutNode {
	const normalizedParentId = normalizePreviewNodeId(input.parentId ?? parentId);
	const normalizedId = normalizePreviewNodeId(input.id) ?? input.id;
	const measuredSize = normalizeIntrinsicSize(
		input.intrinsicSize ??
			(input.canMeasure ? (input.measure?.() ?? null) : null),
	);

	const nextNode: PreviewLayoutNode = {
		debugLabel: input.debugLabel,
		hostMetadata: normalizeHostMetadata(input.hostMetadata, input.nodeType),
		id: normalizedId,
		intrinsicSize: measuredSize,
		kind:
			input.kind ??
			(normalizedParentId === undefined && input.nodeType === "ScreenGui"
				? "root"
				: "host"),
		layout: {
			anchorPoint: toLayoutVector(
				serializeVector2(input.anchorPoint, ZERO_VECTOR2),
			),
			constraints: normalizeConstraints(
				(input as { constraints?: unknown }).constraints,
			),
			position: toLayoutSize(
				serializeUDim2(input.position, ZERO_UDIM2) ?? ZERO_UDIM2,
			),
			positionMode: "absolute",
			size: input.size
				? toLayoutSize(serializeUDim2(input.size, ZERO_UDIM2) ?? ZERO_UDIM2)
				: undefined,
		},
		nodeType: input.nodeType,
		parentId: normalizedParentId,
		styleHints: normalizeStyleHints(input.styleHints),
	};

	return normalizeRootScreenGuiNode(nextNode);
}

export function areNodesEqual(
	a: PreviewLayoutNode,
	b: PreviewLayoutNode,
): boolean {
	return (
		a.debugLabel === b.debugLabel &&
		a.hostMetadata?.degraded === b.hostMetadata?.degraded &&
		a.hostMetadata?.fullSizeDefault === b.hostMetadata?.fullSizeDefault &&
		a.hostMetadata?.placeholderBehavior ===
			b.hostMetadata?.placeholderBehavior &&
		a.id === b.id &&
		(a.intrinsicSize?.width ?? 0) === (b.intrinsicSize?.width ?? 0) &&
		(a.intrinsicSize?.height ?? 0) === (b.intrinsicSize?.height ?? 0) &&
		a.kind === b.kind &&
		a.layout.anchorPoint.x === b.layout.anchorPoint.x &&
		a.layout.anchorPoint.y === b.layout.anchorPoint.y &&
		(a.layout.constraints?.width?.min ?? undefined) ===
			(b.layout.constraints?.width?.min ?? undefined) &&
		(a.layout.constraints?.width?.max ?? undefined) ===
			(b.layout.constraints?.width?.max ?? undefined) &&
		(a.layout.constraints?.height?.min ?? undefined) ===
			(b.layout.constraints?.height?.min ?? undefined) &&
		(a.layout.constraints?.height?.max ?? undefined) ===
			(b.layout.constraints?.height?.max ?? undefined) &&
		a.layout.position.x.scale === b.layout.position.x.scale &&
		a.layout.position.x.offset === b.layout.position.x.offset &&
		a.layout.position.y.scale === b.layout.position.y.scale &&
		a.layout.position.y.offset === b.layout.position.y.offset &&
		a.layout.positionMode === b.layout.positionMode &&
		(a.layout.size?.x.scale ?? 0) === (b.layout.size?.x.scale ?? 0) &&
		(a.layout.size?.x.offset ?? 0) === (b.layout.size?.x.offset ?? 0) &&
		(a.layout.size?.y.scale ?? 0) === (b.layout.size?.y.scale ?? 0) &&
		(a.layout.size?.y.offset ?? 0) === (b.layout.size?.y.offset ?? 0) &&
		a.nodeType === b.nodeType &&
		a.parentId === b.parentId &&
		a.styleHints?.height === b.styleHints?.height &&
		a.styleHints?.width === b.styleHints?.width
	);
}

export function resolveNodeSize(
	node: Pick<
		PreviewLayoutNode,
		"hostMetadata" | "intrinsicSize" | "kind" | "layout"
	>,
): PreviewResolvedNodeSize {
	if (node.kind === "root") {
		return {
			layoutSource: "root-default",
			resolvedSize: toLayoutSize(FULL_SIZE_UDIM2),
			sizeResolution: createSizeResolution(false, false, "root-default"),
		};
	}

	if (node.layout.size) {
		return {
			layoutSource: "explicit-size",
			resolvedSize: node.layout.size,
			sizeResolution: createSizeResolution(
				true,
				node.intrinsicSize !== null && node.intrinsicSize !== undefined,
				"explicit-size",
			),
		};
	}

	if (node.hostMetadata?.fullSizeDefault) {
		return {
			layoutSource: "full-size-default",
			resolvedSize: toLayoutSize(FULL_SIZE_UDIM2),
			sizeResolution: createSizeResolution(
				false,
				node.intrinsicSize !== null && node.intrinsicSize !== undefined,
				"full-size-default",
			),
		};
	}

	if (node.intrinsicSize) {
		return {
			layoutSource: "intrinsic-size",
			resolvedSize: createMeasuredSizeLayout(node.intrinsicSize),
			sizeResolution: createSizeResolution(
				false,
				true,
				"intrinsic-measurement",
			),
		};
	}

	return {
		layoutSource: "intrinsic-size",
		resolvedSize: toLayoutSize(ZERO_UDIM2),
		sizeResolution: createSizeResolution(false, false, "intrinsic-empty"),
	};
}

export function computeRectFromParentRect(
	node: Pick<
		PreviewLayoutNode,
		"hostMetadata" | "intrinsicSize" | "kind" | "layout"
	>,
	parentRect: ComputedRect,
): { layoutSource: PreviewLayoutSource; rect: ComputedRect } {
	const resolved = resolveNodeSize(node);

	let width = resolveAxis(resolved.resolvedSize.x, parentRect.width);
	let height = resolveAxis(resolved.resolvedSize.y, parentRect.height);
	width = clampAxis(width, node.layout.constraints?.width);
	height = clampAxis(height, node.layout.constraints?.height);

	return {
		layoutSource: resolved.layoutSource,
		rect: {
			height,
			width,
			x:
				parentRect.x +
				resolveAxis(node.layout.position.x, parentRect.width) -
				node.layout.anchorPoint.x * width,
			y:
				parentRect.y +
				resolveAxis(node.layout.position.y, parentRect.height) -
				node.layout.anchorPoint.y * height,
		},
	};
}

export function computeNodeRect(
	node: PreviewLayoutNode,
	parentRect: ComputedRect,
): { layoutSource: PreviewLayoutSource; rect: ComputedRect } {
	if (node.kind === "root") {
		return {
			layoutSource: "root-default",
			rect: createViewportRect(parentRect.width, parentRect.height),
		};
	}

	return computeRectFromParentRect(node, parentRect);
}

export function normalizeLayoutMap(raw: unknown): Record<string, ComputedRect> {
	if (!(raw instanceof Map) && !(raw && typeof raw === "object")) {
		throw new Error(`Unexpected compute_layout result type: ${typeof raw}`);
	}

	const entries =
		raw instanceof Map
			? (Array.from(raw.entries()) as Array<[string, unknown]>)
			: Object.entries(raw as Record<string, unknown>);

	const next: Record<string, ComputedRect> = {};
	for (const [key, value] of entries) {
		if (!value || typeof value !== "object") {
			continue;
		}

		const record = value as Record<string, unknown>;
		const rect: ComputedRect = {
			height: toFiniteNumber(record.height, 0),
			width: toFiniteNumber(record.width, 0),
			x: toFiniteNumber(record.x, 0),
			y: toFiniteNumber(record.y, 0),
		};

		const normalizedKey = normalizePreviewNodeId(key) ?? key;
		next[normalizedKey] = rect;
	}

	return next;
}

function normalizeLayoutSource(value: unknown): PreviewLayoutSource {
	return value === "explicit-size" ||
		value === "full-size-default" ||
		value === "intrinsic-size" ||
		value === "root-default"
		? value
		: "intrinsic-size";
}

function normalizeSizeResolutionReason(
	value: unknown,
	layoutSource: PreviewLayoutSource,
	intrinsicSizeAvailable: boolean,
): PreviewLayoutSizeResolutionReason {
	if (
		value === "explicit-size" ||
		value === "full-size-default" ||
		value === "intrinsic-measurement" ||
		value === "intrinsic-empty" ||
		value === "root-default"
	) {
		return value;
	}

	if (layoutSource === "explicit-size") {
		return "explicit-size";
	}

	if (layoutSource === "full-size-default") {
		return "full-size-default";
	}

	if (layoutSource === "root-default") {
		return "root-default";
	}

	return intrinsicSizeAvailable ? "intrinsic-measurement" : "intrinsic-empty";
}

function normalizeDebugNode(raw: unknown): PreviewLayoutDebugNode | null {
	if (!raw || typeof raw !== "object") {
		return null;
	}

	const record = raw as Record<string, unknown>;
	const idValue = record.id;
	if (typeof idValue !== "string") {
		return null;
	}

	const rect =
		record.rect && typeof record.rect === "object"
			? (record.rect as Record<string, unknown>)
			: null;
	const parentConstraints =
		record.parentConstraints && typeof record.parentConstraints === "object"
			? (record.parentConstraints as Record<string, unknown>)
			: null;
	const intrinsicSize =
		record.intrinsicSize && typeof record.intrinsicSize === "object"
			? (record.intrinsicSize as Record<string, unknown>)
			: null;
	const provenance =
		record.provenance && typeof record.provenance === "object"
			? (record.provenance as Record<string, unknown>)
			: null;
	const hostPolicy =
		record.hostPolicy && typeof record.hostPolicy === "object"
			? (record.hostPolicy as Partial<PreviewLayoutHostMetadata>)
			: undefined;
	const nodeType =
		typeof record.nodeType === "string" ? record.nodeType : "Frame";
	const kind =
		record.kind === "layout" || record.kind === "root" || record.kind === "host"
			? record.kind
			: "host";
	const layoutSource =
		record.layoutSource === undefined && kind === "root"
			? "root-default"
			: normalizeLayoutSource(record.layoutSource);
	const normalizedIntrinsicSize = intrinsicSize
		? {
				height: toFiniteNumber(intrinsicSize.height, 0),
				width: toFiniteNumber(intrinsicSize.width, 0),
			}
		: null;
	const normalizedHostPolicy = createHostPolicy(hostPolicy, nodeType);
	const sizeResolutionRecord =
		record.sizeResolution && typeof record.sizeResolution === "object"
			? (record.sizeResolution as Record<string, unknown>)
			: null;
	const intrinsicSizeAvailable =
		typeof sizeResolutionRecord?.intrinsicSizeAvailable === "boolean"
			? sizeResolutionRecord.intrinsicSizeAvailable
			: normalizedIntrinsicSize !== null;
	const sizeResolution = createSizeResolution(
		typeof sizeResolutionRecord?.hadExplicitSize === "boolean"
			? sizeResolutionRecord.hadExplicitSize
			: layoutSource === "explicit-size",
		intrinsicSizeAvailable,
		normalizeSizeResolutionReason(
			sizeResolutionRecord?.reason,
			layoutSource,
			intrinsicSizeAvailable,
		),
	);

	return {
		children: Array.isArray(record.children)
			? record.children
					.map((child) => normalizeDebugNode(child))
					.filter((child): child is PreviewLayoutDebugNode => child !== null)
			: [],
		debugLabel:
			typeof record.debugLabel === "string" ? record.debugLabel : undefined,
		hostPolicy: normalizedHostPolicy,
		id: normalizePreviewNodeId(idValue) ?? idValue,
		intrinsicSize: normalizedIntrinsicSize,
		kind,
		layoutSource,
		nodeType,
		parentConstraints: parentConstraints
			? {
					height: toFiniteNumber(parentConstraints.height, 0),
					width: toFiniteNumber(parentConstraints.width, 0),
					x: toFiniteNumber(parentConstraints.x, 0),
					y: toFiniteNumber(parentConstraints.y, 0),
				}
			: null,
		parentId:
			typeof record.parentId === "string"
				? (normalizePreviewNodeId(record.parentId) ?? record.parentId)
				: undefined,
		provenance: {
			detail:
				typeof provenance?.detail === "string"
					? provenance.detail
					: "layout engine result",
			source: provenance?.source === "fallback" ? "fallback" : "wasm",
		},
		rect: rect
			? {
					height: toFiniteNumber(rect.height, 0),
					width: toFiniteNumber(rect.width, 0),
					x: toFiniteNumber(rect.x, 0),
					y: toFiniteNumber(rect.y, 0),
				}
			: null,
		sizeResolution,
		styleHints:
			record.styleHints && typeof record.styleHints === "object"
				? normalizeStyleHints(record.styleHints as PreviewLayoutStyleHints)
				: undefined,
	};
}

export function normalizePreviewLayoutResult(
	raw: unknown,
	viewport: { height: number; width: number },
): PreviewLayoutResult {
	if (!raw || typeof raw !== "object") {
		throw new Error(`Unexpected layout session result type: ${typeof raw}`);
	}

	const record = raw as Record<string, unknown>;
	const dirtyNodeIds = Array.isArray(record.dirtyNodeIds)
		? record.dirtyNodeIds
				.filter((value): value is string => typeof value === "string")
				.map((value) => normalizePreviewNodeId(value) ?? value)
		: [];
	const debugRecord =
		record.debug && typeof record.debug === "object"
			? (record.debug as Record<string, unknown>)
			: null;

	return {
		debug: {
			dirtyNodeIds,
			roots: Array.isArray(debugRecord?.roots)
				? debugRecord.roots
						.map((node) => normalizeDebugNode(node))
						.filter((node): node is PreviewLayoutDebugNode => node !== null)
				: [],
			viewport: {
				height: toFiniteNumber(
					debugRecord?.viewport &&
						(debugRecord.viewport as Record<string, unknown>).height,
					viewport.height,
				),
				width: toFiniteNumber(
					debugRecord?.viewport &&
						(debugRecord.viewport as Record<string, unknown>).width,
					viewport.width,
				),
			},
		},
		dirtyNodeIds,
		rects: normalizeLayoutMap(record.rects ?? {}),
	};
}
