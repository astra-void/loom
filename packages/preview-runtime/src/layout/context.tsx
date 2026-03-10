import * as React from "react";
import { normalizePreviewNodeId } from "../internal/robloxValues";
import { normalizePreviewRuntimeError, publishPreviewRuntimeIssue } from "../runtime/runtimeError";
import { LayoutController } from "./controller";
import {
  adaptRobloxNodeInput,
  type ComputedRect,
  computeNodeRect,
  createEmptyLayoutResult,
  createViewportRect,
  type PreviewLayoutDebugNode,
  type PreviewLayoutNode,
  type PreviewLayoutResult,
  type RobloxLayoutRegistrationInput,
} from "./model";
import {
  areViewportsEqual,
  createViewportSize,
  DEFAULT_VIEWPORT_HEIGHT,
  DEFAULT_VIEWPORT_WIDTH,
  hasPositiveViewport,
  measureElementViewport,
  type ViewportSize,
} from "./viewport";
import { createWasmLayoutSession, initializeLayoutEngine } from "./wasm";

export type { ComputedRect, RobloxLayoutNodeInput, RobloxLayoutRegistrationInput } from "./model";

export type LayoutProviderProps = {
  children: React.ReactNode;
  debounceMs?: number;
  viewportHeight?: number;
  viewportWidth?: number;
};

type LayoutContextValue = {
  error: string | null;
  getDebugNode: (nodeId: string) => PreviewLayoutDebugNode | null;
  getRect: (nodeId: string) => ComputedRect | null;
  isReady: boolean;
  registerNode: (node: ReturnType<typeof adaptRobloxNodeInput>) => void;
  unregisterNode: (nodeId: string) => void;
  viewport: ViewportSize;
  viewportReady: boolean;
};

const DEFAULT_DEBOUNCE_MS = 12;
const ZERO_VIEWPORT: ViewportSize = {
  height: 0,
  width: 0,
};
const LAYOUT_CONTEXTS_GLOBAL_KEY = "__lattice_preview_layout_contexts__";

type LayoutContexts = {
  layout: React.Context<LayoutContextValue | null>;
  parentNode: React.Context<string | undefined>;
  parentRect: React.Context<ComputedRect | null>;
};

function getSharedLayoutContexts(): LayoutContexts {
  const globalRecord = globalThis as typeof globalThis & {
    [LAYOUT_CONTEXTS_GLOBAL_KEY]?: LayoutContexts;
  };

  if (!globalRecord[LAYOUT_CONTEXTS_GLOBAL_KEY]) {
    globalRecord[LAYOUT_CONTEXTS_GLOBAL_KEY] = {
      layout: React.createContext<LayoutContextValue | null>(null),
      parentNode: React.createContext<string | undefined>(undefined),
      parentRect: React.createContext<ComputedRect | null>(null),
    };
  }

  return globalRecord[LAYOUT_CONTEXTS_GLOBAL_KEY];
}

const sharedLayoutContexts = getSharedLayoutContexts();
const LayoutContext = sharedLayoutContexts.layout;
const ParentNodeContext = sharedLayoutContexts.parentNode;
const ParentRectContext = sharedLayoutContexts.parentRect;

function scheduleMicrotask(callback: () => void): void {
  if (typeof globalThis.queueMicrotask === "function") {
    globalThis.queueMicrotask(callback);
    return;
  }

  void Promise.resolve().then(callback);
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function isValidationError(error: unknown) {
  return error instanceof Error && error.message.startsWith("Unexpected ");
}

function useMeasuredViewport(containerRef: React.RefObject<HTMLDivElement | null>): ViewportSize | null {
  const [viewport, setViewport] = React.useState<ViewportSize | null>(null);

  React.useLayoutEffect(() => {
    const element = containerRef.current;
    const measurementElement = element?.parentElement ?? element;
    if (!measurementElement) {
      return;
    }

    const update = (nextViewport?: ViewportSize | null) => {
      const next = nextViewport ?? measureElementViewport(measurementElement);
      setViewport((previous) => (areViewportsEqual(previous, next) ? previous : next));
    };

    update();

    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver((entries) => {
        const entry = entries.find((candidate) => candidate.target === measurementElement) ?? entries[0];
        update(createViewportSize(entry?.contentRect.width, entry?.contentRect.height));
      });
      observer.observe(measurementElement);

      return () => {
        observer.disconnect();
      };
    }

    if (typeof window === "undefined") {
      return;
    }

    const handleWindowResize = () => {
      update();
    };

    window.addEventListener("resize", handleWindowResize);
    return () => {
      window.removeEventListener("resize", handleWindowResize);
    };
  }, [containerRef]);

  return viewport;
}

