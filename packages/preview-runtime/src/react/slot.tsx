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
type PreviewChangeTable = NonNullable<PreviewDomProps["Change"]>;

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

function getChangeHandler(
	changeTable: PreviewChangeTable | undefined,
	key: keyof PreviewChangeTable,
) {
	try {
		const handler = changeTable?.[key];
		return typeof handler === "function" ? handler : undefined;
	} catch {
		return undefined;
	}
}

function mergeChangeTables(
	slotChange?: PreviewChangeTable,
	childChange?: PreviewChangeTable,
) {
	const text = (() => {
		const childText = getChangeHandler(childChange, "Text");
		const slotText = getChangeHandler(slotChange, "Text");

		if (childText && slotText) {
			return (element: HTMLInputElement) => {
				childText(element);
				slotText(element);
			};
		}

		return childText ?? slotText;
	})();

	if (!text) {
		return undefined;
	}

	return {
		...(text ? { Text: text } : {}),
	} satisfies PreviewChangeTable;
}

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

			(ref as React.MutableRefObject<T | null>).current = value;
		}
	}, []);
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
		const child = React.isValidElement(props.children)
			? (props.children as React.ReactElement<
					PreviewDomProps & Record<string, unknown>
				>)
			: null;
		const childRef = child
			? ((child as React.ReactElement & { ref?: React.Ref<unknown> }).ref ??
				undefined)
			: undefined;
		const mergedRef = useMergedRefs(
			childRef,
			forwardedRef as React.Ref<unknown>,
		);
		if (!child) {
			return null;
		}

		const slotProps = sanitizePreviewDomProps(props);
		const childProps = sanitizePreviewDomProps(
			(child.props ?? {}) as PreviewDomProps,
		);
		const slotEvent =
			(slotProps.Event as PreviewEventTable | undefined) ?? EMPTY_EVENT_TABLE;
		const childEvent =
			(childProps.Event as PreviewEventTable | undefined) ?? EMPTY_EVENT_TABLE;
		const slotHost = resolvePreviewSlotHost(child.type);
		const slotRenderType = getSlotRenderType(child.type);
		const slotChange =
			(slotProps.Change as PreviewChangeTable | undefined) ?? undefined;
		const childChange =
			(childProps.Change as PreviewChangeTable | undefined) ?? undefined;

		const mergedProps: PreviewDomProps = {
			...slotProps,
			...childProps,
		};

		mergedProps.children = childProps.children;
		mergedProps.Event = mergeEventTables(slotEvent, childEvent);
		mergedProps.Change = mergeChangeTables(slotChange, childChange);

		const normalized = resolvePreviewDomProps(mergedProps, {
			applyComputedLayout: false,
			computed: null,
			host: slotHost,
			nodeId: `slot:${slotNodeId}`,
		});

		const clonedProps: Record<string, unknown> = {
			...normalized.domProps,
			ref: mergedRef,
			children: React.Children.toArray([
				normalized.text ? (
					<span key="preview-slot-text" className="preview-host-text">
						{normalized.text}
					</span>
				) : null,
				normalized.children,
			]),
		};
		clonedProps.Change = undefined;
		clonedProps.Event = undefined;
		clonedProps.__previewReactChangeText = undefined;
		clonedProps.__previewReactEventActivated = undefined;
		clonedProps.__previewReactEventFocusLost = undefined;
		clonedProps.__previewReactEventInputBegan = undefined;

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
