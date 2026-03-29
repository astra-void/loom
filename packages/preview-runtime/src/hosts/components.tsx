import * as React from "react";
import { clampPreviewTextSize, useTextScaleStyle } from "../style/textStyles";
import { domPresentationAdapter } from "./domAdapter";
import { markPreviewHostComponent } from "./hostComponent";
import type { PreviewDomProps } from "./types";
import {
	resolveHostContentRect,
	useHostLayout,
	withNodeParent,
} from "./useHostLayout";

function useMergedRefs<T>(...refs: Array<React.Ref<T> | undefined>) {
	const refsRef = React.useRef(refs);
	refsRef.current = refs;

	return React.useCallback((value: T | null) => {
		for (const ref of refsRef.current) {
			if (!ref) {
				continue;
			}

			if (typeof ref === "function") {
				ref(value);
				continue;
			}

			(ref as React.RefObject<T | null>).current = value;
		}
	}, []);
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
			const { computed, hostNode, nodeId, setElementRef } = useHostLayout(
				host,
				props,
			);
			const mergedRef = useMergedRefs(
				forwardedRef as React.Ref<HTMLElement>,
				setElementRef as React.Ref<HTMLElement>,
			);

			return domPresentationAdapter.render(
				hostNode,
				renderChildren(hostNode, nodeId, computed),
				mergedRef,
			);
		},
	);

	Component.displayName = displayName;
	return markPreviewHostComponent(Component, host);
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

type TextHostName = "textbutton" | "textlabel" | "textbox";

function useTextHostRenderNode(
	hostNode: ReturnType<typeof useHostLayout>["hostNode"],
	patchDomProps: ReturnType<typeof useHostLayout>["patchDomProps"],
	textScaleStyle: React.CSSProperties | undefined,
) {
	return React.useMemo(
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
}

function createTextHost(host: TextHostName, displayName: string) {
	const Component = React.forwardRef<HTMLElement, PreviewDomProps>(
		(props, forwardedRef) => {
			const {
				computed,
				elementRef,
				hostNode,
				nodeId,
				patchDomProps,
				setElementRef,
			} = useHostLayout(host, props);
			const innerRef = elementRef as React.RefObject<HTMLElement | null>;
			const mergedRef = useMergedRefs(
				forwardedRef as React.Ref<HTMLElement>,
				setElementRef as React.Ref<HTMLElement>,
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
			const renderNode = useTextHostRenderNode(
				hostNode,
				patchDomProps,
				textScaleStyle,
			);

			React.useLayoutEffect(() => {
				if (host !== "textbox") {
					return;
				}

				const element = elementRef.current;
				if (!(element instanceof HTMLInputElement)) {
					return;
				}

				const input = element as HTMLInputElement & { Text?: string };
				const nextText = hostNode.presentationHints.text ?? "";
				if (input.value !== nextText) {
					input.value = nextText;
				}
			}, [elementRef, hostNode.presentationHints.text]);

			return domPresentationAdapter.render(
				renderNode,
				renderChildren(hostNode, nodeId, computed),
				mergedRef,
			);
		},
	);

	Component.displayName = displayName;
	return markPreviewHostComponent(Component, host);
}

export const Frame = createSimpleHost("frame", "PreviewFrame");

export const TextButton = createTextHost("textbutton", "PreviewTextButton");

export const ImageButton = React.forwardRef<HTMLElement, PreviewDomProps>(
	(props, forwardedRef) => {
		const { computed, hostNode, nodeId, setElementRef } = useHostLayout(
			"imagebutton",
			props,
		);
		const mergedRef = useMergedRefs(
			forwardedRef as React.Ref<HTMLButtonElement>,
			setElementRef as React.Ref<HTMLButtonElement>,
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

export const TextLabel = createTextHost("textlabel", "PreviewTextLabel");

export const TextBox = createTextHost("textbox", "PreviewTextBox");

export const ImageLabel = React.forwardRef<HTMLElement, PreviewDomProps>(
	(props, forwardedRef) => {
		const { computed, hostNode, nodeId, setElementRef } = useHostLayout(
			"imagelabel",
			props,
		);
		const mergedRef = useMergedRefs(
			forwardedRef as React.Ref<HTMLImageElement>,
			setElementRef as React.Ref<HTMLImageElement>,
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
