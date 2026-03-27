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

const EMPTY_EVENT_TABLE = Object.freeze({}) as PreviewEventTable;

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

function sanitizePreviewDomProps(
	props: PreviewDomProps | undefined,
): PreviewDomProps {
	const sanitized: Record<string, unknown> = {};

	if (!props) {
		return sanitized as PreviewDomProps;
	}

	for (const key of Object.keys(props) as Array<keyof PreviewDomProps>) {
		try {
			sanitized[key] = props[key];
		} catch {
			// Ignore proxy-backed getters that explode when preview reads Event-like props.
		}
	}

	return sanitized as PreviewDomProps;
}

function getEventHandler(
	eventTable: PreviewEventTable | undefined,
	key: keyof PreviewEventTable,
) {
	try {
		const handler = eventTable?.[key];
		return typeof handler === "function" ? handler : undefined;
	} catch {
		return undefined;
	}
}

function mergeEventTables(
	slotEvent?: PreviewEventTable,
	childEvent?: PreviewEventTable,
) {
	const activated = (() => {
		const childActivated = getEventHandler(childEvent, "Activated");
		const slotActivated = getEventHandler(slotEvent, "Activated");

		if (childActivated && slotActivated) {
			return (event: unknown) => {
				childActivated(event);
				slotActivated(event);
			};
		}

		return childActivated ?? slotActivated;
	})();

	const focusLost = (() => {
		const childFocusLost = getEventHandler(childEvent, "FocusLost");
		const slotFocusLost = getEventHandler(slotEvent, "FocusLost");

		if (childFocusLost && slotFocusLost) {
			return (event: unknown) => {
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

		const slotProps = sanitizePreviewDomProps(props);
		const child = props.children as React.ReactElement<
			PreviewDomProps & Record<string, unknown>
		>;
		const childProps = sanitizePreviewDomProps(
			(child.props ?? {}) as PreviewDomProps,
		);
		const slotEvent =
			(slotProps.Event as PreviewEventTable | undefined) ?? EMPTY_EVENT_TABLE;
		const childEvent =
			(childProps.Event as PreviewEventTable | undefined) ?? EMPTY_EVENT_TABLE;
		const slotHost = resolvePreviewSlotHost(child.type);
		const slotRenderType = getSlotRenderType(child.type);

		const mergedProps: PreviewDomProps = {
			...slotProps,
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
