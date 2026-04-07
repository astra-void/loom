import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = resolve(SCRIPT_DIR, "../..");
const PRE_STATE_PATH = resolve(WORKSPACE_ROOT, ".changeset", "pre.json");

function readPreMode() {
	if (!existsSync(PRE_STATE_PATH)) {
		return null;
	}

	try {
		const preState = JSON.parse(readFileSync(PRE_STATE_PATH, "utf8"));
		return typeof preState?.mode === "string" ? preState.mode : null;
	} catch {
		return "invalid";
	}
}

function runChangesetPre(args) {
	const result = spawnSync("changeset", ["pre", ...args], {
		cwd: WORKSPACE_ROOT,
		stdio: "inherit",
	});

	if (result.error) {
		throw result.error;
	}

	if (result.status !== 0) {
		process.exit(result.status ?? 1);
	}
}

function main() {
	const action = process.argv[2];

	if (action !== "enter" && action !== "exit") {
		throw new Error("Usage: pre-mode.ts <enter|exit>");
	}

	const currentMode = readPreMode();

	if (action === "enter") {
		if (currentMode === "pre") {
			return;
		}

		runChangesetPre(["enter", "alpha"]);
		return;
	}

	if (currentMode !== "pre") {
		return;
	}

	runChangesetPre(["exit"]);
}

main();
