import * as React from "react";
import type { ComputedRect } from "../layout/model";
import type { PreviewDomProps } from "./types";
export type HoistedModifierState = {
	cornerRadius?: unknown;
	scale?: number;
	strokeShadow?: string;
};
type ExtractedModifierState = {
	appearance: HoistedModifierState;
	layoutModifiers: Record<string, unknown>;
	renderableChildren: React.ReactNode[];
};
export declare function extractModifierState(
	children: React.ReactNode,
	computed: ComputedRect | null,
): ExtractedModifierState;
export declare function applyHoistedModifierStyles(
	style: React.CSSProperties,
	state: HoistedModifierState,
	computed: ComputedRect | null,
	anchorPoint: PreviewDomProps["AnchorPoint"],
): void;
export declare const UICorner: React.ForwardRefExoticComponent<
	Omit<PreviewDomProps, "ref"> & React.RefAttributes<HTMLElement>
>;
export declare const UIPadding: React.ForwardRefExoticComponent<
	Omit<PreviewDomProps, "ref"> & React.RefAttributes<HTMLElement>
>;
export declare const UIListLayout: React.ForwardRefExoticComponent<
	Omit<PreviewDomProps, "ref"> & React.RefAttributes<HTMLElement>
>;
export declare const UIGridLayout: React.ForwardRefExoticComponent<
	Omit<PreviewDomProps, "ref"> & React.RefAttributes<HTMLElement>
>;
export declare const UIStroke: React.ForwardRefExoticComponent<
	Omit<PreviewDomProps, "ref"> & React.RefAttributes<HTMLElement>
>;
export declare const UIScale: React.ForwardRefExoticComponent<
	Omit<PreviewDomProps, "ref"> & React.RefAttributes<HTMLElement>
>;
export declare const UIGradient: React.ForwardRefExoticComponent<
	Omit<PreviewDomProps, "ref"> & React.RefAttributes<HTMLElement>
>;
export declare const UIPageLayout: React.ForwardRefExoticComponent<
	Omit<PreviewDomProps, "ref"> & React.RefAttributes<HTMLElement>
>;
export declare const UITableLayout: React.ForwardRefExoticComponent<
	Omit<PreviewDomProps, "ref"> & React.RefAttributes<HTMLElement>
>;
export declare const UISizeConstraint: React.ForwardRefExoticComponent<
	Omit<PreviewDomProps, "ref"> & React.RefAttributes<HTMLElement>
>;
export declare const UITextSizeConstraint: React.ForwardRefExoticComponent<
	Omit<PreviewDomProps, "ref"> & React.RefAttributes<HTMLElement>
>;
export declare const UIAspectRatioConstraint: React.ForwardRefExoticComponent<
	Omit<PreviewDomProps, "ref"> & React.RefAttributes<HTMLElement>
>;
export declare const UIFlexItem: React.ForwardRefExoticComponent<
	Omit<PreviewDomProps, "ref"> & React.RefAttributes<HTMLElement>
>;
