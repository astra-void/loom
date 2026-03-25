import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import topLevelAwait from "vite-plugin-top-level-await";
import wasm from "vite-plugin-wasm";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
	resolve: {
		alias: [
			{
				find: /^@loom-dev\/compiler\/wasm$/,
				replacement: path.resolve(
					__dirname,
					"../../packages/compiler/wasm.mjs",
				),
			},
		],
	},
	plugins: [react(), wasm(), topLevelAwait()],
	assetsInclude: ["**/*.wasm"],
	optimizeDeps: {
		exclude: ["@loom-dev/compiler"],
	},
	server: {
		host: "127.0.0.1",
		port: 4175,
	},
});
