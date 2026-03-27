import type {
	LogErrorOptions,
	Logger,
	Plugin,
	PluginOption,
	UserConfig,
	ViteDevServer,
} from "vite";

export type PreviewDevServer = ViteDevServer;
export type PreviewPlugin = Plugin;
export type PreviewPluginOption = PluginOption;
export type PreviewServerConfig = UserConfig;

export type ViteModule = typeof import("vite");
export type ViteLogger = Logger;
export type ViteLogErrorOptions = LogErrorOptions;

export type ReactPluginModule = {
	default: (options?: unknown) => PluginOption | PluginOption[];
};

export type ViteWasmPluginModule = {
	default: (options?: unknown) => PluginOption;
};

export type ViteTopLevelAwaitPluginModule = {
	default: (options?: unknown) => PluginOption;
};
