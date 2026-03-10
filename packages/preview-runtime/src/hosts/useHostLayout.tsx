import * as React from "react";
import { normalizePreviewNodeId } from "../internal/robloxValues";
import { LayoutNodeParentProvider, useLayoutDebugState, useRobloxLayout } from "../layout/context";
import {
  domPresentationAdapter,
  type LayoutDebugState,
  type PreviewHostNode,
  patchPreviewHostNodeDomProps,
} from "./domAdapter";
import { type LayoutHostName, type PreviewDomProps } from "./types";

let previewNodeIdCounter = 0;

function getStringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function getLayoutParentId(props: PreviewDomProps) {
  const source = props as Record<string, unknown>;
  return getStringValue(source.ParentId ?? source.parentId);
}

function useGeneratedPreviewNodeId(): string {
  const idRef = React.useRef<string | null>(null);
  if (idRef.current === null) {
    previewNodeIdCounter += 1;
    idRef.current = `preview-node-${previewNodeIdCounter}`;
  }

  return idRef.current;
}

function resolveNodeId(generatedId: string, props: PreviewDomProps): string {
  const source = props as Record<string, unknown>;
  const explicitId = getStringValue(source.Id ?? source.id);
  return normalizePreviewNodeId(explicitId) ?? generatedId;
}

function useMeasurementRevision(elementRef: React.RefObject<HTMLElement | null>, enabled: boolean) {
  const [revision, setRevision] = React.useState(0);

  React.useLayoutEffect(() => {
    if (!enabled) {
      return;
    }

    const element = elementRef.current;
    if (!element) {
      return;
    }

    let lastWidth = element.getBoundingClientRect().width;
    let lastHeight = element.getBoundingClientRect().height;
    setRevision((previous) => previous + 1);

    const notifyIfChanged = () => {
      const rect = element.getBoundingClientRect();
      if (lastWidth === rect.width && lastHeight === rect.height) {
        return;
      }

      lastWidth = rect.width;
      lastHeight = rect.height;
      setRevision((previous) => previous + 1);
    };

    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(() => {
        notifyIfChanged();
      });
      observer.observe(element);
      return () => {
        observer.disconnect();
      };
    }

    const handleResize = () => {
      notifyIfChanged();
    };

    globalThis.addEventListener?.("resize", handleResize);
    return () => {
      globalThis.removeEventListener?.("resize", handleResize);
    };
  }, [elementRef, enabled]);

  return revision;
}

export function useHostLayout(host: LayoutHostName, props: PreviewDomProps) {
  const elementRef = React.useRef<HTMLElement | null>(null);
  const generatedId = useGeneratedPreviewNodeId();
  const nodeId = React.useMemo(() => resolveNodeId(generatedId, props), [generatedId, props]);
  const normalizedParentId = React.useMemo(() => normalizePreviewNodeId(getLayoutParentId(props)), [props]);

  const normalizedNode = React.useMemo(
    () =>
      domPresentationAdapter.normalize({
        host,
        nodeId,
        parentId: normalizedParentId,
        props,
      }),
    [host, nodeId, normalizedParentId, props],
  );

  const measurementVersion = useMeasurementRevision(elementRef, normalizedNode.measurementEnabled);
  const intrinsicSize = React.useMemo(
    () => domPresentationAdapter.measure(normalizedNode, elementRef.current),
    [measurementVersion, normalizedNode],
  );

  const layoutNode = React.useMemo<PreviewHostNode>(
    () => ({
      ...normalizedNode,
      intrinsicSize,
    }),
    [intrinsicSize, normalizedNode],
  );

  const computed = useRobloxLayout(layoutNode);
  const diagnostics = useLayoutDebugState(nodeId) as LayoutDebugState;

  const hostNode = React.useMemo(
    () => ({
      ...layoutNode,
      computed,
      layoutDebug: diagnostics,
    }),
    [computed, diagnostics, layoutNode],
  );

  return {
    computed,
    diagnostics,
    elementRef,
    hostNode,
    nodeId,
    patchDomProps: React.useCallback(
      (domProps: PreviewHostNode["presentationHints"]["domProps"]) => patchPreviewHostNodeDomProps(hostNode, domProps),
      [hostNode],
    ),
  };
}

export function withNodeParent(nodeId: string, rect: ReturnType<typeof useRobloxLayout>, children: React.ReactNode) {
  return (
    <LayoutNodeParentProvider nodeId={nodeId} rect={rect}>
      {children}
    </LayoutNodeParentProvider>
  );
}
