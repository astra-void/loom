import { previewHostMatchesType } from "../hosts/metadata";
import robloxMock from "./robloxMock";

const robloxMockRecord = robloxMock as unknown as Record<PropertyKey, unknown>;

export type Color3Value = Color3;

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

export class Vector3 {
	readonly X: number;
	readonly Y: number;
	readonly Z: number;

	constructor(x: number, y: number, z: number) {
		this.X = x;
		this.Y = y;
		this.Z = z;
	}
}

export class UDim2 {
	readonly X: UDim;
	readonly Y: UDim;

	constructor(
		xScale: number,
		xOffset: number,
		yScale: number,
		yOffset: number,
	) {
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

function clampNormalizedChannel(channel: number) {
	return Math.max(0, Math.min(1, Number(channel) || 0));
}

function colorChannelToByte(channel: number) {
	return Math.round(clampNormalizedChannel(channel) * 255);
}

export class Color3 {
	readonly R: number;
	readonly G: number;
	readonly B: number;

	constructor(r: number, g: number, b: number) {
		this.R = clampNormalizedChannel(r);
		this.G = clampNormalizedChannel(g);
		this.B = clampNormalizedChannel(b);
	}

	static fromRGB(r: number, g: number, b: number): Color3 {
		return new Color3(r / 255, g / 255, b / 255);
	}
}

function truncateTowardZero(value: number) {
	return value < 0 ? Math.ceil(value) : Math.floor(value);
}

function roundHalfAwayFromZero(value: number) {
	return value < 0 ? Math.ceil(value - 0.5) : Math.floor(value + 0.5);
}

function mathLog(value: number, base?: number) {
	if (base === undefined) {
		return Math.log(value);
	}

	return Math.log(value) / Math.log(base);
}

function mathRandom(): number;
function mathRandom(upper: number): number;
function mathRandom(lower: number, upper: number): number;
function mathRandom(lower?: number, upper?: number) {
	if (lower === undefined) {
		return Math.random();
	}

	if (upper === undefined) {
		return Math.floor(Math.random() * lower) + 1;
	}

	const min = Math.ceil(lower);
	const max = Math.floor(upper);
	if (max < min) {
		return min;
	}

	return Math.floor(Math.random() * (max - min + 1)) + min;
}

export const math = Object.freeze({
	abs: Math.abs,
	acos: Math.acos,
	asin: Math.asin,
	atan: (value: number, x?: number) =>
		x === undefined ? Math.atan(value) : Math.atan2(value, x),
	atan2: Math.atan2,
	ceil: Math.ceil,
	clamp: (value: number, min: number, max: number) =>
		Math.min(Math.max(value, min), max),
	cos: Math.cos,
	deg: (value: number) => (value * 180) / Math.PI,
	exp: Math.exp,
	floor: Math.floor,
	fmod: (left: number, right: number) => left % right,
	huge: Number.POSITIVE_INFINITY,
	log: mathLog,
	max: Math.max,
	min: Math.min,
	modf: (value: number): readonly [number, number] => {
		const integerPart = truncateTowardZero(value);
		return [integerPart, value - integerPart] as const;
	},
	pi: Math.PI,
	pow: Math.pow,
	rad: (value: number) => (value * Math.PI) / 180,
	random: mathRandom,
	round: roundHalfAwayFromZero,
	sign: (value: number) => (value === 0 ? 0 : value < 0 ? -1 : 1),
	sin: Math.sin,
	sqrt: Math.sqrt,
	tan: Math.tan,
});

export function typeIs(
	value: unknown,
	typeName: "string" | "number" | "boolean" | "function" | "table",
) {
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

export function warn(...args: unknown[]) {
	console.warn(...args);
}

export function isPreviewElement(
	value: unknown,
	typeName: string,
): value is HTMLElement {
	if (typeof HTMLElement === "undefined" || !(value instanceof HTMLElement)) {
		return false;
	}

	const previewHost = value.dataset.previewHost;
	return previewHost
		? previewHostMatchesType(previewHost, typeName, "isa")
		: false;
}

export function __previewGlobal(name: string) {
	const globalRecord = globalThis as Record<PropertyKey, unknown>;
	if (name in globalRecord) {
		return globalRecord[name];
	}

	return robloxMockRecord[name];
}

function resolveColorChannels(color: Color3Value) {
	return {
		blue: colorChannelToByte(color.B),
		green: colorChannelToByte(color.G),
		red: colorChannelToByte(color.R),
	};
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

export function toCssColor(
	color: Color3Value,
	backgroundTransparency?: number,
) {
	const channels = resolveColorChannels(color);
	const alpha = clampAlpha(
		backgroundTransparency === undefined
			? undefined
			: 1 - backgroundTransparency,
	);
	return `rgba(${channels.red}, ${channels.green}, ${channels.blue}, ${alpha})`;
}
