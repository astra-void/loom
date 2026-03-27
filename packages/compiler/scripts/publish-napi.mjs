import { existsSync } from "node:fs";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { readNapiConfig } from "@napi-rs/cli";

import {
	getPassthroughArgs,
	runCommand,
	runNapi,
	runPnpm,
} from "./napi-cli.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PACKAGE_DIR = resolve(SCRIPT_DIR, "..");
const WORKSPACE_ROOT = resolve(PACKAGE_DIR, "../..");
const PUBLISH_CACHE_DIR = join(PACKAGE_DIR, ".npm", "cache");
const STAGE_ROOT = join(PACKAGE_DIR, ".npm", "publish");

const options = parseArgs(getPassthroughArgs());
const packageJsonPath = join(PACKAGE_DIR, "package.json");
const { binaryName, packageJson, packageName, targets } =
	await readNapiConfig(packageJsonPath);

await buildRootMetaPackage();
await prepareStage();

if (!options.prepareOnly) {
	await publishStage();
}

async function buildRootMetaPackage() {
	runPnpm(["run", "build:release"], { cwd: PACKAGE_DIR });
}

async function prepareStage() {
	await rm(STAGE_ROOT, { force: true, recursive: true });
	await mkdir(STAGE_ROOT, { recursive: true });
	await writeStagePackageJson();
	await copyRootPublishFiles();
	await copyArtifacts();

	runNapi(["create-npm-dirs", "--npm-dir", "./npm"], { cwd: STAGE_ROOT });
	runNapi(["artifacts", "--output-dir", "./artifacts", "--npm-dir", "./npm"], {
		cwd: STAGE_ROOT,
	});
	runNapi(["pre-publish", "--npm-dir", "./npm", "--skip-optional-publish"], {
		cwd: STAGE_ROOT,
	});

	await validateStage();
}

async function publishStage() {
	const publishClient = await detectPublishClient();
	const publishArgs = buildPublishArgs(publishClient);
	const publishEnv = await createPublishEnv();

	for (const target of targets) {
		runPackageManager(publishClient, publishArgs, {
			cwd: join(STAGE_ROOT, "npm", target.platformArchABI),
			env: publishEnv,
		});
	}

	runPackageManager(publishClient, publishArgs, {
		cwd: STAGE_ROOT,
		env: publishEnv,
	});
}

function runPackageManager(client, args, options = {}) {
	if (client === "pnpm") {
		return runPnpm(args, options);
	}

	return runCommand(client, args, options);
}

function parseArgs(rawArgs) {
	const publishArgs = [];
	let dryRun = false;
	let prepareOnly = false;

	for (const arg of rawArgs) {
		if (arg === "--") {
			continue;
		}

		if (arg === "--dry-run") {
			dryRun = true;
			continue;
		}

		if (arg === "--prepare-only" || arg === "--stage-only") {
			prepareOnly = true;
			continue;
		}

		publishArgs.push(arg);
	}

	return {
		dryRun,
		publishArgs,
		prepareOnly,
	};
}

function buildPublishArgs(publishClient) {
	const publishArgs = ["publish", ...options.publishArgs];

	if (!publishArgs.includes("--ignore-scripts")) {
		publishArgs.push("--ignore-scripts");
	}

	if (options.dryRun && !publishArgs.includes("--dry-run")) {
		publishArgs.push("--dry-run");
	}

	if (publishClient === "pnpm" && !publishArgs.includes("--no-git-checks")) {
		publishArgs.push("--no-git-checks");
	}

	return publishArgs;
}

async function copyRootPublishFiles() {
	for (const relativePath of getRootPublishFiles()) {
		const sourcePath = join(PACKAGE_DIR, relativePath);
		const destinationPath = join(STAGE_ROOT, relativePath);

		if (!existsSync(sourcePath)) {
			throw new Error(`Missing root publish file: ${relativePath}`);
		}

		await mkdir(dirname(destinationPath), { recursive: true });
		await cp(sourcePath, destinationPath, { recursive: true });
	}
}

function getRootPublishFiles() {
	const files = new Set();

	for (const entry of packageJson.files ?? []) {
		if (!entry.includes("*")) {
			files.add(entry);
		}
	}

	files.add("index.js");
	files.add("index.d.ts");
	files.add(packageJson.main);
	files.add(packageJson.module);
	files.add(packageJson.types);

	return [...files].filter(Boolean).sort();
}

