import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runCommand } from "./napi-cli.ts";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PACKAGE_DIR = dirname(SCRIPT_DIR);

async function main() {
	runCommand("tsx", [join(SCRIPT_DIR, "build-release-native.ts")], {
		cwd: PACKAGE_DIR,
	});

	runCommand("tsx", [join(SCRIPT_DIR, "build-release-wasm.ts")], {
		cwd: PACKAGE_DIR,
	});
}

await main();
