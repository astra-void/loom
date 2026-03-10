import robloxMock from "./robloxMock";

const robloxMockRecord = robloxMock as unknown as Record<PropertyKey, unknown>;

export type Color3Value = {
  r: number;
  g: number;
  b: number;
};

export class UDim {
  readonly Scale: number;
  readonly Offset: number;

  constructor(scale: number, offset: number) {
    this.Scale = scale;
    this.Offset = offset;
  }

  add(other: UDim) {
    return new UDim(this.Scale + other.Scale, this.Offset + other.Offset);
  }

  sub(other: UDim) {
    return new UDim(this.Scale - other.Scale, this.Offset - other.Offset);
  }
}

export class Vector2 {
  readonly X: number;
  readonly Y: number;

  constructor(x: number, y: number) {
    this.X = x;
    this.Y = y;
  }
}

export class UDim2 {
  readonly X: UDim;
  readonly Y: UDim;

  constructor(xScale: number, xOffset: number, yScale: number, yOffset: number) {
    this.X = new UDim(xScale, xOffset);
    this.Y = new UDim(yScale, yOffset);
  }

  static fromOffset(x: number, y: number) {
    return new UDim2(0, x, 0, y);
  }

  static fromScale(x: number, y: number) {
    return new UDim2(x, 0, y, 0);
  }

  add(other: UDim2Value) {
    return new UDim2(
      this.X.Scale + other.X.Scale,
      this.X.Offset + other.X.Offset,
      this.Y.Scale + other.Y.Scale,
      this.Y.Offset + other.Y.Offset,
    );
  }

  sub(other: UDim2Value) {
    return new UDim2(
      this.X.Scale - other.X.Scale,
      this.X.Offset - other.X.Offset,
      this.Y.Scale - other.Y.Scale,
      this.Y.Offset - other.Y.Offset,
    );
  }
}

export type UDim2Value = UDim2;

export const Color3 = {
  fromRGB(r: number, g: number, b: number): Color3Value {
    return { r, g, b };
  },
} as const;

export function typeIs(value: unknown, typeName: "string" | "number" | "boolean" | "function" | "table") {
  if (typeName === "table") {
    return typeof value === "object" && value !== null;
  }

  return typeof value === typeName;
}

export function* pairs(value: unknown) {
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      yield [index, item] as const;
    }
    return;
  }

  if (value && typeof value === "object") {
    for (const entry of Object.entries(value)) {
      yield entry;
    }
  }
}

export function error(message: string): never {
  throw new Error(message);
}

export function isPreviewElement(value: unknown, typeName: string): value is HTMLElement {
  if (typeof HTMLElement === "undefined" || !(value instanceof HTMLElement)) {
    return false;
  }

  if (typeName === "GuiObject" || typeName === "Instance") {
    return true;
  }

  const previewHost = value.dataset.previewHost;
  switch (typeName) {
    case "Frame":
      return previewHost === "frame";
    case "ScreenGui":
      return previewHost === "screengui";
    case "TextButton":
      return previewHost === "textbutton";
    case "TextLabel":
      return previewHost === "textlabel";
    case "TextBox":
      return previewHost === "textbox";
    case "ImageLabel":
      return previewHost === "imagelabel";
    case "ScrollingFrame":
      return previewHost === "scrollingframe";
    default:
      return true;
  }
}

export function __previewGlobal(name: string) {
  const globalRecord = globalThis as Record<PropertyKey, unknown>;
  if (name in globalRecord) {
    return globalRecord[name];
  }

  return robloxMockRecord[name];
}

function toChannel(channel: number) {
  return Math.max(0, Math.min(255, Math.round(channel)));
}

function clampAlpha(value: number | undefined) {
  if (value === undefined) {
    return 1;
  }

  return Math.max(0, Math.min(1, value));
}

export function toCssLength(dimension: UDim) {
  if (dimension.Scale === 0) {
    return `${dimension.Offset}px`;
  }

  if (dimension.Offset === 0) {
    return `${dimension.Scale * 100}%`;
  }

  return `calc(${dimension.Scale * 100}% + ${dimension.Offset}px)`;
}

export function toCssColor(color: Color3Value, backgroundTransparency?: number) {
  const alpha = clampAlpha(backgroundTransparency === undefined ? undefined : 1 - backgroundTransparency);
  return `rgba(${toChannel(color.r)}, ${toChannel(color.g)}, ${toChannel(color.b)}, ${alpha})`;
}
