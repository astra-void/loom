/**
 * Capture every parity fixture scene from Loom into `<outDir>/<scene>.json`.
 *
 * Thin cross-platform wrapper: it runs the Vitest capture spec (which needs
 * jsdom + the WASM layout engine) with `LOOM_PARITY_OUT` set via the child
 * environment, so it works on Windows too (inline `VAR=...` does not).
 *
 *   pnpm parity:capture [outDir] [-- --viewport 1280x720]
 */

import { spawnSync } from "node:child_process";
import path from "node:path";

const passthrough = process.argv.slice(2);
const outArg = passthrough.find((arg) => !arg.startsWith("-"));
const outDir = path.resolve(process.cwd(), outArg ?? "parity-out/loom");

const viewportIndex = passthrough.indexOf("--viewport");
const viewport =
	viewportIndex >= 0 ? passthrough[viewportIndex + 1] : undefined;

const result = spawnSync(
	"pnpm",
	["exec", "vitest", "run", "tests/parity/captureLoom.parity.test.tsx"],
	{
		stdio: "inherit",
		shell: process.platform === "win32",
		env: {
			...process.env,
			LOOM_PARITY_OUT: outDir,
			...(viewport ? { LOOM_PARITY_VIEWPORT: viewport } : {}),
		},
	},
);

if (result.status === 0) {
	console.log(`\n[parity] captured Loom scenes -> ${outDir}`);
}

process.exit(result.status ?? 1);
