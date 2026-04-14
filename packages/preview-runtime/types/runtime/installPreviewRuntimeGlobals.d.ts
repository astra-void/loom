export declare const previewRuntimeGlobalValues: Readonly<{
	readonly Enum: import("./Enum").PreviewEnumRoot;
	readonly RunService: import("./RunService").PreviewRunService;
	readonly TweenInfo: typeof import("./services").TweenInfo;
	readonly game: import("./services").PreviewGame;
	readonly task: import("./task").TaskLibrary;
	readonly workspace: import("./services").PreviewWorkspace;
	readonly Color3: typeof import("./helpers").Color3;
	readonly error: typeof import("./helpers").error;
	readonly math: Readonly<{
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
		log: (value: number, base?: number) => number;
		max: (...values: number[]) => number;
		min: (...values: number[]) => number;
		modf: (value: number) => readonly [number, number];
		pi: number;
		pow: (x: number, y: number) => number;
		rad: (value: number) => number;
		random: {
			(): number;
			(upper: number): number;
			(lower: number, upper: number): number;
		};
		round: (value: number) => number;
		sign: (value: number) => 0 | 1 | -1;
		sin: (x: number) => number;
		sqrt: (x: number) => number;
		tan: (x: number) => number;
	}>;
	readonly next: typeof import("./helpers").next;
	readonly os: Readonly<{
		clock: () => number;
	}>;
	readonly pairs: typeof import("./helpers").pairs;
	readonly print: typeof import("./helpers").print;
	readonly string: Readonly<{
		find: (
			value: string,
			pattern: string,
			init?: number,
			plain?: boolean,
		) => readonly [number, number] | undefined;
		gsub: (
			value: string,
			pattern: string,
			replacement: string | ((match: string, ...captures: string[]) => unknown),
		) => readonly [string, number];
		lower: (value: string) => string;
		sub: (value: string, start?: number, finish?: number) => string;
		upper: (value: string) => string;
	}>;
	readonly tostring: typeof import("./helpers").tostring;
	readonly typeIs: typeof import("./helpers").typeIs;
	readonly warn: typeof import("./helpers").warn;
	readonly UDim: typeof import("./helpers").UDim;
	readonly UDim2: typeof import("./helpers").UDim2;
	readonly Vector2: typeof import("./helpers").Vector2;
	readonly Vector3: typeof import("./helpers").Vector3;
}>;
export type PreviewRuntimeGlobalValues = typeof previewRuntimeGlobalValues;
export type PreviewRuntimeGlobalName = keyof PreviewRuntimeGlobalValues;
export type PreviewRuntimeGlobalTarget = {
	-readonly [K in PreviewRuntimeGlobalName]?: PreviewRuntimeGlobalValues[K];
};
export declare const previewRuntimeGlobalNames: readonly (
	| "string"
	| "math"
	| "error"
	| "Color3"
	| "next"
	| "os"
	| "pairs"
	| "print"
	| "tostring"
	| "typeIs"
	| "warn"
	| "UDim"
	| "UDim2"
	| "Vector2"
	| "Vector3"
	| "Enum"
	| "RunService"
	| "game"
	| "TweenInfo"
	| "task"
	| "workspace"
)[];
export declare function installPreviewRuntimeGlobals(
	target?: PreviewRuntimeGlobalTarget,
): PreviewRuntimeGlobalTarget;
export default installPreviewRuntimeGlobals;
