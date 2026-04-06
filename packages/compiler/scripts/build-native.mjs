import { existsSync } from "node:fs";
import { copyFile, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { getNativeTarget } from "../../../scripts/native-target.mjs";
import { buildWrapperTypes } from "./build-wrapper-types.mjs";
import { getPassthroughArgs, runNapi } from "./napi-cli.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PACKAGE_DIR = dirname(SCRIPT_DIR);
const NATIVE_DIR = join(PACKAGE_DIR, ".native");
const TEMP_OUTPUT_DIR = join(NATIVE_DIR, "build-tmp");
const LOCAL_BINARIES_DIR = join(NATIVE_DIR, "local");
const MANIFEST_PATH = join(NATIVE_DIR, "manifest.json");
const ROOT_INDEX_JS_PATH = join(PACKAGE_DIR, "index.js");
const ROOT_INDEX_D_TS_PATH = join(PACKAGE_DIR, "index.d.ts");

async function main() {
	await rm(TEMP_OUTPUT_DIR, { force: true, recursive: true });
	await mkdir(TEMP_OUTPUT_DIR, { recursive: true });
	await mkdir(LOCAL_BINARIES_DIR, { recursive: true });

	const passthroughArgs = getPassthroughArgs();
	const target = getTargetTriple(passthroughArgs);
	const buildArgs = [
		"build",
		"--platform",
		"--release",
		"--output-dir",
		TEMP_OUTPUT_DIR,
	];

	if (target && target !== getNativeTarget()) {
		buildArgs.push("--cross-compile");
	}

	buildArgs.push(...passthroughArgs);

	const result = runNapi(
		buildArgs,
		{
			check: false,
			cwd: PACKAGE_DIR,
		},
	);

	if (result.status !== 0) {
		process.exit(result.status ?? 1);
	}

	const binaryFileName = await getSingleBinaryFileName(TEMP_OUTPUT_DIR);
	const sourceBinaryPath = join(TEMP_OUTPUT_DIR, binaryFileName);
	const localBinaryPath = join(LOCAL_BINARIES_DIR, binaryFileName);
	const rootBinaryPath = join(PACKAGE_DIR, binaryFileName);

	await copyFile(sourceBinaryPath, localBinaryPath);
	await copyFile(sourceBinaryPath, rootBinaryPath);
	await copyGeneratedBindings();
	buildWrapperTypes();
	await writeManifest(localBinaryPath);
	await pruneStaleLocalBinaries(binaryFileName);
	await rm(TEMP_OUTPUT_DIR, { force: true, recursive: true });
}

function getTargetTriple(args) {
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];

		if (arg === "--target" || arg === "-t") {
			return args[index + 1] ?? null;
		}
	}

	return null;
}

async function getSingleBinaryFileName(directoryPath) {
	const entries = await readdir(directoryPath, { withFileTypes: true });
	const binaryFileNames = entries
		.filter((entry) => entry.isFile() && entry.name.endsWith(".node"))
		.map((entry) => entry.name)
		.sort();

	if (binaryFileNames.length !== 1) {
		throw new Error(
			`Expected exactly one built .node artifact in ${directoryPath}, found ${binaryFileNames.length}.`,
		);
	}

	return binaryFileNames[0];
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

async function writeManifest(localBinaryPath) {
	const manifest = {
		entry: relative(PACKAGE_DIR, localBinaryPath).replaceAll("\\", "/"),
	};

	await writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
}

async function pruneStaleLocalBinaries(currentBinaryFileName) {
	const entries = await readdir(LOCAL_BINARIES_DIR, { withFileTypes: true });
	await Promise.all(
		entries
			.filter(
				(entry) =>
					entry.isFile() &&
					entry.name.endsWith(".node") &&
					entry.name !== currentBinaryFileName,
			)
			.map(async (entry) => {
				try {
					await rm(join(LOCAL_BINARIES_DIR, entry.name), { force: true });
				} catch {
					// Ignore stale binaries that are still locked by another process.
				}
			}),
	);
}

await main();
