import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export function hashText(value: string) {
	return createHash("sha1").update(value).digest("hex");
}

export function normalizeRelativePath(filePath: string) {
	return filePath.split(path.sep).join("/");
}

export function ensureDirectory(dirPath: string) {
	fs.mkdirSync(dirPath, { recursive: true });
}

export function readJsonFile<T>(filePath: string): T | undefined {
	if (!fs.existsSync(filePath)) {
		return undefined;
	}

	try {
		return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
	} catch {
		return undefined;
	}
}

export function writeJsonFile(filePath: string, value: unknown) {
	ensureDirectory(path.dirname(filePath));
	fs.writeFileSync(filePath, JSON.stringify(value, undefined, 2), "utf8");
}