async function copyArtifacts() {
	const sourceArtifactsDir = join(PACKAGE_DIR, "artifacts");
	const stageArtifactsDir = join(STAGE_ROOT, "artifacts");
	const missingArtifacts = [];

	if (!existsSync(sourceArtifactsDir)) {
		throw new Error(
			"Missing aggregated artifacts directory at packages/compiler/artifacts",
		);
	}

	await mkdir(stageArtifactsDir, { recursive: true });

	for (const target of targets) {
		const artifactFileName = getArtifactFileName(target);
		const sourcePath = join(sourceArtifactsDir, artifactFileName);

		if (!existsSync(sourcePath)) {
			missingArtifacts.push(artifactFileName);
			continue;
		}

		await cp(sourcePath, join(stageArtifactsDir, artifactFileName));
	}

	if (missingArtifacts.length > 0) {
		throw new Error(
			`Missing compiled artifacts:\n${missingArtifacts
				.map((artifact) => `- ${artifact}`)
				.join("\n")}`,
		);
	}
}

function getArtifactFileName(target) {
	const extension =
		target.platform === "wasi" || target.platform === "wasm" ? "wasm" : "node";

	return `${binaryName}.${target.platformArchABI}.${extension}`;
}

async function writeStagePackageJson() {
	const stagedPackageJson = structuredClone(packageJson);

	delete stagedPackageJson.devDependencies;
	delete stagedPackageJson.optionalDependencies;
	delete stagedPackageJson.scripts;

	await writeFile(
		join(STAGE_ROOT, "package.json"),
		`${JSON.stringify(stagedPackageJson, null, 2)}\n`,
	);
}

async function validateStage() {
	const stagedPackageJson = JSON.parse(
		await readFile(join(STAGE_ROOT, "package.json"), "utf8"),
	);
	const optionalDependencyNames = Object.keys(
		stagedPackageJson.optionalDependencies ?? {},
	).sort();
	const expectedPackageNames = targets
		.map((target) => `${packageName}-${target.platformArchABI}`)
		.sort();
	const stageIndexSource = await readFile(join(STAGE_ROOT, "index.js"), "utf8");

	if (
		JSON.stringify(optionalDependencyNames) !==
		JSON.stringify(expectedPackageNames)
	) {
		throw new Error(
			"Staged root package optionalDependencies do not match configured targets",
		);
	}

	for (const expectedPackageName of expectedPackageNames) {
		if (!stageIndexSource.includes(expectedPackageName)) {
			throw new Error(
				`Generated loader is missing native package reference: ${expectedPackageName}`,
			);
		}
	}

	for (const target of targets) {
		const packageDir = join(STAGE_ROOT, "npm", target.platformArchABI);
		const targetPackageJson = JSON.parse(
			await readFile(join(packageDir, "package.json"), "utf8"),
		);
		const expectedArtifactFile = getArtifactFileName(target);

		if (targetPackageJson.name !== `${packageName}-${target.platformArchABI}`) {
			throw new Error(
				`Unexpected target package name for ${target.platformArchABI}`,
			);
		}

		if (
			JSON.stringify(targetPackageJson.os) !== JSON.stringify([target.platform])
		) {
			throw new Error(`Unexpected os field for ${target.platformArchABI}`);
		}

		if (
			JSON.stringify(targetPackageJson.cpu) !== JSON.stringify([target.arch])
		) {
			throw new Error(`Unexpected cpu field for ${target.platformArchABI}`);
		}

		if (
			target.abi === "gnu" &&
			JSON.stringify(targetPackageJson.libc) !== JSON.stringify(["glibc"])
		) {
			throw new Error(`Unexpected libc field for ${target.platformArchABI}`);
		}

		if (
			target.abi === "musl" &&
			JSON.stringify(targetPackageJson.libc) !== JSON.stringify(["musl"])
		) {
			throw new Error(`Unexpected libc field for ${target.platformArchABI}`);
		}

		if (!existsSync(join(packageDir, expectedArtifactFile))) {
			throw new Error(`Missing staged artifact for ${target.platformArchABI}`);
		}
	}
}

async function detectPublishClient() {
	if (process.env.npm_config_user_agent?.startsWith("pnpm/")) {
		return "pnpm";
	}

	const workspacePackageJsonPath = join(WORKSPACE_ROOT, "package.json");

	if (existsSync(workspacePackageJsonPath)) {
		const workspacePackageJson = JSON.parse(
			await readFile(workspacePackageJsonPath, "utf8"),
		);

		if (typeof workspacePackageJson.packageManager === "string") {
			const [client] = workspacePackageJson.packageManager.split("@");

			if (client) {
				return client;
			}
		}
	}

	return "npm";
}

async function createPublishEnv() {
	await mkdir(PUBLISH_CACHE_DIR, { recursive: true });

	return {
		...process.env,
		npm_config_cache: PUBLISH_CACHE_DIR,
	};
}
