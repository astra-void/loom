import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ResolvedPreviewConfig } from "../../packages/preview/src/config";
import type {
	PreviewPlugin,
	PreviewPluginOption,
} from "../../packages/preview/src/source/viteTypes";
import {
	createPreviewViteConfig,
	type PreviewViteResolveAlias,
} from "../../packages/preview/src/vite";

const temporaryRoots: string[] = [];

afterEach(() => {
	for (const root of temporaryRoots.splice(0)) {
		fs.rmSync(root, { force: true, recursive: true });
	}
});

function createTempRoot(prefix: string) {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
	temporaryRoots.push(root);
	return root;
}

function createFixtureConfig(): ResolvedPreviewConfig {
	const workspaceRoot = createTempRoot("loom-preview-vite-config-");
	const sourceRoot = path.join(workspaceRoot, "src");
	const runtimeModule = path
		.join(sourceRoot, "runtime.ts")
		.split(path.sep)
		.join("/");

	fs.mkdirSync(sourceRoot, { recursive: true });
	fs.writeFileSync(
		path.join(workspaceRoot, "package.json"),
		JSON.stringify({ name: "@fixtures/vite-config" }, null, 2),
		"utf8",
	);
	fs.writeFileSync(path.join(sourceRoot, "Entry.tsx"), "export const Entry = 1;\n");
	fs.writeFileSync(path.join(sourceRoot, "runtime.ts"), "export const runtime = true;\n");

	return {
		configDir: workspaceRoot,
		cwd: workspaceRoot,
		mode: "config-object",
		projectName: "Vite Config Fixture",
		reactAliases: ["@rbxts/react"],
		reactRobloxAliases: ["@rbxts/react-roblox"],
		runtimeAliases: [],
		runtimeModule,
		server: {
			fsAllow: [workspaceRoot, sourceRoot],
			host: undefined,
			open: false,
			port: 4174,
		},
		targetDiscovery: [],
		targets: [
			{
				name: "fixture",
				packageName: "@fixtures/vite-config",
				packageRoot: workspaceRoot,
				sourceRoot,
			},
		],
		transformMode: "strict-fidelity",
		workspaceRoot,
	};
}

function flattenPluginOptions(plugins: PreviewPluginOption[] | undefined) {
	const pending = [...(plugins ?? [])] as unknown[];
	const flattened: PreviewPlugin[] = [];

	while (pending.length > 0) {
		const plugin = pending.shift();
		if (Array.isArray(plugin)) {
			pending.unshift(...plugin);
			continue;
		}

		if (
			plugin &&
			typeof plugin === "object" &&
			!Array.isArray(plugin) &&
			!("then" in plugin)
		) {
			flattened.push(plugin as PreviewPlugin);
		}
	}

	return flattened;
}

function getAliasEntries(aliases: unknown): PreviewViteResolveAlias[] {
	if (Array.isArray(aliases)) {
		return aliases.filter(
			(entry): entry is PreviewViteResolveAlias =>
				typeof entry === "object" &&
				entry !== null &&
				"find" in entry &&
				"replacement" in entry &&
				typeof (entry as { replacement?: unknown }).replacement === "string",
		);
	}

	if (!aliases || typeof aliases !== "object") {
		return [];
	}

	return Object.entries(aliases as Record<string, string>).map(
		([find, replacement]) => ({
			find,
			replacement,
		}),
	);
}

function findPluginByName(plugins: PreviewPlugin[], name: string) {
	return plugins.find((plugin) => plugin.name === name);
}

