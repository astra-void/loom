import topLevelAwait from "vite-plugin-top-level-await";
import wasm from "vite-plugin-wasm";
import {
	createPackageTargetDiscovery,
	loadPreviewConfig,
	type ResolvedPreviewConfig,
	resolvePreviewConfigObject,
} from "../config";
import { createPreviewViteConfig } from "../vite";

export type LoomPreviewAstroOptions = {
	/**
	 * Working directory used to resolve `loom.config.*` and relative paths.
	 * Defaults to `process.cwd()`.
	 */
	cwd?: string;
	/**
	 * Explicit `loom.config.*` path. Ignored when `sourceRoot` is provided.
	 */
	configFile?: string;
	/**
	 * Directory that holds the preview source (e.g. `./src/previews`).
	 * When set, a static target is synthesized and no `loom.config.*` is needed.
	 */
	sourceRoot?: string;
	/** Project name used when synthesizing config from `sourceRoot`. */
	projectName?: string;
	/** Bare packages aliased to browser-safe runtime shims (e.g. `@rbxts/services`). */
	runtimeAliases?: string[];
	/** react-roblox aliases forwarded to the preview transform. */
	reactRobloxAliases?: string[];
	/** Extra `optimizeDeps.exclude` entries merged into the preview defaults. */
	additionalOptimizeDepsExclude?: string[];
};

/**
 * Minimal structural shape of an Astro integration. Declared locally so this
 * package does not need `astro` as a build-time dependency; the returned object
 * is a valid `AstroIntegration` at runtime.
 */
type AstroIntegrationLike = {
	name: string;
	hooks: {
		"astro:config:setup": (context: {
			updateConfig: (config: { vite?: Record<string, unknown> }) => void;
		}) => void | Promise<void>;
	};
};

async function resolveLoomPreviewConfig(
	options: LoomPreviewAstroOptions,
): Promise<ResolvedPreviewConfig> {
	const cwd = options.cwd ?? process.cwd();

	if (options.sourceRoot) {
		return resolvePreviewConfigObject(
			{
				projectName: options.projectName ?? "loom-preview",
				...(options.runtimeAliases
					? { runtimeAliases: options.runtimeAliases }
					: {}),
				...(options.reactRobloxAliases
					? { reactRobloxAliases: options.reactRobloxAliases }
					: {}),
				targetDiscovery: createPackageTargetDiscovery({
					sourceRoot: options.sourceRoot,
				}),
			},
			{ cwd },
		);
	}

	return loadPreviewConfig({
		cwd,
		...(options.configFile ? { configFile: options.configFile } : {}),
	});
}

/**
 * Astro integration that wires Loom's source-first preview transform into
 * Astro's own Vite pipeline. Everything happens at build time, so the produced
 * site is fully static — no preview server is needed at runtime.
 *
 * Pair with `@astrojs/react` (which transforms the remaining JSX in the
 * preview output and renders the `LoomPreview` island) and render previews via
 * `import { LoomPreview } from "@loom-dev/preview/astro/react"` using
 * `client:only="react"`.
 */
export default function loomPreview(
	options: LoomPreviewAstroOptions = {},
): AstroIntegrationLike {
	return {
		name: "@loom-dev/preview",
		hooks: {
			"astro:config:setup": async ({ updateConfig }) => {
				const resolvedConfig = await resolveLoomPreviewConfig(options);
				const viteConfig = createPreviewViteConfig(resolvedConfig, {
					thirdPartyPlugins: [wasm(), topLevelAwait()],
					...(options.additionalOptimizeDepsExclude
						? {
								additionalOptimizeDepsExclude:
									options.additionalOptimizeDepsExclude,
							}
						: {}),
				});

				// Force-prebundle the (CommonJS) island so Vite serves it as ESM;
				// its dynamic `virtual:` import stays external and is resolved at
				// runtime by the preview plugin's resolveId/load hooks.
				const optimizeDeps = {
					...(viteConfig.optimizeDeps as Record<string, unknown> | undefined),
					include: ["@loom-dev/preview/astro/react"],
				};

				updateConfig({
					vite: { ...viteConfig, optimizeDeps } as Record<string, unknown>,
				});
			},
		},
	};
}
