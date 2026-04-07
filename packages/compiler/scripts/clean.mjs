import { rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PACKAGE_DIR = dirname(SCRIPT_DIR);

const PATHS_TO_REMOVE = [
	join(PACKAGE_DIR, ".native"),
	join(PACKAGE_DIR, "artifacts"),
	join(PACKAGE_DIR, "npm"),
	join(PACKAGE_DIR, "index.js"),
	join(PACKAGE_DIR, "index.d.ts"),
	join(PACKAGE_DIR, "wasm"),
	join(PACKAGE_DIR, "target"),
];

async function main() {
	await Promise.all(
		PATHS_TO_REMOVE.map(async (targetPath) => {
			await rm(targetPath, { force: true, recursive: true });
		}),
	);
}

await main();
