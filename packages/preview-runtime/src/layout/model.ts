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
	serializeUDim,
	serializeUDim2,
	serializeVector2,
	toFiniteNumber,
	type UDim2Like,
	type Vector2Like,
	ZERO_UDIM,
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

export type PreviewLayoutPaddingInsets = {
	bottom: SerializedUDim;
	left: SerializedUDim;
	right: SerializedUDim;
	top: SerializedUDim;
};

export type PreviewLayoutListLayout = {
	fillDirection: "horizontal" | "vertical";
	horizontalAlignment: "center" | "left" | "right";
	horizontalFlex?: string;
	itemLineAlignment?: string;
	padding: SerializedUDim;
	sortOrder: "layout-order" | "name" | "source";
	verticalAlignment: "bottom" | "center" | "top";
	verticalFlex?: string;
	wraps: boolean;
};

export type PreviewLayoutGridLayout = {
	cellPadding: SerializedUDim2;
	cellSize: SerializedUDim2;
	fillDirection: "horizontal" | "vertical";
	fillDirectionMaxCells?: number;
	horizontalAlignment: "center" | "left" | "right";
	sortOrder: "layout-order" | "name" | "source";
	startCorner: "bottom-left" | "bottom-right" | "top-left" | "top-right";
	verticalAlignment: "bottom" | "center" | "top";
};

export type PreviewLayoutSizeConstraint = {
	maxSize?: SerializedVector2;
	minSize?: SerializedVector2;
};

export type PreviewLayoutTextSizeConstraint = {
	maxTextSize?: number;
	minTextSize?: number;
};

export type PreviewLayoutAspectRatioConstraint = {
	aspectRatio: number;
	dominantAxis: "auto" | "height" | "width";
};

export type PreviewLayoutFlexItem = {
	flexMode?: string;
	growRatio?: number;
	itemLineAlignment?: string;
	shrinkRatio?: number;
};

export type PreviewLayoutModifiers = {
	aspectRatioConstraint?: PreviewLayoutAspectRatioConstraint;
	flexItem?: PreviewLayoutFlexItem;
	grid?: PreviewLayoutGridLayout;
	list?: PreviewLayoutListLayout;
	padding?: PreviewLayoutPaddingInsets;
	sizeConstraint?: PreviewLayoutSizeConstraint;
	textSizeConstraint?: PreviewLayoutTextSizeConstraint;
};

export type PreviewLayoutPositionMode = "absolute";
export type PreviewLayoutSizeConstraintMode =
	| "RelativeXX"
	| "RelativeXY"
	| "RelativeYY";
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
	sizeConstraintMode: PreviewLayoutSizeConstraintMode;
	size?: PreviewLayoutSize;
};

export type PreviewLayoutNode = {
	debugLabel?: string;
	hostMetadata?: PreviewLayoutHostMetadata;
	id: string;
	intrinsicSize?: MeasuredNodeSize | null;
	kind: PreviewLayoutNodeKind;
	layoutModifiers?: PreviewLayoutModifiers;
	layoutOrder?: number;
	layout: PreviewLayoutNodeLayout;
	name?: string;
	nodeType: string;
	parentId?: string;
	sourceOrder?: number;
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
	sizeConstraintMode?: string;
};

