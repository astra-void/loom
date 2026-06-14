import {
	previewHostMatchesType,
	runtimeOnlyTypeNames,
} from "../hosts/metadata";
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

	get Magnitude() {
		return Math.sqrt(this.X * this.X + this.Y * this.Y);
	}

	get Unit() {
		const magnitude = this.Magnitude;
		return magnitude === 0
			? new Vector2(0, 0)
			: new Vector2(this.X / magnitude, this.Y / magnitude);
	}

	// roblox-ts compiles the Vector2 `+ - * /` operators down to these method
	// calls, so consumer code (e.g. @lattice-ui/popper measuring a viewport)
	// invokes them on the preview's Vector2. They read `.X`/`.Y` off the operand
	// so a plain `{ X, Y }` mock works as an argument too.
	add(other: { X: number; Y: number }) {
		return new Vector2(this.X + other.X, this.Y + other.Y);
	}

	sub(other: { X: number; Y: number }) {
		return new Vector2(this.X - other.X, this.Y - other.Y);
	}

	mul(other: number | { X: number; Y: number }) {
		return typeof other === "number"
			? new Vector2(this.X * other, this.Y * other)
			: new Vector2(this.X * other.X, this.Y * other.Y);
	}

	div(other: number | { X: number; Y: number }) {
		return typeof other === "number"
			? new Vector2(this.X / other, this.Y / other)
			: new Vector2(this.X / other.X, this.Y / other.Y);
	}

	Dot(other: { X: number; Y: number }) {
		return this.X * other.X + this.Y * other.Y;
	}

	Lerp(goal: { X: number; Y: number }, alpha: number) {
		return new Vector2(
			this.X + (goal.X - this.X) * alpha,
			this.Y + (goal.Y - this.Y) * alpha,
		);
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

export class Rect {
	readonly Min: Vector2;
	readonly Max: Vector2;
	readonly Width: number;
	readonly Height: number;

	constructor(min: Vector2, max: Vector2);
	constructor(minX: number, minY: number, maxX: number, maxY: number);
	constructor(
		minOrMinX: Vector2 | number,
		maxOrMinY: Vector2 | number,
		maxX?: number,
		maxY?: number,
	) {
		if (typeof minOrMinX === "number") {
			this.Min = new Vector2(minOrMinX, maxOrMinY as number);
			this.Max = new Vector2(maxX ?? 0, maxY ?? 0);
		} else {
			this.Min = minOrMinX;
			this.Max = maxOrMinY as Vector2;
		}

		this.Width = this.Max.X - this.Min.X;
		this.Height = this.Max.Y - this.Min.Y;
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

function toFiniteValue(value: unknown, fallback = 0) {
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : fallback;
}

export class ColorSequenceKeypoint {
	readonly Time: number;
	readonly Value: Color3;

	constructor(time: number, value: Color3) {
		this.Time = clampNormalizedChannel(time);
		this.Value = value;
	}
}

export class ColorSequence {
	readonly Keypoints: readonly ColorSequenceKeypoint[];

	constructor(
		color: Color3 | readonly ColorSequenceKeypoint[],
		finishColor?: Color3,
	) {
		if (Array.isArray(color)) {
			this.Keypoints = [...color];
			return;
		}

		const startColor = color as Color3;
		this.Keypoints = [
			new ColorSequenceKeypoint(0, startColor),
			new ColorSequenceKeypoint(1, finishColor ?? startColor),
		];
	}
}

export class NumberSequenceKeypoint {
	readonly Time: number;
	readonly Value: number;
	readonly Envelope: number;

	constructor(time: number, value: number, envelope = 0) {
		this.Time = clampNormalizedChannel(time);
		this.Value = toFiniteValue(value);
		this.Envelope = toFiniteValue(envelope);
	}
}

export class NumberSequence {
	readonly Keypoints: readonly NumberSequenceKeypoint[];

	constructor(
		value: number | readonly NumberSequenceKeypoint[],
		finishValue?: number,
	) {
		if (Array.isArray(value)) {
			this.Keypoints = [...value];
			return;
		}

		const startValue = value as number;
		this.Keypoints = [
			new NumberSequenceKeypoint(0, startValue),
			new NumberSequenceKeypoint(1, finishValue ?? startValue),
		];
	}
}

export function tostring(value: unknown) {
	return String(value);
}

export function print(...args: unknown[]) {
	console.log(...args);
}

function normalizeLuaSearchStart(length: number, index?: number) {
	if (index === undefined || !Number.isFinite(index)) {
		return 1;
	}

	const normalizedIndex = Math.trunc(index);
	if (normalizedIndex === 0) {
		return 1;
	}

	if (normalizedIndex < 0) {
		return Math.max(1, length + normalizedIndex + 1);
	}

	return Math.min(length + 1, normalizedIndex);
}

function normalizeLuaStringIndex(
	length: number,
	index: number | undefined,
	fallback: number,
) {
	const normalizedIndex =
		index === undefined || !Number.isFinite(index)
			? fallback
			: Math.trunc(index);

	if (normalizedIndex === 0) {
		return 1;
	}

	if (normalizedIndex < 0) {
		return length + normalizedIndex + 1;
	}

	return normalizedIndex;
}

function luaSubstring(value: string, start?: number, finish?: number) {
	if (value.length === 0) {
		return "";
	}

	const normalizedStart = Math.max(
		1,
		Math.min(value.length + 1, normalizeLuaStringIndex(value.length, start, 1)),
	);
	const normalizedFinish = Math.max(
		0,
		Math.min(
			value.length,
			normalizeLuaStringIndex(value.length, finish, value.length),
		),
	);

	if (normalizedStart > normalizedFinish) {
		return "";
	}

	return value.slice(normalizedStart - 1, normalizedFinish);
}

function escapeRegExpCharacter(character: string) {
	return /[\\^$.*+?()[\]{}|]/.test(character) ? `\\${character}` : character;
}

function luaPatternClassEscape(character: string) {
	if (character === "-" || character === "]" || character === "\\") {
		return `\\${character}`;
	}

	return escapeRegExpCharacter(character);
}

function luaPatternToRegExpSource(pattern: string) {
	let source = "";
	let inClass = false;
	let classStart = false;

	for (let index = 0; index < pattern.length; index += 1) {
		const character = pattern[index] ?? "";

		if (character === "%") {
			const nextCharacter = pattern[index + 1];
			if (nextCharacter === undefined) {
				source += "%";
				continue;
			}

			index += 1;

			const outsideClassSource: Record<string, string> = {
				a: "[A-Za-z]",
				A: "[^A-Za-z]",
				c: "[\\x00-\\x1F\\x7F]",
				C: "[^\\x00-\\x1F\\x7F]",
				d: "[0-9]",
				D: "[^0-9]",
				l: "[a-z]",
				L: "[^a-z]",
				p: "[!\"#$%&'()*+,\\-./:;<=>?@[\\\\\\]^_`{|}~]",
				P: "[^!\"#$%&'()*+,\\-./:;<=>?@[\\\\\\]^_`{|}~]",
				s: "[\\s]",
				S: "[^\\s]",
				u: "[A-Z]",
				U: "[^A-Z]",
				w: "[A-Za-z0-9_]",
				W: "[^A-Za-z0-9_]",
				x: "[0-9A-Fa-f]",
				X: "[^0-9A-Fa-f]",
				z: "\\x00",
			};

			if (!inClass && outsideClassSource[nextCharacter]) {
				source += outsideClassSource[nextCharacter];
				continue;
			}

			if (inClass) {
				const insideClassSource: Record<string, string> = {
					a: "A-Za-z",
					A: "\\W",
					c: "\\x00-\\x1F\\x7F",
					C: "\\W",
					d: "0-9",
					D: "\\D",
					l: "a-z",
					L: "\\W",
					p: "!\"#$%&'()*+,\\-./:;<=>?@[\\\\\\]^_`{|}~",
					P: "\\W",
					s: "\\s",
					S: "\\S",
					u: "A-Z",
					U: "\\W",
					w: "A-Za-z0-9_",
					W: "\\W",
					x: "0-9A-Fa-f",
					X: "\\W",
					z: "\\x00",
				};

				if (insideClassSource[nextCharacter]) {
					source += insideClassSource[nextCharacter];
					continue;
				}

				source += luaPatternClassEscape(nextCharacter);
				continue;
			}

			source += escapeRegExpCharacter(nextCharacter);
			continue;
		}

		if (character === "[") {
			inClass = true;
			classStart = true;
			source += "[";
			continue;
		}

		if (character === "]" && inClass) {
			inClass = false;
			classStart = false;
			source += "]";
			continue;
		}

		if (inClass) {
			if (classStart && character === "^") {
				source += "^";
				classStart = false;
				continue;
			}

			source += luaPatternClassEscape(character);
			classStart = false;
			continue;
		}

		if (character === ".") {
			source += "[\\s\\S]";
			continue;
		}

		source += escapeRegExpCharacter(character);
	}

	return source;
}

function luaPatternToRegExp(pattern: string) {
	return new RegExp(luaPatternToRegExpSource(pattern));
}

function stringFind(
	value: string,
	pattern: string,
	init?: number,
	plain?: boolean,
): readonly [number, number] | undefined {
	const text = String(value);
	const search = String(pattern);
	const startIndex = normalizeLuaSearchStart(text.length, init) - 1;

	if (plain) {
		const foundIndex = text.indexOf(search, startIndex);
		if (foundIndex < 0) {
			return undefined;
		}

		return [foundIndex + 1, foundIndex + search.length] as const;
	}

	const match = text.slice(startIndex).match(luaPatternToRegExp(search));
	if (!match || match.index === undefined) {
		return undefined;
	}

	const foundIndex = startIndex + match.index;
	return [foundIndex + 1, foundIndex + match[0].length] as const;
}

function stringGsub(
	value: string,
	pattern: string,
	replacement: string | ((match: string, ...captures: string[]) => unknown),
): readonly [string, number] {
	const text = String(value);
	const matcher = new RegExp(luaPatternToRegExpSource(String(pattern)), "g");
	let count = 0;

	const replaced = text.replace(matcher, (...args: unknown[]) => {
		const match = String(args[0] ?? "");
		const captures = args.slice(1, -2).map((capture) => String(capture));
		count += 1;

		if (typeof replacement === "function") {
			return tostring(replacement(match, ...captures));
		}

		return replacement;
	});

	return [replaced, count] as const;
}

function stringSub(value: string, start?: number, finish?: number) {
	return luaSubstring(String(value), start, finish);
}

function stringLower(value: string) {
	return String(value).toLowerCase();
}

function stringUpper(value: string) {
	return String(value).toUpperCase();
}

export const string = Object.freeze({
	find: stringFind,
	gsub: stringGsub,
	lower: stringLower,
	sub: stringSub,
	upper: stringUpper,
});

export const os = Object.freeze({
	clock: () => (globalThis.performance?.now?.() ?? Date.now()) / 1000,
});

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
	for (const entry of getEnumerableEntries(value)) {
		yield entry;
	}
}

function getEnumerableEntries(value: unknown) {
	if (Array.isArray(value)) {
		return [...value.entries()] as Array<readonly [number, unknown]>;
	}

	if (value && typeof value === "object") {
		return Object.entries(value) as Array<readonly [string, unknown]>;
	}

	return [] as Array<readonly [PropertyKey, unknown]>;
}

export function next(
	value: unknown,
	index?: PropertyKey | null,
): readonly [PropertyKey | undefined, unknown | undefined] {
	const entries = getEnumerableEntries(value);
	if (entries.length === 0) {
		return [undefined, undefined] as const;
	}

	if (index === undefined || index === null) {
		const [key, entryValue] = entries[0] ?? [];
		return [key, entryValue] as const;
	}

	const currentIndex = entries.findIndex(([key]) => Object.is(key, index));
	if (currentIndex < 0) {
		return [undefined, undefined] as const;
	}

	const [key, entryValue] = entries[currentIndex + 1] ?? [];
	return [key, entryValue] as const;
}

export function error(message: string): never {
	throw new Error(message);
}

export function warn(...args: unknown[]) {
	console.warn(...args);
}

export const previewRuntimeBaseGlobals = Object.freeze({
	Color3,
	ColorSequence,
	ColorSequenceKeypoint,
	NumberSequence,
	NumberSequenceKeypoint,
	error,
	math,
	next,
	os,
	pairs,
	print,
	string,
	tostring,
	typeIs,
	warn,
	Rect,
	UDim,
	UDim2,
	Vector2,
	Vector3,
});

export function isPreviewElement(
	value: unknown,
	typeName: string,
): value is HTMLElement {
	if (typeof HTMLElement === "undefined" || !(value instanceof HTMLElement)) {
		return false;
	}

	if (value.dataset.previewPlayerGui === "true") {
		return (
			runtimeOnlyTypeNames.includes(typeName) ||
			typeName === "BasePlayerGui" ||
			typeName === "LayerCollector" ||
			typeName === "Instance"
		);
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

	if (name in previewRuntimeBaseGlobals) {
		return previewRuntimeBaseGlobals[
			name as keyof typeof previewRuntimeBaseGlobals
		];
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

export function isColor3Value(value: unknown): value is Color3Value {
	return (
		typeof value === "object" &&
		value !== null &&
		typeof (value as Color3Value).R === "number" &&
		typeof (value as Color3Value).G === "number" &&
		typeof (value as Color3Value).B === "number"
	);
}

function sortKeypoints<TKeypoint extends { Time: number }>(
	keypoints: readonly TKeypoint[],
): TKeypoint[] {
	return [...keypoints].sort((left, right) => left.Time - right.Time);
}

function interpolate(from: number, to: number, alpha: number) {
	return from + (to - from) * alpha;
}

function resolveColorKeypoints(value: unknown): ColorSequenceKeypoint[] {
	if (
		value &&
		typeof value === "object" &&
		Array.isArray((value as ColorSequence).Keypoints)
	) {
		return sortKeypoints((value as ColorSequence).Keypoints);
	}

	if (isColor3Value(value)) {
		return [
			new ColorSequenceKeypoint(0, value),
			new ColorSequenceKeypoint(1, value),
		];
	}

	return [];
}

function resolveNumberKeypoints(value: unknown): NumberSequenceKeypoint[] {
	if (
		value &&
		typeof value === "object" &&
		Array.isArray((value as NumberSequence).Keypoints)
	) {
		return sortKeypoints((value as NumberSequence).Keypoints);
	}

	if (typeof value === "number" && Number.isFinite(value)) {
		return [
			new NumberSequenceKeypoint(0, value),
			new NumberSequenceKeypoint(1, value),
		];
	}

	return [];
}

function sampleColorAt(
	keypoints: readonly ColorSequenceKeypoint[],
	time: number,
): Color3 {
	const first = keypoints[0];
	if (!first || time <= first.Time) {
		return first?.Value ?? new Color3(1, 1, 1);
	}

	const last = keypoints[keypoints.length - 1];
	if (time >= last.Time) {
		return last.Value;
	}

	for (let index = 0; index < keypoints.length - 1; index += 1) {
		const current = keypoints[index];
		const next = keypoints[index + 1];
		if (time >= current.Time && time <= next.Time) {
			const span = next.Time - current.Time;
			const alpha = span === 0 ? 0 : (time - current.Time) / span;
			return new Color3(
				interpolate(current.Value.R, next.Value.R, alpha),
				interpolate(current.Value.G, next.Value.G, alpha),
				interpolate(current.Value.B, next.Value.B, alpha),
			);
		}
	}

	return last.Value;
}

function sampleNumberAt(
	keypoints: readonly NumberSequenceKeypoint[],
	time: number,
): number {
	const first = keypoints[0];
	if (!first || time <= first.Time) {
		return first?.Value ?? 0;
	}

	const last = keypoints[keypoints.length - 1];
	if (time >= last.Time) {
		return last.Value;
	}

	for (let index = 0; index < keypoints.length - 1; index += 1) {
		const current = keypoints[index];
		const next = keypoints[index + 1];
		if (time >= current.Time && time <= next.Time) {
			const span = next.Time - current.Time;
			const alpha = span === 0 ? 0 : (time - current.Time) / span;
			return interpolate(current.Value, next.Value, alpha);
		}
	}

	return last.Value;
}

/**
 * Converts a Roblox `UIGradient` (a `ColorSequence` plus optional
 * `NumberSequence` transparency, rotation and offset) into a CSS
 * `linear-gradient` value. Roblox measures rotation clockwise from the +X axis
 * (0° points right), whereas CSS measures it clockwise from "up", so the CSS
 * angle is the Roblox rotation plus 90°.
 *
 * `Offset` slides the gradient pattern relative to the parent's bounding box.
 * We approximate it by projecting the offset vector onto the gradient axis and
 * shifting every colour stop by that amount; CSS clamps stops that fall outside
 * the 0–100% range, which matches Roblox extending the end colours.
 */
export function toCssGradient(
	colorValue: unknown,
	transparencyValue: unknown,
	rotation: number,
	offset?: { X: number; Y: number },
): string | undefined {
	const colorKeypoints = resolveColorKeypoints(colorValue);
	if (colorKeypoints.length === 0) {
		return undefined;
	}

	const transparencyKeypoints = resolveNumberKeypoints(transparencyValue);

	const times = new Set<number>();
	for (const keypoint of colorKeypoints) {
		times.add(keypoint.Time);
	}
	for (const keypoint of transparencyKeypoints) {
		times.add(keypoint.Time);
	}
	const sortedTimes = [...times].sort((left, right) => left - right);

	const normalizedRotation = toFiniteValue(rotation);
	const shift = offset ? projectGradientOffset(offset, normalizedRotation) : 0;

	const stops = sortedTimes.map((time) => {
		const channels = resolveColorChannels(sampleColorAt(colorKeypoints, time));
		const alpha = clampAlpha(
			transparencyKeypoints.length === 0
				? 1
				: 1 - sampleNumberAt(transparencyKeypoints, time),
		);
		const percent = Math.round((time + shift) * 1000) / 10;
		return `rgba(${channels.red}, ${channels.green}, ${channels.blue}, ${alpha}) ${percent}%`;
	});

	const cssAngle = normalizedRotation + 90;
	return `linear-gradient(${cssAngle}deg, ${stops.join(", ")})`;
}

function projectGradientOffset(
	offset: { X: number; Y: number },
	rotation: number,
): number {
	const radians = (rotation * Math.PI) / 180;
	return (
		toFiniteValue(offset.X) * Math.cos(radians) +
		toFiniteValue(offset.Y) * Math.sin(radians)
	);
}
