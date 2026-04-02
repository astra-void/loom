import { spawnSync } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { WORKSPACE_PUBLISH_ORDER } from "./release-config.mjs";

function runCommand(command, args, options = {}) {
	const result = spawnSync(command, args, {
		cwd: options.cwd ?? process.cwd(),
		env: options.env ?? process.env,
		stdio: options.stdio ?? "inherit",
	});

	if (result.error) {
		throw result.error;
	}

	if (result.status !== 0) {
		process.exit(result.status ?? 1);
	}
}

function runPnpm(args, options = {}) {
	const pnpmExecPath = process.env.npm_execpath;

	if (pnpmExecPath) {
		return runCommand(process.execPath, [pnpmExecPath, ...args], options);
	}

	return runCommand("pnpm", args, options);
}

function buildPublishArgs(argv = process.argv.slice(2)) {
	const publishArgs = ["publish"];
	const passthroughArgs = argv.filter((arg) => arg !== "--");

	if (!passthroughArgs.includes("--access")) {
		publishArgs.push("--access", "public");
	}

	publishArgs.push(...passthroughArgs);
	return publishArgs;
}

async function findTarball(packDestination) {
	const entries = await readdir(packDestination);
	const tarballs = entries
		.filter((entry) => entry.endsWith(".tgz"))
		.map((entry) => join(packDestination, entry))
		.sort();

	if (tarballs.length !== 1) {
		throw new Error(
			`Expected one tarball in ${packDestination}, found ${tarballs.length}.`,
		);
	}

	return tarballs[0];
}

async function main() {
	const publishArgs = buildPublishArgs();
	const tempRoot = await mkdtemp(join(os.tmpdir(), "loom-release-pack-"));

	try {
		for (const packageName of WORKSPACE_PUBLISH_ORDER) {
			const packDestination = resolve(
				tempRoot,
				packageName.replaceAll("/", "-").replaceAll("@", ""),
			);

			runPnpm(
				[
					"--filter",
					packageName,
					"pack",
					"--pack-destination",
					packDestination,
				],
				{ cwd: process.cwd() },
			);

			const tarballPath = await findTarball(packDestination);
			runCommand("npm", [...publishArgs, tarballPath], { cwd: process.cwd() });
		}
	} finally {
		await rm(tempRoot, { force: true, recursive: true });
	}
}

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(process.argv[1]).href
) {
	main().catch((error) => {
		process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
		process.exit(1);
	});
}
