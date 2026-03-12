import * as React from "react";
import { clampPreviewTextSize, useTextScaleStyle } from "../style/textStyles";
import { domPresentationAdapter } from "./domAdapter";
import type { PreviewDomProps } from "./types";
import {
	resolveHostContentRect,
	useHostLayout,
	withNodeParent,
} from "./useHostLayout";

function useMergedRefs<T>(...refs: Array<React.Ref<T> | undefined>) {
	return React.useCallback(
		(value: T | null) => {
			for (const ref of refs) {
				if (!ref) {
					continue;
				}

				if (typeof ref === "function") {
					ref(value);
					continue;
				}

				(ref as React.MutableRefObject<T | null>).current = value;
			}
		},
		[refs],
	);
}

function renderChildren(
	hostNode: ReturnType<typeof useHostLayout>["hostNode"],
	nodeId: string,
	rect: ReturnType<typeof useHostLayout>["computed"],
) {
	return withNodeParent(
		nodeId,
		rect,
		resolveHostContentRect(rect, hostNode.layoutModifiers),
		hostNode.renderChildren,
	);
}

function createSimpleHost(
	host: Parameters<typeof useHostLayout>[0],
	displayName: string,
) {
	const Component = React.forwardRef<HTMLElement, PreviewDomProps>(
		(props, forwardedRef) => {
			const { computed, elementRef, hostNode, nodeId } = useHostLayout(
				host,
				props,
			);
			const mergedRef = useMergedRefs(
				forwardedRef as React.Ref<HTMLElement>,
				elementRef as React.Ref<HTMLElement>,
			);

			return domPresentationAdapter.render(
				hostNode,
				renderChildren(hostNode, nodeId, computed),
				mergedRef,
			);
		},
	);

	Component.displayName = displayName;
	return Component;
}

function withConstrainedTextStyle(
	style: React.CSSProperties | undefined,
	constraints:
		| {
				maxTextSize?: number;
				minTextSize?: number;
		  }
		| undefined,
) {
	if (!style || !constraints) {
		return style;
	}

	const nextStyle = {
		...style,
	};
	const currentFontSize =
		typeof nextStyle.fontSize === "number"
			? nextStyle.fontSize
			: typeof nextStyle.fontSize === "string"
				? Number.parseFloat(nextStyle.fontSize)
				: undefined;
	const constrainedFontSize = clampPreviewTextSize(
		currentFontSize,
		constraints,
	);
	if (constrainedFontSize !== undefined) {
		nextStyle.fontSize = `${constrainedFontSize}px`;
	}

	return nextStyle;
}

export const Frame = createSimpleHost("frame", "PreviewFrame");

export const TextButton = React.forwardRef<HTMLElement, PreviewDomProps>(
	(props, forwardedRef) => {
		const { computed, elementRef, hostNode, nodeId, patchDomProps } =
			useHostLayout("textbutton", props);
		const innerRef = elementRef as React.RefObject<HTMLButtonElement | null>;
		const mergedRef = useMergedRefs(
			forwardedRef as React.Ref<HTMLButtonElement>,
			innerRef as React.Ref<HTMLButtonElement>,
		);
		const textScaleStyle = useTextScaleStyle({
			elementRef: innerRef,
			enabled: props.TextScaled === true,
			fontFamily: hostNode.presentationHints.domProps.style?.fontFamily as
				| string
				| undefined,
			fontStyle: hostNode.presentationHints.domProps.style?.fontStyle as
				| React.CSSProperties["fontStyle"]
				| undefined,
			fontWeight: hostNode.presentationHints.domProps.style?.fontWeight as
				| React.CSSProperties["fontWeight"]
				| undefined,
			lineHeight: hostNode.presentationHints.domProps.style?.lineHeight,
			maxTextSize: hostNode.layoutModifiers?.textSizeConstraint?.maxTextSize,
			minTextSize: hostNode.layoutModifiers?.textSizeConstraint?.minTextSize,
			text: hostNode.presentationHints.text,
			wrapped: props.TextWrapped === true,
		});
		const renderNode = React.useMemo(
			() =>
				patchDomProps({
					...hostNode.presentationHints.domProps,
					style: withConstrainedTextStyle(
						{
							...(hostNode.presentationHints.domProps.style as
								| React.CSSProperties
								| undefined),
							...(textScaleStyle ?? {}),
						},
						hostNode.layoutModifiers?.textSizeConstraint,
					),
				}),
			[
				hostNode.layoutModifiers?.textSizeConstraint,
				hostNode.presentationHints.domProps,
				patchDomProps,
				textScaleStyle,
			],
		);

		return domPresentationAdapter.render(
			renderNode,
			renderChildren(hostNode, nodeId, computed),
			mergedRef,
		);
	},
);
TextButton.displayName = "PreviewTextButton";

export const ImageButton = React.forwardRef<HTMLElement, PreviewDomProps>(
	(props, forwardedRef) => {
		const { computed, elementRef, hostNode, nodeId } = useHostLayout(
			"imagebutton",
			props,
		);
		const mergedRef = useMergedRefs(
			forwardedRef as React.Ref<HTMLButtonElement>,
			elementRef as React.Ref<HTMLButtonElement>,
		);

		return domPresentationAdapter.render(
			hostNode,
			renderChildren(hostNode, nodeId, computed),
			mergedRef,
		);
	},
);
ImageButton.displayName = "PreviewImageButton";

