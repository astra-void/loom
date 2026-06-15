import fs from "node:fs";
import ts from "typescript";
import { createWorkspaceGraphServiceContext } from "./graph/context";
import {
	mapResolvedPathToSourceCandidates,
	resolveWorkspacePackageSpecifier,
} from "./graph/imports";
import {
	findNearestPackageRoot,
	getWorkspacePackageForFile,
	readPackageJson,
	splitBarePackageSpecifier,
} from "./graph/packages";
import {
	dedupeSorted,
	isDeclarationFile,
	isTraceableSourceFile,
	isTransformableSourceFile,
	listSourceFiles,
	resolveExistingTraceablePath,
} from "./graph/sourceFiles";
import type { WorkspaceProject } from "./graph/tsconfig";
import { DEFAULT_COMPILER_OPTIONS } from "./graph/tsconfig";
import {
	isFilePathIncludedByTarget,
	isFilePathUnderRoot,
	resolveRealFilePath,
} from "./pathUtils";
import {
	collectTransitiveDependencyPathsWithPreviewGraph,
	type PreviewGraphRecordSnapshot,
} from "./previewGraphWasm";
import type { PreviewGraphImportEdge, PreviewSourceTarget } from "./types";

export type { WorkspaceProject } from "./graph/tsconfig";
export { isTransformableSourceFile };

export type WorkspaceResolutionDiagnostic = {
	code: "DECLARATION_ONLY_BOUNDARY" | "UNRESOLVED_IMPORT";
	file: string;
	importChain?: string[];
	packageRoot: string;
	phase: "discovery";
	severity: "warning";
	summary: string;
	target: "preview-engine";
};

type WorkspaceFileContext = {
	packageName?: string;
	packageRoot: string;
	project?: WorkspaceProject;
};

export type WorkspaceImportResolution = {
	diagnostic?: WorkspaceResolutionDiagnostic;
	edge: PreviewGraphImportEdge;
	followedFilePath?: string;
};

export type WorkspaceGraphService = {
	collectTransitiveDependencyPaths(filePath: string): string[];
	getFileContext(filePath: string): WorkspaceFileContext;
	getWorkspaceProjects(): WorkspaceProject[];
	listTargetSourceFiles(
		target: Pick<PreviewSourceTarget, "exclude" | "include" | "sourceRoot">,
	): string[];
	resolveImport(options: {
		importerFilePath: string;
		specifier: string;
	}): WorkspaceImportResolution | undefined;
	workspaceRoot: string;
};

