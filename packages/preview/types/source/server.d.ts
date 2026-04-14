import type {
	PreviewEngine,
	PreviewExecutionMode,
} from "@loom-dev/preview-engine";
import type {
	LoadPreviewConfigOptions,
	PreviewConfig,
	ResolvedPreviewConfig,
} from "../config";
import { type PreviewProgressWriter } from "./progress";
export type StartPreviewServerOptions = {
	configFile?: string;
	cwd?: string;
	packageName: string;
	packageRoot: string;
	port?: number;
	reactAliases?: string[];
	reactRobloxAliases?: string[];
	runtimeModule?: string;
	runtimeAliases?: string[];
	sourceRoot: string;
	transformMode?: PreviewExecutionMode;
};
export type PreviewServerProgressOptions = {
	progressWriter?: PreviewProgressWriter;
};
export type StartPreviewServerInput =
	| LoadPreviewConfigOptions
	| PreviewConfig
	| ResolvedPreviewConfig
	| StartPreviewServerOptions;
export type CreatePreviewViteServerOptions = {
	appType?: "custom" | "spa";
	middlewareMode?: boolean;
	previewEngine?: PreviewEngine;
	progressWriter?: PreviewProgressWriter;
};
export declare function normalizeViteLogErrorOptions<
	TOptions extends import("vite").LogErrorOptions,
>(options?: TOptions): TOptions | undefined;
export { resolvePreviewRuntimeRootEntry } from "./previewPackagePaths";
export declare function resolvePreviewServerConfig(
	options?: StartPreviewServerInput,
): Promise<ResolvedPreviewConfig>;
export declare function startPreviewServer(
	options?: StartPreviewServerInput,
	runtimeOptions?: PreviewServerProgressOptions,
): Promise<
	import("vite", { with: { "resolution-mode": "import" }}).ViteDevServer
>;
export declare function createPreviewViteServer(
	resolvedConfig: ResolvedPreviewConfig,
	options?: CreatePreviewViteServerOptions,
): Promise<
	import("vite", { with: { "resolution-mode": "import" }}).ViteDevServer
>;
