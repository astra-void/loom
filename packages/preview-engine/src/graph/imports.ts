import path from "node:path";
import { isFilePathUnderRoot, resolveRealFilePath } from "../pathUtils";
import type { WorkspacePackage } from "./packages";
import { collectPackageExportTargets } from "./packages";
import {
	createCandidateFilePaths,
	dedupeSorted,
	isDeclarationFile,
	isTraceableSourceFile,
	resolveExistingTraceablePath,
	stripDeclarationSuffix,
	uniquePush,
} from "./sourceFiles";
import type { WorkspaceProject } from "./tsconfig";

const BUILD_OUTPUT_SEGMENTS = ["build", "dist", "lib", "out", "types"];

export function mapResolvedPathToSourceCandidates(
	resolvedFilePath: string,
	project: WorkspaceProject | undefined,
	workspacePackage: WorkspacePackage | undefined,
) {
	const candidates: string[] = [];
	const normalizedResolvedPath = resolveRealFilePath(resolvedFilePath);
	const sourceResolvedPath = stripDeclarationSuffix(normalizedResolvedPath);

	if (isTraceableSourceFile(normalizedResolvedPath)) {
		uniquePush(candidates, normalizedResolvedPath);
	}

	const extension = path.extname(sourceResolvedPath);
	const withoutExtension = extension
		? sourceResolvedPath.slice(0, -extension.length)
		: sourceResolvedPath;
	uniquePush(candidates, `${withoutExtension}.tsx`);
	uniquePush(candidates, `${withoutExtension}.ts`);

	if (isDeclarationFile(normalizedResolvedPath)) {
		uniquePush(candidates, `${sourceResolvedPath}.tsx`);
		uniquePush(candidates, `${sourceResolvedPath}.ts`);
	}

	if (
		project?.outDir &&
		isFilePathUnderRoot(project.outDir, normalizedResolvedPath)
	) {
		const relativeFromOutDir = path.relative(
			project.outDir,
			normalizedResolvedPath,
		);
		const rootCandidate = path.join(project.rootDir, relativeFromOutDir);
		candidates.push(...createCandidateFilePaths(rootCandidate));
	}

	if (workspacePackage) {
		for (const sourceRoot of workspacePackage.sourceRoots) {
			for (const segment of BUILD_OUTPUT_SEGMENTS) {
				const buildSegmentPrefix = `${workspacePackage.packageRoot}${path.sep}${segment}${path.sep}`;
				if (!normalizedResolvedPath.startsWith(buildSegmentPrefix)) {
					continue;
				}

				const relativeFromBuildDir = path.relative(
					path.join(workspacePackage.packageRoot, segment),
					normalizedResolvedPath,
				);
				candidates.push(
					...createCandidateFilePaths(
						path.join(sourceRoot, relativeFromBuildDir),
					),
				);
			}
		}
	}

	return dedupeSorted(candidates);
}

export function resolveWorkspacePackageSpecifier(
	workspacePackage: WorkspacePackage,
	specifier: string,
	subpath: string,
	project: WorkspaceProject | undefined,
) {
	const candidates: string[] = [];
	const exportsValue =
		typeof workspacePackage.packageJson.exports === "object" &&
		workspacePackage.packageJson.exports !== undefined
			? ((workspacePackage.packageJson.exports as Record<string, unknown>)[
					subpath ? `./${subpath}` : "."
				] ?? (subpath ? undefined : workspacePackage.packageJson.exports))
			: workspacePackage.packageJson.exports;

	for (const exportTarget of collectPackageExportTargets(exportsValue)) {
		const absoluteTarget = path.resolve(
			workspacePackage.packageRoot,
			exportTarget,
		);
		candidates.push(
			...mapResolvedPathToSourceCandidates(
				absoluteTarget,
				project,
				workspacePackage,
			),
		);
	}

	if (!subpath) {
		for (const packageField of [
			workspacePackage.packageJson.source,
			workspacePackage.packageJson.types,
			workspacePackage.packageJson.module,
			workspacePackage.packageJson.main,
		]) {
			if (typeof packageField === "string") {
				candidates.push(
					...mapResolvedPathToSourceCandidates(
						path.resolve(workspacePackage.packageRoot, packageField),
						project,
						workspacePackage,
					),
				);
			}
		}
	}

	const targetBases =
		subpath.length > 0
			? workspacePackage.sourceRoots.flatMap((sourceRoot) => [
					path.join(sourceRoot, subpath),
					path.join(workspacePackage.packageRoot, subpath),
				])
			: workspacePackage.sourceRoots.flatMap((sourceRoot) => [
					path.join(sourceRoot, "index"),
					path.join(sourceRoot, specifier.split("/").pop() ?? "index"),
				]);

	for (const targetBase of targetBases) {
		candidates.push(...createCandidateFilePaths(targetBase));
	}

	return resolveExistingTraceablePath(dedupeSorted(candidates), true);
}
