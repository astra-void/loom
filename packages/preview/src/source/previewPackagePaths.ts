import fs from "node:fs";
import path from "node:path";

function uniquePaths(paths: string[]) {
	return [...new Set(paths.map((filePath) => path.resolve(filePath)))];
}

export function resolvePreviewPackageEntry(
	candidates: string[],
	label: string,
) {
	const matchedPath = candidates.find((candidate) => fs.existsSync(candidate));
	if (!matchedPath) {
		throw new Error(`Unable to resolve ${label} entry.`);
	}

	return path.resolve(matchedPath);
}

export function isInstalledPreviewPackage(currentDir = __dirname) {
	return currentDir.replace(/\\/g, "/").includes("/node_modules/");
}

export function resolvePreviewShellRoot() {
	return resolvePreviewPackageEntry(
		[
			path.resolve(__dirname, "../shell"),
			path.resolve(__dirname, "../../src/shell"),
		],
		"preview shell root",
	);
}

export function resolvePreviewRuntimeRootEntry() {
	const runtimeCandidates = isInstalledPreviewPackage()
		? [
				path.resolve(__dirname, "../../../preview-runtime/dist/index.js"),
				path.resolve(__dirname, "../../../preview-runtime/src/index.ts"),
			]
		: [
				path.resolve(__dirname, "../../../preview-runtime/src/index.ts"),
				path.resolve(__dirname, "../../../preview-runtime/dist/index.js"),
			];

	return resolvePreviewPackageEntry(runtimeCandidates, "preview runtime root");
}

export function resolvePreviewRuntimeRoots() {
	return uniquePaths([path.dirname(resolvePreviewRuntimeRootEntry())]);
}

export function resolveLayoutEngineRoots() {
	return uniquePaths([
		path.resolve(__dirname, "../../../layout-engine"),
		path.resolve(__dirname, "../../../layout-engine/pkg"),
	]);
}
