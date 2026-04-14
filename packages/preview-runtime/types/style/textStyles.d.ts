import * as React from "react";
type FontStyleDescriptor = Pick<React.CSSProperties, "fontFamily" | "fontStyle" | "fontWeight">;
type TextScaleOptions = {
    elementRef: React.RefObject<HTMLElement | null>;
    enabled: boolean;
    fontFamily?: string;
    fontStyle?: React.CSSProperties["fontStyle"];
    fontWeight?: React.CSSProperties["fontWeight"];
    lineHeight?: React.CSSProperties["lineHeight"];
    maxTextSize?: number;
    minTextSize?: number;
    text: string | undefined;
    wrapped?: boolean;
};
export declare function clampPreviewTextSize(value: number | undefined, constraints: {
    maxTextSize?: number;
    minTextSize?: number;
}): number | undefined;
export declare function mapRobloxFont(value: unknown): FontStyleDescriptor;
export declare function useTextScaleStyle(options: TextScaleOptions): React.CSSProperties | undefined;
export {};
