import * as React from "react";
import { useRobloxLayout } from "../layout/context";
import type { ComputedRect } from "../layout/model";
import { type LayoutDebugState, type PreviewHostNode } from "./domAdapter";
import type { LayoutHostName, PreviewDomProps } from "./types";
export declare function useHostLayout(host: LayoutHostName, props: PreviewDomProps): {
    computed: ComputedRect | null;
    diagnostics: LayoutDebugState;
    elementRef: React.RefObject<HTMLElement | null>;
    hostNode: {
        computed: ComputedRect | null;
        intrinsicSize: {
            height: number;
            width: number;
        } | null;
        layoutDebug: LayoutDebugState;
        debugLabel?: string;
        hostMetadata?: import("../layout/model").PreviewLayoutHostMetadata;
        id: string;
        kind: import("../layout/model").PreviewLayoutNodeKind;
        layoutModifiers?: import("../layout/model").PreviewLayoutModifiers;
        layoutOrder?: number;
        layout: import("../layout/model").PreviewLayoutNodeLayout;
        name?: string;
        nodeType: string;
        parentId?: string;
        sourceOrder?: number;
        styleHints?: import("../layout/model").PreviewLayoutStyleHints;
        visible?: boolean;
        host: LayoutHostName;
        hoistedModifierState: import("./modifiers").HoistedModifierState;
        measurementEnabled: boolean;
        presentationHints: {
            disabled: boolean;
            domProps: import("./resolveProps").ResolvedPreviewDomProps["domProps"];
            image: unknown;
            imageColor3: unknown;
            imageTransparency: number | undefined;
            text: string | undefined;
        };
        renderChildren: React.ReactNode;
        sourceProps: PreviewDomProps;
    };
    nodeId: string;
    setElementRef: (element: HTMLElement | null) => void;
    patchDomProps: (domProps: PreviewHostNode["presentationHints"]["domProps"]) => PreviewHostNode;
};
export declare function withNodeParent(nodeId: string, rect: ReturnType<typeof useRobloxLayout>, contentRect: ComputedRect | null, children: React.ReactNode): import("react/jsx-runtime").JSX.Element;
export declare function resolveHostContentRect(rect: ComputedRect | null, props: ReturnType<typeof useHostLayout>["hostNode"]["layoutModifiers"]): ComputedRect | null;
