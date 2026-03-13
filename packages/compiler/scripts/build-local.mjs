import { existsSync } from "node:fs";
import {
	copyFile,
	mkdir,
	readdir,
	rm,
	stat,
	unlink,
	writeFile,
} from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { getPassthroughArgs, runNapi } from "./napi-cli.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PACKAGE_DIR = dirname(SCRIPT_DIR);
const NATIVE_DIR = join(PACKAGE_DIR, ".native");
const TEMP_OUTPUT_DIR = join(NATIVE_DIR, "build-tmp");
const LOCAL_BINARIES_DIR = join(NATIVE_DIR, "local");
const MANIFEST_PATH = join(NATIVE_DIR, "manifest.json");
const ROOT_INDEX_JS_PATH = join(PACKAGE_DIR, "index.js");
const ROOT_INDEX_D_TS_PATH = join(PACKAGE_DIR, "index.d.ts");
const MAX_LOCAL_BINARIES = 5;

async function main() {
	await rm(TEMP_OUTPUT_DIR, { force: true, recursive: true });
	await mkdir(TEMP_OUTPUT_DIR, { recursive: true });
	await mkdir(LOCAL_BINARIES_DIR, { recursive: true });

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

	const binaryFileName = await getSingleBinaryFileName(TEMP_OUTPUT_DIR);
	const sourceBinaryPath = join(TEMP_OUTPUT_DIR, binaryFileName);
	const versionedBinaryFileName = createVersionedBinaryFileName(binaryFileName);
	const localBinaryPath = join(LOCAL_BINARIES_DIR, versionedBinaryFileName);

	await copyFile(sourceBinaryPath, localBinaryPath);
	await copyGeneratedBindings();
	await writeManifest(localBinaryPath);
	await pruneOldLocalBinaries(versionedBinaryFileName);
	await rm(TEMP_OUTPUT_DIR, { force: true, recursive: true });
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

function createVersionedBinaryFileName(binaryFileName) {
	const timestamp = new Date().toISOString().replace(/[-:.TZ]/g, "");
	return binaryFileName.replace(/\.node$/, `.dev-${timestamp}.node`);
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
		builtAt: new Date().toISOString(),
		entry: relative(PACKAGE_DIR, localBinaryPath).replaceAll("\\", "/"),
	};

	await writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
}

async function pruneOldLocalBinaries(currentBinaryFileName) {
	const entries = await readdir(LOCAL_BINARIES_DIR, { withFileTypes: true });
	const binaryEntries = await Promise.all(
		entries
			.filter((entry) => entry.isFile() && entry.name.endsWith(".node"))
			.map(async (entry) => ({
				name: entry.name,
				path: join(LOCAL_BINARIES_DIR, entry.name),
				stats: await stat(join(LOCAL_BINARIES_DIR, entry.name)),
			})),
	);

	const staleEntries = binaryEntries
		.filter((entry) => entry.name !== currentBinaryFileName)
		.sort((left, right) => right.stats.mtimeMs - left.stats.mtimeMs)
		.slice(MAX_LOCAL_BINARIES - 1);

	await Promise.all(
		staleEntries.map(async (entry) => {
			try {
				await unlink(entry.path);
			} catch {
				// Ignore stale binaries that are still locked by another process.
			}
		}),
	);
}

await main();
