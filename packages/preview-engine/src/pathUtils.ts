import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import type { PreviewSourceTarget } from "./types";

function stripViteFsPrefix(filePath: string) {
	return filePath.startsWith("/@fs/")
		? filePath.slice("/@fs/".length)
		: filePath;
}

function normalizeComparablePath(filePath: string) {
	const slashNormalizedPath = filePath.replace(/\\/g, "/");
	return ts.sys.useCaseSensitiveFileNames
		? slashNormalizedPath
		: slashNormalizedPath.toLowerCase();
}

function normalizeSlashPath(filePath: string) {
	return resolveFilePath(filePath).replace(/\\/g, "/");
}

function escapeRegExp(value: string) {
	return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}

function createGlobMatcher(pattern: string) {
	const normalizedPattern = pattern.replace(/\\/g, "/");
	let source = "^";

	for (let index = 0; index < normalizedPattern.length; index += 1) {
		const character = normalizedPattern[index];
		const nextCharacter = normalizedPattern[index + 1];

		if (character === "*" && nextCharacter === "*") {
			source += ".*";
			index += 1;
			continue;
		}

		if (character === "*") {
			source += "[^/]*";
			continue;
		}

		source += escapeRegExp(character);
	}

	source += "$";
	return new RegExp(source);
}

function matchesPatterns(value: string, patterns: string[] | undefined) {
	if (!patterns || patterns.length === 0) {
		return false;
	}

	return patterns.some((pattern) => createGlobMatcher(pattern).test(value));
}

function getComparablePathVariants(filePath: string) {
	const resolvedPath = normalizeComparablePath(resolveFilePath(filePath));
	const comparablePaths = new Set<string>([resolvedPath]);

	try {
		comparablePaths.add(
			normalizeComparablePath(
				fs.realpathSync.native?.(resolveFilePath(filePath)) ??
					fs.realpathSync(resolveFilePath(filePath)),
			),
		);
	} catch {
		// Keep the resolved path when the file no longer exists.
	}

	return [...comparablePaths];
}

export function stripFileIdDecorations(filePath: string) {
	const searchIndex = filePath.search(/[?#]/);
	return searchIndex === -1 ? filePath : filePath.slice(0, searchIndex);
}

export function resolveFilePath(filePath: string) {
	return path.resolve(stripViteFsPrefix(stripFileIdDecorations(filePath)));
}

export function resolveRealFilePath(filePath: string) {
	const resolvedPath = resolveFilePath(filePath);

	try {
		return (
			fs.realpathSync.native?.(resolvedPath) ?? fs.realpathSync(resolvedPath)
		);
	} catch {
		return resolvedPath;
	}
}

export function canonicalizeFilePath(filePath: string) {
	const [canonicalPath] = getComparablePathVariants(filePath);
	return canonicalPath ?? normalizeComparablePath(resolveFilePath(filePath));
}

export function isFilePathUnderRoot(rootPath: string, filePath: string) {
	const comparableRootPaths = getComparablePathVariants(rootPath);
	const comparableFilePaths = getComparablePathVariants(filePath);

	return comparableFilePaths.some((comparableFilePath) =>
		comparableRootPaths.some((comparableRootPath) => {
			if (comparableFilePath === comparableRootPath) {
				return true;
			}

			const rootPrefix = comparableRootPath.endsWith("/")
				? comparableRootPath
				: `${comparableRootPath}/`;
			return comparableFilePath.startsWith(rootPrefix);
		}),
	);
}

export function isFilePathIncludedByTarget(
	target: Pick<PreviewSourceTarget, "exclude" | "include" | "sourceRoot">,
	filePath: string,
) {
	const resolvedFilePath = resolveFilePath(filePath);
	if (!isFilePathUnderRoot(target.sourceRoot, resolvedFilePath)) {
		return false;
	}

	const relativePath = path
		.relative(resolveFilePath(target.sourceRoot), resolvedFilePath)
		.split(path.sep)
		.join("/");
	const candidateValues = [relativePath, normalizeSlashPath(resolvedFilePath)];

	if (
		target.include &&
		target.include.length > 0 &&
		!candidateValues.some((value) => matchesPatterns(value, target.include))
	) {
		return false;
	}

	if (
		target.exclude &&
		target.exclude.length > 0 &&
		candidateValues.some((value) => matchesPatterns(value, target.exclude))
	) {
		return false;
	}

	return true;
}
