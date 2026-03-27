import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { isFilePathIncludedByTarget } from "./pathUtils";
import {
	buildWorkspaceDiscoveryWithPreviewGraph,
	type WorkspaceDiscoverySnapshot as PreviewGraphWorkspaceDiscoverySnapshot,
	type PreviewSourceTargetSnapshot,
	type WorkspaceDiscoveryEntryState,
	type WorkspaceFileSnapshot,
} from "./previewGraphWasm";
import type {
	CreatePreviewEngineOptions,
	PreviewEntryDescriptor,
	PreviewWorkspaceIndex,
} from "./types";
import { PREVIEW_ENGINE_PROTOCOL_VERSION } from "./types";
import {
	createWorkspaceGraphService,
	type WorkspaceGraphService,
} from "./workspaceGraph";

type TargetContext = {
	exclude?: string[];
	include?: string[];
	packageName: string;
	packageRoot: string;
	name: string;
	sourceRoot: string;
	targetName: string;
};

export type DiscoveredEntryState = WorkspaceDiscoveryEntryState & {
	target: TargetContext;
};

export type WorkspaceDiscoverySnapshot = {
	entryDependencyPathsById: Map<string, string[]>;
	entryStatesById: Map<string, DiscoveredEntryState>;
	workspaceIndex: PreviewWorkspaceIndex;
};

type WorkspaceSnapshotQueueItem = {
	filePath: string;
	isEntryCandidate: boolean;
	target: TargetContext;
};

type SourceFileAnalysis = {
	fingerprint: string;
	hasPreviewContract: boolean;
	specifiers: string[];
};

const sourceFileAnalysisCache = new Map<string, SourceFileAnalysis>();

function toRelativePath(rootPath: string, filePath: string) {
	return path
		.relative(resolveRealFilePath(rootPath), resolveRealFilePath(filePath))
		.split(path.sep)
		.join("/");
}

function resolveRealFilePath(filePath: string) {
	try {
		return fs.realpathSync.native(filePath);
	} catch {
		return path.resolve(filePath);
	}
}

function isTraceableSourceFile(fileName: string) {
	return (
		fileName.endsWith(".ts") ||
		fileName.endsWith(".tsx") ||
		fileName.endsWith(".d.ts") ||
		fileName.endsWith(".d.tsx")
	);
}

function isPreviewEntryFile(fileName: string) {
	return fileName.endsWith(".loom.ts") || fileName.endsWith(".loom.tsx");
}

