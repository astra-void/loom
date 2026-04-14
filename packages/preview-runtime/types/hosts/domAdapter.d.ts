import type * as React from "react";
import { type ComputedRect, type PreviewLayoutHostPolicy, type PreviewLayoutModifiers, type PreviewLayoutNode, type PreviewLayoutSizeResolution } from "../layout/model";
import { type HoistedModifierState } from "./modifiers";
import { type ResolvedPreviewDomProps } from "./resolveProps";
import { type LayoutHostName, type PreviewDomProps } from "./types";
export type PreviewDomRef<T> = ((instance: T | null) => void) | {
    current: T | null;
} | null;
export type LayoutDebugState = {
    debugNode: {
        hostPolicy: PreviewLayoutHostPolicy;
        layoutSource: "explicit-size" | "full-size-default" | "intrinsic-size" | "root-default";
        parentConstraints: ComputedRect | null;
        rect: ComputedRect | null;
        sizeResolution: PreviewLayoutSizeResolution;
        styleHints?: {
            height?: string;
            width?: string;
        };
    } | null;
    hasContext: boolean;
    inheritedParentRect: ComputedRect | null;
    viewport: {
        height: number;
        width: number;
    } | null;
    viewportReady: boolean;
};
export type SourceHostDescriptor = {
    host: LayoutHostName;
    nodeId: string;
    parentId?: string;
    props: PreviewDomProps;
    sourceOrder?: number;
};
export type PreviewHostNode = PreviewLayoutNode & {
    computed?: ComputedRect | null;
    host: LayoutHostName;
    hoistedModifierState: HoistedModifierState;
    layoutDebug?: LayoutDebugState;
    layoutModifiers?: PreviewLayoutModifiers;
    measurementEnabled: boolean;
    presentationHints: {
        disabled: boolean;
        domProps: ResolvedPreviewDomProps["domProps"];
        image: unknown;
        imageColor3: unknown;
        imageTransparency: number | undefined;
        text: string | undefined;
    };
    renderChildren: React.ReactNode;
    sourceProps: PreviewDomProps;
};
export interface PresentationAdapter {
    measure(node: PreviewHostNode, element: HTMLElement | null): {
        height: number;
        width: number;
    } | null;
    normalize(source: SourceHostDescriptor): PreviewHostNode;
    render<T extends HTMLElement>(node: PreviewHostNode, children: React.ReactNode, ref: PreviewDomRef<T>): React.ReactElement;
}
export declare function patchPreviewHostNodeDomProps(node: PreviewHostNode, domProps: ResolvedPreviewDomProps["domProps"]): PreviewHostNode;
export declare const domPresentationAdapter: PresentationAdapter;
