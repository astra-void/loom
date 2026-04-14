export type PreviewDevServer = import("vite").ViteDevServer;
export type PreviewPlugin = import("vite").Plugin;
export type PreviewPluginOption = import("vite").PluginOption;
export type PreviewServerConfig = import("vite").UserConfig;
export type ViteModule = typeof import("vite", { with: {
	"resolution-mode": "import",
}});
export type ViteLogger = import("vite").Logger;
export type ViteLogErrorOptions = import("vite").LogErrorOptions;
export type ReactPluginModule = {
	default: (
		options?: unknown,
	) => import("vite").PluginOption | import("vite").PluginOption[];
};
export type ViteWasmPluginModule = {
	default: (options?: unknown) => import("vite").PluginOption;
};
export type ViteTopLevelAwaitPluginModule = {
	default: (options?: unknown) => import("vite").PluginOption;
};
