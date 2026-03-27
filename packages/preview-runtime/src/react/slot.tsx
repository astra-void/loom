import * as React from "react";
import {
	BillboardGui,
	CanvasGroup,
	Frame,
	ImageButton,
	ImageLabel,
	ScreenGui,
	ScrollingFrame,
	SurfaceGui,
	TextBox,
	TextButton,
	TextLabel,
	VideoFrame,
	ViewportFrame,
} from "../hosts/components";
import { resolvePreviewDomProps } from "../hosts/resolveProps";
import type { PreviewDomProps, PreviewEventTable } from "../hosts/types";
import { resolvePreviewSlotHost } from "./slotHost";

type SlotProps = PreviewDomProps & {
	children?: React.ReactNode;
};

const previewIntrinsicHostComponents = {
	billboardgui: BillboardGui,
	canvasgroup: CanvasGroup,
	frame: Frame,
	imagebutton: ImageButton,
	imagelabel: ImageLabel,
	scrollingframe: ScrollingFrame,
	screengui: ScreenGui,
	surfacegui: SurfaceGui,
	textbox: TextBox,
	textbutton: TextButton,
	textlabel: TextLabel,
	videoframe: VideoFrame,
	viewportframe: ViewportFrame,
} as const satisfies Partial<
	Record<string, React.ElementType<PreviewDomProps>>
>;

function isPreviewIntrinsicHostComponentKey(
	value: string,
): value is keyof typeof previewIntrinsicHostComponents {
	return value in previewIntrinsicHostComponents;
}

function mergeEventTables(
	slotEvent?: PreviewEventTable,
	childEvent?: PreviewEventTable,
) {
	const activated = (() => {
		const childActivated = childEvent?.Activated;
		const slotActivated = slotEvent?.Activated;

		if (childActivated && slotActivated) {
			return (event: Event) => {
				childActivated(event);
				slotActivated(event);
			};
		}

		return childActivated ?? slotActivated;
	})();

	const focusLost = (() => {
		const childFocusLost = childEvent?.FocusLost;
		const slotFocusLost = slotEvent?.FocusLost;

		if (childFocusLost && slotFocusLost) {
			return (event: Event) => {
				childFocusLost(event);
				slotFocusLost(event);
			};
		}

		return childFocusLost ?? slotFocusLost;
	})();

	if (!activated && !focusLost) {
		return undefined;
	}

	return {
		...(activated ? { Activated: activated } : {}),
		...(focusLost ? { FocusLost: focusLost } : {}),
	} satisfies PreviewEventTable;
}

function getSlotRenderType(
	childType: unknown,
): React.ElementType<Record<string, unknown>> | unknown {
	if (typeof childType !== "string") {
		return childType;
	}

	return isPreviewIntrinsicHostComponentKey(childType)
		? previewIntrinsicHostComponents[childType]
		: childType;
}

export const Slot = React.forwardRef<HTMLElement, SlotProps>(
	(props, forwardedRef) => {
		const slotNodeId = React.useId();
		if (!React.isValidElement(props.children)) {
			return null;
		}

		const child = props.children as React.ReactElement<
			PreviewDomProps & Record<string, unknown>
		>;
		const childProps = (child.props ?? {}) as PreviewDomProps;
		const slotEvent = props.Event as PreviewEventTable | undefined;
		const childEvent = childProps.Event as PreviewEventTable | undefined;
		const slotHost = resolvePreviewSlotHost(child.type);
		const slotRenderType = getSlotRenderType(child.type);

		const mergedProps: PreviewDomProps = {
			...props,
			...childProps,
		};

		mergedProps.children = childProps.children;
		mergedProps.Event = mergeEventTables(slotEvent, childEvent);

		const normalized = resolvePreviewDomProps(mergedProps, {
			applyComputedLayout: false,
			computed: null,
			host: slotHost,
			nodeId: `slot:${slotNodeId}`,
		});

		const clonedProps: Record<string, unknown> = {
			...normalized.domProps,
			ref: forwardedRef as React.Ref<unknown>,
			children: React.Children.toArray([
				normalized.text ? (
					<span key="preview-slot-text" className="preview-host-text">
						{normalized.text}
					</span>
				) : null,
				normalized.children,
			]),
		};
		if (typeof child.type !== "string") {
			clonedProps.Event = undefined;
		}

		if (slotRenderType !== child.type) {
			return React.createElement(
				slotRenderType as React.ElementType<Record<string, unknown>>,
				clonedProps,
			);
		}

		return React.cloneElement(child, clonedProps);
	},
);
Slot.displayName = "PreviewSlot";
