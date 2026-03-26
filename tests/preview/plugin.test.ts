import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPreviewVitePlugin } from "../../packages/preview/src/source/plugin";
import type { PreviewPlugin } from "../../packages/preview/src/source/viteTypes";
import { getHookHandler, getHookResultCode } from "./hookTestUtils";

const WORKSPACE_INDEX_MODULE_ID = "virtual:loom-preview-workspace-index";
const temporaryRoots: string[] = [];

type MockServer = ReturnType<typeof createMockServer>;
type TestResolveIdHook = (id: string) => string | undefined;
type TestLoadHook = (id: string) => string | undefined;
type TestConfigureServerHook = (server: MockServer) => void;
type TestHotUpdateHook = (context: { file: string }) => [] | undefined;
type TestTransformHook = (
	code: string,
	id: string,
) => Promise<unknown> | unknown;

afterEach(() => {
	for (const root of temporaryRoots.splice(0)) {
		fs.rmSync(root, { force: true, recursive: true });
	}
});

function createFixtureRoot() {
	const fixtureRoot = fs.mkdtempSync(
		path.join(os.tmpdir(), "loom-preview-plugin-"),
	);
	const sourceRoot = path.join(fixtureRoot, "src");
	temporaryRoots.push(fixtureRoot);
	fs.mkdirSync(sourceRoot, { recursive: true });
	fs.writeFileSync(
		path.join(fixtureRoot, "package.json"),
		JSON.stringify({ name: "@fixtures/plugin" }, null, 2),
		"utf8",
	);

	return {
		fixtureRoot,
		sourceRoot,
	};
}

function createPreviewPlugin(
	fixtureRoot: string,
	sourceRoot: string,
	runtimeModule?: string,
): PreviewPlugin {
	const plugins = createPreviewPlugins(fixtureRoot, sourceRoot, runtimeModule);

	const previewPlugin = plugins.find(
		(plugin) =>
			plugin &&
			typeof plugin === "object" &&
			"name" in plugin &&
			plugin.name === "loom-preview-source-first",
	);
	if (
		!previewPlugin ||
		typeof previewPlugin !== "object" ||
		Array.isArray(previewPlugin)
	) {
		throw new Error(
			"Expected the preview Vite plugin to be present in the plugin array.",
		);
	}

	return previewPlugin as PreviewPlugin;
}

function createPreviewPlugins(
	fixtureRoot: string,
	sourceRoot: string,
	runtimeModule?: string,
) {
	return createPreviewVitePlugin({
		projectName: "Fixture Preview",
		...(runtimeModule ? { runtimeModule } : {}),
		workspaceRoot: fixtureRoot,
		targets: [
			{
				name: "fixture",
				packageName: "@fixtures/plugin",
				packageRoot: fixtureRoot,
				sourceRoot,
			},
		],
	});
}

function assertPreviewPlugins(
	plugins: ReturnType<typeof createPreviewPlugins>,
) {
	if (!Array.isArray(plugins)) {
		throw new Error(
			"Expected the preview Vite plugin factory to return a plugin array.",
		);
	}

	return plugins;
}

function createMockServer() {
	const watcherHandlers = new Map<string, Array<(filePath: string) => void>>();
	const workspaceModule = { id: "\0virtual:loom-preview-workspace-index" };

	return {
		emit(event: string, filePath: string) {
			for (const handler of watcherHandlers.get(event) ?? []) {
				handler(filePath);
			}
		},
		moduleGraph: {
			getModuleById: vi.fn((id: string) =>
				id === workspaceModule.id ? workspaceModule : undefined,
			),
			invalidateModule: vi.fn(),
		},
		watcher: {
			add: vi.fn(),
			on: vi.fn((event: string, handler: (filePath: string) => void) => {
				const handlers = watcherHandlers.get(event) ?? [];
				handlers.push(handler);
				watcherHandlers.set(event, handlers);
			}),
		},
		ws: {
			send: vi.fn(),
		},
	};
}

