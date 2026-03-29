import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

function resolveCargoHomeDirectory() {
	return process.env.CARGO_HOME && process.env.CARGO_HOME.length > 0
		? process.env.CARGO_HOME
		: path.join(os.homedir(), ".cargo");
}

function collectCargoBinDirectories(cargoHomeDirectory) {
	const directories = [];

	if (cargoHomeDirectory) {
		directories.push(path.join(cargoHomeDirectory, "bin"));
	}

	return directories.filter((directory) => existsSync(directory));
}

function createEnvironment() {
	const cargoHomeDirectory = resolveCargoHomeDirectory();
	const workspaceTempDirectory = path.resolve(
		process.cwd(),
		"../../.tmp/wasm-pack",
	);
	mkdirSync(workspaceTempDirectory, { recursive: true });

	const pathEntries = [
		...collectCargoBinDirectories(cargoHomeDirectory),
		...(process.env.PATH ?? process.env.Path ?? "")
			.split(path.delimiter)
			.filter((entry) => entry.length > 0),
	];

	return {
		...process.env,
		CARGO_HOME: cargoHomeDirectory,
		PATH: pathEntries.join(path.delimiter),
		TEMP: workspaceTempDirectory,
		TMP: workspaceTempDirectory,
		TMPDIR: workspaceTempDirectory,
	};
}

const result = spawnSync(
	process.platform === "win32" ? "wasm-pack.exe" : "wasm-pack",
	process.argv.slice(2),
	{
		env: createEnvironment(),
		stdio: "inherit",
	},
);

if (result.error) {
	throw result.error;
}

process.exit(result.status ?? 1);
