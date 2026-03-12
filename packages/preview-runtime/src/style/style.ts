import type * as React from "react";
import {
	serializeUDim,
	serializeUDim2,
	type UDim2Like,
} from "../internal/robloxValues";
import type { Color3Value } from "../runtime/helpers";

type Color3Like = Color3Value;

type RobloxStyleProps = Record<string, unknown> & {
	Size?: UDim2Like;
	BackgroundColor3?: Color3Like;
	BackgroundTransparency?: number;
	Visible?: boolean;
};

function toCalcLength(axis: unknown) {
	if (axis === undefined || axis === null) {
		return undefined;
	}

	const serialized = serializeUDim(axis);
	return `calc(${serialized.Scale * 100}% + ${serialized.Offset}px)`;
}

function toRgb(color: Color3Like | undefined) {
	if (!color) {
		return undefined;
	}

	const red = Math.max(0, Math.min(255, Math.round(color.R * 255)));
	const green = Math.max(0, Math.min(255, Math.round(color.G * 255)));
	const blue = Math.max(0, Math.min(255, Math.round(color.B * 255)));
	return `rgb(${red}, ${green}, ${blue})`;
}

export function __rbxStyle(props: RobloxStyleProps): React.CSSProperties {
	const style: React.CSSProperties = {};
	const size = serializeUDim2(props.Size);

	const width = toCalcLength(size?.X);
	const height = toCalcLength(size?.Y);

	if (width) {
		style.width = width;
	}
	if (height) {
		style.height = height;
	}

	const backgroundColor = toRgb(props.BackgroundColor3);
	if (backgroundColor) {
		style.backgroundColor = backgroundColor;
	}

	if (typeof props.BackgroundTransparency === "number") {
		style.opacity = 1 - props.BackgroundTransparency;
	}

	if (props.Visible === false) {
		style.display = "none";
	}

	// Unknown Roblox props are ignored for now.
	return style;
}
