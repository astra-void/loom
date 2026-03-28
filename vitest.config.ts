import path from "node:path";
import topLevelAwait from "vite-plugin-top-level-await";
import wasm from "vite-plugin-wasm";
import { defineConfig } from "vitest/config";

const workspaceRoot = __dirname;
const layoutEngineWasmPath = path.resolve(
	workspaceRoot,
	"packages/layout-engine/pkg/layout_engine_bg.wasm",
);

export default defineConfig({
	plugins: [wasm(), topLevelAwait()],
	resolve: {
		alias: [
			{
				find: "virtual:loom-preview-workspace-index",
				replacement: path.resolve(
					workspaceRoot,
					"tests/mocks/virtualPreviewWorkspaceIndex.ts",
				),
			},
			{
				find: /^@loom-dev\/compiler$/,
				replacement: path.resolve(
					workspaceRoot,
					"packages/compiler/sync.mjs",
				),
			},
			{
				find: /^@loom-dev\/compiler\/wasm$/,
				replacement: path.resolve(workspaceRoot, "packages/compiler/wasm.mjs"),
			},
			{
				find: "@loom-dev/layout-engine/layout_engine_bg.wasm?url",
				replacement: `${layoutEngineWasmPath}?url`,
			},
			{
				find: "@loom-dev/layout-engine/layout_engine_bg.wasm",
				replacement: layoutEngineWasmPath,
			},
			{
				find: "@loom-dev/layout-engine",
				replacement: path.resolve(
					workspaceRoot,
					"packages/layout-engine/pkg/layout_engine.js",
				),
			},
			{
				find: "@loom-dev/preview-engine",
				replacement: path.resolve(
					workspaceRoot,
					"packages/preview-engine/src/index.ts",
				),
			},
			{
				find: "@loom-dev/preview-runtime",
				replacement: path.resolve(
					workspaceRoot,
					"packages/preview-runtime/src/index.ts",
				),
			},
		],
	},
	optimizeDeps: {
		exclude: [
			"@loom-dev/layout-engine",
			"@loom-dev/layout-engine/layout_engine_bg.wasm?url",
		],
	},
	test: {
		include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
		maxWorkers: 4,
	},
});
