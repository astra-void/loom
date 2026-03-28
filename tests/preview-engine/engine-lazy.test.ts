import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	discoverWorkspaceState: vi.fn(),
}));

vi.mock("../../packages/preview-engine/src/discover", async () => {
	const actual = await vi.importActual<
		typeof import("../../packages/preview-engine/src/discover")
	>("../../packages/preview-engine/src/discover");
	return {
		...actual,
		discoverWorkspaceState: mocks.discoverWorkspaceState,
	};
});

const temporaryRoots: string[] = [];

afterEach(() => {
	for (const root of temporaryRoots.splice(0)) {
		fs.rmSync(root, { force: true, recursive: true });
	}
	mocks.discoverWorkspaceState.mockReset();
});

function createTempRoot(prefix: string) {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
	temporaryRoots.push(root);
	return root;
}

describe("createPreviewEngine", () => {
	it("defers workspace discovery until a snapshot is requested", async () => {
		const { createPreviewEngine } = await import(
			"../../packages/preview-engine/src/engine"
		);
		const compiler = await import("../../packages/compiler/sync.mjs");
		const workspaceRoot = createTempRoot("loom-preview-engine-lazy-");
		const packageRoot = path.join(workspaceRoot, "packages", "fixture");
		const sourceRoot = path.join(packageRoot, "src");
		const target = {
			name: "fixture",
			packageName: "@fixtures/preview-engine",
			packageRoot,
			sourceRoot,
		};

		mocks.discoverWorkspaceState.mockReturnValue({
			entryDependencyPathsById: new Map(),
			entryStatesById: new Map(),
			workspaceIndex: {
				entries: [],
				projectName: "Fixture Preview",
				protocolVersion: 1,
				targets: [target],
			},
		});

		const engine = createPreviewEngine({
			compiler,
			projectName: "Fixture Preview",
			targets: [target],
			workspaceRoot,
		});

		expect(mocks.discoverWorkspaceState).not.toHaveBeenCalled();

		engine.getSnapshot();

		expect(mocks.discoverWorkspaceState).toHaveBeenCalledTimes(1);
		expect(mocks.discoverWorkspaceState).toHaveBeenCalledWith({
			projectName: "Fixture Preview",
			targets: [target],
			workspaceRoot,
		});
	});
});
