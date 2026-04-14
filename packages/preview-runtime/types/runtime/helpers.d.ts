export type Color3Value = Color3;
export declare class UDim {
	readonly Scale: number;
	readonly Offset: number;
	constructor(scale: number, offset: number);
	add(other: UDim): UDim;
	sub(other: UDim): UDim;
}
export declare class Vector2 {
	readonly X: number;
	readonly Y: number;
	constructor(x: number, y: number);
}
export declare class Vector3 {
	readonly X: number;
	readonly Y: number;
	readonly Z: number;
	constructor(x: number, y: number, z: number);
}
export declare class UDim2 {
	readonly X: UDim;
	readonly Y: UDim;
	constructor(xScale: number, xOffset: number, yScale: number, yOffset: number);
	static fromOffset(x: number, y: number): UDim2;
	static fromScale(x: number, y: number): UDim2;
	add(other: UDim2Value): UDim2;
	sub(other: UDim2Value): UDim2;
}
export type UDim2Value = UDim2;
export declare class Color3 {
	readonly R: number;
	readonly G: number;
	readonly B: number;
	constructor(r: number, g: number, b: number);
	static fromRGB(r: number, g: number, b: number): Color3;
}
export declare function tostring(value: unknown): string;
export declare function print(...args: unknown[]): void;
declare function stringFind(
	value: string,
	pattern: string,
	init?: number,
	plain?: boolean,
): readonly [number, number] | undefined;
declare function stringGsub(
	value: string,
	pattern: string,
	replacement: string | ((match: string, ...captures: string[]) => unknown),
): readonly [string, number];
declare function stringSub(
	value: string,
	start?: number,
	finish?: number,
): string;
declare function stringLower(value: string): string;
declare function stringUpper(value: string): string;
export declare const string: Readonly<{
	find: typeof stringFind;
	gsub: typeof stringGsub;
	lower: typeof stringLower;
	sub: typeof stringSub;
	upper: typeof stringUpper;
}>;
export declare const os: Readonly<{
	clock: () => number;
}>;
declare function roundHalfAwayFromZero(value: number): number;
declare function mathLog(value: number, base?: number): number;
declare function mathRandom(): number;
declare function mathRandom(upper: number): number;
declare function mathRandom(lower: number, upper: number): number;
export declare const math: Readonly<{
	abs: (x: number) => number;
	acos: (x: number) => number;
	asin: (x: number) => number;
	atan: (value: number, x?: number) => number;
	atan2: (y: number, x: number) => number;
	ceil: (x: number) => number;
	clamp: (value: number, min: number, max: number) => number;
	cos: (x: number) => number;
	deg: (value: number) => number;
	exp: (x: number) => number;
	floor: (x: number) => number;
	fmod: (left: number, right: number) => number;
	huge: number;
	log: typeof mathLog;
	max: (...values: number[]) => number;
	min: (...values: number[]) => number;
	modf: (value: number) => readonly [number, number];
	pi: number;
	pow: (x: number, y: number) => number;
	rad: (value: number) => number;
	random: typeof mathRandom;
	round: typeof roundHalfAwayFromZero;
	sign: (value: number) => 0 | 1 | -1;
	sin: (x: number) => number;
	sqrt: (x: number) => number;
	tan: (x: number) => number;
}>;
export declare function typeIs(
	value: unknown,
	typeName: "string" | "number" | "boolean" | "function" | "table",
): boolean;
export declare function pairs(
	value: unknown,
): Generator<readonly [PropertyKey, unknown], void, unknown>;
export declare function next(
	value: unknown,
	index?: PropertyKey | null,
): readonly [PropertyKey | undefined, unknown | undefined];
export declare function error(message: string): never;
export declare function warn(...args: unknown[]): void;
export declare const previewRuntimeBaseGlobals: Readonly<{
	Color3: typeof Color3;
	error: typeof error;
	math: Readonly<{
		abs: (x: number) => number;
		acos: (x: number) => number;
		asin: (x: number) => number;
		atan: (value: number, x?: number) => number;
		atan2: (y: number, x: number) => number;
		ceil: (x: number) => number;
		clamp: (value: number, min: number, max: number) => number;
		cos: (x: number) => number;
		deg: (value: number) => number;
		exp: (x: number) => number;
		floor: (x: number) => number;
		fmod: (left: number, right: number) => number;
		huge: number;
		log: typeof mathLog;
		max: (...values: number[]) => number;
		min: (...values: number[]) => number;
		modf: (value: number) => readonly [number, number];
		pi: number;
		pow: (x: number, y: number) => number;
		rad: (value: number) => number;
		random: typeof mathRandom;
		round: typeof roundHalfAwayFromZero;
		sign: (value: number) => 0 | 1 | -1;
		sin: (x: number) => number;
		sqrt: (x: number) => number;
		tan: (x: number) => number;
	}>;
	next: typeof next;
	os: Readonly<{
		clock: () => number;
	}>;
	pairs: typeof pairs;
	print: typeof print;
	string: Readonly<{
		find: typeof stringFind;
		gsub: typeof stringGsub;
		lower: typeof stringLower;
		sub: typeof stringSub;
		upper: typeof stringUpper;
	}>;
	tostring: typeof tostring;
	typeIs: typeof typeIs;
	warn: typeof warn;
	UDim: typeof UDim;
	UDim2: typeof UDim2;
	Vector2: typeof Vector2;
	Vector3: typeof Vector3;
}>;
export declare function isPreviewElement(
	value: unknown,
	typeName: string,
): value is HTMLElement;
export declare function __previewGlobal(name: string): unknown;
export declare function toCssLength(dimension: UDim): string;
export declare function toCssColor(
	color: Color3Value,
	backgroundTransparency?: number,
): string;
