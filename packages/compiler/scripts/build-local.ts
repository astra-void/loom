import { existsSync } from "node:fs";
import { copyFile, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildWrapperTypes } from "./build-wrapper-types.ts";
import { getPassthroughArgs, runNapi } from "./napi-cli.ts";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PACKAGE_DIR = dirname(SCRIPT_DIR);
const TEMP_OUTPUT_DIR = join(PACKAGE_DIR, ".native", "build-tmp");
const ROOT_INDEX_JS_PATH = join(PACKAGE_DIR, "index.js");
const ROOT_INDEX_D_TS_PATH = join(PACKAGE_DIR, "index.d.ts");

async function main() {
	await rm(TEMP_OUTPUT_DIR, { force: true, recursive: true });
	await mkdir(TEMP_OUTPUT_DIR, { recursive: true });

	const result = runNapi(
		[
			"build",
			"--platform",
			"--output-dir",
			TEMP_OUTPUT_DIR,
			...getPassthroughArgs(),
		],
		{
			check: false,
			cwd: PACKAGE_DIR,
		},
	);

	if (result.status !== 0) {
		process.exit(result.status ?? 1);
	}

	await copyGeneratedBindings();
	buildWrapperTypes();
	await rm(TEMP_OUTPUT_DIR, { force: true, recursive: true });
}

async function copyGeneratedBindings() {
	const tempIndexJsPath = join(TEMP_OUTPUT_DIR, "index.js");
	const tempIndexDtsPath = join(TEMP_OUTPUT_DIR, "index.d.ts");

	if (!existsSync(tempIndexJsPath)) {
		throw new Error("Missing generated index.js from napi build output.");
	}

	await copyFile(tempIndexJsPath, ROOT_INDEX_JS_PATH);

	if (existsSync(tempIndexDtsPath)) {
		await copyFile(tempIndexDtsPath, ROOT_INDEX_D_TS_PATH);
	} else if (!existsSync(ROOT_INDEX_D_TS_PATH)) {
		throw new Error("Missing generated index.d.ts from napi build output.");
	}
}

await main();
