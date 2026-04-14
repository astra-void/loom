import type { UDim2Value, Vector2 } from "../runtime/helpers";
export type UDimLike = {
    Scale?: number;
    Offset?: number;
    scale?: number;
    offset?: number;
} | readonly [number, number];
export type UDim2Like = UDim2Value | {
    X?: UDimLike;
    Y?: UDimLike;
    x?: UDimLike;
    y?: UDimLike;
} | readonly [number, number, number, number] | readonly [UDimLike, UDimLike];
export type Vector2Like = Vector2 | {
    X?: number;
    Y?: number;
    x?: number;
    y?: number;
} | readonly [number, number];
export type SerializedUDim = {
    Scale: number;
    Offset: number;
};
export type SerializedUDim2 = {
    X: SerializedUDim;
    Y: SerializedUDim;
};
export type SerializedVector2 = {
    X: number;
    Y: number;
};
export declare const ZERO_UDIM: SerializedUDim;
export declare const ZERO_UDIM2: SerializedUDim2;
export declare const FULL_SIZE_UDIM2: SerializedUDim2;
export declare const ZERO_VECTOR2: SerializedVector2;
export declare function toFiniteNumber(value: unknown, fallback?: number): number;
export declare function normalizePreviewNodeId(nodeId: string | undefined): string | undefined;
export declare function normalizeLegacyPreviewResultNodeId(nodeId: string | undefined): string | undefined;
export declare function serializeUDim(value: unknown, fallback?: SerializedUDim): SerializedUDim;
export declare function serializeUDim2(value: unknown, fallback?: SerializedUDim2): SerializedUDim2 | undefined;
export declare function serializeVector2(value: unknown, fallback?: SerializedVector2): SerializedVector2;
