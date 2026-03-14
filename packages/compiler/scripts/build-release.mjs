import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildWrapperTypes } from "./build-wrapper-types.mjs";
import { getPassthroughArgs, runNapi } from "./napi-cli.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PACKAGE_DIR = dirname(SCRIPT_DIR);
const result = runNapi(
	[
		"build",
		"--platform",
		"--release",
		"--cross-compile",
		...getPassthroughArgs(),
	],
	{ check: false, cwd: PACKAGE_DIR },
);

if (result.status !== 0) {
	process.exit(result.status ?? 1);
}

buildWrapperTypes();
