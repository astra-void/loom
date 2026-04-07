import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runNapi } from "./napi-cli.mjs";
import { stampRepositoryIntoNpmManifests } from "./stamp-repository.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PACKAGE_DIR = dirname(SCRIPT_DIR);

async function main() {
	await mkdir(join(PACKAGE_DIR, "artifacts"), { recursive: true });
	runNapi(["create-npm-dirs", "--npm-dir", "./npm"], { cwd: PACKAGE_DIR });
	runNapi(["artifacts", "--output-dir", "./artifacts", "--npm-dir", "./npm"], {
		cwd: PACKAGE_DIR,
	});
	await stampRepositoryIntoNpmManifests({ rootDir: PACKAGE_DIR });
}

await main();
