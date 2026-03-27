import type * as React from "react";
import { PREVIEW_HOST_DATA_ATTRIBUTE } from "../internal/previewAttributes";
import type { ComputedRect } from "../layout/model";
import { toCssColor } from "../runtime/helpers";
import { mapRobloxFont } from "../style/textStyles";
import type {
	ForwardedDomProps,
	HostName,
	PreviewDomProps,
	PreviewEventTable,
} from "./types";

const DOM_PROP_NAMES = new Set([
	"children",
	"className",
	"defaultValue",
	"id",
	"onBlur",
	"onChange",
	"onClick",
	"onFocus",
	"onInput",
	"onKeyDown",
	"onKeyUp",
	"onMouseDown",
	"onMouseEnter",
	"onMouseLeave",
	"onPointerDown",
	"onPointerMove",
	"onPointerUp",
	"placeholder",
	"role",
	"style",
	"tabIndex",
	"title",
	"value",
]);

const PREVIEW_ONLY_PROP_NAMES = new Set([
	"Active",
	"AnchorPoint",
	"AutoButtonColor",
	"AspectRatio",
	"AutomaticSize",
	"BackgroundColor3",
	"BackgroundTransparency",
	"BorderSizePixel",
	"CellPadding",
	"CellSize",
	"CanvasSize",
	"Change",
	"Color",
	"CornerRadius",
	"DominantAxis",
	"Event",
	"FillDirection",
	"FillDirectionMaxCells",
	"Font",
	"FlexMode",
	"GrowRatio",
	"HorizontalAlignment",
	"HorizontalFlex",
	"Id",
	"Image",
	"ImageColor3",
	"ImageTransparency",
	"ItemLineAlignment",
	"LayoutOrder",
	"MaxSize",
	"MaxTextSize",
	"MinSize",
	"MinTextSize",
	"Modal",
	"Name",
	"Padding",
	"PaddingBottom",
	"PaddingBetweenItems",
	"PaddingLeft",
	"PaddingRight",
	"PaddingTop",
	"ParentId",
	"PlaceholderText",
	"Position",
	"Scale",
	"ScrollBarThickness",
	"ScrollingDirection",
	"Selectable",
	"ShrinkRatio",
	"Size",
	"SortOrder",
	"StartCorner",
	"Text",
	"TextColor3",
	"TextEditable",
	"TextScaled",
	"TextSize",
	"TextTransparency",
	"TextWrapped",
	"TextXAlignment",
	"TextYAlignment",
	"Thickness",
	"Transparency",
	"VerticalAlignment",
	"VerticalFlex",
	"Visible",
	"Wraps",
	"ZIndex",
	"__previewReactChangeText",
	"__previewReactEventActivated",
	"__previewReactEventFocusLost",
	"__previewReactEventInputBegan",
]);

const PREVIEW_REACT_EVENT_PROP_KEYS = {
	Activated: "__previewReactEventActivated",
	FocusLost: "__previewReactEventFocusLost",
	InputBegan: "__previewReactEventInputBegan",
} as const;

const PREVIEW_REACT_CHANGE_PROP_KEYS = {
	Text: "__previewReactChangeText",
} as const;

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

function sanitizePreviewDomProps(props: PreviewDomProps): PreviewDomProps {
	const sanitized: Record<string, unknown> = {};

	for (const key of Object.keys(props) as Array<keyof PreviewDomProps>) {
		try {
			sanitized[key] = props[key];
		} catch {
			// Ignore preview prop getters that throw during DOM prop normalization.
		}
	}

	return sanitized as PreviewDomProps;
}

function normalizePreviewKeyCode(key: string): string {
	switch (key) {
		case "Return":
			return "Enter";
		case "Space":
		case "Spacebar":
			return " ";
		default:
			return key;
	}
}

function toPreviewInputPosition(event: MouseEvent | PointerEvent) {
	return {
		X: event.clientX,
		Y: event.clientY,
	};
}

