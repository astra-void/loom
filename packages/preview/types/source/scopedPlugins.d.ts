import type { ResolvedPreviewConfig } from "../config";
import type { PreviewPluginOption } from "./viteTypes";
export declare function createScopedPreviewPlugins(plugins: PreviewPluginOption | PreviewPluginOption[], resolvedConfig: ResolvedPreviewConfig): import("vite", { with: { "resolution-mode": "import" } }).PluginOption[];
