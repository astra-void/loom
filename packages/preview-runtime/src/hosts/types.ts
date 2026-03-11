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

export const hostModifierNames = ["uicorner", "uiscale", "uistroke"] as const;
export type HostModifierName = (typeof hostModifierNames)[number];

export const decoratorHostNames = [
  "uicorner",
  "uipadding",
  "uilistlayout",
  "uigridlayout",
  "uistroke",
  "uiscale",
  "uigradient",
  "uipagelayout",
  "uitablelayout",
  "uisizeconstraint",
  "uitextsizeconstraint",
  "uiaspectratioconstraint",
  "uiflexitem",
] as const;
export type DecoratorHostName = (typeof decoratorHostNames)[number];

export const layoutHostNodeType = {
  frame: "Frame",
  textbutton: "TextButton",
  imagebutton: "ImageButton",
  screengui: "ScreenGui",
  surfacegui: "SurfaceGui",
  billboardgui: "BillboardGui",
  textlabel: "TextLabel",
  textbox: "TextBox",
  imagelabel: "ImageLabel",
  scrollingframe: "ScrollingFrame",
  canvasgroup: "CanvasGroup",
  viewportframe: "ViewportFrame",
  videoframe: "VideoFrame",
} as const;

export type LayoutHostName = keyof typeof layoutHostNodeType;
export type HostName = LayoutHostName | DecoratorHostName;

export const buttonLikeHostNames = ["textbutton", "imagebutton"] as const;
export const frameLikeHostNames = [
  "frame",
  "canvasgroup",
  "viewportframe",
  "videoframe",
  "surfacegui",
  "billboardgui",
] as const;
export const fullSizeLayoutHostNames = [...frameLikeHostNames, "screengui"] as const;

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