describe("createPreviewViteConfig", () => {
	it("returns Loom defaults for plugins, aliases, deps, and fs allow", () => {
		const resolvedConfig = createFixtureConfig();
		const viteConfig = createPreviewViteConfig(resolvedConfig);
		const aliases = getAliasEntries(viteConfig.resolve?.alias);
		const previewRuntimeAlias = aliases.find(
			(alias) => alias.find === "@loom-dev/preview-runtime",
		);

		expect(viteConfig.assetsInclude).toEqual(["**/*.wasm"]);
		expect(viteConfig.optimizeDeps?.exclude).toEqual([
			"@loom-dev/layout-engine",
			"layout-engine",
		]);
		expect(viteConfig.server?.fs?.allow).toEqual(resolvedConfig.server.fsAllow);
		expect(previewRuntimeAlias).toEqual({
			find: "@loom-dev/preview-runtime",
			replacement: resolvedConfig.runtimeModule,
		});

		const plugins = flattenPluginOptions(viteConfig.plugins as PreviewPluginOption[]);
		expect(findPluginByName(plugins, "loom-preview-source-first")).toBeDefined();
	});

	it("scopes third-party plugins by default and allows opting out", () => {
		const resolvedConfig = createFixtureConfig();
		const thirdPartyPlugin = {
			name: "third-party",
		} satisfies PreviewPlugin;

		const scopedConfig = createPreviewViteConfig(resolvedConfig, {
			thirdPartyPlugins: thirdPartyPlugin,
		});
		const scopedPlugins = flattenPluginOptions(
			scopedConfig.plugins as PreviewPluginOption[],
		);
		const scopedPlugin = findPluginByName(scopedPlugins, "third-party");

		expect(scopedPlugin).toBeDefined();
		expect(scopedPlugin).not.toBe(thirdPartyPlugin);

		const unscopedConfig = createPreviewViteConfig(resolvedConfig, {
			scopeThirdPartyPlugins: false,
			thirdPartyPlugins: thirdPartyPlugin,
		});
		const unscopedPlugins = flattenPluginOptions(
			unscopedConfig.plugins as PreviewPluginOption[],
		);
		expect(findPluginByName(unscopedPlugins, "third-party")).toBe(
			thirdPartyPlugin,
		);
	});

	it("merges additive aliases, optimizeDeps, and assets with dedupe", () => {
		const resolvedConfig = createFixtureConfig();
		const viteConfig = createPreviewViteConfig(resolvedConfig, {
			additionalAssetsInclude: ["**/*.wasm", "**/*.loom"],
			additionalOptimizeDepsExclude: ["layout-engine", "@fixtures/custom"],
			additionalResolveAliases: [
				{
					find: "@fixtures/custom",
					replacement: "/tmp/custom-first.ts",
				},
				{
					find: "@fixtures/custom",
					replacement: "/tmp/custom-last.ts",
				},
			],
		});
		const aliases = getAliasEntries(viteConfig.resolve?.alias);
		const runtimeAliases = aliases.filter(
			(alias) => alias.find === "@loom-dev/preview-runtime",
		);
		const customAlias = aliases.find(
			(alias) => alias.find === "@fixtures/custom",
		);

		expect(viteConfig.assetsInclude).toEqual(["**/*.wasm", "**/*.loom"]);
		expect(viteConfig.optimizeDeps?.exclude).toEqual([
			"@loom-dev/layout-engine",
			"layout-engine",
			"@fixtures/custom",
		]);
		expect(runtimeAliases).toHaveLength(1);
		expect(customAlias).toEqual({
			find: "@fixtures/custom",
			replacement: "/tmp/custom-last.ts",
		});
	});

	it("falls back to resolved preview-runtime entry when runtimeModule is unset", () => {
		const resolvedConfig = createFixtureConfig();
		const viteConfig = createPreviewViteConfig({
			...resolvedConfig,
			runtimeModule: undefined,
		});
		const aliases = getAliasEntries(viteConfig.resolve?.alias);
		const previewRuntimeAlias = aliases.find(
			(alias) => alias.find === "@loom-dev/preview-runtime",
		);

		expect(previewRuntimeAlias).toBeDefined();
		expect(previewRuntimeAlias?.replacement).toContain("preview-runtime");
	});
});