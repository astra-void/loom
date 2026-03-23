import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, readFile, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const declarationTargets = [
	{
		label: "@loom-dev/preview-runtime",
		tsconfig: "packages/preview-runtime/tsconfig.json",
		typesDir: "packages/preview-runtime/types",
	},
	{
		label: "@loom-dev/preview-engine",
		tsconfig: "packages/preview-engine/tsconfig.json",
		typesDir: "packages/preview-engine/types",
	},
	{
		label: "@loom-dev/preview",
		tsconfig: "packages/preview/tsconfig.json",
		typesDir: "packages/preview/types",
	},
	{
		label: "loom-dev",
		tsconfig: "packages/cli/tsconfig.json",
		typesDir: "packages/cli/types",
	},
];

const noEmitChecks = [
	"packages/preview-runtime/tsconfig.json",
	"packages/preview-engine/tsconfig.json",
	"packages/preview/tsconfig.json",
	"packages/cli/tsconfig.json",
	"apps/preview-harness/tsconfig.json",
	"tests/compiler/tsconfig.json",
	"tests/preview/tsconfig.json",
];

const hiddenArtifacts = [
	"packages/preview-runtime/dist",
	"packages/preview-engine/dist",
	"packages/preview/dist",
	"packages/cli/dist",
	"packages/layout-engine/pkg",
];

function runCommand(args) {
	console.error(`$ ${args.join(" ")}`);
	const result = spawnSync(args[0], args.slice(1), {
		cwd: ROOT_DIR,
		env: process.env,
		stdio: "inherit",
	});

	if (result.status !== 0) {
		throw new Error(`Command failed: ${args.join(" ")}`);
	}
}

async function listFiles(directoryPath, prefix = "") {
	const entries = await readdir(directoryPath, { withFileTypes: true });
	const files = [];

	for (const entry of entries.sort((left, right) =>
		left.name.localeCompare(right.name),
	)) {
		const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
		const absolutePath = join(directoryPath, entry.name);

		if (entry.isDirectory()) {
			files.push(...(await listFiles(absolutePath, relativePath)));
			continue;
		}

		files.push(relativePath);
	}

	return files;
}

async function compareDirectories(expectedDir, actualDir) {
	const [expectedFiles, actualFiles] = await Promise.all([
		listFiles(expectedDir),
		listFiles(actualDir),
	]);

	if (expectedFiles.join("\n") !== actualFiles.join("\n")) {
		throw new Error(
			[
				`Declaration file list mismatch for ${relative(ROOT_DIR, actualDir)}.`,
				`Expected: ${expectedFiles.join(", ") || "(none)"}`,
				`Actual: ${actualFiles.join(", ") || "(none)"}`,
			].join("\n"),
		);
	}

	for (const relativePath of expectedFiles) {
		const [expectedContent, actualContent] = await Promise.all([
			readFile(join(expectedDir, relativePath), "utf8"),
			readFile(join(actualDir, relativePath), "utf8"),
		]);

		if (expectedContent !== actualContent) {
			throw new Error(
				`Declaration content mismatch for ${relative(ROOT_DIR, join(actualDir, relativePath))}.`,
			);
		}
	}
}

async function withHiddenArtifacts(callback) {
	const tempRoot = await mkdtemp(join(tmpdir(), "loom-dts-hidden-"));
	const movedArtifacts = [];

	try {
		for (const artifactPath of hiddenArtifacts) {
			const absoluteArtifactPath = resolve(ROOT_DIR, artifactPath);
			if (!existsSync(absoluteArtifactPath)) {
				continue;
			}

			const hiddenPath = join(tempRoot, artifactPath.replaceAll("/", "__"));
			await rename(absoluteArtifactPath, hiddenPath);
			movedArtifacts.push({ hiddenPath, originalPath: absoluteArtifactPath });
		}

		await callback(tempRoot);
	} finally {
		for (const artifact of movedArtifacts.reverse()) {
			await rename(artifact.hiddenPath, artifact.originalPath);
		}

		await rm(tempRoot, { force: true, recursive: true });
	}
}

async function emitDeclarations(target, tempRoot) {
	const outputDir = join(tempRoot, target.label.replaceAll("/", "-"));
	runCommand([
		"pnpm",
		"exec",
		"tsc",
		"-p",
		target.tsconfig,
		"--emitDeclarationOnly",
		"--outDir",
		outputDir,
	]);
	await compareDirectories(resolve(ROOT_DIR, target.typesDir), outputDir);
}

async function main() {
	await withHiddenArtifacts(async (tempRoot) => {
		for (const tsconfigPath of noEmitChecks) {
			runCommand(["pnpm", "exec", "tsc", "-p", tsconfigPath, "--noEmit"]);
		}

		for (const target of declarationTargets) {
			await emitDeclarations(target, tempRoot);
		}
	});
}

await main();
