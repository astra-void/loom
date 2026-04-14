declare const previewRuntimePolyfillsMarker: unique symbol;
export type PreviewPolyfillTarget = typeof globalThis & {
	[previewRuntimePolyfillsMarker]?: boolean;
	print?: (...args: unknown[]) => void;
	tostring?: (value: unknown) => string;
};
declare global {
	interface String {
		size(): number;
		lower(): string;
		upper(): string;
		sub(start?: number, finish?: number): string;
	}
	interface Array<T> {
		size(this: T[]): number;
		isEmpty(this: T[]): boolean;
		remove(this: T[], indexOrValue: number | T): T | undefined;
	}
	interface ReadonlyArray<T> {
		size(this: readonly T[]): number;
		isEmpty(this: readonly T[]): boolean;
	}
	interface Set<T> {
		remove(this: Set<T>, value: T): boolean;
	}
}
export declare function installPreviewRuntimePolyfills(
	target?: PreviewPolyfillTarget,
): PreviewPolyfillTarget;
export default installPreviewRuntimePolyfills;