function analyzeSourceFile(filePath: string): SourceFileAnalysis {
	const normalizedFilePath = resolveRealFilePath(filePath);
	if (!fs.existsSync(normalizedFilePath)) {
		const emptyAnalysis = {
			fingerprint: "missing",
			hasPreviewContract: false,
			specifiers: [],
		};
		sourceFileAnalysisCache.set(normalizedFilePath, emptyAnalysis);
		return emptyAnalysis;
	}

	const fileStats = fs.statSync(normalizedFilePath);
	const fingerprint = `${fileStats.mtimeMs}:${fileStats.size}`;
	const cachedAnalysis = sourceFileAnalysisCache.get(normalizedFilePath);
	if (cachedAnalysis?.fingerprint === fingerprint) {
		return cachedAnalysis;
	}

	const sourceText = fs.readFileSync(normalizedFilePath, "utf8");
	const scriptKind =
		normalizedFilePath.endsWith(".tsx") || normalizedFilePath.endsWith(".d.tsx")
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
	let hasPreviewContract = false;
	const hasExportModifier = (node: ts.Node) =>
		(node as { modifiers?: readonly ts.ModifierLike[] }).modifiers?.some(
			(modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
		) ?? false;

	const visit = (node: ts.Node): void => {
		if (
			(ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
			node.moduleSpecifier &&
			ts.isStringLiteralLike(node.moduleSpecifier)
		) {
			specifiers.add(node.moduleSpecifier.text);
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

		if (hasExportModifier(node)) {
			if (ts.isVariableStatement(node)) {
				for (const declaration of node.declarationList.declarations) {
					if (
						ts.isIdentifier(declaration.name) &&
						declaration.name.text === "preview"
					) {
						hasPreviewContract = true;
					}
				}
			}

			if (ts.isFunctionDeclaration(node) && node.name?.text === "preview") {
				hasPreviewContract = true;
			}

			if (ts.isClassDeclaration(node) && node.name?.text === "preview") {
				hasPreviewContract = true;
			}
		}

		if (
			ts.isExportDeclaration(node) &&
			!node.moduleSpecifier &&
			node.exportClause &&
			ts.isNamedExports(node.exportClause)
		) {
			for (const element of node.exportClause.elements) {
				if (element.name.text === "preview") {
					hasPreviewContract = true;
				}
			}
		}

		ts.forEachChild(node, visit);
	};

	visit(sourceFile);

	const analysis = {
		fingerprint,
		hasPreviewContract,
		specifiers: [...specifiers].sort((left, right) =>
			left.localeCompare(right),
		),
	};
	sourceFileAnalysisCache.set(normalizedFilePath, analysis);
	return analysis;
}

function getModuleSpecifiers(filePath: string) {
	return analyzeSourceFile(filePath).specifiers;
}

function isPreviewEntryCandidate(filePath: string) {
	return (
		isPreviewEntryFile(filePath) ||
		analyzeSourceFile(filePath).hasPreviewContract
	);
}

function findOwningTarget(filePath: string, targets: TargetContext[]) {
	const matchingTargets = targets
		.filter((target) => isFilePathIncludedByTarget(target, filePath))
		.sort((left, right) => {
			if (left.sourceRoot.length !== right.sourceRoot.length) {
				return right.sourceRoot.length - left.sourceRoot.length;
			}

			return left.name.localeCompare(right.name);
		});

	return matchingTargets[0];
}

function findWorkspaceRoot(startPaths: string[]) {
	const candidates = startPaths.map((startPath) =>
		resolveRealFilePath(startPath),
	);
	const markerRoots: string[] = [];

	for (const startPath of candidates) {
		let current = startPath;
		while (true) {
			if (
				fs.existsSync(path.join(current, "pnpm-workspace.yaml")) ||
				fs.existsSync(path.join(current, ".git"))
			) {
				markerRoots.push(current);
				break;
			}

			const parent = path.dirname(current);
			if (parent === current) {
				markerRoots.push(startPath);
				break;
			}

			current = parent;
		}
	}

	let commonPath = markerRoots[0] ?? process.cwd();
	for (const candidate of markerRoots.slice(1)) {
		while (!isPathEqualOrContained(commonPath, candidate)) {
			const parent = path.dirname(commonPath);
			if (parent === commonPath) {
				return commonPath;
			}

			commonPath = parent;
		}
	}

	return commonPath;
}

function isPathEqualOrContained(rootPath: string, candidatePath: string) {
	const normalizedRoot = resolveRealFilePath(rootPath);
	const normalizedCandidate = resolveRealFilePath(candidatePath);
	return (
		normalizedRoot === normalizedCandidate ||
		normalizedCandidate.startsWith(`${normalizedRoot}${path.sep}`) ||
		normalizedRoot.startsWith(`${normalizedCandidate}${path.sep}`)
	);
}

function normalizeTarget(
	target: CreatePreviewEngineOptions["targets"][number],
) {
	return {
		...target,
		packageName: target.packageName ?? target.name,
		packageRoot: resolveRealFilePath(target.packageRoot),
		sourceRoot: resolveRealFilePath(target.sourceRoot),
	};
}

function createTargetSnapshot(
	target: TargetContext,
): PreviewSourceTargetSnapshot {
	return {
		exclude: target.exclude,
		include: target.include,
		name: target.targetName,
		packageName: target.packageName,
		packageRoot: target.packageRoot,
		sourceRoot: target.sourceRoot,
	};
}

function collectWorkspaceFileSnapshots(
	targets: TargetContext[],
	graphService: WorkspaceGraphService,
) {
	const snapshotsByPath = new Map<string, WorkspaceFileSnapshot>();
	const visited = new Set<string>();
	const queue: WorkspaceSnapshotQueueItem[] = [];

	for (const target of targets) {
		for (const filePath of graphService.listTargetSourceFiles(target)) {
			if (!isPreviewEntryCandidate(filePath)) {
				continue;
			}

			queue.push({
				filePath: resolveRealFilePath(filePath),
				target,
				isEntryCandidate: true,
			});
		}
	}

	while (queue.length > 0) {
		const next = queue.shift();
		if (!next) {
			continue;
		}
		const filePath = resolveRealFilePath(next.filePath);
		if (visited.has(filePath) || !fs.existsSync(filePath)) {
			continue;
		}

		visited.add(filePath);

		if (!isTraceableSourceFile(filePath)) {
			continue;
		}

		const owningTarget = findOwningTarget(filePath, targets) ?? next.target;
		const targetSnapshot = createTargetSnapshot(owningTarget);
		if (!snapshotsByPath.has(filePath)) {
			const fileContext = graphService.getFileContext(filePath);
			snapshotsByPath.set(filePath, {
				filePath,
				ownerPackageName: fileContext.packageName,
				ownerPackageRoot: fileContext.packageRoot,
				isEntryCandidate: next.isEntryCandidate,
				projectConfigPath: fileContext.project?.configPath,
				relativePath: toRelativePath(owningTarget.sourceRoot, filePath),
				sourceText: fs.readFileSync(filePath, "utf8"),
				target: targetSnapshot,
			});
		}

		for (const specifier of getModuleSpecifiers(filePath)) {
			const resolution = graphService.resolveImport({
				importerFilePath: filePath,
				specifier,
			});
			if (resolution?.followedFilePath) {
				queue.push({
					filePath: resolution.followedFilePath,
					target: owningTarget,
					isEntryCandidate: false,
				});
			}
		}
	}

	return [...snapshotsByPath.values()].sort((left, right) =>
		left.filePath.localeCompare(right.filePath),
	);
}

function logPreviewTiming(label: string, startedAt: number) {
	if (process.env.LOOM_PREVIEW_TIMINGS !== "1") {
		return;
	}

	console.info(`[preview] ${label}: ${Date.now() - startedAt}ms`);
}

function createTargetContext(
	target: ReturnType<typeof normalizeTarget>,
): TargetContext {
	return {
		exclude: target.exclude,
		include: target.include,
		packageName: target.packageName,
		packageRoot: target.packageRoot,
		name: target.name,
		sourceRoot: target.sourceRoot,
		targetName: target.name,
	};
}

export function discoverWorkspaceState(
	options: Pick<
		CreatePreviewEngineOptions,
		"projectName" | "targets" | "workspaceRoot"
	>,
) {
	const startedAt = process.env.LOOM_PREVIEW_TIMINGS === "1" ? Date.now() : 0;
	const normalizedTargets = options.targets.map(normalizeTarget);
	const graphService = createWorkspaceGraphService({
		targets: normalizedTargets,
		workspaceRoot:
			options.workspaceRoot ??
			findWorkspaceRoot(normalizedTargets.map((target) => target.packageRoot)),
	});
	const targetContexts = normalizedTargets.map(createTargetContext);
	const workspaceFileSnapshots = collectWorkspaceFileSnapshots(
		targetContexts,
		graphService,
	);

	logPreviewTiming("workspace file snapshots collected", startedAt);

	const discovery = buildWorkspaceDiscoveryWithPreviewGraph(
		workspaceFileSnapshots,
		options.projectName,
		PREVIEW_ENGINE_PROTOCOL_VERSION,
		(importerFilePath, specifier) =>
			graphService.resolveImport({ importerFilePath, specifier }),
	) as PreviewGraphWorkspaceDiscoverySnapshot;

	const targetsByName = new Map(
		targetContexts.map((target) => [target.name, target] as const),
	);
	const entryStatesById = new Map<string, DiscoveredEntryState>();
	const entryDependencyPathsById = new Map<string, string[]>();
	const entries: PreviewEntryDescriptor[] = [];

	for (const entryState of discovery.entries) {
		const target = targetsByName.get(entryState.descriptor.targetName);
		if (!target) {
			continue;
		}

		entryStatesById.set(entryState.descriptor.id, {
			...entryState,
			target,
		});
		entryDependencyPathsById.set(
			entryState.descriptor.id,
			entryState.dependencyPaths,
		);
		entries.push(entryState.descriptor);
	}

	entries.sort((left, right) => {
		if (left.targetName !== right.targetName) {
			return left.targetName.localeCompare(right.targetName);
		}

		return left.relativePath.localeCompare(right.relativePath);
	});

	logPreviewTiming("discoverWorkspaceState()", startedAt);

	return {
		entryDependencyPathsById,
		entryStatesById,
		workspaceIndex: {
			...discovery.workspaceIndex,
			entries,
		},
	} satisfies WorkspaceDiscoverySnapshot;
}
