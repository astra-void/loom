import fs from "node:fs";
import path from "node:path";
import { resolveRealFilePath } from "../pathUtils";
import type {
	PreviewBuildArtifactKind,
	PreviewExecutionMode,
	PreviewSourceTarget,
} from "../types";

export function isPathEqualOrContained(
	rootPath: string,
	candidatePath: string,
) {
	const normalizedRoot = resolveRealFilePath(rootPath);
	const normalizedCandidate = resolveRealFilePath(candidatePath);
	return (
		normalizedRoot === normalizedCandidate ||
		normalizedCandidate.startsWith(`${normalizedRoot}${path.sep}`) ||
		normalizedRoot.startsWith(`${normalizedCandidate}${path.sep}`)
	);
}

function validateTargetName(targetName: string) {
	if (
		!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(targetName) ||
		targetName === "." ||
		targetName === ".."
	) {
		throw new Error(
			`Preview target name must be a safe path segment: ${targetName}`,
		);
	}
}

function validateTargets(targets: PreviewSourceTarget[]) {
	if (targets.length === 0) {
		throw new Error(
			"Preview artifact generation requires at least one target.",
		);
	}

	const seenTargetNames = new Set<string>();
	for (const target of targets) {
		validateTargetName(target.name);
		if (seenTargetNames.has(target.name)) {
			throw new Error(`Duplicate preview target name: ${target.name}`);
		}

		seenTargetNames.add(target.name);

		const sourceRoot = path.resolve(target.sourceRoot);
		if (!fs.existsSync(sourceRoot) || !fs.statSync(sourceRoot).isDirectory()) {
			throw new Error(`Preview source directory does not exist: ${sourceRoot}`);
		}

		const packageRoot = path.resolve(target.packageRoot);
		if (
			!fs.existsSync(packageRoot) ||
			!fs.statSync(packageRoot).isDirectory()
		) {
			throw new Error(`Preview package root does not exist: ${packageRoot}`);
		}
	}
}

export function validateBuildOptions(options: {
	artifactKinds: PreviewBuildArtifactKind[];
	outDir?: string;
	targets: PreviewSourceTarget[];
	transformMode: PreviewExecutionMode;
	workspaceRoot: string;
}) {
	validateTargets(options.targets);

	if (options.artifactKinds.length === 0) {
		throw new Error(
			"Preview artifact generation requires at least one artifact kind.",
		);
	}

	const uniqueArtifactKinds = new Set(options.artifactKinds);
	if (uniqueArtifactKinds.size !== options.artifactKinds.length) {
		throw new Error("Preview artifact kinds must be unique.");
	}

	if (
		options.transformMode === "design-time" &&
		options.artifactKinds.includes("module")
	) {
		throw new Error(
			"Design-time transform mode does not support module artifact generation.",
		);
	}

	if (!options.outDir) {
		return;
	}

	const resolvedOutDir = path.resolve(options.outDir);
	const parsedOutDir = path.parse(resolvedOutDir);
	if (resolvedOutDir === parsedOutDir.root) {
		throw new Error(`Preview output directory is too broad: ${resolvedOutDir}`);
	}

	if (resolvedOutDir === path.resolve(options.workspaceRoot)) {
		throw new Error(
			`Preview output directory must not be the workspace root: ${resolvedOutDir}`,
		);
	}

	for (const target of options.targets) {
		if (
			isPathEqualOrContained(path.resolve(target.sourceRoot), resolvedOutDir)
		) {
			throw new Error(
				`Preview output directory overlaps the source tree for target ${target.name}: ${resolvedOutDir}`,
			);
		}

		if (
			isPathEqualOrContained(path.resolve(target.packageRoot), resolvedOutDir)
		) {
			throw new Error(
				`Preview output directory overlaps the package root for target ${target.name}: ${resolvedOutDir}`,
			);
		}
	}
}
