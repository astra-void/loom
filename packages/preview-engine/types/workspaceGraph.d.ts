import ts from "typescript";
import type { PreviewGraphImportEdge, PreviewSourceTarget } from "./types";
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
export type WorkspaceProject = {
	configDir: string;
	configPath: string;
	filePaths: Set<string>;
	outDir?: string;
	packageName?: string;
	packageRoot: string;
	parsedConfig: ts.ParsedCommandLine;
	referencedProjectConfigPaths: string[];
	rootDir: string;
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
export declare function isTransformableSourceFile(fileName: string): boolean;
export declare function createWorkspaceGraphService(options: {
	targets: PreviewSourceTarget[];
	workspaceRoot?: string;
}): WorkspaceGraphService;
