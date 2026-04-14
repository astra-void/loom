type Plugin = import("vite").Plugin;
export declare const UNRESOLVED_MOCK_MODULE_ID =
	"virtual:loom-preview-unresolved-env";
export declare const ROBLOX_MOCK_MODULE_ID =
	"virtual:loom-preview-unresolved-env";
export type TransformResolveContext = {
	resolve?: (
		source: string,
		importer?: string,
		options?: {
			skipSelf?: boolean;
		},
	) => Promise<unknown> | unknown;
};
export type RobloxPackageMockPluginOptions = {
	reactAliases?: string[];
	reactRobloxAliases?: string[];
};
export declare function isBareModuleSpecifier(specifier: string): boolean;
export declare function createUnresolvedPackageMockResolvePlugin(
	mockEntryPath: string,
	options?: RobloxPackageMockPluginOptions,
): Plugin;
export declare function createUnresolvedPackageMockTransformPlugin(
	options?: RobloxPackageMockPluginOptions,
): Plugin;
export declare const createRobloxPackageMockResolvePlugin: typeof createUnresolvedPackageMockResolvePlugin;
export declare const createRobloxPackageMockTransformPlugin: typeof createUnresolvedPackageMockTransformPlugin;
