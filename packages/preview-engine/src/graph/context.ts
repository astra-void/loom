import path from "node:path";
import { resolveRealFilePath } from "../pathUtils";
import type { PreviewSourceTarget } from "../types";
import type { WorkspacePackage } from "./packages";
import {
	findNearestPackageRoot,
	findWorkspaceRoot,
	readPackageJson,
	scanWorkspacePackages,
} from "./packages";
import { dedupeSorted } from "./sourceFiles";
import type { WorkspaceProject } from "./tsconfig";
import {
	createProjectFromParsedConfig,
	findNearestTsconfig,
	parseTsconfig,
} from "./tsconfig";

export type WorkspaceGraphServiceContext = {
	packagesByName: Map<string, WorkspacePackage>;
	projects: WorkspaceProject[];
	projectsByFilePath: Map<string, WorkspaceProject>;
	workspacePackageList: WorkspacePackage[];
	workspaceRoot: string;
};

export function createWorkspaceGraphServiceContext(
	targets: PreviewSourceTarget[],
	workspaceRoot?: string,
): WorkspaceGraphServiceContext {
	const timingEnabled = process.env.LOOM_PREVIEW_TIMINGS === "1";
	const startedAt = timingEnabled ? Date.now() : 0;
	const resolvedWorkspaceRoot = resolveRealFilePath(
		workspaceRoot ??
			findWorkspaceRoot(targets.map((target) => target.packageRoot)),
	);
	const workspacePackages = scanWorkspacePackages(resolvedWorkspaceRoot);

	for (const target of targets) {
		const packageRoot = resolveRealFilePath(target.packageRoot);
		const sourceRoot = resolveRealFilePath(target.sourceRoot);
		const existingPackage = workspacePackages.get(packageRoot) ?? {
			packageJson: readPackageJson(packageRoot),
			packageName: target.packageName,
			packageRoot,
			sourceRoots: [],
			tsconfigPaths: [],
		};

		existingPackage.packageName ??= target.packageName ?? target.name;
		existingPackage.sourceRoots.push(sourceRoot);
		workspacePackages.set(packageRoot, existingPackage);
	}

	const projectMap = new Map<string, WorkspaceProject>();
	const pendingConfigPaths: string[] = [];
	const seenPending = new Set<string>();

	const queueConfigPath = (configPath: string | undefined) => {
		if (!configPath) {
			return;
		}

		const normalizedConfigPath = resolveRealFilePath(configPath);
		if (seenPending.has(normalizedConfigPath)) {
			return;
		}

		seenPending.add(normalizedConfigPath);
		pendingConfigPaths.push(normalizedConfigPath);
	};

	for (const target of targets) {
		queueConfigPath(findNearestTsconfig(target.sourceRoot));
	}

	for (const workspacePackage of workspacePackages.values()) {
		const packageConfigPath = findNearestTsconfig(workspacePackage.packageRoot);
		if (packageConfigPath) {
			workspacePackage.tsconfigPaths.push(
				resolveRealFilePath(packageConfigPath),
			);
			queueConfigPath(packageConfigPath);
		}
	}

	while (pendingConfigPaths.length > 0) {
		const nextConfigPath = pendingConfigPaths.pop();
		if (!nextConfigPath || projectMap.has(nextConfigPath)) {
			continue;
		}

		const parsedConfig = parseTsconfig(nextConfigPath);
		const packageRoot = findNearestPackageRoot(nextConfigPath);
		const workspacePackage = workspacePackages.get(packageRoot);
		const project = createProjectFromParsedConfig(
			packageRoot,
			workspacePackage?.packageName,
			parsedConfig,
			nextConfigPath,
		);
		projectMap.set(project.configPath, project);

		if (workspacePackage) {
			workspacePackage.sourceRoots.push(project.rootDir);
			workspacePackage.sourceRoots.push(path.join(project.rootDir, "src"));
			workspacePackage.tsconfigPaths.push(project.configPath);
		}

		for (const referencePath of project.referencedProjectConfigPaths) {
			queueConfigPath(referencePath);
		}
	}

	const projects = [...projectMap.values()].sort((left, right) =>
		left.configPath.localeCompare(right.configPath),
	);
	const projectsByFilePath = new Map<string, WorkspaceProject>();

	for (const project of projects) {
		for (const filePath of project.filePaths) {
			const existing = projectsByFilePath.get(filePath);
			if (!existing || existing.configDir.length < project.configDir.length) {
				projectsByFilePath.set(filePath, project);
			}
		}
	}

	const packagesByName = new Map<string, WorkspacePackage>();
	const workspacePackageList = [...workspacePackages.values()]
		.map((workspacePackage) => ({
			...workspacePackage,
			sourceRoots: dedupeSorted(
				workspacePackage.sourceRoots.length > 0
					? workspacePackage.sourceRoots
					: [path.join(workspacePackage.packageRoot, "src")],
			),
			tsconfigPaths: dedupeSorted(workspacePackage.tsconfigPaths),
		}))
		.sort((left, right) => right.packageRoot.length - left.packageRoot.length);

	for (const workspacePackage of workspacePackageList) {
		if (workspacePackage.packageName) {
			packagesByName.set(workspacePackage.packageName, workspacePackage);
		}
	}

	if (timingEnabled) {
		console.info(
			`[preview] createWorkspaceGraphServiceContext(): ${Date.now() - startedAt}ms`,
		);
	}

	return {
		packagesByName,
		projects,
		projectsByFilePath,
		workspacePackageList,
		workspaceRoot: resolvedWorkspaceRoot,
	};
}
