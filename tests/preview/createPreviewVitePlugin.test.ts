import path from "node:path";
import { describe, expect, it } from "vitest";
import { createPreviewVitePlugin } from "../../packages/preview/src/vite";

describe("createPreviewVitePlugin", () => {
	it("does not block compatibility transforms for non-blocking diagnostics", async () => {
		const sourceRoot = path.resolve(
			process.cwd(),
			"tests/fixtures/preview-target",
		);
		const sourceFilePath = path.join(sourceRoot, "Example.ts");
		const plugins = createPreviewVitePlugin({
			previewEngine: {} as never,
			projectName: "test-project",
			runtimeModule: "@loom-dev/preview-runtime",
			targets: [
				{
					name: "fixture",
					packageRoot: sourceRoot,
					sourceRoot,
				},
			],
			transformMode: "compatibility",
			workspaceRoot: process.cwd(),
		});
		const previewPlugin = plugins.find(
			(plugin) =>
				typeof plugin === "object" &&
				plugin !== null &&
				"name" in plugin &&
				plugin.name === "loom-preview-source-first",
		);

		if (
			typeof previewPlugin !== "object" ||
			previewPlugin === null ||
			!("transform" in previewPlugin) ||
			typeof previewPlugin.transform !== "function"
		) {
			throw new Error("Expected preview source-first plugin transform hook.");
		}

		const result = await previewPlugin.transform(
			"export const value = foo;",
			sourceFilePath,
		);

		expect(result).toBeDefined();
		expect(result?.code).toContain('__previewGlobal("foo")');
	});
});
