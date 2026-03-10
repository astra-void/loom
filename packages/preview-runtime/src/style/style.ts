import type * as React from "react";
import { serializeUDim, serializeUDim2, type UDim2Like } from "../internal/robloxValues";

type Color3Like = {
  R?: number;
  G?: number;
  B?: number;
};

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

  const red = Math.round(Number(color.R ?? 0) * 255);
  const green = Math.round(Number(color.G ?? 0) * 255);
  const blue = Math.round(Number(color.B ?? 0) * 255);
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
