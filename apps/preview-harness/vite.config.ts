import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadPreviewConfig } from "@loom-dev/preview/config";
import { createPreviewVitePlugin } from "@loom-dev/preview/vite";
import type { PreviewExecutionMode } from "@loom-dev/preview-engine";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import topLevelAwait from "vite-plugin-top-level-await";
import wasm from "vite-plugin-wasm";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const _workspaceRoot = path.resolve(__dirname, "../..");
const previewEngineEntry = "@loom-dev/preview-engine";
const previewRuntimeEntry = path
	.resolve(__dirname, "./src/mocks/roblox-env.ts")
	.split(path.sep)
	.join("/");
const previewConfig = await loadPreviewConfig({ cwd: __dirname });
const previewConfigRecord = previewConfig as Record<string, unknown>;

function isPreviewExecutionMode(value: unknown): value is PreviewExecutionMode {
	return (
		value === "strict-fidelity" ||
		value === "compatibility" ||
		value === "mocked" ||
		value === "design-time"
	);
}

const transformMode = isPreviewExecutionMode(previewConfigRecord.transformMode)
	? previewConfigRecord.transformMode
	: undefined;

export default defineConfig({
	resolve: {
		alias: [
			{
				find: "@loom-dev/preview-engine",
				replacement: previewEngineEntry,
			},
			{
				find: "@loom-dev/preview-runtime",
				replacement: previewConfig.runtimeModule ?? previewRuntimeEntry,
			},
		],
	},
	plugins: [
		await createPreviewVitePlugin({
			projectName: previewConfig.projectName,
			runtimeModule: previewConfig.runtimeModule ?? previewRuntimeEntry,
			targets: previewConfig.targets,
			transformMode,
			workspaceRoot: previewConfig.workspaceRoot,
		}),
		react(),
		wasm(),
		topLevelAwait(),
	],
	assetsInclude: ["**/*.wasm"],
	optimizeDeps: {
		exclude: ["@loom-dev/layout-engine", "layout-engine"],
	},
	server: {
		fs: {
			allow: previewConfig.server.fsAllow,
		},
		host: previewConfig.server.host,
		open: previewConfig.server.open,
		port: previewConfig.server.port,
	},
});
