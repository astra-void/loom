import * as React from "react";
import { serializeUDim, serializeVector2, toFiniteNumber } from "../internal/robloxValues";
import { type ComputedRect } from "../layout/model";
import { toCssColor } from "../runtime/helpers";
import { type HostModifierName, type HostName, type PreviewDomProps } from "./types";

const PREVIEW_DECORATOR_HOST_MARKER = Symbol.for("lattice.preview.decoratorHost");

type HoistedModifierState = {
  cornerRadius?: string;
  scale?: number;
  strokeShadow?: string;
};

function getDecoratorHost(type: unknown): HostModifierName | undefined {
  if (typeof type !== "object" && typeof type !== "function") {
    return undefined;
  }

  return (type as { [PREVIEW_DECORATOR_HOST_MARKER]?: HostModifierName })[PREVIEW_DECORATOR_HOST_MARKER];
}

function toTransformOrigin(anchorPoint: { X: number; Y: number }): string {
  return `${anchorPoint.X * 100}% ${anchorPoint.Y * 100}%`;
}

function resolveCornerRadius(value: unknown, computed: ComputedRect | null): string {
  const radius = serializeUDim(value);
  const referenceSize = computed ? Math.min(computed.width, computed.height) : 0;
  return `${Math.max(0, referenceSize * radius.Scale + radius.Offset)}px`;
}

function appendStyleValue(
  existing: React.CSSProperties[keyof React.CSSProperties] | undefined,
  next: string,
  separator: string,
): string {
  if (!existing) {
    return next;
  }

  return `${String(existing)}${separator}${next}`;
}

function collectHoistedModifierState(
  state: HoistedModifierState,
  host: HostModifierName,
  props: PreviewDomProps,
  computed: ComputedRect | null,
): void {
  switch (host) {
    case "uicorner":
      state.cornerRadius = resolveCornerRadius(props.CornerRadius, computed);
      break;
    case "uiscale":
      state.scale = toFiniteNumber(props.Scale, 1);
      break;
    case "uistroke": {
      const thickness = Math.max(0, toFiniteNumber(props.Thickness, 1));
      const color = props.Color ? toCssColor(props.Color, props.Transparency) : undefined;
      if (thickness > 0 && color) {
        state.strokeShadow = `inset 0 0 0 ${thickness}px ${color}`;
      }
      break;
    }
  }
}

function collectRenderableChildren(
  children: React.ReactNode,
  state: HoistedModifierState,
  computed: ComputedRect | null,
): React.ReactNode[] {
  const renderableChildren: React.ReactNode[] = [];

  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child)) {
      if (child !== undefined && child !== null && child !== false) {
        renderableChildren.push(child);
      }
      return;
    }

    const decoratorHost = getDecoratorHost(child.type);
    if (decoratorHost) {
      collectHoistedModifierState(state, decoratorHost, child.props as PreviewDomProps, computed);
      return;
    }

    if (child.type === React.Fragment) {
      const fragmentProps = child.props as { children?: React.ReactNode };
      const fragmentChildren = collectRenderableChildren(fragmentProps.children, state, computed);
      if (fragmentChildren.length > 0) {
        renderableChildren.push(React.cloneElement(child, undefined, ...fragmentChildren));
      }
      return;
    }

    renderableChildren.push(child);
  });

  return renderableChildren;
}

export function extractHoistedChildren(children: React.ReactNode, computed: ComputedRect | null) {
  const state: HoistedModifierState = {};
  const renderableChildren = collectRenderableChildren(children, state, computed);

  return {
    children: renderableChildren,
    state,
  };
}

export function applyHoistedModifierStyles(
  style: React.CSSProperties,
  state: HoistedModifierState,
  anchorPoint: PreviewDomProps["AnchorPoint"],
): void {
  if (state.cornerRadius) {
    style.borderRadius = state.cornerRadius;
  }

  if (state.scale !== undefined && Number.isFinite(state.scale) && state.scale !== 1) {
    style.transform = appendStyleValue(style.transform, `scale(${state.scale})`, " ");
    style.transformOrigin = toTransformOrigin(serializeVector2(anchorPoint));
  }

  if (state.strokeShadow) {
    style.boxShadow = appendStyleValue(style.boxShadow, state.strokeShadow, ", ");
  }
}

function createDecoratorHost(displayName: string, host: HostName) {
  const Component = React.forwardRef<HTMLElement, PreviewDomProps>(() => null);

  Component.displayName = displayName;
  if (host === "uicorner" || host === "uiscale" || host === "uistroke") {
    (Component as typeof Component & { [PREVIEW_DECORATOR_HOST_MARKER]?: HostModifierName })[
      PREVIEW_DECORATOR_HOST_MARKER
    ] = host;
  }

  return Component;
}

export const UICorner = createDecoratorHost("PreviewUICorner", "uicorner");
export const UIPadding = createDecoratorHost("PreviewUIPadding", "uipadding");
export const UIListLayout = createDecoratorHost("PreviewUIListLayout", "uilistlayout");
export const UIGridLayout = createDecoratorHost("PreviewUIGridLayout", "uigridlayout");
export const UIStroke = createDecoratorHost("PreviewUIStroke", "uistroke");
export const UIScale = createDecoratorHost("PreviewUIScale", "uiscale");
export const UIGradient = createDecoratorHost("PreviewUIGradient", "uigradient");
export const UIPageLayout = createDecoratorHost("PreviewUIPageLayout", "uipagelayout");
export const UITableLayout = createDecoratorHost("PreviewUITableLayout", "uitablelayout");
export const UISizeConstraint = createDecoratorHost("PreviewUISizeConstraint", "uisizeconstraint");
export const UITextSizeConstraint = createDecoratorHost("PreviewUITextSizeConstraint", "uitextsizeconstraint");
export const UIAspectRatioConstraint = createDecoratorHost("PreviewUIAspectRatioConstraint", "uiaspectratioconstraint");
export const UIFlexItem = createDecoratorHost("PreviewUIFlexItem", "uiflexitem");
