import * as React from "react";
import { type ComputedRect } from "../layout/model";
import { toCssColor } from "../runtime/helpers";
import { mapRobloxFont } from "../style/textStyles";
import { type ForwardedDomProps, type HostName, type PreviewDomProps } from "./types";

const DOM_PROP_NAMES = new Set([
  "children",
  "className",
  "defaultValue",
  "id",
  "onBlur",
  "onChange",
  "onClick",
  "onFocus",
  "onInput",
  "onKeyDown",
  "onKeyUp",
  "onMouseDown",
  "onMouseEnter",
  "onMouseLeave",
  "onPointerDown",
  "onPointerMove",
  "onPointerUp",
  "placeholder",
  "role",
  "style",
  "tabIndex",
  "title",
  "value",
]);

export type ResolveOptions = {
  applyComputedLayout?: boolean;
  computed: ComputedRect | null;
  host: HostName;
  nodeId: string;
};

export type ResolvedPreviewDomProps = {
  children: React.ReactNode;
  disabled: boolean;
  domProps: ForwardedDomProps & Record<string, unknown>;
  image: unknown;
  text: string | undefined;
};

function mergeHandlers<T>(a?: (event: T) => void, b?: (event: T) => void) {
  if (!a) {
    return b;
  }

  if (!b) {
    return a;
  }

  return (event: T) => {
    a(event);
    b(event);
  };
}

function toTextAlign(value: string | undefined): "center" | "left" | "right" {
  switch (value) {
    case "center":
      return "center";
    case "right":
      return "right";
    default:
      return "left";
  }
}

function toJustifyContent(value: string | undefined): "center" | "flex-end" | "flex-start" {
  switch (value) {
    case "center":
      return "center";
    case "bottom":
      return "flex-end";
    default:
      return "flex-start";
  }
}

function pickForwardedDomProps(props: PreviewDomProps): ForwardedDomProps {
  const domProps: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(props)) {
    if (key.startsWith("aria-") || key.startsWith("data-") || DOM_PROP_NAMES.has(key)) {
      domProps[key] = value;
    }
  }

  return domProps as ForwardedDomProps;
}

function coerceTextValue(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  return String(value);
}

export function applyComputedLayoutStyle(style: React.CSSProperties, computed: ComputedRect | null): void {
  delete style.left;
  delete style.top;
  delete style.width;
  delete style.height;
  delete style.transform;
  delete style.translate;

  style.position = "absolute";

  if (!computed) {
    style.visibility = "hidden";
    return;
  }

  style.visibility = "visible";
  style.left = `${computed.x}px`;
  style.top = `${computed.y}px`;
  style.width = `${computed.width}px`;
  style.height = `${computed.height}px`;
}

