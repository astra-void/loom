import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
	const previewEngine = {
		getSnapshot: vi.fn(() => ({
			entries: {},
			protocolVersion: 1,
			workspaceIndex: {
				entries: [],
				projectName: "Fixture Preview",
				protocolVersion: 1,
				targets: [],
			},
		})),
	};
	const workspaceGraphService = {
		resolveImport: vi.fn(() => ({
			followedFilePath: "/virtual/shared.tsx",
		})),
		workspaceRoot: "/virtual",
	};

	return {
		createPreviewEngine: vi.fn(() => previewEngine),
		createWorkspaceGraphService: vi.fn(() => workspaceGraphService),
		previewEngine,
		workspaceGraphService,
	};
});

vi.mock("@loom-dev/preview-engine", async () => {
	const actual = await vi.importActual<typeof import("@loom-dev/preview-engine")>(
		"@loom-dev/preview-engine",
	);
	return {
		...actual,
		createPreviewEngine: mocks.createPreviewEngine,
		createWorkspaceGraphService: mocks.createWorkspaceGraphService,
	};
});

const temporaryRoots: string[] = [];

afterEach(() => {
	for (const root of temporaryRoots.splice(0)) {
		fs.rmSync(root, { force: true, recursive: true });
	}
	mocks.createPreviewEngine.mockClear();
	mocks.createWorkspaceGraphService.mockClear();
	mocks.previewEngine.getSnapshot.mockClear();
	mocks.workspaceGraphService.resolveImport.mockClear();
});

function createFixtureRoot() {
	const fixtureRoot = fs.mkdtempSync(
		path.join(os.tmpdir(), "loom-preview-plugin-lazy-"),
	);
	temporaryRoots.push(fixtureRoot);

	const sourceRoot = path.join(fixtureRoot, "src");
	fs.mkdirSync(sourceRoot, { recursive: true });
	fs.writeFileSync(
		path.join(fixtureRoot, "package.json"),
		JSON.stringify({ name: "@fixtures/plugin" }, null, 2),
		"utf8",
	);
	fs.writeFileSync(
		path.join(sourceRoot, "Entry.tsx"),
		"export const Entry = 1;\n",
		"utf8",
	);

	return {
		fixtureRoot,
		sourceRoot,
	};
}

function createMockServer() {
	return {
		moduleGraph: {
			getModuleById: vi.fn(() => undefined),
			invalidateModule: vi.fn(),
		},
		watcher: {
			add: vi.fn(),
			on: vi.fn(),
		},
		ws: {
			on: vi.fn(),
			send: vi.fn(),
		},
	};
}

function findPlugin<T extends { name?: string }>(
	plugins: Array<T | T[] | null | undefined>,
	name: string,
) {
	const plugin = plugins.find(
		(candidate): candidate is T =>
			Boolean(candidate) &&
			!Array.isArray(candidate) &&
			typeof candidate === "object" &&
			"name" in candidate &&
			candidate.name === name,
	);
	if (!plugin) {
		throw new Error(`Missing plugin: ${name}`);
	}

	return plugin;
}

describe("createPreviewVitePlugin lazy initialization", () => {
	it("defers engine and workspace graph creation until hooks need them", async () => {
		const { createPreviewVitePlugin } = await import(
			"../../packages/preview/src/source/plugin"
		);
		const { fixtureRoot, sourceRoot } = createFixtureRoot();
		const plugins = createPreviewVitePlugin({
			projectName: "Fixture Preview",
			targets: [
				{
					name: "fixture",
					packageName: "@fixtures/plugin",
					packageRoot: fixtureRoot,
					sourceRoot,
				},
			],
			workspaceRoot: fixtureRoot,
		});

		expect(mocks.createPreviewEngine).not.toHaveBeenCalled();
		expect(mocks.createWorkspaceGraphService).not.toHaveBeenCalled();

		const previewPlugin = findPlugin(plugins, "loom-preview-source-first");
		previewPlugin.configureServer?.(createMockServer() as never);

		expect(mocks.createPreviewEngine).not.toHaveBeenCalled();
		expect(mocks.createWorkspaceGraphService).not.toHaveBeenCalled();

		const resolveId = previewPlugin.resolveId as
			| ((id: string) => string | undefined)
			| undefined;
		const load = previewPlugin.load as
			| ((id: string) => string | undefined)
			| undefined;
		const resolvedWorkspaceId = resolveId?.("virtual:loom-preview-workspace-index");
		const workspaceModuleCode = load?.(
			resolvedWorkspaceId ?? "virtual:loom-preview-workspace-index",
		);

		expect(mocks.createPreviewEngine).toHaveBeenCalledTimes(1);
		expect(mocks.createWorkspaceGraphService).not.toHaveBeenCalled();
		expect(workspaceModuleCode).toContain("previewWorkspaceIndex");

		const workspaceResolvePlugin = findPlugin(
			plugins,
			"loom-preview-workspace-source-resolve",
		);
		const workspaceResolveId = workspaceResolvePlugin.resolveId as
			| ((id: string, importer?: string) => string | undefined)
			| undefined;
		const resolvedSharedPath = workspaceResolveId?.(
			"shared/utils",
			path.join(sourceRoot, "Entry.tsx"),
		);

		expect(mocks.createWorkspaceGraphService).toHaveBeenCalledTimes(1);
		expect(resolvedSharedPath).toBe("/virtual/shared.tsx");
	});
});
