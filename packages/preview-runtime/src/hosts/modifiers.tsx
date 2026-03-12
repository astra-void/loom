import * as React from "react";
import {
	serializeUDim,
	serializeVector2,
	toFiniteNumber,
} from "../internal/robloxValues";
import type { ComputedRect } from "../layout/model";
import { toCssColor } from "../runtime/helpers";
import type {
	DecoratorHostName,
	HostModifierName,
	HostName,
	PreviewDomProps,
} from "./types";

const PREVIEW_DECORATOR_HOST_MARKER = Symbol.for("loom.preview.decoratorHost");

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

function getDecoratorHost(type: unknown): DecoratorHostName | undefined {
	if (typeof type !== "object" && typeof type !== "function") {
		return undefined;
	}

	return (type as { [PREVIEW_DECORATOR_HOST_MARKER]?: DecoratorHostName })[
		PREVIEW_DECORATOR_HOST_MARKER
	];
}

function toTransformOrigin(anchorPoint: { X: number; Y: number }): string {
	return `${anchorPoint.X * 100}% ${anchorPoint.Y * 100}%`;
}

function resolveCornerRadius(
	value: unknown,
	computed: ComputedRect | null,
): string {
	const radius = serializeUDim(value);
	const referenceSize = computed
		? Math.min(computed.width, computed.height)
		: 0;
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
	_computed: ComputedRect | null,
): void {
	switch (host) {
		case "uicorner":
			state.cornerRadius = props.CornerRadius;
			break;
		case "uiscale":
			state.scale = toFiniteNumber(props.Scale, 1);
			break;
		case "uistroke": {
			const thickness = Math.max(0, toFiniteNumber(props.Thickness, 1));
			const color = props.Color
				? toCssColor(props.Color, props.Transparency)
				: undefined;
			if (thickness > 0 && color) {
				state.strokeShadow = `inset 0 0 0 ${thickness}px ${color}`;
			}
			break;
		}
	}
}

function mergeLayoutModifiers(
	target: Record<string, unknown>,
	host: DecoratorHostName,
	props: PreviewDomProps,
) {
	switch (host) {
		case "uipadding":
			target.padding = {
				bottom: props.PaddingBottom ?? props.Padding,
				left: props.PaddingLeft ?? props.Padding,
				right: props.PaddingRight ?? props.Padding,
				top: props.PaddingTop ?? props.Padding,
			};
			break;
		case "uilistlayout":
			target.list = {
				fillDirection: props.FillDirection,
				horizontalAlignment: props.HorizontalAlignment,
				horizontalFlex: props.HorizontalFlex,
				itemLineAlignment: props.ItemLineAlignment,
				padding: props.Padding,
				sortOrder: props.SortOrder,
				verticalAlignment: props.VerticalAlignment,
				verticalFlex: props.VerticalFlex,
				wraps: props.Wraps,
			};
			break;
		case "uigridlayout":
			target.grid = {
				cellPadding: props.CellPadding,
				cellSize: props.CellSize,
				fillDirection: props.FillDirection,
				fillDirectionMaxCells: props.FillDirectionMaxCells,
				horizontalAlignment: props.HorizontalAlignment,
				sortOrder: props.SortOrder,
				startCorner: props.StartCorner,
				verticalAlignment: props.VerticalAlignment,
			};
			break;
		case "uisizeconstraint":
			target.sizeConstraint = {
				maxSize: props.MaxSize,
				minSize: props.MinSize,
			};
			break;
		case "uitextsizeconstraint":
			target.textSizeConstraint = {
				maxTextSize: props.MaxTextSize,
				minTextSize: props.MinTextSize,
			};
			break;
		case "uiaspectratioconstraint":
			target.aspectRatioConstraint = {
				aspectRatio: props.AspectRatio,
				dominantAxis: props.DominantAxis,
			};
			break;
		case "uiflexitem":
			target.flexItem = {
				flexMode: props.FlexMode,
				growRatio: props.GrowRatio,
				itemLineAlignment: props.ItemLineAlignment,
				shrinkRatio: props.ShrinkRatio,
			};
			break;
	}
}

