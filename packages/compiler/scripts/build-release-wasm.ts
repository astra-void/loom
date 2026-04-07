import { rm } from "node:fs/promises";
import os from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runCommand } from "./napi-cli.ts";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PACKAGE_DIR = dirname(SCRIPT_DIR);
const WASM_OUTPUT_DIR = join(PACKAGE_DIR, "wasm");

async function main() {
	await rm(WASM_OUTPUT_DIR, { force: true, recursive: true });

	runCommand(
		"wasm-pack",
		[
			"build",
			"--release",
			"--target",
			"web",
			"--out-dir",
			"wasm",
			"--out-name",
			"compiler",
		],
		{
			cwd: PACKAGE_DIR,
			env: {
				...process.env,
				PATH: `${os.homedir()}/.cargo/bin:${process.env.PATH ?? ""}`,
			},
		},
	);
}

await main();
