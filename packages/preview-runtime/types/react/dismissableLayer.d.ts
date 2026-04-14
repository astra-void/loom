import * as React from "react";
export type LayerInteractEvent = {
	originalEvent: Event;
	defaultPrevented: boolean;
	preventDefault: () => void;
};
type DismissableLayerProps = {
	children?: React.ReactNode;
	enabled?: boolean;
	modal?: boolean;
	disableOutsidePointerEvents?: boolean;
	onPointerDownOutside?: (event: LayerInteractEvent) => void;
	onInteractOutside?: (event: LayerInteractEvent) => void;
	onEscapeKeyDown?: (event: LayerInteractEvent) => void;
	onDismiss?: () => void;
};
export declare function DismissableLayer(
	props: DismissableLayerProps,
): import("react/jsx-runtime").JSX.Element;
