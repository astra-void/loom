export declare const bridgedPreviewHostProperties: readonly [
	"AbsolutePosition",
	"AbsoluteSize",
	"AbsoluteCanvasSize",
	"AbsoluteWindowSize",
	"AnchorPoint",
	"BackgroundColor3",
	"BackgroundTransparency",
	"CanvasPosition",
	"CanvasSize",
	"ImageColor3",
	"ImageTransparency",
	"Name",
	"Parent",
	"Position",
	"Rotation",
	"Size",
	"Text",
	"TextBounds",
	"TextColor3",
	"TextSize",
	"TextTransparency",
	"Visible",
	"ZIndex",
];
type HostOverrideListener = () => void;
export declare function clearPreviewHostOverrides(nodeId: string): void;
export declare function notifyPreviewHostPropertyChanged(
	nodeId: string,
	property: string,
): void;
export declare function subscribePreviewHostPropertyChanged(
	nodeId: string,
	property: string,
	listener: HostOverrideListener,
): () => void;
export declare function installPreviewHostPropertyBridge(
	element: HTMLElement,
	nodeId: string,
	getBaseValue: (property: string) => unknown,
): void;
export declare function usePreviewHostOverrides(
	nodeId: string,
): Readonly<Record<string, unknown>>;
export declare function cleanupPreviewHostBridge(
	element: HTMLElement | null,
	nodeId: string,
): void;
