import type * as React from "react";
import type { UDim2Like, Vector2Like } from "../internal/robloxValues";
import type { Color3Value } from "../runtime/helpers";

export type PreviewEventTable = {
  Activated?: (event: Event) => void;
  FocusLost?: (event: Event) => void;
};

export type ForwardedDomProps = React.HTMLAttributes<HTMLElement> &
  React.InputHTMLAttributes<HTMLInputElement> &
  React.ImgHTMLAttributes<HTMLImageElement>;

export type HostModifierName = "uicorner" | "uiscale" | "uistroke";

export type HostName =
  | "frame"
  | "textbutton"
  | "screengui"
  | "textlabel"
  | "textbox"
  | "imagelabel"
  | "scrollingframe"
  | "uicorner"
  | "uipadding"
  | "uilistlayout"
  | "uigridlayout"
  | "uistroke"
  | "uiscale"
  | "uigradient"
  | "uipagelayout"
  | "uitablelayout"
  | "uisizeconstraint"
  | "uitextsizeconstraint"
  | "uiaspectratioconstraint"
  | "uiflexitem";

export type LayoutHostName =
  | "frame"
  | "textbutton"
  | "screengui"
  | "textlabel"
  | "textbox"
  | "imagelabel"
  | "scrollingframe";

export type PreviewDomProps = {
  Active?: boolean;
  AnchorPoint?: Vector2Like;
  AutoButtonColor?: boolean;
  AutomaticSize?: string;
  BackgroundColor3?: Color3Value;
  BackgroundTransparency?: number;
  BorderSizePixel?: number;
  CanvasSize?: UDim2Like;
  Change?: {
    Text?: (element: HTMLInputElement) => void;
  };
  Color?: Color3Value;
  CornerRadius?: unknown;
  Event?: PreviewEventTable;
  FillDirection?: string;
  Font?: unknown;
  HorizontalAlignment?: string;
  Id?: string;
  Image?: string;
  ImageColor3?: Color3Value;
  ImageTransparency?: number;
  Modal?: boolean;
  Name?: string;
  PaddingBottom?: unknown;
  PaddingLeft?: unknown;
  PaddingRight?: unknown;
  PaddingTop?: unknown;
  Padding?: unknown;
  ParentId?: string;
  PlaceholderText?: string;
  Position?: UDim2Like;
  ScrollBarThickness?: number;
  ScrollingDirection?: string;
  Scale?: number;
  Selectable?: boolean;
  Size?: UDim2Like;
  SortOrder?: string;
  Text?: unknown;
  TextColor3?: Color3Value;
  TextEditable?: boolean;
  TextScaled?: boolean;
  TextSize?: number;
  TextTransparency?: number;
  TextWrapped?: boolean;
  TextXAlignment?: string;
  TextYAlignment?: string;
  Thickness?: number;
  Transparency?: number;
  VerticalAlignment?: string;
  Visible?: boolean;
  ZIndex?: number;
  children?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  [key: string]: unknown;
} & ForwardedDomProps;

export const layoutHostNodeType: Record<LayoutHostName, string> = {
  frame: "Frame",
  textbutton: "TextButton",
  screengui: "ScreenGui",
  textlabel: "TextLabel",
  textbox: "TextBox",
  imagelabel: "ImageLabel",
  scrollingframe: "ScrollingFrame",
};
