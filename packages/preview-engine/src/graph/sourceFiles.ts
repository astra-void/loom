import fs from "node:fs";
import path from "node:path";
import { resolveRealFilePath } from "../pathUtils";

const TRANSFORMABLE_SOURCE_EXTENSIONS = new Set([".ts", ".tsx"]);
const TRACEABLE_SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".d.ts", ".d.tsx"]);

export function isDeclarationFile(filePath: string) {
	return filePath.endsWith(".d.ts") || filePath.endsWith(".d.tsx");
}

export function isTransformableSourceFile(fileName: string) {
	return (
		TRANSFORMABLE_SOURCE_EXTENSIONS.has(path.extname(fileName)) &&
		!fileName.endsWith(".d.ts") &&
		!fileName.endsWith(".d.tsx")
	);
}

export function isTraceableSourceFile(fileName: string) {
	return (
		TRACEABLE_SOURCE_EXTENSIONS.has(path.extname(fileName)) ||
		isDeclarationFile(fileName)
	);
}

export function listSourceFiles(dirPath: string): string[] {
	if (!fs.existsSync(dirPath)) {
		return [];
	}

	const entries = fs.readdirSync(dirPath, { withFileTypes: true });
	const files: string[] = [];

	for (const entry of entries) {
		const entryPath = path.join(dirPath, entry.name);
		if (entry.isDirectory()) {
			files.push(...listSourceFiles(entryPath));
			continue;
		}

		if (isTransformableSourceFile(entry.name)) {
			files.push(resolveRealFilePath(entryPath));
		}
	}

	return files.sort((left, right) => left.localeCompare(right));
}

export function dedupeSorted(values: string[]) {
	return [...new Set(values.map((value) => resolveRealFilePath(value)))].sort(
		(left, right) => left.localeCompare(right),
	);
}

export function stripDeclarationSuffix(filePath: string) {
	return filePath.replace(/\.d\.tsx?$/, "");
}

export function createCandidateFilePaths(basePath: string) {
	const normalized = stripDeclarationSuffix(basePath).replace(/\\/g, "/");
	const extension = path.extname(normalized);
	const withoutExtension = extension
		? normalized.slice(0, -extension.length)
		: normalized;
	const directCandidates = [
		normalized,
		`${withoutExtension}.loom.tsx`,
		`${withoutExtension}.tsx`,
		`${withoutExtension}.ts`,
		`${withoutExtension}.d.ts`,
		`${withoutExtension}.d.tsx`,
	];

	const indexCandidates = [
		path.posix.join(normalized, "index.loom.tsx"),
		path.posix.join(normalized, "index.tsx"),
		path.posix.join(normalized, "index.ts"),
		path.posix.join(normalized, "index.d.ts"),
		path.posix.join(normalized, "index.d.tsx"),
	];

	return dedupeSorted([...directCandidates, ...indexCandidates]);
}

export function resolveExistingTraceablePath(
	candidates: string[],
	preferTransformable = false,
) {
	const existingCandidates = candidates.filter((candidate) =>
		fs.existsSync(candidate),
	);
	if (preferTransformable) {
		const transformable = existingCandidates.find((candidate) =>
			isTransformableSourceFile(candidate),
		);
		if (transformable) {
			return resolveRealFilePath(transformable);
		}
	}

	const traceable = existingCandidates.find((candidate) =>
		isTraceableSourceFile(candidate),
	);
	return traceable ? resolveRealFilePath(traceable) : undefined;
}

export function uniquePush(values: string[], value: string | undefined) {
	if (!value) {
		return;
	}

	values.push(resolveRealFilePath(value));
}
