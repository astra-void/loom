import * as React from "react";
import { normalizePreviewNodeId, serializeUDim2 } from "../internal/robloxValues";
import { adaptRobloxNodeInput, type ComputedRect, type PreviewLayoutNode } from "../layout/model";
import { getPreviewHostMetadataByJsxName, isDegradedPreviewHost } from "./metadata";
import { applyHoistedModifierStyles, extractHoistedChildren } from "./modifiers";
import { applyComputedLayoutStyle, type ResolvedPreviewDomProps, resolvePreviewDomProps } from "./resolveProps";
import { type LayoutHostName, layoutHostNodeType, type PreviewDomProps } from "./types";

export type LayoutDebugState = {
  debugNode: {
    parentConstraints: ComputedRect | null;
    rect: ComputedRect | null;
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
};

export type PreviewHostNode = PreviewLayoutNode & {
  computed?: ComputedRect | null;
  host: LayoutHostName;
  layoutDebug?: LayoutDebugState;
  measurementEnabled: boolean;
  presentationHints: {
    disabled: boolean;
    domProps: ResolvedPreviewDomProps["domProps"];
    image: unknown;
    text: string | undefined;
  };
  sourceProps: PreviewDomProps;
};

export interface PresentationAdapter {
  measure(node: PreviewHostNode, element: HTMLElement | null): { height: number; width: number } | null;
  normalize(source: SourceHostDescriptor): PreviewHostNode;
  render(node: PreviewHostNode, children: React.ReactNode, ref: React.Ref<HTMLElement>): React.ReactElement;
}

function renderDegradedHostLabel(node: PreviewHostNode) {
  if (!isDegradedPreviewHost(node.host)) {
    return undefined;
  }

  return (
    <span
      aria-hidden="true"
      className="preview-host-degraded-label"
      data-preview-degraded-label={node.nodeType}
      style={{
        background: "rgba(247, 232, 208, 0.92)",
        border: "1px solid rgba(121, 97, 67, 0.22)",
        borderRadius: "999px",
        color: "#6f5739",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        fontSize: "11px",
        fontWeight: 600,
        left: "8px",
        letterSpacing: "0.04em",
        maxWidth: "calc(100% - 16px)",
        overflow: "hidden",
        padding: "4px 8px",
        pointerEvents: "none",
        position: "absolute",
        textOverflow: "ellipsis",
        textTransform: "uppercase",
        top: "8px",
        whiteSpace: "nowrap",
        zIndex: 2,
      }}
    >
      {node.nodeType}
    </span>
  );
}

function renderHostText(text: string | undefined) {
  if (!text) {
    return undefined;
  }

  return (
    <span
      className="preview-host-text"
      style={{
        display: "block",
        width: "100%",
      }}
    >
      {text}
    </span>
  );
}

function renderHostImage(image: unknown) {
  if (typeof image !== "string" || image.length === 0) {
    return undefined;
  }

  return (
    <img
      alt=""
      aria-hidden="true"
      className="preview-host-image"
      src={image}
      style={{
        display: "block",
        height: "100%",
        objectFit: "cover",
        pointerEvents: "none",
        width: "100%",
      }}
    />
  );
}

function shouldMeasureHost(host: LayoutHostName, props: PreviewDomProps) {
  if (props.Size !== undefined || props.size !== undefined) {
    return false;
  }

  return (
    host === "imagelabel" ||
    host === "imagebutton" ||
    host === "textbutton" ||
    host === "textlabel" ||
    host === "textbox"
  );
}

function readMeasuredSize(element: HTMLElement | null) {
  if (!element) {
    return null;
  }

  const rect = element.getBoundingClientRect();
  if (!Number.isFinite(rect.width) || !Number.isFinite(rect.height)) {
    return null;
  }

  return {
    height: Math.max(0, rect.height),
    width: Math.max(0, rect.width),
  };
}

function withLayoutDiagnostics(
  domProps: React.HTMLAttributes<HTMLElement> & Record<string, unknown>,
  diagnostics: LayoutDebugState | undefined,
  node: PreviewHostNode,
) {
  const debugNode = diagnostics?.debugNode ?? null;

  return {
    ...domProps,
    "data-layout-computed-height": debugNode?.rect?.height ?? undefined,
    "data-layout-computed-width": debugNode?.rect?.width ?? undefined,
    "data-layout-context": diagnostics?.hasContext ? "true" : "false",
    "data-layout-parent-height":
      debugNode?.parentConstraints?.height ?? diagnostics?.inheritedParentRect?.height ?? undefined,
    "data-layout-parent-width":
      debugNode?.parentConstraints?.width ?? diagnostics?.inheritedParentRect?.width ?? undefined,
    "data-layout-style-height": debugNode?.styleHints?.height ?? node.styleHints?.height ?? undefined,
    "data-layout-style-width": debugNode?.styleHints?.width ?? node.styleHints?.width ?? undefined,
    "data-layout-viewport-height": diagnostics?.viewport?.height ?? undefined,
    "data-layout-viewport-ready": diagnostics?.viewportReady ? "true" : "false",
    "data-layout-viewport-width": diagnostics?.viewport?.width ?? undefined,
  };
}

function createRenderedDomProps(node: PreviewHostNode) {
  const { children, state } = extractHoistedChildren(node.sourceProps.children, node.computed ?? null);
  const domProps = {
    ...node.presentationHints.domProps,
  } as ResolvedPreviewDomProps["domProps"] & Record<string, unknown>;
  const style = {
    ...(domProps.style as React.CSSProperties | undefined),
  };

  applyComputedLayoutStyle(style, node.computed ?? null);
  applyHoistedModifierStyles(style, state, node.sourceProps.AnchorPoint);
  if (isDegradedPreviewHost(node.host)) {
    style.backgroundImage =
      style.backgroundImage ??
      "linear-gradient(135deg, rgba(245, 232, 210, 0.9), rgba(255, 247, 234, 0.9))";
    style.border = style.border ?? "1px dashed rgba(141, 115, 83, 0.45)";
    style.overflow = style.overflow ?? "hidden";
  }
  domProps.style = style;

  return {
    children,
    domProps: withLayoutDiagnostics(
      {
        ...domProps,
        "data-preview-degraded": isDegradedPreviewHost(node.host) ? "true" : undefined,
      },
      node.layoutDebug,
      node,
    ),
  };
}

function createHostNode(source: SourceHostDescriptor): PreviewHostNode {
  const nodeId = normalizePreviewNodeId(source.nodeId) ?? source.nodeId;
  const parentId = normalizePreviewNodeId(source.parentId);
  const rawProps = source.props as PreviewDomProps & {
    anchorPoint?: unknown;
    position?: unknown;
    size?: unknown;
  };
  const resolved = resolvePreviewDomProps(source.props, {
    applyComputedLayout: false,
    computed: null,
    host: source.host,
    nodeId,
  });
  const hostMetadata = getPreviewHostMetadataByJsxName(source.host);
  const style = resolved.domProps.style as React.CSSProperties | undefined;

  const layoutNode = adaptRobloxNodeInput(
    {
      anchorPoint: source.props.AnchorPoint ?? (rawProps.anchorPoint as PreviewDomProps["AnchorPoint"] | undefined),
      debugLabel: source.props.Name ? String(source.props.Name) : nodeId,
      hostMetadata:
        hostMetadata === undefined
          ? undefined
          : {
              degraded: hostMetadata.degraded,
              fullSizeDefault: hostMetadata.fullSizeDefault,
            },
      id: nodeId,
      kind: source.host === "screengui" && parentId === undefined ? "root" : "host",
      nodeType: layoutHostNodeType[source.host],
      parentId,
      position: source.props.Position ?? (rawProps.position as PreviewDomProps["Position"] | undefined),
      size: serializeUDim2(source.props.Size ?? rawProps.size, undefined) ?? undefined,
      styleHints: {
        height: typeof style?.height === "string" ? style.height : undefined,
        width: typeof style?.width === "string" ? style.width : undefined,
      },
    },
    parentId,
  );

  return {
    ...layoutNode,
    host: source.host,
    measurementEnabled: shouldMeasureHost(source.host, source.props),
    presentationHints: {
      disabled: resolved.disabled,
      domProps: resolved.domProps,
      image: resolved.image,
      text: resolved.text,
    },
    sourceProps: source.props,
  };
}

export function patchPreviewHostNodeDomProps(
  node: PreviewHostNode,
  domProps: ResolvedPreviewDomProps["domProps"],
): PreviewHostNode {
  return {
    ...node,
    presentationHints: {
      ...node.presentationHints,
      domProps,
    },
  };
}

export const domPresentationAdapter: PresentationAdapter = {
  measure(node, element) {
    if (!node.measurementEnabled) {
      return null;
    }

    return readMeasuredSize(element);
  },

  normalize(source) {
    return createHostNode(source);
  },

  render(node, children, ref) {
    const rendered = createRenderedDomProps(node);

    switch (node.host) {
      case "textbutton":
        return (
          <button
            {...rendered.domProps}
            disabled={node.presentationHints.disabled}
            ref={ref as React.Ref<HTMLButtonElement>}
            type="button"
          >
            {renderHostText(node.presentationHints.text)}
            {children}
          </button>
        );
      case "imagebutton":
        return (
          <button
            {...rendered.domProps}
            disabled={node.presentationHints.disabled}
            ref={ref as React.Ref<HTMLButtonElement>}
            type="button"
          >
            {renderHostImage(node.presentationHints.image)}
            {children}
          </button>
        );
      case "textbox":
        return (
          <input
            {...rendered.domProps}
            defaultValue={node.presentationHints.text}
            disabled={node.presentationHints.disabled}
            ref={ref as React.Ref<HTMLInputElement>}
            type="text"
          />
        );
      case "imagelabel":
        return (
          <img
            {...rendered.domProps}
            alt=""
            ref={ref as React.Ref<HTMLImageElement>}
            src={typeof node.presentationHints.image === "string" ? node.presentationHints.image : undefined}
          />
        );
      default: {
        return (
          <div {...rendered.domProps} ref={ref as React.Ref<HTMLDivElement>}>
            {renderDegradedHostLabel(node)}
            {(node.host === "textlabel" || node.host === "frame") && renderHostText(node.presentationHints.text)}
            {children}
          </div>
        );
      }
    }
  },
};
