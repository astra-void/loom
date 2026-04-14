export type PreviewAliasConfig = {
	reactAliases?: string[];
	reactRobloxAliases?: string[];
	runtimeAliases?: string[];
};
export type ReactShimMode = "browser" | "node";
export declare function resolvePreviewRuntimeAliases(
	runtimeAliases?: string[],
): string[];
export declare function resolvePreviewReactAliases(
	reactAliases?: string[],
): string[];
export declare function resolvePreviewReactRobloxAliases(
	reactRobloxAliases?: string[],
): string[];
export declare function resolvePreviewAliasConfig(
	config?: PreviewAliasConfig,
): {
	reactAliases: string[];
	reactRobloxAliases: string[];
	runtimeAliases: string[];
};
export declare function createRuntimeAliasSet(
	runtimeAliases?: string[],
): Set<string>;
export declare function createNonMockableSpecifiers(
	config?: PreviewAliasConfig,
): Set<string>;
export declare function createReactShimSpecifierMap(options: {
	mode: ReactShimMode;
	reactAliases?: string[];
	reactRobloxAliases?: string[];
	resolveReactRobloxShimEntry: (mode: ReactShimMode) => string;
	resolveReactShimEntry: (fileName: string, mode: ReactShimMode) => string;
}): Map<string, string>;
export declare function isInternalPreviewPackageName(
	packageName?: string,
): boolean;
