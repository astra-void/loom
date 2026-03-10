export type ViewportSize = {
  height: number;
  width: number;
};

export const DEFAULT_VIEWPORT_WIDTH = 800;
export const DEFAULT_VIEWPORT_HEIGHT = 600;
export const MIN_VALID_VIEWPORT_DIMENSION = 48;

function toViewportDimension(value: unknown) {
  const next = Math.floor(Number(value));
  if (!Number.isFinite(next)) {
    return null;
  }

  return Math.max(0, next);
}

function toPositiveViewportDimension(value: unknown) {
  const next = toViewportDimension(value);
  if (next === null || next <= 0) {
    return null;
  }

  return next;
}

export function createViewportSize(width: unknown, height: unknown): ViewportSize | null {
  const nextWidth = toViewportDimension(width);
  const nextHeight = toViewportDimension(height);
  if (nextWidth === null || nextHeight === null) {
    return null;
  }

  return {
    height: nextHeight,
    width: nextWidth,
  };
}

export function createWindowViewport(): ViewportSize {
  if (typeof window === "undefined") {
    return {
      height: DEFAULT_VIEWPORT_HEIGHT,
      width: DEFAULT_VIEWPORT_WIDTH,
    };
  }

  return {
    height: toPositiveViewportDimension(window.innerHeight) ?? DEFAULT_VIEWPORT_HEIGHT,
    width: toPositiveViewportDimension(window.innerWidth) ?? DEFAULT_VIEWPORT_WIDTH,
  };
}

export function areViewportsEqual(a: ViewportSize | null | undefined, b: ViewportSize | null | undefined) {
  return a?.width === b?.width && a?.height === b?.height;
}

export function hasPositiveViewport(viewport: ViewportSize | null | undefined): viewport is ViewportSize {
  return viewport !== null && viewport !== undefined && viewport.width > 0 && viewport.height > 0;
}

export function isViewportLargeEnough(
  viewport: ViewportSize | null | undefined,
  minDimension = MIN_VALID_VIEWPORT_DIMENSION,
): viewport is ViewportSize {
  return hasPositiveViewport(viewport) && viewport.width >= minDimension && viewport.height >= minDimension;
}

export function measureElementViewport(element: Element | null): ViewportSize | null {
  if (!(element instanceof Element)) {
    return null;
  }

  const rect = element.getBoundingClientRect();
  return createViewportSize(rect.width, rect.height);
}

export function pickViewport(
  candidates: Array<ViewportSize | null | undefined>,
  fallbackViewport: ViewportSize,
): ViewportSize {
  for (const candidate of candidates) {
    if (isViewportLargeEnough(candidate)) {
      return candidate;
    }
  }

  if (hasPositiveViewport(fallbackViewport)) {
    return fallbackViewport;
  }

  return {
    height: DEFAULT_VIEWPORT_HEIGHT,
    width: DEFAULT_VIEWPORT_WIDTH,
  };
}