export function createWorkspaceGraphService(options: {
	targets: PreviewSourceTarget[];
	workspaceRoot?: string;
}): WorkspaceGraphService {
	const context = createWorkspaceGraphServiceContext(
		options.targets,
		options.workspaceRoot,
	);
	const specifierCache = new Map<string, string[]>();
	const dependencyMemo = new Map<string, string[]>();

	const getProjectForFile = (filePath: string) => {
		const normalizedFilePath = resolveRealFilePath(filePath);
		const exactProject = context.projectsByFilePath.get(normalizedFilePath);
		if (exactProject) {
			return exactProject;
		}

		return context.projects
			.filter((project) =>
				isFilePathUnderRoot(project.configDir, normalizedFilePath),
			)
			.sort((left, right) => right.configDir.length - left.configDir.length)[0];
	};

	const getFileContext = (filePath: string): WorkspaceFileContext => {
		const normalizedFilePath = resolveRealFilePath(filePath);
		const workspacePackage = getWorkspacePackageForFile(
			context.workspacePackageList,
			normalizedFilePath,
		);
		const packageRoot =
			workspacePackage?.packageRoot ??
			findNearestPackageRoot(normalizedFilePath);
		const packageName =
			workspacePackage?.packageName ?? readPackageJson(packageRoot).name;

		return {
			packageName,
			packageRoot,
			project: getProjectForFile(normalizedFilePath),
		};
	};

	const listTargetSourceFiles = (
		target: Pick<PreviewSourceTarget, "exclude" | "include" | "sourceRoot">,
	) => {
		const sourceRoot = resolveRealFilePath(target.sourceRoot);
		const projectFiles = dedupeSorted(
			context.projects.flatMap((project) =>
				[...project.filePaths].filter(
					(filePath) =>
						isTransformableSourceFile(filePath) &&
						isFilePathIncludedByTarget(target, filePath),
				),
			),
		);

		if (projectFiles.length > 0) {
			return projectFiles;
		}

		return listSourceFiles(sourceRoot).filter((filePath) =>
			isFilePathIncludedByTarget(target, filePath),
		);
	};

	const getModuleSpecifiers = (filePath: string) => {
		const normalizedFilePath = resolveRealFilePath(filePath);
		const cachedSpecifiers = specifierCache.get(normalizedFilePath);
		if (cachedSpecifiers) {
			return cachedSpecifiers;
		}

		if (!fs.existsSync(normalizedFilePath)) {
			specifierCache.set(normalizedFilePath, []);
			return [];
		}

		const sourceText = fs.readFileSync(normalizedFilePath, "utf8");
		const scriptKind = normalizedFilePath.endsWith(".tsx")
			? ts.ScriptKind.TSX
			: ts.ScriptKind.TS;
		const sourceFile = ts.createSourceFile(
			normalizedFilePath,
			sourceText,
			ts.ScriptTarget.Latest,
			true,
			scriptKind,
		);
		const specifiers = new Set<string>();

		const visit = (node: ts.Node): void => {
			if (
				(ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
				node.moduleSpecifier
			) {
				if (ts.isStringLiteralLike(node.moduleSpecifier)) {
					specifiers.add(node.moduleSpecifier.text);
				}
			}

			if (
				ts.isImportEqualsDeclaration(node) &&
				ts.isExternalModuleReference(node.moduleReference)
			) {
				const expression = node.moduleReference.expression;
				if (expression && ts.isStringLiteralLike(expression)) {
					specifiers.add(expression.text);
				}
			}

			if (
				ts.isCallExpression(node) &&
				node.arguments.length === 1 &&
				ts.isIdentifier(node.expression) &&
				node.expression.text === "require"
			) {
				const [argument] = node.arguments;
				if (argument && ts.isStringLiteralLike(argument)) {
					specifiers.add(argument.text);
				}
			}

			ts.forEachChild(node, visit);
		};

		visit(sourceFile);
		const nextSpecifiers = [...specifiers].sort((left, right) =>
			left.localeCompare(right),
		);
		specifierCache.set(normalizedFilePath, nextSpecifiers);
		return nextSpecifiers;
	};

	const createExternalEdge = (options: {
		importerFilePath: string;
		importerProject?: WorkspaceProject;
		resolvedFilePath?: string;
		specifier: string;
	}) =>
		({
			crossesPackageBoundary: false,
			importerFile: options.importerFilePath,
			importerProjectConfigPath: options.importerProject?.configPath,
			...(options.resolvedFilePath
				? { originalResolvedFile: options.resolvedFilePath }
				: {}),
			resolution: "stopped" as const,
			resolutionKind: "external-dependency" as const,
			specifier: options.specifier,
			stopReason: "external-dependency",
		}) satisfies PreviewGraphImportEdge;

	const resolveToTraceableWorkspacePath = (options: {
		importerProject?: WorkspaceProject;
		rawResolvedFilePath: string;
		specifier: string;
	}) => {
		const normalizedResolvedPath = resolveRealFilePath(
			options.rawResolvedFilePath,
		);
		const resolvedPackage = getWorkspacePackageForFile(
			context.workspacePackageList,
			normalizedResolvedPath,
		);
		const resolvedProject = getProjectForFile(normalizedResolvedPath);
		const mappedSource = resolveExistingTraceablePath(
			mapResolvedPathToSourceCandidates(
				normalizedResolvedPath,
				resolvedProject,
				resolvedPackage,
			),
			true,
		);

		if (mappedSource && isTransformableSourceFile(mappedSource)) {
			return {
				followedFilePath: mappedSource,
				resolutionKind:
					mappedSource === normalizedResolvedPath
						? ("source-file" as const)
						: resolvedProject?.outDir &&
								isFilePathUnderRoot(
									resolvedProject.outDir,
									normalizedResolvedPath,
								)
							? ("project-reference-source" as const)
							: ("workspace-package" as const),
			};
		}

		if (mappedSource && isTraceableSourceFile(mappedSource)) {
			return {
				followedFilePath: mappedSource,
				resolutionKind: "declaration-file" as const,
			};
		}

		if (isTraceableSourceFile(normalizedResolvedPath)) {
			return {
				followedFilePath: normalizedResolvedPath,
				resolutionKind: isDeclarationFile(normalizedResolvedPath)
					? ("declaration-file" as const)
					: ("source-file" as const),
			};
		}

		const bareSpecifier = splitBarePackageSpecifier(options.specifier);
		if (bareSpecifier) {
			const workspacePackage = context.packagesByName.get(
				bareSpecifier.packageName,
			);
			if (workspacePackage) {
				const packageResolution = resolveWorkspacePackageSpecifier(
					workspacePackage,
					options.specifier,
					bareSpecifier.subpath,
					getProjectForFile(workspacePackage.packageRoot),
				);
				if (packageResolution) {
					return {
						followedFilePath: packageResolution,
						resolutionKind: "workspace-package" as const,
					};
				}
			}
		}

		return undefined;
	};

	const resolveImport = (options: {
		importerFilePath: string;
		specifier: string;
	}): WorkspaceImportResolution | undefined => {
		const importerFilePath = resolveRealFilePath(options.importerFilePath);
		const importerContext = getFileContext(importerFilePath);
		const compilerOptions =
			importerContext.project?.parsedConfig.options ?? DEFAULT_COMPILER_OPTIONS;
		const resolution = ts.resolveModuleName(
			options.specifier,
			importerFilePath,
			compilerOptions,
			ts.sys,
		);
		const rawResolvedFilePath = resolution.resolvedModule?.resolvedFileName
			? resolveRealFilePath(resolution.resolvedModule.resolvedFileName)
			: undefined;

		if (!rawResolvedFilePath) {
			const bareSpecifier = splitBarePackageSpecifier(options.specifier);
			if (bareSpecifier) {
				const workspacePackage = context.packagesByName.get(
					bareSpecifier.packageName,
				);
				if (workspacePackage) {
					const packageResolution = resolveWorkspacePackageSpecifier(
						workspacePackage,
						options.specifier,
						bareSpecifier.subpath,
						getProjectForFile(workspacePackage.packageRoot),
					);
					if (packageResolution) {
						const resolvedContext = getFileContext(packageResolution);
						return {
							edge: {
								crossesPackageBoundary:
									importerContext.packageRoot !== resolvedContext.packageRoot,
								importerFile: importerFilePath,
								importerProjectConfigPath: importerContext.project?.configPath,
								resolution: "resolved",
								resolutionKind: "workspace-package",
								resolvedFile: packageResolution,
								resolvedProjectConfigPath: resolvedContext.project?.configPath,
								specifier: options.specifier,
							},
							followedFilePath: packageResolution,
						};
					}

					return {
						diagnostic: {
							code: "DECLARATION_ONLY_BOUNDARY",
							file: importerFilePath,
							importChain: [importerFilePath],
							packageRoot: importerContext.packageRoot,
							phase: "discovery",
							severity: "warning",
							summary:
								`Preview graph reached ${JSON.stringify(options.specifier)}, but the workspace package could not be mapped ` +
								"back to a traceable source file.",
							target: "preview-engine",
						},
						edge: {
							crossesPackageBoundary: false,
							importerFile: importerFilePath,
							importerProjectConfigPath: importerContext.project?.configPath,
							resolution: "stopped",
							specifier: options.specifier,
							stopReason: "declaration-only-boundary",
						},
					};
				}

				return {
					edge: createExternalEdge({
						importerFilePath,
						importerProject: importerContext.project,
						specifier: options.specifier,
					}),
				};
			}

			return {
				diagnostic: {
					code: "UNRESOLVED_IMPORT",
					file: importerFilePath,
					importChain: [importerFilePath],
					packageRoot: importerContext.packageRoot,
					phase: "discovery",
					severity: "warning",
					summary: `Preview graph could not resolve ${JSON.stringify(options.specifier)} from ${importerFilePath}.`,
					target: "preview-engine",
				},
				edge: {
					crossesPackageBoundary: false,
					importerFile: importerFilePath,
					importerProjectConfigPath: importerContext.project?.configPath,
					resolution: "stopped",
					specifier: options.specifier,
					stopReason: "unresolved-import",
				},
			};
		}

		if (!isFilePathUnderRoot(context.workspaceRoot, rawResolvedFilePath)) {
			return {
				edge: createExternalEdge({
					importerFilePath,
					importerProject: importerContext.project,
					resolvedFilePath: rawResolvedFilePath,
					specifier: options.specifier,
				}),
			};
		}

		const normalizedResolution = resolveToTraceableWorkspacePath({
			importerProject: importerContext.project,
			rawResolvedFilePath,
			specifier: options.specifier,
		});
		if (!normalizedResolution?.followedFilePath) {
			return {
				diagnostic: {
					code: "DECLARATION_ONLY_BOUNDARY",
					file: importerFilePath,
					importChain: [importerFilePath],
					packageRoot: importerContext.packageRoot,
					phase: "discovery",
					severity: "warning",
					summary:
						`Preview graph resolved ${JSON.stringify(options.specifier)} inside the workspace (${rawResolvedFilePath}) ` +
						"but could not map it back to a traceable source file.",
					target: "preview-engine",
				},
				edge: {
					crossesPackageBoundary: false,
					importerFile: importerFilePath,
					importerProjectConfigPath: importerContext.project?.configPath,
					originalResolvedFile: rawResolvedFilePath,
					resolution: "stopped",
					specifier: options.specifier,
					stopReason: "declaration-only-boundary",
				},
			};
		}

		const resolvedContext = getFileContext(
			normalizedResolution.followedFilePath,
		);
		return {
			edge: {
				crossesPackageBoundary:
					importerContext.packageRoot !== resolvedContext.packageRoot,
				importerFile: importerFilePath,
				importerProjectConfigPath: importerContext.project?.configPath,
				...(rawResolvedFilePath !== normalizedResolution.followedFilePath
					? { originalResolvedFile: rawResolvedFilePath }
					: {}),
				resolution: "resolved",
				resolutionKind: normalizedResolution.resolutionKind,
				resolvedFile: normalizedResolution.followedFilePath,
				resolvedProjectConfigPath: resolvedContext.project?.configPath,
				specifier: options.specifier,
			},
			followedFilePath: normalizedResolution.followedFilePath,
		};
	};

	const collectPreviewGraphSnapshot = (entryFilePath: string) => {
		const normalizedEntryFilePath = resolveRealFilePath(entryFilePath);
		if (
			!fs.existsSync(normalizedEntryFilePath) ||
			!isTraceableSourceFile(normalizedEntryFilePath)
		) {
			return [] as PreviewGraphRecordSnapshot[];
		}

		const visited = new Set<string>();
		const recordsByPath = new Map<string, PreviewGraphRecordSnapshot>();

		const visit = (nextFilePath: string) => {
			const normalizedNextFilePath = resolveRealFilePath(nextFilePath);
			if (
				visited.has(normalizedNextFilePath) ||
				!fs.existsSync(normalizedNextFilePath) ||
				!isTraceableSourceFile(normalizedNextFilePath)
			) {
				return;
			}

			visited.add(normalizedNextFilePath);

			const imports = new Set<string>();
			const graphEdges: PreviewGraphImportEdge[] = [];

			for (const specifier of getModuleSpecifiers(normalizedNextFilePath)) {
				const resolution = resolveImport({
					importerFilePath: normalizedNextFilePath,
					specifier,
				});
				if (resolution?.edge) {
					graphEdges.push(resolution.edge);
				}

				if (resolution?.followedFilePath) {
					imports.add(resolution.followedFilePath);
					visit(resolution.followedFilePath);
				}
			}

			const fileContext = getFileContext(normalizedNextFilePath);
			recordsByPath.set(normalizedNextFilePath, {
				filePath: normalizedNextFilePath,
				graphEdges,
				imports: [...imports].sort((left, right) => left.localeCompare(right)),
				ownerPackageName: fileContext.packageName,
				ownerPackageRoot: fileContext.packageRoot,
				...(fileContext.project?.configPath
					? { projectConfigPath: fileContext.project.configPath }
					: {}),
			});
		};

		visit(normalizedEntryFilePath);
		return [...recordsByPath.values()].sort((left, right) =>
			left.filePath.localeCompare(right.filePath),
		);
	};

	const collectTransitiveDependencyPaths = (filePath: string) => {
		const normalizedFilePath = resolveRealFilePath(filePath);
		const cachedDependencies = dependencyMemo.get(normalizedFilePath);
		if (cachedDependencies) {
			return cachedDependencies;
		}

		const graphSnapshot = collectPreviewGraphSnapshot(normalizedFilePath);
		if (graphSnapshot.length === 0) {
			dependencyMemo.set(normalizedFilePath, []);
			return [];
		}

		const dependencies = collectTransitiveDependencyPathsWithPreviewGraph(
			graphSnapshot,
			normalizedFilePath,
		).sort((left, right) => left.localeCompare(right));
		dependencyMemo.set(normalizedFilePath, dependencies);
		return dependencies;
	};

	return {
		collectTransitiveDependencyPaths,
		getFileContext,
		getWorkspaceProjects() {
			return context.projects;
		},
		listTargetSourceFiles,
		resolveImport,
		workspaceRoot: context.workspaceRoot,
	};
}
