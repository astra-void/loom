import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runCommand } from "./napi-cli.mjs";

const require = createRequire(import.meta.url);
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PACKAGE_DIR = dirname(SCRIPT_DIR);
const TSC_PATH = require.resolve("typescript/bin/tsc");

export function buildWrapperTypes() {
	return runCommand(
		process.execPath,
		[TSC_PATH, "-p", resolve(PACKAGE_DIR, "tsconfig.types.json")],
		{
			cwd: PACKAGE_DIR,
		},
	);
}

if (
	process.argv[1] &&
	resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	buildWrapperTypes();
}
