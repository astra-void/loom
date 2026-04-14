import * as React from "react";
import {
	adaptRobloxNodeInput,
	type ComputedRect,
	type PreviewLayoutDebugNode,
	type PreviewLayoutDebugPayload,
	type PreviewLayoutNode,
	type RobloxLayoutRegistrationInput,
} from "./model";
import { type ViewportSize } from "./viewport";
export type {
	ComputedRect,
	RobloxLayoutNodeInput,
	RobloxLayoutRegistrationInput,
} from "./model";
export type LayoutProviderProps = {
	children: React.ReactNode;
	debounceMs?: number;
	viewportHeight?: number;
	viewportWidth?: number;
};
export type PreviewLayoutProbeSnapshot = {
	debug: PreviewLayoutDebugPayload;
	error: string | null;
	isReady: boolean;
	revision: number;
	viewport: ViewportSize;
	viewportReady: boolean;
};
type LayoutContextValue = {
	error: string | null;
	getContainerRect: () => DOMRect | null;
	getDebugNode: (nodeId: string) => PreviewLayoutDebugNode | null;
	getRect: (nodeId: string) => ComputedRect | null;
	isReady: boolean;
	registerNode: (node: ReturnType<typeof adaptRobloxNodeInput>) => void;
	unregisterNode: (nodeId: string) => void;
	viewport: ViewportSize;
	viewportReady: boolean;
};
type PreviewLayoutProbeListener = (
	snapshot: PreviewLayoutProbeSnapshot,
) => void;
export declare function getPreviewLayoutProbeSnapshot(): PreviewLayoutProbeSnapshot;
export declare function subscribePreviewLayoutProbe(
	listener: PreviewLayoutProbeListener,
): () => void;
export declare function usePreviewLayoutProbeSnapshot(): PreviewLayoutProbeSnapshot;
export declare const LayoutContext: React.Context<LayoutContextValue | null>;
export declare const PortalRootContext: React.Context<boolean>;
export declare function LayoutProvider(
	props: LayoutProviderProps,
): import("react/jsx-runtime").JSX.Element;
export declare function LayoutNodeParentProvider(props: {
	children: React.ReactNode;
	contentRect: ComputedRect | null;
	nodeId: string;
	renderRect?: ComputedRect | null;
}): import("react/jsx-runtime").JSX.Element;
export declare function LayoutViewportPortalBoundary(props: {
	children: React.ReactNode;
}): import("react/jsx-runtime").JSX.Element;
export declare function useLayoutEngineStatus(): {
	error: string | null;
	isReady: boolean;
};
export declare function useLayoutDebugState(nodeId?: string): {
	debugNode: PreviewLayoutDebugNode | null;
	hasContext: boolean;
	inheritedParentRect: ComputedRect | null;
	viewport: ViewportSize | null;
	viewportReady: boolean;
};
export declare function useRobloxLayout(
	input: RobloxLayoutRegistrationInput | PreviewLayoutNode,
): ComputedRect | null;