export const ScreenGui = createSimpleHost("screengui", "PreviewScreenGui");
export const SurfaceGui = createSimpleHost("surfacegui", "PreviewSurfaceGui");
export const BillboardGui = createSimpleHost(
	"billboardgui",
	"PreviewBillboardGui",
);

export const TextLabel = React.forwardRef<HTMLElement, PreviewDomProps>(
	(props, forwardedRef) => {
		const { computed, elementRef, hostNode, nodeId, patchDomProps } =
			useHostLayout("textlabel", props);
		const innerRef = elementRef as React.RefObject<HTMLDivElement | null>;
		const mergedRef = useMergedRefs(
			forwardedRef as React.Ref<HTMLDivElement>,
			innerRef as React.Ref<HTMLDivElement>,
		);
		const textScaleStyle = useTextScaleStyle({
			elementRef: innerRef,
			enabled: props.TextScaled === true,
			fontFamily: hostNode.presentationHints.domProps.style?.fontFamily as
				| string
				| undefined,
			fontStyle: hostNode.presentationHints.domProps.style?.fontStyle as
				| React.CSSProperties["fontStyle"]
				| undefined,
			fontWeight: hostNode.presentationHints.domProps.style?.fontWeight as
				| React.CSSProperties["fontWeight"]
				| undefined,
			lineHeight: hostNode.presentationHints.domProps.style?.lineHeight,
			maxTextSize: hostNode.layoutModifiers?.textSizeConstraint?.maxTextSize,
			minTextSize: hostNode.layoutModifiers?.textSizeConstraint?.minTextSize,
			text: hostNode.presentationHints.text,
			wrapped: props.TextWrapped === true,
		});
		const renderNode = React.useMemo(
			() =>
				patchDomProps({
					...hostNode.presentationHints.domProps,
					style: withConstrainedTextStyle(
						{
							...(hostNode.presentationHints.domProps.style as
								| React.CSSProperties
								| undefined),
							...(textScaleStyle ?? {}),
						},
						hostNode.layoutModifiers?.textSizeConstraint,
					),
				}),
			[
				hostNode.layoutModifiers?.textSizeConstraint,
				hostNode.presentationHints.domProps,
				patchDomProps,
				textScaleStyle,
			],
		);

		return domPresentationAdapter.render(
			renderNode,
			renderChildren(hostNode, nodeId, computed),
			mergedRef,
		);
	},
);
TextLabel.displayName = "PreviewTextLabel";

export const TextBox = React.forwardRef<HTMLElement, PreviewDomProps>(
	(props, forwardedRef) => {
		const { computed, elementRef, hostNode, nodeId, patchDomProps } =
			useHostLayout("textbox", props);
		const innerRef = elementRef as React.RefObject<HTMLInputElement | null>;
		const mergedRef = useMergedRefs(
			forwardedRef as React.Ref<HTMLInputElement>,
			innerRef as React.Ref<HTMLInputElement>,
		);
		const textScaleStyle = useTextScaleStyle({
			elementRef: innerRef,
			enabled: props.TextScaled === true,
			fontFamily: hostNode.presentationHints.domProps.style?.fontFamily as
				| string
				| undefined,
			fontStyle: hostNode.presentationHints.domProps.style?.fontStyle as
				| React.CSSProperties["fontStyle"]
				| undefined,
			fontWeight: hostNode.presentationHints.domProps.style?.fontWeight as
				| React.CSSProperties["fontWeight"]
				| undefined,
			lineHeight: hostNode.presentationHints.domProps.style?.lineHeight,
			maxTextSize: hostNode.layoutModifiers?.textSizeConstraint?.maxTextSize,
			minTextSize: hostNode.layoutModifiers?.textSizeConstraint?.minTextSize,
			text: hostNode.presentationHints.text,
			wrapped: props.TextWrapped === true,
		});
		const renderNode = React.useMemo(
			() =>
				patchDomProps({
					...hostNode.presentationHints.domProps,
					style: withConstrainedTextStyle(
						{
							...(hostNode.presentationHints.domProps.style as
								| React.CSSProperties
								| undefined),
							...(textScaleStyle ?? {}),
						},
						hostNode.layoutModifiers?.textSizeConstraint,
					),
				}),
			[
				hostNode.layoutModifiers?.textSizeConstraint,
				hostNode.presentationHints.domProps,
				patchDomProps,
				textScaleStyle,
			],
		);

		return domPresentationAdapter.render(
			renderNode,
			renderChildren(hostNode, nodeId, computed),
			mergedRef,
		);
	},
);
TextBox.displayName = "PreviewTextBox";

export const ImageLabel = React.forwardRef<HTMLElement, PreviewDomProps>(
	(props, forwardedRef) => {
		const { computed, elementRef, hostNode, nodeId } = useHostLayout(
			"imagelabel",
			props,
		);
		const mergedRef = useMergedRefs(
			forwardedRef as React.Ref<HTMLImageElement>,
			elementRef as React.Ref<HTMLImageElement>,
		);

		return domPresentationAdapter.render(
			hostNode,
			renderChildren(hostNode, nodeId, computed),
			mergedRef,
		);
	},
);
ImageLabel.displayName = "PreviewImageLabel";

export const ScrollingFrame = createSimpleHost(
	"scrollingframe",
	"PreviewScrollingFrame",
);
export const CanvasGroup = createSimpleHost(
	"canvasgroup",
	"PreviewCanvasGroup",
);
export const ViewportFrame = createSimpleHost(
	"viewportframe",
	"PreviewViewportFrame",
);
export const VideoFrame = createSimpleHost("videoframe", "PreviewVideoFrame");