function toPreviewInputObject(
	event: KeyboardEvent | MouseEvent | PointerEvent,
): Record<string, unknown> {
	if (event instanceof KeyboardEvent) {
		return {
			KeyCode: normalizePreviewKeyCode(event.key),
			UserInputType: "Keyboard",
		};
	}

	if (event instanceof PointerEvent) {
		return {
			Position: toPreviewInputPosition(event),
			UserInputType: event.pointerType === "touch" ? "Touch" : "MouseButton1",
		};
	}

	return {
		Position: toPreviewInputPosition(event),
		UserInputType: "MouseButton1",
	};
}

function createPreviewGuiObject(element: HTMLElement, host: HostName) {
	const rect = element.getBoundingClientRect();

	return {
		AbsolutePosition: {
			X: rect.left,
			Y: rect.top,
		},
		AbsoluteSize: {
			X: rect.width,
			Y: rect.height,
		},
		AutoButtonColor: true,
		IsA(name: string) {
			switch (name) {
				case "Instance":
				case "GuiObject":
					return true;
				case "GuiButton":
					return host === "textbutton" || host === "imagebutton";
				case "TextBox":
					return host === "textbox";
				default:
					return false;
			}
		},
		Text:
			element instanceof HTMLInputElement
				? element.value
				: (element.textContent ?? ""),
	};
}

export type ResolveOptions = {
	applyComputedLayout?: boolean;
	computed: ComputedRect | null;
	host: HostName;
	nodeId: string;
};

export type ResolvedPreviewDomProps = {
	children: React.ReactNode;
	disabled: boolean;
	domProps: ForwardedDomProps & Record<string, unknown>;
	image: unknown;
	text: string | undefined;
};

function mergeHandlers<T>(a?: (event: T) => void, b?: (event: T) => void) {
	if (!a) {
		return b;
	}

	if (!b) {
		return a;
	}

	return (event: T) => {
		a(event);
		b(event);
	};
}

function toTextAlign(value: string | undefined): "center" | "left" | "right" {
	switch (value) {
		case "center":
			return "center";
		case "right":
			return "right";
		default:
			return "left";
	}
}

function toJustifyContent(
	value: string | undefined,
): "center" | "flex-end" | "flex-start" {
	switch (value) {
		case "center":
			return "center";
		case "bottom":
			return "flex-end";
		default:
			return "flex-start";
	}
}

function pickForwardedDomProps(props: PreviewDomProps): ForwardedDomProps {
	const domProps: Record<string, unknown> = {};

	for (const [key, value] of Object.entries(props)) {
		if (PREVIEW_ONLY_PROP_NAMES.has(key)) {
			continue;
		}

		if (
			key.startsWith("aria-") ||
			key.startsWith("data-") ||
			DOM_PROP_NAMES.has(key)
		) {
			domProps[key] = value;
		}
	}

	return domProps as ForwardedDomProps;
}

function coerceTextValue(value: unknown): string | undefined {
	if (value === undefined || value === null) {
		return undefined;
	}

	return String(value);
}

export function applyComputedLayoutStyle(
	style: React.CSSProperties,
	computed: ComputedRect | null,
): void {
	delete style.left;
	delete style.top;
	delete style.width;
	delete style.height;
	delete style.transform;
	delete style.translate;

	style.position = "absolute";

	if (!computed) {
		style.visibility = "hidden";
		return;
	}

	style.visibility = "visible";
	style.left = `${computed.x}px`;
	style.top = `${computed.y}px`;
	style.width = `${computed.width}px`;
	style.height = `${computed.height}px`;
}

