import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ResolvedPreviewConfig } from "../../packages/preview/src/config";
import { loadPreviewConfig } from "../../packages/preview/src/config";
import type { PreviewPlugin } from "../../packages/preview/src/source/viteTypes";
import {
	createPreviewVitePlugin,
	createScopedPreviewPlugins,
} from "../../packages/preview/src/vite";
import { getHookHandler, getHookResultId } from "./hookTestUtils";

const temporaryRoots: string[] = [];
const WORKSPACE_INDEX_MODULE_ID = "virtual:loom-preview-workspace-index";
const require = createRequire(import.meta.url);

type ResolveIdHook = (
	source: string,
	importer?: string,
	options?: { ssr?: boolean },
) => unknown;
type LoadHook = (id: string, options?: { ssr?: boolean }) => unknown;
type TransformHook = (
	code: string,
	id: string,
	options?: { ssr?: boolean },
) => unknown;
type HotUpdateHook = (context: { file: string }) => unknown;

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

function createFixtureConfig(): ResolvedPreviewConfig & {
	externalFilePath: string;
	sourceRoot: string;
	workspaceFilePath: string;
} {
	const workspaceRoot = createTempRoot("loom-preview-scoped-plugins-");
	const sourceRoot = path.join(workspaceRoot, "src");
	const externalRoot = createTempRoot("loom-preview-scoped-external-");
	const externalFilePath = path.join(externalRoot, "App.tsx");
	const workspaceFilePath = path.join(workspaceRoot, "notes.ts");

	fs.mkdirSync(sourceRoot, { recursive: true });
	fs.writeFileSync(
		path.join(workspaceRoot, "package.json"),
		JSON.stringify({ name: "@fixtures/scoped-preview" }, null, 2),
		"utf8",
	);
	fs.writeFileSync(
		path.join(sourceRoot, "Entry.tsx"),
		"export const Entry = 1;\n",
	);
	fs.writeFileSync(workspaceFilePath, "export const workspaceValue = 1;\n");
	fs.writeFileSync(externalFilePath, "export const externalValue = 1;\n");

	return {
		configDir: workspaceRoot,
		cwd: workspaceRoot,
		externalFilePath,
		mode: "config-object",
		projectName: "Scoped Plugin Fixture",
		reactAliases: [],
		reactRobloxAliases: [],
		runtimeAliases: [],
		server: {
			fsAllow: [workspaceRoot, sourceRoot],
			open: false,
			port: 4174,
		},
		sourceRoot,
		targetDiscovery: [],
		targets: [
			{
				name: "fixture",
				packageName: "@fixtures/scoped-preview",
				packageRoot: workspaceRoot,
				sourceRoot,
			},
		],
		transformMode: "strict-fidelity",
		workspaceFilePath,
		workspaceRoot,
	};
}

function getPreviewShellFilePath() {
	return path.resolve(process.cwd(), "packages/preview/src/shell/main.tsx");
}

function getPreviewRuntimeFilePath() {
	return path.resolve(process.cwd(), "packages/preview-runtime/src/index.ts");
}

function getLayoutEngineFilePath() {
	return path.resolve(process.cwd(), "packages/layout-engine/package.json");
}

async function importPreviewPackageDependency(moduleId: string) {
	const resolvedPath = require.resolve(moduleId, {
		paths: [path.resolve(process.cwd(), "packages/preview")],
	});
	return import(resolvedPath);
}

function getWrappedPlugin(
	plugin: PreviewPlugin,
	config: ResolvedPreviewConfig,
): PreviewPlugin {
	const [wrappedPlugin] = createScopedPreviewPlugins(plugin, config);
	if (
		!wrappedPlugin ||
		typeof wrappedPlugin !== "object" ||
		Array.isArray(wrappedPlugin)
	) {
		throw new Error(
			"Expected scoped preview plugins to return a wrapped plugin.",
		);
	}

	return wrappedPlugin as PreviewPlugin;
}

