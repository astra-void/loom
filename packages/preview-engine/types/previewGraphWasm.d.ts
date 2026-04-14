import type {
	PreviewDiagnostic,
	PreviewEntryDescriptor,
	PreviewGraphImportEdge,
	PreviewGraphTrace,
	PreviewWorkspaceIndex,
} from "./types";
export type PreviewGraphRecordSnapshot = {
	filePath: string;
	graphEdges: PreviewGraphImportEdge[];
	imports: string[];
	ownerPackageName?: string;
	ownerPackageRoot: string;
	projectConfigPath?: string;
};
export type PreviewSourceTargetSnapshot = {
	exclude?: string[];
	include?: string[];
	name: string;
	packageName?: string;
	packageRoot: string;
	sourceRoot: string;
};
export type WorkspaceFileSnapshot = {
	isEntryCandidate?: boolean;
	filePath: string;
	ownerPackageName?: string;
	ownerPackageRoot: string;
	projectConfigPath?: string;
	relativePath: string;
	sourceText: string;
	target: PreviewSourceTargetSnapshot;
};
export type WorkspaceResolutionDiagnostic = {
	code: string;
	file: string;
	importChain?: string[];
	packageRoot: string;
	phase: string;
	severity: string;
	summary: string;
	target: string;
};
export type WorkspaceImportResolution = {
	diagnostic?: WorkspaceResolutionDiagnostic;
	edge: PreviewGraphImportEdge;
	followedFilePath?: string;
};
export type WorkspaceDiscoveryEntryState = {
	dependencyPaths: string[];
	descriptor: PreviewEntryDescriptor;
	discoveryDiagnostics: PreviewDiagnostic[];
	graphTrace: PreviewGraphTrace;
	packageRoot: string;
	previewHasProps: boolean;
	target: PreviewSourceTargetSnapshot;
};
export type WorkspaceDiscoverySnapshot = {
	entries: WorkspaceDiscoveryEntryState[];
	workspaceIndex: PreviewWorkspaceIndex;
};
export declare function normalizePreviewAnalysisError(
	error: unknown,
	fallbackMessage: string,
): Error;
export declare function resolvePreviewGraphModulePath(
	resolveModule?: (specifier: string) => string,
): string;
export declare function collectGraphTraceWithPreviewGraph(
	records: PreviewGraphRecordSnapshot[],
	entryFilePath: string,
	selectionTrace: PreviewGraphTrace["selection"],
): {
	selection: import("./types").PreviewSelectionTrace;
	boundaryHops: Array<{
		fromFile: string;
		fromPackageRoot: string;
		toFile: string;
		toPackageRoot: string;
	}>;
	imports: PreviewGraphImportEdge[];
	stopReason?: import("./types").PreviewGraphStopReason;
	traversedProjects?: Array<{
		configPath: string;
		packageName?: string;
		packageRoot: string;
	}>;
};
export declare function collectTransitiveDependencyPathsWithPreviewGraph(
	records: PreviewGraphRecordSnapshot[],
	entryFilePath: string,
): string[];
export declare function buildWorkspaceDiscoveryWithPreviewGraph(
	records: WorkspaceFileSnapshot[],
	projectName: string,
	protocolVersion: number,
	resolveImport: (
		importerFilePath: string,
		specifier: string,
	) => WorkspaceImportResolution | undefined,
): WorkspaceDiscoverySnapshot;