export function resolvePreviewDomProps(
	props: PreviewDomProps,
	options: ResolveOptions,
): ResolvedPreviewDomProps {
	const safeProps = sanitizePreviewDomProps(props);
	const {
		Active,
		AnchorPoint,
		AutoButtonColor,
		BackgroundColor3,
		BackgroundTransparency,
		BorderSizePixel,
		Change,
		Color,
		CornerRadius,
		Event,
		Font,
		Id,
		Image,
		ImageColor3,
		ImageTransparency,
		Modal,
		Name,
		ParentId,
		PlaceholderText,
		Position,
		Scale,
		Selectable,
		Size,
		Text,
		TextColor3,
		TextEditable,
		TextScaled,
		TextSize,
		TextTransparency,
		TextWrapped,
		TextXAlignment,
		TextYAlignment,
		Thickness,
		Transparency,
		Visible,
		ZIndex,
		children,
		className,
		onBlur,
		onChange,
		onClick,
		onKeyDown,
		onPointerDown,
		style,
		[PREVIEW_REACT_CHANGE_PROP_KEYS.Text]: previewReactChangeText,
		[PREVIEW_REACT_EVENT_PROP_KEYS.Activated]: previewReactActivated,
		[PREVIEW_REACT_EVENT_PROP_KEYS.FocusLost]: previewReactFocusLost,
		[PREVIEW_REACT_EVENT_PROP_KEYS.InputBegan]: previewReactInputBegan,
		...rest
	} = safeProps;

	void Active;
	void AnchorPoint;
	void AutoButtonColor;
	void Color;
	void CornerRadius;
	void Font;
	void Id;
	void ImageColor3;
	void ImageTransparency;
	void Modal;
	void Name;
	void ParentId;
	void Position;
	void Scale;
	void Size;
	void TextScaled;
	void TextTransparency;
	void Thickness;
	void Transparency;

	const forwarded = pickForwardedDomProps(rest);
	const computedStyle: React.CSSProperties = {
		...(style ?? {}),
	};

	if (options.applyComputedLayout !== false) {
		applyComputedLayoutStyle(computedStyle, options.computed);
	}

	computedStyle.boxSizing = computedStyle.boxSizing ?? "border-box";
	computedStyle.flexShrink = computedStyle.flexShrink ?? 0;
	computedStyle.margin = computedStyle.margin ?? 0;
	computedStyle.minHeight = computedStyle.minHeight ?? 0;
	computedStyle.minWidth = computedStyle.minWidth ?? 0;
	computedStyle.padding = computedStyle.padding ?? 0;

	if (Visible === false) {
		computedStyle.display = "none";
	}

	if (ZIndex !== undefined) {
		computedStyle.zIndex = ZIndex;
	}

	if (BackgroundColor3) {
		computedStyle.backgroundColor = toCssColor(
			BackgroundColor3,
			BackgroundTransparency,
		);
	} else if (BackgroundTransparency === 1) {
		computedStyle.backgroundColor = "transparent";
	}

	if (TextColor3) {
		computedStyle.color = toCssColor(TextColor3);
	}

	const fontStyle = mapRobloxFont(Font);
	if (fontStyle.fontFamily) {
		computedStyle.fontFamily = fontStyle.fontFamily;
	}
	if (fontStyle.fontStyle) {
		computedStyle.fontStyle = fontStyle.fontStyle;
	}
	if (fontStyle.fontWeight) {
		computedStyle.fontWeight = fontStyle.fontWeight;
	}

	if (TextSize !== undefined) {
		computedStyle.fontSize = `${TextSize}px`;
		computedStyle.lineHeight = 1.2;
	}

	if (BorderSizePixel === 0) {
		computedStyle.border = "none";
	} else if (BorderSizePixel !== undefined) {
		computedStyle.borderColor = "transparent";
		computedStyle.borderStyle = "solid";
		computedStyle.borderWidth = `${BorderSizePixel}px`;
	}

	if (TextWrapped) {
		computedStyle.whiteSpace = "pre-wrap";
		computedStyle.overflowWrap = "break-word";
	} else if (
		options.host === "textbutton" ||
		options.host === "textlabel" ||
		options.host === "textbox" ||
		options.host === "imagebutton"
	) {
		computedStyle.whiteSpace = "pre";
	}

	if (options.host === "textbutton" || options.host === "textlabel") {
		computedStyle.display = computedStyle.display === "none" ? "none" : "flex";
		computedStyle.flexDirection = "column";
		computedStyle.justifyContent = toJustifyContent(TextYAlignment);
		computedStyle.textAlign = toTextAlign(TextXAlignment);
	}

	if (options.host === "textbox") {
		computedStyle.textAlign = toTextAlign(TextXAlignment);
	}

	if (
		options.host === "textbutton" ||
		options.host === "textbox" ||
		options.host === "imagebutton"
	) {
		computedStyle.appearance = computedStyle.appearance ?? "none";
		computedStyle.backgroundClip =
			computedStyle.backgroundClip ?? "padding-box";
	}

	if (options.host === "imagelabel") {
		computedStyle.objectFit = "cover";
	}

	if (options.host === "imagebutton") {
		computedStyle.overflow = computedStyle.overflow ?? "hidden";
	}

	if (options.host === "scrollingframe") {
		computedStyle.overflow = "auto";
	}

	const activatedHandler =
		typeof previewReactActivated === "function"
			? previewReactActivated
			: getEventHandler(Event, "Activated");
	const focusLostHandler =
		typeof previewReactFocusLost === "function"
			? previewReactFocusLost
			: getEventHandler(Event, "FocusLost");
	const inputBeganHandler =
		typeof previewReactInputBegan === "function"
			? previewReactInputBegan
			: getEventHandler(Event, "InputBegan");
	const mergedClick = mergeHandlers<React.MouseEvent<HTMLElement>>(
		onClick,
		activatedHandler
			? (event) => {
					activatedHandler(
						createPreviewGuiObject(event.currentTarget, options.host),
					);
				}
			: undefined,
	);
	const mergedBlur = mergeHandlers<React.FocusEvent<HTMLElement>>(
		onBlur,
		focusLostHandler
			? (event) => {
					focusLostHandler(
						createPreviewGuiObject(event.currentTarget, options.host),
					);
				}
			: undefined,
	);
	const mergedKeyDown = mergeHandlers<React.KeyboardEvent<HTMLElement>>(
		onKeyDown,
		inputBeganHandler
			? (event) => {
					inputBeganHandler(
						createPreviewGuiObject(event.currentTarget, options.host),
						toPreviewInputObject(event.nativeEvent),
					);
				}
			: undefined,
	);
	const mergedPointerDown = mergeHandlers<React.PointerEvent<HTMLElement>>(
		onPointerDown,
		inputBeganHandler
			? (event) => {
					inputBeganHandler(
						createPreviewGuiObject(event.currentTarget, options.host),
						toPreviewInputObject(event.nativeEvent),
					);
				}
			: undefined,
	);
	const mergedChange = mergeHandlers<React.ChangeEvent<HTMLElement>>(
		onChange as ((event: React.ChangeEvent<HTMLElement>) => void) | undefined,
		typeof previewReactChangeText === "function"
			? (event) => {
					if (event.target instanceof HTMLInputElement) {
						previewReactChangeText(event.target);
					}
				}
			: Change?.Text
				? (event) => {
						if (event.target instanceof HTMLInputElement) {
							Change.Text?.(event.target);
						}
					}
				: undefined,
	);

	return {
		children,
		disabled:
			options.host === "textbutton" || options.host === "imagebutton"
				? props.Active === false
				: TextEditable === false,
		domProps: {
			...forwarded,
			[PREVIEW_HOST_DATA_ATTRIBUTE]: options.host,
			"data-preview-node-id": options.nodeId,
			className: ["preview-host", `preview-${options.host}`, className]
				.filter(Boolean)
				.join(" "),
			onBlur: mergedBlur,
			onChange: mergedChange,
			onClick: mergedClick,
			onKeyDown: mergedKeyDown,
			onPointerDown: mergedPointerDown,
			placeholder: PlaceholderText,
			style: computedStyle,
			tabIndex:
				Selectable === false ? -1 : (forwarded.tabIndex as number | undefined),
		},
		image: Image,
		text: coerceTextValue(Text),
	};
}