function collectRenderableChildren(
	children: React.ReactNode,
	state: ExtractedModifierState,
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
			if (
				decoratorHost === "uicorner" ||
				decoratorHost === "uiscale" ||
				decoratorHost === "uistroke"
			) {
				collectHoistedModifierState(
					state.appearance,
					decoratorHost,
					child.props as PreviewDomProps,
					computed,
				);
			}
			mergeLayoutModifiers(
				state.layoutModifiers,
				decoratorHost,
				child.props as PreviewDomProps,
			);
			return;
		}

		if (child.type === React.Fragment) {
			const fragmentProps = child.props as { children?: React.ReactNode };
			const fragmentChildren = collectRenderableChildren(
				fragmentProps.children,
				state,
				computed,
			);
			if (fragmentChildren.length > 0) {
				renderableChildren.push(
					React.cloneElement(child, undefined, ...fragmentChildren),
				);
			}
			return;
		}

		renderableChildren.push(child);
	});

	return renderableChildren;
}

export function extractModifierState(
	children: React.ReactNode,
	computed: ComputedRect | null,
): ExtractedModifierState {
	const state: ExtractedModifierState = {
		appearance: {},
		layoutModifiers: {},
		renderableChildren: [],
	};
	state.renderableChildren = collectRenderableChildren(
		children,
		state,
		computed,
	);

	return state;
}

export function applyHoistedModifierStyles(
	style: React.CSSProperties,
	state: HoistedModifierState,
	computed: ComputedRect | null,
	anchorPoint: PreviewDomProps["AnchorPoint"],
): void {
	if (state.cornerRadius) {
		style.borderRadius = resolveCornerRadius(state.cornerRadius, computed);
	}

	if (
		state.scale !== undefined &&
		Number.isFinite(state.scale) &&
		state.scale !== 1
	) {
		style.transform = appendStyleValue(
			style.transform,
			`scale(${state.scale})`,
			" ",
		);
		style.transformOrigin = toTransformOrigin(serializeVector2(anchorPoint));
	}

	if (state.strokeShadow) {
		style.boxShadow = appendStyleValue(
			style.boxShadow,
			state.strokeShadow,
			", ",
		);
	}
}

function createDecoratorHost(displayName: string, host: HostName) {
	const Component = React.forwardRef<HTMLElement, PreviewDomProps>(() => null);

	Component.displayName = displayName;
	(
		Component as typeof Component & {
			[PREVIEW_DECORATOR_HOST_MARKER]?: DecoratorHostName;
		}
	)[PREVIEW_DECORATOR_HOST_MARKER] = host as DecoratorHostName;

	return Component;
}

export const UICorner = createDecoratorHost("PreviewUICorner", "uicorner");
export const UIPadding = createDecoratorHost("PreviewUIPadding", "uipadding");
export const UIListLayout = createDecoratorHost(
	"PreviewUIListLayout",
	"uilistlayout",
);
export const UIGridLayout = createDecoratorHost(
	"PreviewUIGridLayout",
	"uigridlayout",
);
export const UIStroke = createDecoratorHost("PreviewUIStroke", "uistroke");
export const UIScale = createDecoratorHost("PreviewUIScale", "uiscale");
export const UIGradient = createDecoratorHost(
	"PreviewUIGradient",
	"uigradient",
);
export const UIPageLayout = createDecoratorHost(
	"PreviewUIPageLayout",
	"uipagelayout",
);
export const UITableLayout = createDecoratorHost(
	"PreviewUITableLayout",
	"uitablelayout",
);
export const UISizeConstraint = createDecoratorHost(
	"PreviewUISizeConstraint",
	"uisizeconstraint",
);
export const UITextSizeConstraint = createDecoratorHost(
	"PreviewUITextSizeConstraint",
	"uitextsizeconstraint",
);
export const UIAspectRatioConstraint = createDecoratorHost(
	"PreviewUIAspectRatioConstraint",
	"uiaspectratioconstraint",
);
export const UIFlexItem = createDecoratorHost(
	"PreviewUIFlexItem",
	"uiflexitem",
);