function readWorkspaceEntries(previewPlugin: PreviewPlugin) {
	const resolveId = getHookHandler<TestResolveIdHook>(
		previewPlugin.resolveId as TestResolveIdHook | undefined,
	);
	const load = getHookHandler<TestLoadHook>(
		previewPlugin.load as TestLoadHook | undefined,
	);

	const resolvedWorkspaceId = resolveId?.(WORKSPACE_INDEX_MODULE_ID);
	const workspaceModuleCode = load?.(
		resolvedWorkspaceId ?? WORKSPACE_INDEX_MODULE_ID,
	);
	if (typeof workspaceModuleCode !== "string") {
		throw new Error(
			"Expected the preview workspace index module to load as a string.",
		);
	}

	const workspaceMatch = workspaceModuleCode.match(
		/export const previewWorkspaceIndex = (\{[\s\S]*?\});\nexport const previewEntryPayloads =/,
	);
	if (!workspaceMatch) {
		throw new Error(
			`Unable to parse preview workspace module:\n${workspaceModuleCode}`,
		);
	}

	return JSON.parse(workspaceMatch[1] ?? "{}").entries as Array<{
		relativePath: string;
		status: string;
		renderTarget: {
			kind: string;
			reason?: string;
			candidates?: string[];
		};
	}>;
}

function readEntryPayload(previewPlugin: PreviewPlugin, entryId: string) {
	const resolveId = getHookHandler<TestResolveIdHook>(
		previewPlugin.resolveId as TestResolveIdHook | undefined,
	);
	const load = getHookHandler<TestLoadHook>(
		previewPlugin.load as TestLoadHook | undefined,
	);

	const resolvedEntryId = resolveId?.(
		`virtual:loom-preview-entry:${encodeURIComponent(entryId)}`,
	);
	const entryModuleCode = load?.(resolvedEntryId ?? entryId);
	if (typeof entryModuleCode !== "string") {
		throw new Error("Expected the preview entry module to load as a string.");
	}

	const payloadMatch = entryModuleCode.match(
		/export const __previewEntryPayload = (\{[\s\S]*?\});\n/,
	);
	if (!payloadMatch) {
		throw new Error(
			`Unable to parse preview entry module:\n${entryModuleCode}`,
		);
	}

	return JSON.parse(payloadMatch[1] ?? "{}") as {
		descriptor: {
			status: string;
		};
		diagnostics: Array<{
			blocking?: boolean;
			code: string;
			phase: string;
			relativeFile: string;
			severity?: string;
		}>;
		transform: {
			mode: string;
			outcome: {
				kind: string;
			};
		};
	};
}

