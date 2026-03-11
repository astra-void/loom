import fs from "node:fs";
import * as path from "node:path";

const PACKAGE_JSON_PATH = path.resolve(__dirname, "..", "package.json");

type CliPackageJson = {
	version?: string;
};

export const CLI_BINARY_NAME = "loom";

export function getCliVersion(
	readFileSync: typeof fs.readFileSync = fs.readFileSync,
): string {
	try {
		const packageJson = JSON.parse(
			readFileSync(PACKAGE_JSON_PATH, "utf8"),
		) as CliPackageJson;
		if (
			typeof packageJson.version === "string" &&
			packageJson.version.length > 0
		) {
			return packageJson.version;
		}
	} catch {
		return "0.0.0";
	}

	return "0.0.0";
}
