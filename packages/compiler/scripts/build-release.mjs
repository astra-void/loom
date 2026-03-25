import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runCommand } from "./napi-cli.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PACKAGE_DIR = dirname(SCRIPT_DIR);

async function main() {
	runCommand(process.execPath, [join(SCRIPT_DIR, "build-release-native.mjs")], {
		cwd: PACKAGE_DIR,
	});

	runCommand(process.execPath, [join(SCRIPT_DIR, "build-release-wasm.mjs")], {
		cwd: PACKAGE_DIR,
	});
}

await main();
