import { type PreviewPlaceholderBehavior } from "../hosts/metadata";
import { type SerializedUDim, type SerializedUDim2, type SerializedVector2, type UDim2Like, type Vector2Like } from "../internal/robloxValues";
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
export type PreviewLayoutSizeConstraintMode = "RelativeXX" | "RelativeXY" | "RelativeYY";
export type PreviewLayoutNodeKind = "host" | "layout" | "root";
export type PreviewLayoutSource = "explicit-size" | "full-size-default" | "intrinsic-size" | "root-default";
export type PreviewLayoutSizeResolutionReason = "explicit-size" | "full-size-default" | "intrinsic-measurement" | "intrinsic-empty" | "root-default";
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
    automaticSize?: "none" | "x" | "xy" | "y";
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
    visible?: boolean;
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
    automaticSize?: string;
    id: string;
    kind?: PreviewLayoutNodeKind;
    nodeType: string;
    parentId?: string;
    position?: UDim2Like;
    size?: UDim2Like;
    sizeConstraintMode?: string;
    visible?: boolean;
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
export declare const SYNTHETIC_ROOT_ID = "__loom_preview_root__";
export declare function resolveNodeHostPolicy(node: Pick<PreviewLayoutNode, "hostMetadata" | "nodeType">): PreviewLayoutHostPolicy;
type PreviewResolvedNodeSize = {
    layoutSource: PreviewLayoutSource;
    resolvedSize: PreviewLayoutSize;
    sizeResolution: PreviewLayoutSizeResolution;
};
export declare function createViewportRect(width: number, height: number): ComputedRect;
export declare function normalizeRootScreenGuiNode(node: PreviewLayoutNode): PreviewLayoutNode;
export declare function createEmptyLayoutDebugPayload(viewport: {
    height: number;
    width: number;
}): PreviewLayoutDebugPayload;
export declare function createEmptyLayoutResult(viewport: {
    height: number;
    width: number;
}): PreviewLayoutResult;
export declare function adaptRobloxNodeInput(input: RobloxLayoutRegistrationInput, parentId: string | undefined): PreviewLayoutNode;
export declare function areNodesEqual(a: PreviewLayoutNode, b: PreviewLayoutNode): boolean;
export declare function resolveNodeSize(node: Pick<PreviewLayoutNode, "hostMetadata" | "intrinsicSize" | "kind" | "layout">): PreviewResolvedNodeSize;
export declare function computeRectFromParentRect(node: Pick<PreviewLayoutNode, "hostMetadata" | "intrinsicSize" | "kind" | "layout">, parentRect: ComputedRect): {
    layoutSource: PreviewLayoutSource;
    rect: ComputedRect;
};
export declare function computeNodeRect(node: PreviewLayoutNode, parentRect: ComputedRect): {
    layoutSource: PreviewLayoutSource;
    rect: ComputedRect;
};
export declare function normalizeLayoutMap(raw: unknown): Record<string, ComputedRect>;
export declare function normalizePreviewLayoutResult(raw: unknown, viewport: {
    height: number;
    width: number;
}): PreviewLayoutResult;
export {};