describe("createScopedPreviewPlugins", () => {
	it("flattens nested plugin arrays and removes falsy entries", () => {
		const config = createFixtureConfig();
		const pluginA = { name: "plugin-a" } satisfies PreviewPlugin;
		const pluginB = { name: "plugin-b" } satisfies PreviewPlugin;

		const wrappedPlugins = createScopedPreviewPlugins(
			[pluginA, null, false, [undefined, [pluginB]]],
			config,
		);

		expect(wrappedPlugins).toHaveLength(2);
		expect(
			wrappedPlugins.map((plugin) =>
				typeof plugin === "object" && plugin !== null && "name" in plugin
					? plugin.name
					: undefined,
			),
		).toEqual(["plugin-a", "plugin-b"]);
	});

	it("wraps function-form hooks and only forwards preview-scoped requests", async () => {
		const config = createFixtureConfig();
		const resolveIdSpy = vi.fn((source: string) => ({
			id: `resolved:${source}`,
		}));
		const loadSpy = vi.fn((id: string) => `loaded:${id}`);
		const transformSpy = vi.fn((code: string) => ({ code: `${code}:wrapped` }));
		const handleHotUpdateSpy = vi.fn(() => []);
		const wrappedPlugin = getWrappedPlugin(
			{
				name: "function-hooks",
				handleHotUpdate: handleHotUpdateSpy,
				load: loadSpy,
				resolveId: resolveIdSpy,
				transform: transformSpy,
			},
			config,
		);

		const resolveId = getHookHandler<ResolveIdHook>(wrappedPlugin.resolveId);
		const load = getHookHandler<LoadHook>(wrappedPlugin.load);
		const transform = getHookHandler<TransformHook>(wrappedPlugin.transform);
		const handleHotUpdate = getHookHandler<HotUpdateHook>(
			wrappedPlugin.handleHotUpdate,
		);
		if (!resolveId || !load || !transform || !handleHotUpdate) {
			throw new Error("Expected wrapped hooks to remain callable.");
		}

		expect(getHookResultId(resolveId(WORKSPACE_INDEX_MODULE_ID))).toBe(
			`resolved:${WORKSPACE_INDEX_MODULE_ID}`,
		);
		expect(
			getHookResultId(
				resolveId("react", path.join(config.sourceRoot, "Entry.tsx")),
			),
		).toBe("resolved:react");
		expect(
			resolveId("@loom-dev/layout-engine", config.externalFilePath),
		).toBeNull();
		expect(load(getPreviewShellFilePath())).toBe(
			`loaded:${getPreviewShellFilePath()}`,
		);
		expect(load(config.externalFilePath)).toBeNull();
		expect(
			transform("export const value = 1;", getPreviewRuntimeFilePath()),
		).toEqual({ code: "export const value = 1;:wrapped" });
		expect(
			transform("export const value = 1;", config.externalFilePath, {
				ssr: true,
			}),
		).toBeNull();
		expect(handleHotUpdate({ file: config.workspaceFilePath })).toEqual([]);
		expect(handleHotUpdate({ file: config.externalFilePath })).toBeUndefined();

		expect(resolveIdSpy).toHaveBeenCalledTimes(2);
		expect(loadSpy).toHaveBeenCalledTimes(1);
		expect(transformSpy).toHaveBeenCalledTimes(1);
		expect(handleHotUpdateSpy).toHaveBeenCalledTimes(1);
	});

	it("wraps object-form hook handlers", () => {
		const config = createFixtureConfig();
		const resolveIdSpy = vi.fn((source: string) => ({
			id: `object:${source}`,
		}));
		const loadSpy = vi.fn((id: string) => `object-load:${id}`);
		const transformSpy = vi.fn((code: string) => ({ code: `${code}:object` }));
		const hotUpdateSpy = vi.fn(() => []);
		const wrappedPlugin = getWrappedPlugin(
			{
				name: "object-hooks",
				handleHotUpdate: { handler: hotUpdateSpy },
				load: { handler: loadSpy },
				resolveId: { handler: resolveIdSpy },
				transform: { handler: transformSpy },
			},
			config,
		);

		const resolveId = getHookHandler<ResolveIdHook>(wrappedPlugin.resolveId);
		const load = getHookHandler<LoadHook>(wrappedPlugin.load);
		const transform = getHookHandler<TransformHook>(wrappedPlugin.transform);
		const handleHotUpdate = getHookHandler<HotUpdateHook>(
			wrappedPlugin.handleHotUpdate,
		);
		if (!resolveId || !load || !transform || !handleHotUpdate) {
			throw new Error("Expected wrapped object handlers to remain callable.");
		}

		expect(getHookResultId(resolveId("@loom-dev/preview-runtime"))).toBe(
			"object:@loom-dev/preview-runtime",
		);
		expect(load(getLayoutEngineFilePath())).toBe(
			`object-load:${getLayoutEngineFilePath()}`,
		);
		expect(transform("export {}", config.externalFilePath)).toBeNull();
		expect(handleHotUpdate({ file: getPreviewRuntimeFilePath() })).toEqual([]);

		expect(resolveIdSpy).toHaveBeenCalledTimes(1);
		expect(loadSpy).toHaveBeenCalledTimes(1);
		expect(transformSpy).not.toHaveBeenCalled();
		expect(hotUpdateSpy).toHaveBeenCalledTimes(1);
	});

	it("treats preview runtime and layout-engine requests as scoped only for preview importers", () => {
		const config = createFixtureConfig();
		const resolveIdSpy = vi.fn((source: string) => ({ id: source }));
		const wrappedPlugin = getWrappedPlugin(
			{
				name: "resolve-only",
				resolveId: resolveIdSpy,
			},
			config,
		);
		const resolveId = getHookHandler<ResolveIdHook>(wrappedPlugin.resolveId);
		if (!resolveId) {
			throw new Error("Expected wrapped resolveId hook.");
		}

		expect(
			getHookResultId(
				resolveId(
					"@loom-dev/preview-runtime",
					path.join(config.sourceRoot, "Entry.tsx"),
				),
			),
		).toBe("@loom-dev/preview-runtime");
		expect(
			resolveId("@loom-dev/preview-runtime", config.externalFilePath),
		).toBeNull();
		expect(
			getHookResultId(
				resolveId(
					"@loom-dev/layout-engine",
					path.join(config.sourceRoot, "Entry.tsx"),
				),
			),
		).toBe("@loom-dev/layout-engine");
		expect(
			resolveId("@loom-dev/layout-engine", config.externalFilePath),
		).toBeNull();

		expect(resolveIdSpy).toHaveBeenCalledTimes(2);
	});

	it("scopes absolute paths for target roots, workspace files, preview shell, and runtime roots", () => {
		const config = createFixtureConfig();
		const loadSpy = vi.fn((id: string) => `scope:${id}`);
		const wrappedPlugin = getWrappedPlugin(
			{
				name: "load-only",
				load: loadSpy,
			},
			config,
		);
		const load = getHookHandler<LoadHook>(wrappedPlugin.load);
		if (!load) {
			throw new Error("Expected wrapped load hook.");
		}

		expect(load(path.join(config.sourceRoot, "Entry.tsx"))).toBe(
			`scope:${path.join(config.sourceRoot, "Entry.tsx")}`,
		);
		expect(load(config.workspaceFilePath)).toBe(
			`scope:${config.workspaceFilePath}`,
		);
		expect(load(getPreviewShellFilePath())).toBe(
			`scope:${getPreviewShellFilePath()}`,
		);
		expect(load(getPreviewRuntimeFilePath())).toBe(
			`scope:${getPreviewRuntimeFilePath()}`,
		);
		expect(load(getLayoutEngineFilePath())).toBe(
			`scope:${getLayoutEngineFilePath()}`,
		);
		expect(load(config.externalFilePath)).toBeNull();

		expect(loadSpy).toHaveBeenCalledTimes(5);
	});

	it("supports recommended usage with resolved config and real third-party plugins", async () => {
		const workspaceRoot = createTempRoot("loom-preview-scoped-integration-");
		const sourceRoot = path.join(workspaceRoot, "src");
		fs.mkdirSync(sourceRoot, { recursive: true });
		fs.writeFileSync(
			path.join(workspaceRoot, "package.json"),
			JSON.stringify({ name: "@fixtures/integration" }, null, 2),
			"utf8",
		);
		fs.writeFileSync(
			path.join(sourceRoot, "Button.tsx"),
			[
				"export function ButtonPreview() {",
				"\treturn <frame />;",
				"}",
				"",
				"export const preview = {",
				"\tentry: ButtonPreview,",
				"};",
			].join("\n"),
			"utf8",
		);
		fs.writeFileSync(
			path.join(workspaceRoot, "loom.config.ts"),
			[
				"export default {",
				'\tprojectName: "Scoped Integration",',
				"\ttargetDiscovery: {",
				"\t\tdiscoverTargets() {",
				"\t\t\treturn [{",
				'\t\t\t\tname: "integration",',
				'\t\t\t\tpackageName: "@fixtures/integration",',
				'\t\t\t\tpackageRoot: ".",',
				'\t\t\t\tsourceRoot: "./src",',
				"\t\t\t}];",
				"\t\t},",
				"\t},",
				"};",
			].join("\n"),
			"utf8",
		);

		const resolvedConfig = await loadPreviewConfig({ cwd: workspaceRoot });
		const [{ default: react }, { default: wasm }, { default: topLevelAwait }] =
			await Promise.all([
				importPreviewPackageDependency("@vitejs/plugin-react"),
				importPreviewPackageDependency("vite-plugin-wasm"),
				importPreviewPackageDependency("vite-plugin-top-level-await"),
			]);
		const scopedPlugins = createScopedPreviewPlugins(
			[react(), wasm(), topLevelAwait()],
			resolvedConfig,
		);
		const previewPlugins = createPreviewVitePlugin({
			projectName: resolvedConfig.projectName,
			reactAliases: resolvedConfig.reactAliases,
			reactRobloxAliases: resolvedConfig.reactRobloxAliases,
			runtimeModule: resolvedConfig.runtimeModule,
			runtimeAliases: resolvedConfig.runtimeAliases,
			targets: resolvedConfig.targets,
			transformMode: resolvedConfig.transformMode,
			workspaceRoot: resolvedConfig.workspaceRoot,
		});

		expect(scopedPlugins.length).toBeGreaterThan(0);
		expect(
			scopedPlugins.every(
				(plugin) => !Array.isArray(plugin) && Boolean(plugin),
			),
		).toBe(true);
		expect(
			previewPlugins.some(
				(plugin) =>
					typeof plugin === "object" &&
					plugin !== null &&
					"name" in plugin &&
					plugin.name === "loom-preview-source-first",
			),
		).toBe(true);
	});
});
