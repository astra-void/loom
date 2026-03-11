import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const cliPackageJsonPath = require.resolve("@napi-rs/cli/package.json");
const cliPackageJson = require(cliPackageJsonPath);
const cliPath = join(dirname(cliPackageJsonPath), cliPackageJson.bin.napi);

export function getPassthroughArgs(argv = process.argv.slice(2)) {
	return argv[0] === "--" ? argv.slice(1) : argv;
}

export function runCommand(command, args, options = {}) {
	const result = spawnSync(command, args, {
		cwd: options.cwd ?? process.cwd(),
		env: options.env ?? process.env,
		stdio: options.stdio ?? "inherit",
	});

	if (result.error) {
		throw result.error;
	}

	if (options.check !== false && result.status !== 0) {
		process.exit(result.status ?? 1);
	}

	return result;
}

export function runNapi(args, options = {}) {
	return runCommand(process.execPath, [cliPath, ...args], options);
}
