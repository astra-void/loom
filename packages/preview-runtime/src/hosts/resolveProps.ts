import type * as React from "react";
import { PREVIEW_HOST_DATA_ATTRIBUTE } from "../internal/previewAttributes";
import { serializeUDim2 } from "../internal/robloxValues";
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
	"ClipsDescendants",
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
	"GroupTransparency",
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
	"Rotation",
	"Scale",
	"ScrollBarThickness",
	"ScrollingDirection",
	"Selectable",
	"ShrinkRatio",
	"Size",
	"SizeConstraint",
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

const DEFAULT_GUI_OBJECT_Z_INDEX = 1;
const layerCollectorHostNames = new Set<HostName>([
	"billboardgui",
	"screengui",
	"surfacegui",
]);
const pointerInteractiveHostNames = new Set<HostName>([
	"imagebutton",
	"textbox",
	"textbutton",
]);

type PreviewLayerDiagnosticsGlobal = typeof globalThis & {
	__loomPreviewLayerDiagnostics?: boolean;
};

function shouldLogPreviewLayerDiagnostics() {
	return (
		(globalThis as PreviewLayerDiagnosticsGlobal)
			.__loomPreviewLayerDiagnostics === true
	);
}

function logPreviewLayerDiagnostics(input: {
	domZIndex?: React.CSSProperties["zIndex"];
	host: HostName;
	nodeId: string;
	pointerEvents?: React.CSSProperties["pointerEvents"];
	propZIndex?: number;
}) {
	if (!shouldLogPreviewLayerDiagnostics()) {
		return;
	}

	console.info("[preview-runtime][layer]", input);
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

function isPreviewVector2(value: unknown): value is { X: number; Y: number } {
	return (
		typeof value === "object" &&
		value !== null &&
		typeof (value as { X?: unknown }).X === "number" &&
		typeof (value as { Y?: unknown }).Y === "number" &&
		Number.isFinite((value as { X: number }).X) &&
		Number.isFinite((value as { Y: number }).Y)
	);
}

function createPreviewGuiObject(element: HTMLElement, host: HostName) {
	const bridgedAbsolutePosition = isPreviewVector2(
		(element as HTMLElement & { AbsolutePosition?: unknown }).AbsolutePosition,
	)
		? (
				element as HTMLElement & {
					AbsolutePosition: { X: number; Y: number };
				}
			).AbsolutePosition
		: undefined;
	const bridgedAbsoluteSize = isPreviewVector2(
		(element as HTMLElement & { AbsoluteSize?: unknown }).AbsoluteSize,
	)
		? (
				element as HTMLElement & {
					AbsoluteSize: { X: number; Y: number };
				}
			).AbsoluteSize
		: undefined;
	const bridgedAbsoluteWindowSize = isPreviewVector2(
		(element as HTMLElement & { AbsoluteWindowSize?: unknown })
			.AbsoluteWindowSize,
	)
		? (
				element as HTMLElement & {
					AbsoluteWindowSize: { X: number; Y: number };
				}
			).AbsoluteWindowSize
		: undefined;

	if (
		bridgedAbsolutePosition &&
		bridgedAbsoluteSize &&
		bridgedAbsoluteWindowSize
	) {
		return {
			AbsolutePosition: {
				X: bridgedAbsolutePosition.X,
				Y: bridgedAbsolutePosition.Y,
			},
			AbsoluteSize: {
				X: bridgedAbsoluteSize.X,
				Y: bridgedAbsoluteSize.Y,
			},
			AbsoluteWindowSize: {
				X: bridgedAbsoluteWindowSize.X,
				Y: bridgedAbsoluteWindowSize.Y,
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

	const rect = element.getBoundingClientRect();
	const layoutContext = (
		element as HTMLElement & {
			__previewLayoutContext?: {
				getContainerRect?: () => DOMRect | null;
				viewport?: { width: number; height: number };
			};
		}
	).__previewLayoutContext;
	let containerRect = layoutContext?.getContainerRect?.() ?? null;
	const container = element.closest("[data-preview-layout-provider]");

	if (!containerRect && container) {
		containerRect = container.getBoundingClientRect();
	}

	const offsetX = containerRect?.left ?? 0;
	const offsetY = containerRect?.top ?? 0;

	let scaleX = 1;
	let scaleY = 1;

	const viewportWidth =
		layoutContext?.viewport?.width ||
		Number(container?.getAttribute("data-preview-viewport-width")) ||
		containerRect?.width ||
		0;
	const viewportHeight =
		layoutContext?.viewport?.height ||
		Number(container?.getAttribute("data-preview-viewport-height")) ||
		containerRect?.height ||
		0;

	if (containerRect) {
		scaleX =
			viewportWidth > 0 && containerRect.width > 0
				? containerRect.width / viewportWidth
				: 1;
		scaleY =
			viewportHeight > 0 && containerRect.height > 0
				? containerRect.height / viewportHeight
				: 1;
	}

	return {
		AbsolutePosition: {
			X: (rect.left - offsetX) / scaleX,
			Y: (rect.top - offsetY) / scaleY,
		},
		AbsoluteSize: {
			X: rect.width / scaleX,
			Y: rect.height / scaleY,
		},
		AbsoluteWindowSize: {
			X: viewportWidth,
			Y: viewportHeight,
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
	imageColor3: unknown;
	imageTransparency: number | undefined;
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

function toTextAlign(
	value: string | undefined,
	undefinedFallback: "center" | "left" | "right" = "left",
): "center" | "left" | "right" {
	if (value === undefined) {
		return undefinedFallback;
	}

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
	undefinedFallback: "center" | "flex-end" | "flex-start" = "flex-start",
): "center" | "flex-end" | "flex-start" {
	if (value === undefined) {
		return undefinedFallback;
	}

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

function toOpacity(transparency: number) {
	return Math.max(0, Math.min(1, 1 - transparency));
}

function resolveHostPointerEvents(input: {
	active?: boolean;
	host: HostName;
	textEditable?: boolean;
}) {
	if (input.active === false) {
		return "none";
	}

	if (input.host === "textbox" && input.textEditable === false) {
		return "none";
	}

	if (pointerInteractiveHostNames.has(input.host) || input.active === true) {
		return "auto";
	}

	return "none";
}

function resolveHostZIndex(
	host: HostName,
	zIndex: number | undefined,
	styleZIndex: React.CSSProperties["zIndex"],
) {
	if (typeof zIndex === "number" && Number.isFinite(zIndex)) {
		return zIndex;
	}

	if (styleZIndex !== undefined) {
		return styleZIndex;
	}

	return layerCollectorHostNames.has(host)
		? undefined
		: DEFAULT_GUI_OBJECT_Z_INDEX;
}

export function applyComputedLayoutStyle(
	style: React.CSSProperties,
	computed: ComputedRect | null,
	parentRect?: ComputedRect | null,
	posOffsetX: number = 0,
	posOffsetY: number = 0,
	sizeX?: number,
	sizeY?: number,
): void {
	delete style.left;
	delete style.top;
	delete style.width;
	delete style.height;
	delete style.translate;

	style.position = "absolute";

	if (!computed) {
		style.visibility = "hidden";
		return;
	}

	style.visibility = "visible";
	const originX = parentRect?.x ?? 0;
	const originY = parentRect?.y ?? 0;
	style.left = `${computed.x - originX + posOffsetX}px`;
	style.top = `${computed.y - originY + posOffsetY}px`;
	style.width = sizeX !== undefined ? `${sizeX}px` : `${computed.width}px`;
	style.height = sizeY !== undefined ? `${sizeY}px` : `${computed.height}px`;
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
		GroupTransparency,
		Modal,
		Name,
		ParentId,
		PlaceholderText,
		Position,
		Rotation,
		Scale,
		Selectable,
		AutomaticSize,
		ClipsDescendants,
		Size,
		SizeConstraint,
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

	const normalizedPosition = serializeUDim2(Position);
	const normalizedSize = serializeUDim2(Size);
	const posOffsetX = normalizedPosition?.X.Offset ?? 0;
	const posOffsetY = normalizedPosition?.Y.Offset ?? 0;
	const sizeOffsetX = normalizedSize?.X.Offset;
	const sizeOffsetY = normalizedSize?.Y.Offset;

	void Active;
	void AnchorPoint;
	void AutoButtonColor;
	void AutomaticSize;
	void Color;
	void CornerRadius;
	void Font;
	void Id;
	void Modal;
	void Name;
	void ParentId;
	void Scale;
	void ClipsDescendants;
	void SizeConstraint;
	void TextScaled;
	void Thickness;
	void Transparency;

	const forwarded = pickForwardedDomProps(rest);
	const computedStyle: React.CSSProperties = {
		...(style ?? {}),
	};

	if (options.applyComputedLayout !== false) {
		applyComputedLayoutStyle(
			computedStyle,
			options.computed,
			undefined,
			posOffsetX,
			posOffsetY,
			sizeOffsetX,
			sizeOffsetY,
		);
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

	computedStyle.pointerEvents = resolveHostPointerEvents({
		active: Active,
		host: options.host,
		textEditable: TextEditable,
	});

	if (ClipsDescendants === true && options.host !== "scrollingframe") {
		computedStyle.overflow = "hidden";
	}

	const resolvedZIndex = resolveHostZIndex(
		options.host,
		ZIndex,
		computedStyle.zIndex,
	);
	if (resolvedZIndex !== undefined) {
		computedStyle.zIndex = resolvedZIndex;
	} else {
		delete computedStyle.zIndex;
	}
	logPreviewLayerDiagnostics({
		domZIndex: computedStyle.zIndex,
		host: options.host,
		nodeId: options.nodeId,
		pointerEvents: computedStyle.pointerEvents,
		propZIndex: ZIndex,
	});

	if (BackgroundColor3) {
		computedStyle.backgroundColor = toCssColor(
			BackgroundColor3,
			BackgroundTransparency,
		);
	} else if (BackgroundTransparency === 1) {
		computedStyle.backgroundColor = "transparent";
	}

	if (options.host === "canvasgroup" && typeof GroupTransparency === "number") {
		computedStyle.opacity = toOpacity(GroupTransparency);
	}

	if (TextColor3 || TextTransparency !== undefined) {
		computedStyle.color = toCssColor(
			TextColor3 ?? { R: 0, G: 0, B: 0 },
			TextTransparency,
		);
	}

	if (Rotation !== undefined && Rotation !== 0) {
		computedStyle.transform = `rotate(${Rotation}deg)`;
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
		computedStyle.justifyContent = toJustifyContent(TextYAlignment, "center");
		computedStyle.textAlign = toTextAlign(TextXAlignment, "center");
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

	if (typeof AutomaticSize === "string") {
		const automaticSize = AutomaticSize.toLowerCase();
		const isAutomaticX = automaticSize === "x" || automaticSize === "xy";
		const isAutomaticY = automaticSize === "y" || automaticSize === "xy";

		if (
			options.host === "textbutton" ||
			options.host === "textlabel" ||
			options.host === "textbox" ||
			options.host === "imagebutton" ||
			options.host === "imagelabel"
		) {
			if (isAutomaticX) {
				computedStyle.width = "auto";
			}

			if (isAutomaticY) {
				computedStyle.height = "auto";
			}
		}
	}

	if (options.host === "scrollingframe") {
		const scrollingDirection =
			typeof props.ScrollingDirection === "string"
				? props.ScrollingDirection.toLowerCase()
				: "vertical";
		computedStyle.overflow = "auto";
		computedStyle.overflowX =
			scrollingDirection === "vertical" ? "hidden" : "auto";
		computedStyle.overflowY =
			scrollingDirection === "horizontal" ? "hidden" : "auto";
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
				options.host === "textbutton" || options.host === "imagebutton"
					? (forwarded.tabIndex as number | undefined)
					: Selectable === false
						? -1
						: (forwarded.tabIndex as number | undefined),
		},
		image: Image,
		imageColor3: ImageColor3,
		imageTransparency: ImageTransparency,
		text: coerceTextValue(Text),
	};
}