export type RobloxLayoutRegistrationInput = RobloxLayoutNodeInput & {
	canMeasure?: boolean;
	debugLabel?: string;
	hostMetadata?: PreviewLayoutHostMetadata;
	intrinsicSize?: MeasuredNodeSize | null;
	layoutModifiers?: PreviewLayoutModifiers;
	layoutOrder?: number;
	measure?: () => MeasuredNodeSize | null;
	measurementVersion?: number;
	name?: string;
	sourceOrder?: number;
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

function normalizeLowerCaseString(value: unknown): string | undefined {
	if (typeof value !== "string") {
		return undefined;
	}

	const normalized = value.trim().toLowerCase();
	return normalized.length > 0 ? normalized : undefined;
}

function normalizeSizeConstraintMode(
	value: unknown,
): PreviewLayoutSizeConstraintMode {
	if (typeof value !== "string") {
		return "RelativeXY";
	}

	switch (value.trim().toLowerCase()) {
		case "relativexx":
			return "RelativeXX";
		case "relativeyy":
			return "RelativeYY";
		default:
			return "RelativeXY";
	}
}

function isZeroAxisValue(value: SerializedUDim) {
	return value.Offset === 0 && value.Scale === 0;
}

function isZeroPaddingInsets(value: PreviewLayoutPaddingInsets) {
	return (
		isZeroAxisValue(value.bottom) &&
		isZeroAxisValue(value.left) &&
		isZeroAxisValue(value.right) &&
		isZeroAxisValue(value.top)
	);
}

function _isZeroSize(value: SerializedUDim2) {
	return isZeroAxisValue(value.X) && isZeroAxisValue(value.Y);
}

function isZeroVector(value: SerializedVector2) {
	return value.X === 0 && value.Y === 0;
}

function normalizeFillDirection(
	value: unknown,
): PreviewLayoutListLayout["fillDirection"] {
	return normalizeLowerCaseString(value) === "horizontal"
		? "horizontal"
		: "vertical";
}

function normalizeHorizontalAlignment(
	value: unknown,
): PreviewLayoutListLayout["horizontalAlignment"] {
	const normalized = normalizeLowerCaseString(value);
	if (normalized === "center" || normalized === "right") {
		return normalized;
	}

	return "left";
}

function normalizeVerticalAlignment(
	value: unknown,
): PreviewLayoutListLayout["verticalAlignment"] {
	const normalized = normalizeLowerCaseString(value);
	if (normalized === "bottom" || normalized === "center") {
		return normalized;
	}

	return "top";
}

function normalizeSortOrder(
	value: unknown,
): PreviewLayoutListLayout["sortOrder"] {
	const normalized = normalizeLowerCaseString(value);
	if (normalized === "layout-order" || normalized === "name") {
		return normalized;
	}

	return "source";
}

function normalizeStartCorner(
	value: unknown,
): PreviewLayoutGridLayout["startCorner"] {
	const normalized = normalizeLowerCaseString(value);
	switch (normalized) {
		case "top-right":
		case "bottom-left":
		case "bottom-right":
			return normalized;
		default:
			return "top-left";
	}
}

function normalizeDominantAxis(
	value: unknown,
): PreviewLayoutAspectRatioConstraint["dominantAxis"] {
	const normalized = normalizeLowerCaseString(value);
	switch (normalized) {
		case "width":
		case "height":
			return normalized;
		default:
			return "auto";
	}
}

function normalizePaddingInsets(
	value: unknown,
): PreviewLayoutPaddingInsets | undefined {
	if (!value || typeof value !== "object") {
		return undefined;
	}

	const record = value as {
		bottom?: unknown;
		left?: unknown;
		right?: unknown;
		top?: unknown;
	};
	const normalized: PreviewLayoutPaddingInsets = {
		bottom: serializeUDim(record.bottom, ZERO_UDIM),
		left: serializeUDim(record.left, ZERO_UDIM),
		right: serializeUDim(record.right, ZERO_UDIM),
		top: serializeUDim(record.top, ZERO_UDIM),
	};

	return isZeroPaddingInsets(normalized) ? undefined : normalized;
}

function normalizeListLayout(
	value: unknown,
): PreviewLayoutListLayout | undefined {
	if (!value || typeof value !== "object") {
		return undefined;
	}

	const record = value as {
		fillDirection?: unknown;
		horizontalAlignment?: unknown;
		horizontalFlex?: unknown;
		itemLineAlignment?: unknown;
		padding?: unknown;
		sortOrder?: unknown;
		verticalAlignment?: unknown;
		verticalFlex?: unknown;
		wraps?: unknown;
	};

	return {
		fillDirection: normalizeFillDirection(record.fillDirection),
		horizontalAlignment: normalizeHorizontalAlignment(
			record.horizontalAlignment,
		),
		horizontalFlex: normalizeLowerCaseString(record.horizontalFlex),
		itemLineAlignment: normalizeLowerCaseString(record.itemLineAlignment),
		padding: serializeUDim(record.padding, ZERO_UDIM),
		sortOrder: normalizeSortOrder(record.sortOrder),
		verticalAlignment: normalizeVerticalAlignment(record.verticalAlignment),
		verticalFlex: normalizeLowerCaseString(record.verticalFlex),
		wraps: record.wraps === true,
	};
}

function normalizeGridLayout(
	value: unknown,
): PreviewLayoutGridLayout | undefined {
	if (!value || typeof value !== "object") {
		return undefined;
	}

	const record = value as {
		cellPadding?: unknown;
		cellSize?: unknown;
		fillDirection?: unknown;
		fillDirectionMaxCells?: unknown;
		horizontalAlignment?: unknown;
		sortOrder?: unknown;
		startCorner?: unknown;
		verticalAlignment?: unknown;
	};
	const cellPadding = serializeUDim2(record.cellPadding, ZERO_UDIM2);
	const cellSize = serializeUDim2(record.cellSize, ZERO_UDIM2);
	if (!cellPadding || !cellSize) {
		return undefined;
	}

	return {
		cellPadding,
		cellSize,
		fillDirection: normalizeFillDirection(record.fillDirection),
		fillDirectionMaxCells: Math.max(
			0,
			Math.floor(toFiniteNumber(record.fillDirectionMaxCells, 0)),
		),
		horizontalAlignment: normalizeHorizontalAlignment(
			record.horizontalAlignment,
		),
		sortOrder: normalizeSortOrder(record.sortOrder),
		startCorner: normalizeStartCorner(record.startCorner),
		verticalAlignment: normalizeVerticalAlignment(record.verticalAlignment),
	};
}

function normalizeSizeConstraint(
	value: unknown,
): PreviewLayoutSizeConstraint | undefined {
	if (!value || typeof value !== "object") {
		return undefined;
	}

	const record = value as {
		maxSize?: unknown;
		minSize?: unknown;
	};
	const minSize = record.minSize ? serializeVector2(record.minSize) : undefined;
	const maxSize = record.maxSize ? serializeVector2(record.maxSize) : undefined;
	if (!minSize && !maxSize) {
		return undefined;
	}

	return {
		maxSize: maxSize && !isZeroVector(maxSize) ? maxSize : undefined,
		minSize: minSize && !isZeroVector(minSize) ? minSize : undefined,
	};
}

function normalizeTextSizeConstraint(
	value: unknown,
): PreviewLayoutTextSizeConstraint | undefined {
	if (!value || typeof value !== "object") {
		return undefined;
	}

	const record = value as {
		maxTextSize?: unknown;
		minTextSize?: unknown;
	};
	const minTextSize =
		record.minTextSize === undefined
			? undefined
			: Math.max(1, Math.floor(toFiniteNumber(record.minTextSize, 1)));
	const maxTextSize =
		record.maxTextSize === undefined
			? undefined
			: Math.max(1, Math.floor(toFiniteNumber(record.maxTextSize, 1)));

	if (minTextSize === undefined && maxTextSize === undefined) {
		return undefined;
	}

	return {
		maxTextSize,
		minTextSize,
	};
}

function normalizeAspectRatioConstraint(
	value: unknown,
): PreviewLayoutAspectRatioConstraint | undefined {
	if (!value || typeof value !== "object") {
		return undefined;
	}

	const record = value as {
		aspectRatio?: unknown;
		dominantAxis?: unknown;
	};
	const aspectRatio = toFiniteNumber(record.aspectRatio, 0);
	if (aspectRatio <= 0) {
		return undefined;
	}

	return {
		aspectRatio,
		dominantAxis: normalizeDominantAxis(record.dominantAxis),
	};
}

function normalizeFlexItem(value: unknown): PreviewLayoutFlexItem | undefined {
	if (!value || typeof value !== "object") {
		return undefined;
	}

	const record = value as {
		flexMode?: unknown;
		growRatio?: unknown;
		itemLineAlignment?: unknown;
		shrinkRatio?: unknown;
	};
	const flexMode = normalizeLowerCaseString(record.flexMode);
	const growRatio =
		record.growRatio === undefined
			? undefined
			: Math.max(0, toFiniteNumber(record.growRatio, 0));
	const shrinkRatio =
		record.shrinkRatio === undefined
			? undefined
			: Math.max(0, toFiniteNumber(record.shrinkRatio, 0));
	const itemLineAlignment = normalizeLowerCaseString(record.itemLineAlignment);

	if (
		flexMode === undefined &&
		growRatio === undefined &&
		shrinkRatio === undefined &&
		itemLineAlignment === undefined
	) {
		return undefined;
	}

	return {
		flexMode,
		growRatio,
		itemLineAlignment,
		shrinkRatio,
	};
}

function normalizeLayoutModifiers(
	value: unknown,
): PreviewLayoutModifiers | undefined {
	if (!value || typeof value !== "object") {
		return undefined;
	}

	const record = value as {
		aspectRatioConstraint?: unknown;
		flexItem?: unknown;
		grid?: unknown;
		list?: unknown;
		padding?: unknown;
		sizeConstraint?: unknown;
		textSizeConstraint?: unknown;
	};
	const normalized: PreviewLayoutModifiers = {
		aspectRatioConstraint: normalizeAspectRatioConstraint(
			record.aspectRatioConstraint,
		),
		flexItem: normalizeFlexItem(record.flexItem),
		grid: normalizeGridLayout(record.grid),
		list: normalizeListLayout(record.list),
		padding: normalizePaddingInsets(record.padding),
		sizeConstraint: normalizeSizeConstraint(record.sizeConstraint),
		textSizeConstraint: normalizeTextSizeConstraint(record.textSizeConstraint),
	};

	return normalized.aspectRatioConstraint ||
		normalized.flexItem ||
		normalized.grid ||
		normalized.list ||
		normalized.padding ||
		normalized.sizeConstraint ||
		normalized.textSizeConstraint
		? normalized
		: undefined;
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

function resolveAxisForSizeConstraintMode(
	axis: PreviewLayoutAxis,
	parentRect: ComputedRect,
	mode: PreviewLayoutSizeConstraintMode,
	isX: boolean,
): number {
	const parentAxisSize =
		mode === "RelativeXX"
			? parentRect.width
			: mode === "RelativeYY"
				? parentRect.height
				: isX
					? parentRect.width
					: parentRect.height;

	return resolveAxis(axis, parentAxisSize);
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
	const rawLayoutInput = input as {
		layoutModifiers?: unknown;
		layoutOrder?: unknown;
		name?: unknown;
		sourceOrder?: unknown;
	};
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
		layoutModifiers: normalizeLayoutModifiers(rawLayoutInput.layoutModifiers),
		layoutOrder:
			rawLayoutInput.layoutOrder === undefined
				? undefined
				: Math.floor(toFiniteNumber(rawLayoutInput.layoutOrder, 0)),
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
			sizeConstraintMode: normalizeSizeConstraintMode(input.sizeConstraintMode),
			size: input.size
				? toLayoutSize(serializeUDim2(input.size, ZERO_UDIM2) ?? ZERO_UDIM2)
				: undefined,
		},
		name:
			typeof rawLayoutInput.name === "string" && rawLayoutInput.name.length > 0
				? rawLayoutInput.name
				: undefined,
		nodeType: input.nodeType,
		parentId: normalizedParentId,
		sourceOrder:
			rawLayoutInput.sourceOrder === undefined
				? undefined
				: Math.max(
						0,
						Math.floor(toFiniteNumber(rawLayoutInput.sourceOrder, 0)),
					),
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
		a.layoutOrder === b.layoutOrder &&
		a.layoutModifiers?.aspectRatioConstraint?.aspectRatio ===
			b.layoutModifiers?.aspectRatioConstraint?.aspectRatio &&
		a.layoutModifiers?.aspectRatioConstraint?.dominantAxis ===
			b.layoutModifiers?.aspectRatioConstraint?.dominantAxis &&
		a.layoutModifiers?.flexItem?.flexMode ===
			b.layoutModifiers?.flexItem?.flexMode &&
		(a.layoutModifiers?.flexItem?.growRatio ?? undefined) ===
			(b.layoutModifiers?.flexItem?.growRatio ?? undefined) &&
		a.layoutModifiers?.flexItem?.itemLineAlignment ===
			b.layoutModifiers?.flexItem?.itemLineAlignment &&
		(a.layoutModifiers?.flexItem?.shrinkRatio ?? undefined) ===
			(b.layoutModifiers?.flexItem?.shrinkRatio ?? undefined) &&
		a.layoutModifiers?.grid?.fillDirection ===
			b.layoutModifiers?.grid?.fillDirection &&
		(a.layoutModifiers?.grid?.fillDirectionMaxCells ?? undefined) ===
			(b.layoutModifiers?.grid?.fillDirectionMaxCells ?? undefined) &&
		a.layoutModifiers?.grid?.horizontalAlignment ===
			b.layoutModifiers?.grid?.horizontalAlignment &&
		a.layoutModifiers?.grid?.sortOrder === b.layoutModifiers?.grid?.sortOrder &&
		a.layoutModifiers?.grid?.startCorner ===
			b.layoutModifiers?.grid?.startCorner &&
		a.layoutModifiers?.grid?.verticalAlignment ===
			b.layoutModifiers?.grid?.verticalAlignment &&
		(a.layoutModifiers?.grid?.cellPadding.X.Scale ?? 0) ===
			(b.layoutModifiers?.grid?.cellPadding.X.Scale ?? 0) &&
		(a.layoutModifiers?.grid?.cellPadding.X.Offset ?? 0) ===
			(b.layoutModifiers?.grid?.cellPadding.X.Offset ?? 0) &&
		(a.layoutModifiers?.grid?.cellPadding.Y.Scale ?? 0) ===
			(b.layoutModifiers?.grid?.cellPadding.Y.Scale ?? 0) &&
		(a.layoutModifiers?.grid?.cellPadding.Y.Offset ?? 0) ===
			(b.layoutModifiers?.grid?.cellPadding.Y.Offset ?? 0) &&
		(a.layoutModifiers?.grid?.cellSize.X.Scale ?? 0) ===
			(b.layoutModifiers?.grid?.cellSize.X.Scale ?? 0) &&
		(a.layoutModifiers?.grid?.cellSize.X.Offset ?? 0) ===
			(b.layoutModifiers?.grid?.cellSize.X.Offset ?? 0) &&
		(a.layoutModifiers?.grid?.cellSize.Y.Scale ?? 0) ===
			(b.layoutModifiers?.grid?.cellSize.Y.Scale ?? 0) &&
		(a.layoutModifiers?.grid?.cellSize.Y.Offset ?? 0) ===
			(b.layoutModifiers?.grid?.cellSize.Y.Offset ?? 0) &&
		a.layoutModifiers?.list?.fillDirection ===
			b.layoutModifiers?.list?.fillDirection &&
		a.layoutModifiers?.list?.horizontalAlignment ===
			b.layoutModifiers?.list?.horizontalAlignment &&
		a.layoutModifiers?.list?.horizontalFlex ===
			b.layoutModifiers?.list?.horizontalFlex &&
		a.layoutModifiers?.list?.itemLineAlignment ===
			b.layoutModifiers?.list?.itemLineAlignment &&
		a.layoutModifiers?.list?.sortOrder === b.layoutModifiers?.list?.sortOrder &&
		a.layoutModifiers?.list?.verticalAlignment ===
			b.layoutModifiers?.list?.verticalAlignment &&
		a.layoutModifiers?.list?.verticalFlex ===
			b.layoutModifiers?.list?.verticalFlex &&
		a.layoutModifiers?.list?.wraps === b.layoutModifiers?.list?.wraps &&
		(a.layoutModifiers?.list?.padding.Scale ?? 0) ===
			(b.layoutModifiers?.list?.padding.Scale ?? 0) &&
		(a.layoutModifiers?.list?.padding.Offset ?? 0) ===
			(b.layoutModifiers?.list?.padding.Offset ?? 0) &&
		(a.layoutModifiers?.padding?.left.Scale ?? 0) ===
			(b.layoutModifiers?.padding?.left.Scale ?? 0) &&
		(a.layoutModifiers?.padding?.left.Offset ?? 0) ===
			(b.layoutModifiers?.padding?.left.Offset ?? 0) &&
		(a.layoutModifiers?.padding?.right.Scale ?? 0) ===
			(b.layoutModifiers?.padding?.right.Scale ?? 0) &&
		(a.layoutModifiers?.padding?.right.Offset ?? 0) ===
			(b.layoutModifiers?.padding?.right.Offset ?? 0) &&
		(a.layoutModifiers?.padding?.top.Scale ?? 0) ===
			(b.layoutModifiers?.padding?.top.Scale ?? 0) &&
		(a.layoutModifiers?.padding?.top.Offset ?? 0) ===
			(b.layoutModifiers?.padding?.top.Offset ?? 0) &&
		(a.layoutModifiers?.padding?.bottom.Scale ?? 0) ===
			(b.layoutModifiers?.padding?.bottom.Scale ?? 0) &&
		(a.layoutModifiers?.padding?.bottom.Offset ?? 0) ===
			(b.layoutModifiers?.padding?.bottom.Offset ?? 0) &&
		(a.layoutModifiers?.sizeConstraint?.minSize?.X ?? undefined) ===
			(b.layoutModifiers?.sizeConstraint?.minSize?.X ?? undefined) &&
		(a.layoutModifiers?.sizeConstraint?.minSize?.Y ?? undefined) ===
			(b.layoutModifiers?.sizeConstraint?.minSize?.Y ?? undefined) &&
		(a.layoutModifiers?.sizeConstraint?.maxSize?.X ?? undefined) ===
			(b.layoutModifiers?.sizeConstraint?.maxSize?.X ?? undefined) &&
		(a.layoutModifiers?.sizeConstraint?.maxSize?.Y ?? undefined) ===
			(b.layoutModifiers?.sizeConstraint?.maxSize?.Y ?? undefined) &&
		(a.layoutModifiers?.textSizeConstraint?.minTextSize ?? undefined) ===
			(b.layoutModifiers?.textSizeConstraint?.minTextSize ?? undefined) &&
		(a.layoutModifiers?.textSizeConstraint?.maxTextSize ?? undefined) ===
			(b.layoutModifiers?.textSizeConstraint?.maxTextSize ?? undefined) &&
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
		a.layout.sizeConstraintMode === b.layout.sizeConstraintMode &&
		(a.layout.size?.x.scale ?? 0) === (b.layout.size?.x.scale ?? 0) &&
		(a.layout.size?.x.offset ?? 0) === (b.layout.size?.x.offset ?? 0) &&
		(a.layout.size?.y.scale ?? 0) === (b.layout.size?.y.scale ?? 0) &&
		(a.layout.size?.y.offset ?? 0) === (b.layout.size?.y.offset ?? 0) &&
		a.name === b.name &&
		a.nodeType === b.nodeType &&
		a.parentId === b.parentId &&
		a.sourceOrder === b.sourceOrder &&
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
	const sizeConstraintMode = normalizeSizeConstraintMode(
		(node.layout as { sizeConstraintMode?: unknown }).sizeConstraintMode,
	);

	let width = resolveAxisForSizeConstraintMode(
		resolved.resolvedSize.x,
		parentRect,
		sizeConstraintMode,
		true,
	);
	let height = resolveAxisForSizeConstraintMode(
		resolved.resolvedSize.y,
		parentRect,
		sizeConstraintMode,
		false,
	);
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