describe("createPreviewVitePlugin", () => {
	it("uses the configured runtime module for virtual runtime and entry modules", () => {
		const { fixtureRoot, sourceRoot } = createFixtureRoot();
		const sourceFile = path.join(sourceRoot, "CustomRuntimeEntry.loom.tsx");
		const runtimeModulePath = path.join(
			fixtureRoot,
			"runtime",
			"custom-runtime.ts",
		);
		fs.mkdirSync(path.dirname(runtimeModulePath), { recursive: true });
		fs.writeFileSync(
			runtimeModulePath,
			"export const customRuntime = true;\n",
			"utf8",
		);
		fs.writeFileSync(
			sourceFile,
			[
				"export function CustomRuntimeEntry() { return <frame />; }",
				"",
				"export const preview = {",
				"\tentry: CustomRuntimeEntry,",
				"};",
			].join("\n"),
			"utf8",
		);

		const previewPlugin = createPreviewPlugin(
			fixtureRoot,
			sourceRoot,
			runtimeModulePath,
		);
		const resolveId = getHookHandler<TestResolveIdHook>(
			previewPlugin.resolveId as TestResolveIdHook | undefined,
		);
		const load = getHookHandler<TestLoadHook>(
			previewPlugin.load as TestLoadHook | undefined,
		);

		const resolvedRuntimeId = resolveId?.("virtual:loom-preview-runtime");
		const runtimeModuleCode = load?.(
			resolvedRuntimeId ?? "virtual:loom-preview-runtime",
		);
		expect(runtimeModuleCode).toContain(runtimeModulePath.replace(/\\/g, "/"));

		const resolvedEntryId = resolveId?.(
			"virtual:loom-preview-entry:" +
				encodeURIComponent("fixture:CustomRuntimeEntry.loom.tsx"),
		);
		const entryModuleCode = load?.(
			resolvedEntryId ?? "fixture:CustomRuntimeEntry.loom.tsx",
		);
		expect(entryModuleCode).toContain(runtimeModulePath.replace(/\\/g, "/"));
	});

	it("resolves browser runtime shims for preview source imports", () => {
		const { fixtureRoot, sourceRoot } = createFixtureRoot();
		const plugins = assertPreviewPlugins(
			createPreviewPlugins(fixtureRoot, sourceRoot),
		);
		const runtimeResolvePlugin = plugins.find(
			(plugin) =>
				plugin &&
				typeof plugin === "object" &&
				"name" in plugin &&
				plugin.name === "loom-preview-runtime-dependency-resolve",
		);
		if (!runtimeResolvePlugin || typeof runtimeResolvePlugin !== "object") {
			throw new Error(
				"Expected the runtime dependency resolve plugin to be present.",
			);
		}

		const resolveId = getHookHandler<TestResolveIdHook>(
			runtimeResolvePlugin.resolveId as TestResolveIdHook | undefined,
		);
		expect(
			resolveId?.("@rbxts/react-roblox", path.join(sourceRoot, "Entry.tsx")),
		).toBe(
			path
				.resolve(
					process.cwd(),
					"packages/preview/src/source/react-shims/browser/react-roblox.js",
				)
				.replace(/\\/g, "/"),
		);
		expect(resolveId?.("react", path.join(sourceRoot, "Entry.tsx"))).toBe(
			path
				.resolve(
					process.cwd(),
					"packages/preview/src/source/react-shims/browser/react.js",
				)
				.replace(/\\/g, "/"),
		);
		expect(
			resolveId?.("@rbxts/react", path.join(sourceRoot, "Entry.tsx")),
		).toBe(
			path
				.resolve(
					process.cwd(),
					"packages/preview/src/source/react-shims/browser/react.js",
				)
				.replace(/\\/g, "/"),
		);
	});

	it("discovers .loom.tsx preview entries and transforms source files under the target root", async () => {
		const { fixtureRoot, sourceRoot } = createFixtureRoot();
		const entryFile = path.join(sourceRoot, "Button.loom.tsx");
		const plainFile = path.join(sourceRoot, "Button.tsx");
		const helperFile = path.join(sourceRoot, "utils.ts");

		fs.writeFileSync(helperFile, 'export const label = "ready";\n', "utf8");
		fs.writeFileSync(
			plainFile,
			"export function Button() { return <frame />; }\n",
			"utf8",
		);
		fs.writeFileSync(
			entryFile,
			[
				'import { label } from "./utils";',
				"",
				"export function ButtonPreview() {",
				"	return <textlabel Text={label} />;",
				"}",
				"",
				"export const preview = {",
				"	entry: ButtonPreview,",
				"};",
			].join("\n"),
			"utf8",
		);

		const previewPlugin = createPreviewPlugin(fixtureRoot, sourceRoot);
		expect(readWorkspaceEntries(previewPlugin)).toEqual([
			expect.objectContaining({
				relativePath: "Button.loom.tsx",
				status: "ready",
			}),
		]);

		const transform = getHookHandler<TestTransformHook>(
			previewPlugin.transform as TestTransformHook | undefined,
		);
		const loomTransformed = await transform?.(
			fs.readFileSync(entryFile, "utf8"),
			entryFile,
		);
		expect(getHookResultCode(loomTransformed)).toContain("__previewGlobal");

		const plainTransformed = await transform?.(
			fs.readFileSync(plainFile, "utf8"),
			plainFile,
		);
		const plainTransformedCode = getHookResultCode(plainTransformed);
		expect(plainTransformedCode).toContain("__previewGlobal");
		expect(plainTransformedCode).not.toContain("<frame");
	});

	it("injects the configured runtime module when transformed output references __rbxStyle", async () => {
		const { fixtureRoot, sourceRoot } = createFixtureRoot();
		const sourceFile = path.join(sourceRoot, "StyledFrame.loom.tsx");
		const helperModulePath = path.join(sourceRoot, "styleHelper.ts");
		const runtimeModulePath = path.join(
			fixtureRoot,
			"runtime",
			"custom-runtime.ts",
		);
		fs.mkdirSync(path.dirname(runtimeModulePath), { recursive: true });
		fs.writeFileSync(
			runtimeModulePath,
			"export const customRuntime = true;\n",
			"utf8",
		);
		fs.writeFileSync(
			helperModulePath,
			"export function __rbxStyle(value: unknown) { return value; }\n",
			"utf8",
		);
		fs.writeFileSync(
			sourceFile,
			[
				'import { __rbxStyle } from "./styleHelper";',
				"",
				"const previewStyle = __rbxStyle({ BackgroundTransparency: 0.5 });",
				"",
				"export function StyledFrame() {",
				"	void previewStyle;",
				"	return <frame />;",
				"}",
				"",
				"export const preview = {",
				"	entry: StyledFrame,",
				"};",
			].join("\n"),
			"utf8",
		);

		const previewPlugin = createPreviewPlugin(
			fixtureRoot,
			sourceRoot,
			runtimeModulePath,
		);
		const transform = getHookHandler<TestTransformHook>(
			previewPlugin.transform as TestTransformHook | undefined,
		);

		expect(transform).toBeTypeOf("function");
		const transformResult = await transform?.(
			fs.readFileSync(sourceFile, "utf8"),
			sourceFile,
		);
		const transformedCode = getHookResultCode(transformResult);

		expect(transformedCode).toContain(
			`import { __rbxStyle } from ${JSON.stringify(runtimeModulePath.replace(/\\/g, "/"))};`,
		);
	});

	it("registers preview target source roots with the Vite watcher", () => {
		const { fixtureRoot, sourceRoot } = createFixtureRoot();
		const previewPlugin = createPreviewPlugin(fixtureRoot, sourceRoot);
		const configureServer = getHookHandler<TestConfigureServerHook>(
			previewPlugin.configureServer as TestConfigureServerHook | undefined,
		);
		const mockServer = createMockServer();

		configureServer?.(mockServer);

		expect(mockServer.watcher.add).toHaveBeenCalledWith([
			fs.realpathSync(sourceRoot),
		]);
	});

	it("allows normal hot updates when the registry shape is unchanged", async () => {
		const { fixtureRoot, sourceRoot } = createFixtureRoot();
		const sourceFile = path.join(sourceRoot, "AnimatedSlot.tsx");
		fs.writeFileSync(
			sourceFile,
			"export function AnimatedSlot() { return <frame />; }\n",
			"utf8",
		);

		const previewPlugin = createPreviewPlugin(fixtureRoot, sourceRoot);
		const handleHotUpdate = getHookHandler<TestHotUpdateHook>(
			previewPlugin.handleHotUpdate as TestHotUpdateHook | undefined,
		);

		expect(handleHotUpdate).toBeTypeOf("function");
		expect(handleHotUpdate?.({ file: sourceFile })).toEqual([]);
		expect(
			handleHotUpdate?.({ file: path.join(fixtureRoot, "README.md") }),
		).toBe(undefined);
	});

	it("treats tracked workspace dependencies outside the target source root as hot-update candidates", () => {
		const { fixtureRoot, sourceRoot } = createFixtureRoot();
		const sharedRoot = path.join(fixtureRoot, "shared");
		const sourceFile = path.join(sourceRoot, "AnimatedSlot.loom.tsx");
		const dependencyFile = path.join(sharedRoot, "buildInfo.ts");
		fs.mkdirSync(sharedRoot, { recursive: true });
		fs.writeFileSync(dependencyFile, 'export const LABEL = "one";\n', "utf8");
		fs.writeFileSync(
			sourceFile,
			`
        import { LABEL } from "../shared/buildInfo";

        export function AnimatedSlot() {
          return <textlabel Text={LABEL} />;
        }

        export const preview = {
          entry: AnimatedSlot,
        };
      `,
			"utf8",
		);

		const previewPlugin = createPreviewPlugin(fixtureRoot, sourceRoot);
		const configureServer = getHookHandler<TestConfigureServerHook>(
			previewPlugin.configureServer as TestConfigureServerHook | undefined,
		);
		const handleHotUpdate = getHookHandler<TestHotUpdateHook>(
			previewPlugin.handleHotUpdate as TestHotUpdateHook | undefined,
		);
		const mockServer = createMockServer();

		configureServer?.(mockServer);

		fs.writeFileSync(dependencyFile, 'export const LABEL = "two";\n', "utf8");

		expect(handleHotUpdate?.({ file: dependencyFile })).toEqual([]);
		expect(mockServer.moduleGraph.invalidateModule).toHaveBeenCalledTimes(1);
		expect(mockServer.ws.send).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({
					changedEntryIds: ["fixture:AnimatedSlot.loom.tsx"],
				}),
				event: "loom-preview:update",
				type: "custom",
			}),
		);
	});

	it("refreshes the workspace index and sends custom hmr updates for add, delete, rename, and non-target watcher events", () => {
		const { fixtureRoot, sourceRoot } = createFixtureRoot();
		const sourceFile = path.join(sourceRoot, "AnimatedSlot.loom.tsx");
		const addedFile = path.join(sourceRoot, "FreshSlot.loom.tsx");
		const renamedFile = path.join(sourceRoot, "RenamedSlot.loom.tsx");
		fs.writeFileSync(
			sourceFile,
			"export function AnimatedSlot() { return <frame />; }\n",
			"utf8",
		);

		const previewPlugin = createPreviewPlugin(fixtureRoot, sourceRoot);
		const configureServer = getHookHandler<TestConfigureServerHook>(
			previewPlugin.configureServer as TestConfigureServerHook | undefined,
		);
		const mockServer = createMockServer();

		configureServer?.(mockServer);

		expect(
			readWorkspaceEntries(previewPlugin).map((entry) => entry.relativePath),
		).toEqual(["AnimatedSlot.loom.tsx"]);

		fs.writeFileSync(
			addedFile,
			"export function FreshSlot() { return <frame />; }\n",
			"utf8",
		);
		mockServer.emit("add", addedFile);
		expect(
			readWorkspaceEntries(previewPlugin).map((entry) => entry.relativePath),
		).toEqual(["AnimatedSlot.loom.tsx", "FreshSlot.loom.tsx"]);

		fs.renameSync(addedFile, renamedFile);
		mockServer.emit("unlink", addedFile);
		mockServer.emit("add", renamedFile);
		expect(
			readWorkspaceEntries(previewPlugin).map((entry) => entry.relativePath),
		).toEqual(["AnimatedSlot.loom.tsx", "RenamedSlot.loom.tsx"]);

		mockServer.emit("add", path.join(fixtureRoot, "README.md"));
		expect(
			readWorkspaceEntries(previewPlugin).map((entry) => entry.relativePath),
		).toEqual(["AnimatedSlot.loom.tsx", "RenamedSlot.loom.tsx"]);

		fs.rmSync(renamedFile);
		mockServer.emit("unlink", renamedFile);
		expect(
			readWorkspaceEntries(previewPlugin).map((entry) => entry.relativePath),
		).toEqual(["AnimatedSlot.loom.tsx"]);

		expect(mockServer.moduleGraph.invalidateModule).toHaveBeenCalledTimes(4);
		expect(mockServer.ws.send).toHaveBeenCalledTimes(4);
		expect(mockServer.ws.send).toHaveBeenCalledWith(
			expect.objectContaining({
				event: "loom-preview:update",
				type: "custom",
			}),
		);
	});

	it("recomputes entry status and render targets before sending entry-scoped updates", () => {
		const { fixtureRoot, sourceRoot } = createFixtureRoot();
		const sourceFile = path.join(sourceRoot, "AnimatedSlot.loom.tsx");
		fs.writeFileSync(
			sourceFile,
			`
        export function AnimatedSlot() {
          return <frame />;
        }

        export const preview = {
          entry: AnimatedSlot,
        };
      `,
			"utf8",
		);

		const previewPlugin = createPreviewPlugin(fixtureRoot, sourceRoot);
		const configureServer = getHookHandler<TestConfigureServerHook>(
			previewPlugin.configureServer as TestConfigureServerHook | undefined,
		);
		const handleHotUpdate = getHookHandler<TestHotUpdateHook>(
			previewPlugin.handleHotUpdate as TestHotUpdateHook | undefined,
		);
		const mockServer = createMockServer();

		configureServer?.(mockServer);

		expect(readWorkspaceEntries(previewPlugin)).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					relativePath: "AnimatedSlot.loom.tsx",
					status: "ready",
				}),
			]),
		);

		fs.writeFileSync(
			sourceFile,
			`
        export function Alpha() {
          return <frame />;
        }

        export function Beta() {
          return <frame />;
        }
      `,
			"utf8",
		);
		expect(handleHotUpdate?.({ file: sourceFile })).toEqual([]);
		expect(readWorkspaceEntries(previewPlugin)).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					relativePath: "AnimatedSlot.loom.tsx",
					status: "ambiguous",
					renderTarget: expect.objectContaining({
						kind: "none",
						reason: "ambiguous-exports",
						candidates: ["Alpha", "Beta"],
					}),
				}),
			]),
		);

		fs.writeFileSync(sourceFile, "export const value = 1;\n", "utf8");
		expect(handleHotUpdate?.({ file: sourceFile })).toEqual([]);
		expect(readWorkspaceEntries(previewPlugin)).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					relativePath: "AnimatedSlot.loom.tsx",
					status: "needs_harness",
					renderTarget: expect.objectContaining({
						kind: "none",
						reason: "no-component-export",
					}),
				}),
			]),
		);

		fs.writeFileSync(
			sourceFile,
			`
        export default function AnimatedSlot() {
          return <frame />;
        }

        export const preview = {
          render: AnimatedSlot,
        };
      `,
			"utf8",
		);
		expect(handleHotUpdate?.({ file: sourceFile })).toEqual([]);
		expect(readWorkspaceEntries(previewPlugin)).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					relativePath: "AnimatedSlot.loom.tsx",
					status: "ready",
				}),
			]),
		);

		expect(mockServer.moduleGraph.invalidateModule).toHaveBeenCalledTimes(3);
		expect(mockServer.ws.send).toHaveBeenCalledTimes(3);
	});

	it("loads entry payloads with transform diagnostics on demand", () => {
		const { fixtureRoot, sourceRoot } = createFixtureRoot();
		const sourceFile = path.join(sourceRoot, "Broken.loom.tsx");
		fs.writeFileSync(
			sourceFile,
			`
        export function Broken() {
          return <part />;
        }

        export const preview = {
          entry: Broken,
        };
      `,
			"utf8",
		);

		const previewPlugin = createPreviewPlugin(fixtureRoot, sourceRoot);
		const entryPayload = readEntryPayload(
			previewPlugin,
			"fixture:Broken.loom.tsx",
		);

		expect(entryPayload.descriptor.status).toBe("blocked_by_transform");
		expect(entryPayload.transform).toEqual({
			mode: "strict-fidelity",
			outcome: {
				fidelity: "degraded",
				kind: "blocked",
			},
		});
		expect(entryPayload.diagnostics).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					blocking: true,
					code: "UNSUPPORTED_HOST_ELEMENT",
					phase: "transform",
					relativeFile: "src/Broken.loom.tsx",
					severity: "error",
				}),
			]),
		);
	});
});