export function LayoutProvider(props: LayoutProviderProps) {
  const controllerRef = React.useRef<LayoutController | null>(null);
  if (controllerRef.current === null) {
    controllerRef.current = new LayoutController({
      sessionFactory: () => createWasmLayoutSession(),
    });
  }

  const controller = controllerRef.current;
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const measuredViewport = useMeasuredViewport(containerRef);
  const explicitViewport = React.useMemo(
    () => createViewportSize(props.viewportWidth, props.viewportHeight),
    [props.viewportHeight, props.viewportWidth],
  );
  const resolvedViewport = React.useMemo(() => {
    if (hasPositiveViewport(measuredViewport)) {
      return measuredViewport;
    }

    if (hasPositiveViewport(explicitViewport)) {
      return explicitViewport;
    }

    if (measuredViewport !== null) {
      return null;
    }

    return explicitViewport;
  }, [explicitViewport, measuredViewport]);
  const viewportSource = React.useMemo(() => {
    if (hasPositiveViewport(measuredViewport)) {
      return "measured-parent";
    }

    if (hasPositiveViewport(explicitViewport)) {
      return "explicit";
    }

    if (measuredViewport !== null) {
      return "unresolved";
    }

    return "none";
  }, [explicitViewport, measuredViewport]);
  const viewportReady = hasPositiveViewport(resolvedViewport);
  const viewportWidth = resolvedViewport?.width ?? 0;
  const viewportHeight = resolvedViewport?.height ?? 0;
  const debounceMs = props.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const viewportRect = React.useMemo(
    () => (viewportReady ? createViewportRect(viewportWidth, viewportHeight) : null),
    [viewportHeight, viewportReady, viewportWidth],
  );

  const [isReady, setIsReady] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [treeVersion, setTreeVersion] = React.useState(0);
  const [settledTreeVersion, setSettledTreeVersion] = React.useState(0);
  const [layoutResult, setLayoutResult] = React.useState<PreviewLayoutResult>(() =>
    createEmptyLayoutResult(ZERO_VIEWPORT),
  );
  const containerStyle = React.useMemo<React.CSSProperties>(
    () => ({
      display: "block",
      height: "100%",
      minHeight: "500px",
      position: "relative",
      visibility: viewportReady ? "visible" : "hidden",
      width: "100%",
    }),
    [viewportReady],
  );

  React.useEffect(() => {
    let cancelled = false;

    initializeLayoutEngine()
      .then(() => {
        if (!cancelled) {
          setIsReady(true);
          setError(null);
        }
      })
      .catch((nextError: unknown) => {
        if (!cancelled) {
          setIsReady(false);
          setError(`Wasm init failed: ${toErrorMessage(nextError)}`);
          publishPreviewRuntimeIssue(
            normalizePreviewRuntimeError(
              {
                code: "LAYOUT_WASM_INIT_FAILED",
                kind: "ModuleLoadError",
                phase: "layout",
                summary: `Wasm init failed: ${toErrorMessage(nextError)}`,
                target: "@lattice-ui/layout-engine",
              },
              nextError,
            ),
          );
        }
      });

    return () => {
      cancelled = true;
      controller.dispose();
    };
  }, [controller]);

  const registerNode = React.useCallback(
    (node: ReturnType<typeof adaptRobloxNodeInput>) => {
      if (controller.upsertNode(node)) {
        setTreeVersion((previous) => previous + 1);
      }
    },
    [controller],
  );

  const unregisterNode = React.useCallback(
    (nodeId: string) => {
      if (controller.removeNode(nodeId)) {
        setTreeVersion((previous) => previous + 1);
      }
    },
    [controller],
  );

  React.useEffect(() => {
    let cancelled = false;

    scheduleMicrotask(() => {
      if (!cancelled) {
        setSettledTreeVersion((previous) => previous + 1);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [treeVersion]);

  React.useEffect(() => {
    if (!viewportReady) {
      setLayoutResult(createEmptyLayoutResult({ height: viewportHeight, width: viewportWidth }));
      return;
    }

    controller.setViewport({
      height: viewportHeight,
      width: viewportWidth,
    });

    if (!controller.hasNodes()) {
      setLayoutResult(createEmptyLayoutResult({ height: viewportHeight, width: viewportWidth }));
      setError(null);
      return;
    }

    const timeoutId = globalThis.setTimeout(
      () => {
        try {
          const nextResult = controller.compute(isReady);
          setLayoutResult(nextResult);
          setError(null);
        } catch (nextError) {
          publishPreviewRuntimeIssue(
            normalizePreviewRuntimeError(
              {
                code: isValidationError(nextError) ? "LAYOUT_VALIDATION_ERROR" : "LAYOUT_WASM_COMPUTE_FAILED",
                kind: isValidationError(nextError) ? "LayoutValidationError" : "LayoutExecutionError",
                phase: "layout",
                summary: `Wasm layout failed: ${toErrorMessage(nextError)}`,
                target: "@lattice-ui/layout-engine",
              },
              nextError,
            ),
          );
          try {
            const fallbackResult = controller.compute(false);
            setLayoutResult(fallbackResult);
            setError(`Wasm layout failed: ${toErrorMessage(nextError)}`);
          } catch (fallbackError) {
            publishPreviewRuntimeIssue(
              normalizePreviewRuntimeError(
                {
                  code: isValidationError(fallbackError) ? "LAYOUT_VALIDATION_ERROR" : "LAYOUT_FALLBACK_COMPUTE_FAILED",
                  kind: isValidationError(fallbackError) ? "LayoutValidationError" : "LayoutExecutionError",
                  phase: "layout",
                  summary: `Fallback layout failed: ${toErrorMessage(fallbackError)}`,
                  target: "@lattice-ui/layout-engine",
                },
                fallbackError,
              ),
            );
            setLayoutResult(createEmptyLayoutResult({ height: viewportHeight, width: viewportWidth }));
            setError(`Fallback layout failed: ${toErrorMessage(fallbackError)}`);
          }
        }
      },
      Math.max(0, debounceMs),
    );

    return () => {
      globalThis.clearTimeout(timeoutId);
    };
  }, [controller, debounceMs, isReady, settledTreeVersion, viewportHeight, viewportReady, viewportWidth]);

  const getRect = React.useCallback(
    (nodeId: string) => {
      const normalizedNodeId = normalizePreviewNodeId(nodeId) ?? nodeId;
      return layoutResult.rects[normalizedNodeId] ?? null;
    },
    [layoutResult.rects],
  );

  const getDebugNode = React.useCallback(
    (nodeId: string) => {
      const normalizedNodeId = normalizePreviewNodeId(nodeId) ?? nodeId;
      return controller.getDebugNode(normalizedNodeId);
    },
    [controller],
  );

  const contextValue = React.useMemo<LayoutContextValue>(
    () => ({
      error,
      getDebugNode,
      getRect,
      isReady,
      registerNode,
      unregisterNode,
      viewport: resolvedViewport ?? ZERO_VIEWPORT,
      viewportReady,
    }),
    [error, getDebugNode, getRect, isReady, registerNode, resolvedViewport, unregisterNode, viewportReady],
  );

  return (
    <LayoutContext.Provider value={contextValue}>
      <div
        data-preview-layout-provider=""
        data-preview-viewport-height={viewportHeight || undefined}
        data-preview-viewport-ready={viewportReady ? "true" : "false"}
        data-preview-viewport-source={viewportSource}
        data-preview-viewport-width={viewportWidth || undefined}
        ref={containerRef}
        style={containerStyle}
      >
        <ParentRectContext.Provider value={viewportRect}>
          <ParentNodeContext.Provider value={undefined}>{props.children}</ParentNodeContext.Provider>
        </ParentRectContext.Provider>
      </div>
    </LayoutContext.Provider>
  );
}

export function LayoutNodeParentProvider(props: {
  children: React.ReactNode;
  nodeId: string;
  rect: ComputedRect | null;
}) {
  return (
    <ParentRectContext.Provider value={props.rect}>
      <ParentNodeContext.Provider value={props.nodeId}>{props.children}</ParentNodeContext.Provider>
    </ParentRectContext.Provider>
  );
}

export function useLayoutEngineStatus() {
  const context = React.useContext(LayoutContext);
  return {
    error: context?.error ?? null,
    isReady: context?.isReady ?? false,
  };
}

export function useLayoutDebugState(nodeId?: string) {
  const context = React.useContext(LayoutContext);
  const inheritedParentRect = React.useContext(ParentRectContext);
  const debugNode = nodeId ? (context?.getDebugNode(nodeId) ?? null) : null;

  return React.useMemo(
    () => ({
      debugNode,
      hasContext: context !== null,
      inheritedParentRect: debugNode?.parentConstraints ?? inheritedParentRect,
      viewport: context?.viewport ?? null,
      viewportReady: context?.viewportReady ?? false,
    }),
    [context, debugNode, inheritedParentRect],
  );
}

function isPreviewLayoutNode(input: RobloxLayoutRegistrationInput | PreviewLayoutNode): input is PreviewLayoutNode {
  return "layout" in input && "kind" in input && typeof input.nodeType === "string";
}

export function useRobloxLayout(input: RobloxLayoutRegistrationInput | PreviewLayoutNode): ComputedRect | null {
  const context = React.useContext(LayoutContext);
  const inheritedParentId = React.useContext(ParentNodeContext);
  const inheritedParentRect = React.useContext(ParentRectContext);
  const parentId = input.parentId ?? inheritedParentId;
  const normalizedNode = React.useMemo(
    () =>
      isPreviewLayoutNode(input)
        ? {
            ...input,
            parentId: input.parentId ?? parentId,
          }
        : adaptRobloxNodeInput(input, parentId),
    [input, parentId],
  );
  const fallbackViewportWidth = context?.viewport.width ?? DEFAULT_VIEWPORT_WIDTH;
  const fallbackViewportHeight = context?.viewport.height ?? DEFAULT_VIEWPORT_HEIGHT;
  const fallbackViewportRect = React.useMemo(
    () => createViewportRect(fallbackViewportWidth, fallbackViewportHeight),
    [fallbackViewportHeight, fallbackViewportWidth],
  );
  const fallbackParentRect = inheritedParentRect ?? fallbackViewportRect;
  const fallbackRect = React.useMemo(
    () => computeNodeRect(normalizedNode, fallbackParentRect).rect,
    [fallbackParentRect, normalizedNode],
  );
  const register = context?.registerNode;
  const unregister = context?.unregisterNode;
  const computed = context ? context.getRect(normalizedNode.id) : null;

  React.useLayoutEffect(() => {
    if (!register || !unregister) {
      return;
    }

    register(normalizedNode);
    return () => {
      unregister(normalizedNode.id);
    };
  }, [normalizedNode, register, unregister]);

  if (context && !context.viewportReady) {
    return null;
  }

  return computed ?? fallbackRect;
}
