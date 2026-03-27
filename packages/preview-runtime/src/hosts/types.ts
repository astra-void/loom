import type * as React from "react";
import type { UDim2Like, Vector2Like } from "../internal/robloxValues";
import type { Color3Value } from "../runtime/helpers";
import {
	fullSizeLayoutHostNames as sharedFullSizeLayoutHostNames,
	layoutHostNodeType as sharedLayoutHostNodeType,
} from "./metadata";

export type PreviewEventTable = {
	Activated?: (...args: unknown[]) => void;
	FocusLost?: (...args: unknown[]) => void;
	InputBegan?: (...args: unknown[]) => void;
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

export const layoutHostNodeType = sharedLayoutHostNodeType;

export type LayoutHostName =
	| "frame"
	| "textbutton"
	| "imagebutton"
	| "screengui"
	| "surfacegui"
	| "billboardgui"
	| "textlabel"
	| "textbox"
	| "imagelabel"
	| "scrollingframe"
	| "canvasgroup"
	| "viewportframe"
	| "videoframe";
export type HostName = LayoutHostName | DecoratorHostName;

export const buttonLikeHostNames = ["textbutton", "imagebutton"] as const;
export const fullSizeLayoutHostNames = sharedFullSizeLayoutHostNames;

export type PreviewDomProps = {
	Active?: boolean;
	AnchorPoint?: Vector2Like;
	AutoButtonColor?: boolean;
	AutomaticSize?: string;
	AspectRatio?: number;
	BackgroundColor3?: Color3Value;
	BackgroundTransparency?: number;
	BorderSizePixel?: number;
	CellPadding?: UDim2Like;
	CellSize?: UDim2Like;
	CanvasSize?: UDim2Like;
	Change?: {
		Text?: (element: HTMLInputElement) => void;
	};
	Color?: Color3Value;
	CornerRadius?: unknown;
	DominantAxis?: string;
	Event?: PreviewEventTable;
	FillDirection?: string;
	FillDirectionMaxCells?: number;
	Font?: unknown;
	FlexMode?: string;
	GrowRatio?: number;
	HorizontalAlignment?: string;
	HorizontalFlex?: string;
	Id?: string;
	Image?: string;
	ImageColor3?: Color3Value;
	ImageTransparency?: number;
	ItemLineAlignment?: string;
	LayoutOrder?: number;
	MaxSize?: Vector2Like;
	MaxTextSize?: number;
	MinSize?: Vector2Like;
	MinTextSize?: number;
	Modal?: boolean;
	Name?: string;
	PaddingBottom?: unknown;
	PaddingBetweenItems?: unknown;
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
	ShrinkRatio?: number;
	Size?: UDim2Like;
	SortOrder?: string;
	StartCorner?: string;
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
	VerticalFlex?: string;
	Visible?: boolean;
	Wraps?: boolean;
	ZIndex?: number;
	children?: React.ReactNode;
	className?: string;
	style?: React.CSSProperties;
	[key: string]: unknown;
} & ForwardedDomProps;
