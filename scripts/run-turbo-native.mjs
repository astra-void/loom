import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getNativeTarget } from "./native-target.mjs";

function createEnv() {
	return {
		...process.env,
		LOOM_NATIVE_TARGET: getNativeTarget(),
	};
}

function runTurboFallback(args) {
	const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
	const turboCmd =
		process.platform === "win32"
			? resolve(rootDir, "node_modules/.bin/turbo.CMD")
			: resolve(rootDir, "node_modules/.bin/turbo");

	if (process.platform === "win32") {
		return spawnSync(
			process.env.comspec ?? "cmd.exe",
			["/d", "/s", "/c", turboCmd, ...args],
			{
				env: createEnv(),
				stdio: "inherit",
			},
		);
	}

	return spawnSync(turboCmd, args, {
		env: createEnv(),
		stdio: "inherit",
	});
}

const turboArgs = ["exec", "turbo", ...process.argv.slice(2)];
const result = process.env.npm_execpath
	? spawnSync(process.execPath, [process.env.npm_execpath, ...turboArgs], {
			env: createEnv(),
			stdio: "inherit",
		})
	: runTurboFallback(process.argv.slice(2));

if (result.error) {
	throw result.error;
}

process.exit(result.status ?? 1);
