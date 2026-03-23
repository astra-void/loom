import { spawnSync } from "node:child_process";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const declarationTargets = [
	{
		build: ["pnpm", "--filter", "@loom-dev/preview-runtime", "build"],
		label: "@loom-dev/preview-runtime",
		tsconfig: "packages/preview-runtime/tsconfig.json",
		typesDir: "packages/preview-runtime/types",
	},
	{
		build: ["pnpm", "--filter", "@loom-dev/preview-engine", "build"],
		label: "@loom-dev/preview-engine",
		tsconfig: "packages/preview-engine/tsconfig.json",
		typesDir: "packages/preview-engine/types",
	},
	{
		build: ["pnpm", "--filter", "@loom-dev/preview", "build"],
		label: "@loom-dev/preview",
		tsconfig: "packages/preview/tsconfig.json",
		typesDir: "packages/preview/types",
	},
	{
		build: ["pnpm", "--filter", "loom-dev", "build"],
		label: "loom-dev",
		tsconfig: "packages/cli/tsconfig.json",
		typesDir: "packages/cli/types",
	},
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

async function syncDeclarations(sourceDir, targetDir) {
	const absoluteTargetDir = resolve(ROOT_DIR, targetDir);
	await rm(absoluteTargetDir, { force: true, recursive: true });
	await cp(sourceDir, absoluteTargetDir, { recursive: true });
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
	await syncDeclarations(outputDir, target.typesDir);
}

async function main() {
	const tempRoot = await mkdtemp(join(tmpdir(), "loom-dts-refresh-"));

	try {
		runCommand(["pnpm", "--filter", "@loom-dev/layout-engine", "build"]);
		runCommand(["pnpm", "--filter", "@loom-dev/compiler", "build"]);

		for (const target of declarationTargets) {
			await emitDeclarations(target, tempRoot);
			runCommand(target.build);
		}
	} finally {
		await rm(tempRoot, { force: true, recursive: true });
	}
}

await main();