export function resolvePreviewDomProps(props: PreviewDomProps, options: ResolveOptions): ResolvedPreviewDomProps {
  const {
    Active,
    AnchorPoint,
    AutoButtonColor,
    BackgroundColor3,
    BackgroundTransparency,
    BorderSizePixel,
    Change,
    Color,
    CornerRadius,
    Event,
    Font,
    Id,
    Image,
    ImageColor3,
    ImageTransparency,
    Modal,
    Name,
    ParentId,
    PlaceholderText,
    Position,
    Scale,
    Selectable,
    Size,
    Text,
    TextColor3,
    TextEditable,
    TextScaled,
    TextSize,
    TextTransparency,
    TextWrapped,
    TextXAlignment,
    TextYAlignment,
    Thickness,
    Transparency,
    Visible,
    ZIndex,
    children,
    className,
    onBlur,
    onChange,
    onClick,
    style,
    ...rest
  } = props;

  void Active;
  void AnchorPoint;
  void AutoButtonColor;
  void Color;
  void CornerRadius;
  void Font;
  void Id;
  void ImageColor3;
  void ImageTransparency;
  void Modal;
  void Name;
  void ParentId;
  void Position;
  void Scale;
  void Size;
  void TextScaled;
  void TextTransparency;
  void Thickness;
  void Transparency;

  const forwarded = pickForwardedDomProps(rest);
  const computedStyle: React.CSSProperties = {
    ...(style ?? {}),
  };

  if (options.applyComputedLayout !== false) {
    applyComputedLayoutStyle(computedStyle, options.computed);
  }

  computedStyle.boxSizing = computedStyle.boxSizing ?? "border-box";
  computedStyle.flexShrink = computedStyle.flexShrink ?? 0;
  computedStyle.margin = computedStyle.margin ?? 0;
  computedStyle.minHeight = computedStyle.minHeight ?? 0;
  computedStyle.minWidth = computedStyle.minWidth ?? 0;
  computedStyle.padding = computedStyle.padding ?? 0;

  if (Visible === false) {
    computedStyle.display = "none";
  }

  if (ZIndex !== undefined) {
    computedStyle.zIndex = ZIndex;
  }

  if (BackgroundColor3) {
    computedStyle.backgroundColor = toCssColor(BackgroundColor3, BackgroundTransparency);
  } else if (BackgroundTransparency === 1) {
    computedStyle.backgroundColor = "transparent";
  }

  if (TextColor3) {
    computedStyle.color = toCssColor(TextColor3);
  }

  const fontStyle = mapRobloxFont(Font);
  if (fontStyle.fontFamily) {
    computedStyle.fontFamily = fontStyle.fontFamily;
  }
  if (fontStyle.fontStyle) {
    computedStyle.fontStyle = fontStyle.fontStyle;
  }
  if (fontStyle.fontWeight) {
    computedStyle.fontWeight = fontStyle.fontWeight;
  }

  if (TextSize !== undefined) {
    computedStyle.fontSize = `${TextSize}px`;
    computedStyle.lineHeight = 1.2;
  }

  if (BorderSizePixel === 0) {
    computedStyle.border = "none";
  } else if (BorderSizePixel !== undefined) {
    computedStyle.borderColor = "transparent";
    computedStyle.borderStyle = "solid";
    computedStyle.borderWidth = `${BorderSizePixel}px`;
  }

  if (TextWrapped) {
    computedStyle.whiteSpace = "pre-wrap";
    computedStyle.overflowWrap = "break-word";
  } else if (options.host === "textbutton" || options.host === "textlabel" || options.host === "textbox") {
    computedStyle.whiteSpace = "pre";
  }

  if (options.host === "textbutton" || options.host === "textlabel") {
    computedStyle.display = computedStyle.display === "none" ? "none" : "flex";
    computedStyle.flexDirection = "column";
    computedStyle.justifyContent = toJustifyContent(TextYAlignment);
    computedStyle.textAlign = toTextAlign(TextXAlignment);
  }

  if (options.host === "textbox") {
    computedStyle.textAlign = toTextAlign(TextXAlignment);
  }

  if (options.host === "textbutton" || options.host === "textbox") {
    computedStyle.appearance = computedStyle.appearance ?? "none";
    computedStyle.backgroundClip = computedStyle.backgroundClip ?? "padding-box";
  }

  if (options.host === "imagelabel") {
    computedStyle.objectFit = "cover";
  }

  if (options.host === "scrollingframe") {
    computedStyle.overflow = "auto";
  }

  const mergedClick = mergeHandlers<React.MouseEvent<HTMLElement>>(
    onClick,
    Event?.Activated
      ? (event) => {
          Event.Activated?.(event.nativeEvent);
        }
      : undefined,
  );
  const mergedBlur = mergeHandlers<React.FocusEvent<HTMLElement>>(
    onBlur,
    Event?.FocusLost
      ? (event) => {
          Event.FocusLost?.(event.nativeEvent);
        }
      : undefined,
  );
  const mergedChange = mergeHandlers<React.ChangeEvent<HTMLElement>>(
    onChange as ((event: React.ChangeEvent<HTMLElement>) => void) | undefined,
    Change?.Text
      ? (event) => {
          if (event.target instanceof HTMLInputElement) {
            Change.Text?.(event.target);
          }
        }
      : undefined,
  );

  return {
    children,
    disabled: options.host === "textbutton" ? props.Active === false : TextEditable === false,
    domProps: {
      ...forwarded,
      "data-preview-host": options.host,
      "data-preview-node-id": options.nodeId,
      className: ["preview-host", `preview-${options.host}`, className].filter(Boolean).join(" "),
      onBlur: mergedBlur,
      onChange: mergedChange,
      onClick: mergedClick,
      placeholder: PlaceholderText,
      style: computedStyle,
      tabIndex: Selectable === false ? -1 : (forwarded.tabIndex as number | undefined),
    },
    image: Image,
    text: coerceTextValue(Text),
  };
}
