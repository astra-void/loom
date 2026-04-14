import {
	type PreviewEngine,
	type PreviewExecutionMode,
	type PreviewSourceTarget,
} from "@loom-dev/preview-engine";
import { type PreviewProgressWriter } from "./progress";
import type { PreviewPluginOption } from "./viteTypes";
export type CreatePreviewVitePluginOptions = {
	reactAliases?: string[];
	reactRobloxAliases?: string[];
	previewEngine?: PreviewEngine;
	progressWriter?: PreviewProgressWriter;
	projectName: string;
	runtimeModule?: string;
	runtimeAliases?: string[];
	targets: PreviewSourceTarget[];
	transformMode?: PreviewExecutionMode;
	workspaceRoot: string;
};
export declare function createPreviewVitePlugin(
	options: CreatePreviewVitePluginOptions,
): PreviewPluginOption[];
