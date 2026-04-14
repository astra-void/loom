export type ViewportSize = {
	height: number;
	width: number;
};
export declare const DEFAULT_VIEWPORT_WIDTH = 800;
export declare const DEFAULT_VIEWPORT_HEIGHT = 600;
export declare const MIN_VALID_VIEWPORT_DIMENSION = 48;
export declare function createViewportSize(
	width: unknown,
	height: unknown,
): ViewportSize | null;
export declare function createWindowViewport(): ViewportSize;
export declare function areViewportsEqual(
	a: ViewportSize | null | undefined,
	b: ViewportSize | null | undefined,
): boolean;
export declare function hasPositiveViewport(
	viewport: ViewportSize | null | undefined,
): viewport is ViewportSize;
export declare function isViewportLargeEnough(
	viewport: ViewportSize | null | undefined,
	minDimension?: number,
): viewport is ViewportSize;
export declare function measureElementViewport(
	element: Element | null,
): ViewportSize | null;
export declare function pickViewport(
	candidates: Array<ViewportSize | null | undefined>,
	fallbackViewport: ViewportSize,
): ViewportSize;
