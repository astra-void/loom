import type { PreviewEngine } from "@loom-dev/preview-engine";
import type { ResolvedPreviewConfig } from "../config";
import { createPreviewVitePlugin } from "./plugin";
import { resolvePreviewRuntimeRootEntry } from "./previewPackagePaths";
import type { PreviewProgressWriter } from "./progress";
import { createScopedPreviewPlugins } from "./scopedPlugins";
import type { PreviewPluginOption, PreviewServerConfig } from "./viteTypes";

const DEFAULT_ASSETS_INCLUDE = ["**/*.wasm"];
const DEFAULT_OPTIMIZE_DEPS_EXCLUDE = [
	"@loom-dev/layout-engine",
	"layout-engine",
];

export type PreviewViteResolveAlias = {
	find: string | RegExp;
	replacement: string;
};

export type CreatePreviewViteConfigOptions = {
	additionalAssetsInclude?: string[];
	additionalOptimizeDepsExclude?: string[];
	additionalResolveAliases?: PreviewViteResolveAlias[];
	previewEngine?: PreviewEngine;
	progressWriter?: PreviewProgressWriter;
	scopeThirdPartyPlugins?: boolean;
	thirdPartyPlugins?: PreviewPluginOption | PreviewPluginOption[];
};

function flattenPluginOptions(
	plugins: PreviewPluginOption | PreviewPluginOption[],
): PreviewPluginOption[] {
	const pending = Array.isArray(plugins)
		? ([...plugins] as unknown[])
		: ([plugins] as unknown[]);
	const flattened: PreviewPluginOption[] = [];

	while (pending.length > 0) {
		const plugin = pending.shift();
		if (Array.isArray(plugin)) {
			pending.unshift(...plugin);
			continue;
		}

		if (plugin) {
			flattened.push(plugin as PreviewPluginOption);
		}
	}

	return flattened;
}

function dedupeStrings(values: string[]) {
	return [...new Set(values)];
}

function getResolveAliasKey(alias: PreviewViteResolveAlias) {
	if (typeof alias.find === "string") {
		return `s:${alias.find}`;
	}

	return `r:${alias.find.source}/${alias.find.flags}`;
}

function dedupeResolveAliases(aliases: PreviewViteResolveAlias[]) {
	const aliasesByKey = new Map<string, PreviewViteResolveAlias>();

	for (const alias of aliases) {
		aliasesByKey.set(getResolveAliasKey(alias), alias);
	}

	return [...aliasesByKey.values()];
}

function resolvePreviewRuntimeEntry(resolvedConfig: ResolvedPreviewConfig) {
	return (
		resolvedConfig.runtimeModule ?? resolvePreviewRuntimeRootEntry()
	).replace(/\\/g, "/");
}

export function createPreviewViteConfig(
	resolvedConfig: ResolvedPreviewConfig,
	options: CreatePreviewViteConfigOptions = {},
): PreviewServerConfig {
	const previewRuntimeEntry = resolvePreviewRuntimeEntry(resolvedConfig);
	const thirdPartyPlugins = options.thirdPartyPlugins
		? options.scopeThirdPartyPlugins === false
			? flattenPluginOptions(options.thirdPartyPlugins)
			: createScopedPreviewPlugins(options.thirdPartyPlugins, resolvedConfig)
		: [];
	const previewPlugins = createPreviewVitePlugin({
		previewEngine: options.previewEngine,
		progressWriter: options.progressWriter,
		projectName: resolvedConfig.projectName,
		reactAliases: resolvedConfig.reactAliases,
		reactRobloxAliases: resolvedConfig.reactRobloxAliases,
		runtimeModule: previewRuntimeEntry,
		runtimeAliases: resolvedConfig.runtimeAliases,
		targets: resolvedConfig.targets,
		transformMode: resolvedConfig.transformMode,
		workspaceRoot: resolvedConfig.workspaceRoot,
	});

	return {
		assetsInclude: dedupeStrings([
			...DEFAULT_ASSETS_INCLUDE,
			...(options.additionalAssetsInclude ?? []),
		]),
		optimizeDeps: {
			exclude: dedupeStrings([
				...DEFAULT_OPTIMIZE_DEPS_EXCLUDE,
				...(options.additionalOptimizeDepsExclude ?? []),
			]),
		},
		plugins: [...thirdPartyPlugins, ...previewPlugins],
		resolve: {
			alias: dedupeResolveAliases([
				{
					find: "@loom-dev/preview-runtime",
					replacement: previewRuntimeEntry,
				},
				...(options.additionalResolveAliases ?? []),
			]),
		},
		server: {
			fs: {
				allow: [...resolvedConfig.server.fsAllow],
			},
		},
	};
}
