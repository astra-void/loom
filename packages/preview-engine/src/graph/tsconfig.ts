import path from "node:path";
import ts from "typescript";
import { resolveRealFilePath } from "../pathUtils";

export const DEFAULT_COMPILER_OPTIONS: ts.CompilerOptions = {
	jsx: ts.JsxEmit.Preserve,
	module: ts.ModuleKind.ESNext,
	moduleResolution: ts.ModuleResolutionKind.Node16,
	target: ts.ScriptTarget.ESNext,
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

export function findNearestTsconfig(startPath: string) {
	return ts.findConfigFile(
		resolveRealFilePath(startPath),
		ts.sys.fileExists,
		"tsconfig.json",
	);
}

export function parseTsconfig(tsconfigPath: string) {
	const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
	if (configFile.error) {
		const diagnostic = ts.formatDiagnostic(configFile.error, {
			getCanonicalFileName: (value) => value,
			getCurrentDirectory: () => process.cwd(),
			getNewLine: () => "\n",
		});
		throw new Error(
			`Failed to read TypeScript config ${tsconfigPath}: ${diagnostic}`,
		);
	}

	const parsed = ts.parseJsonConfigFileContent(
		configFile.config,
		ts.sys,
		path.dirname(tsconfigPath),
		undefined,
		tsconfigPath,
	);
	if (parsed.errors.length > 0) {
		const diagnostic = ts.formatDiagnostics(parsed.errors, {
			getCanonicalFileName: (value) => value,
			getCurrentDirectory: () => process.cwd(),
			getNewLine: () => "\n",
		});
		throw new Error(
			`Failed to parse TypeScript config ${tsconfigPath}: ${diagnostic}`,
		);
	}

	return parsed;
}

export function createProjectFromParsedConfig(
	packageRoot: string,
	packageName: string | undefined,
	parsedConfig: ts.ParsedCommandLine,
	configPath: string,
) {
	const configDir = resolveRealFilePath(path.dirname(configPath));
	const rootDir = resolveRealFilePath(
		parsedConfig.options.rootDir
			? path.resolve(configDir, parsedConfig.options.rootDir)
			: configDir,
	);
	const outDir = parsedConfig.options.outDir
		? resolveRealFilePath(path.resolve(configDir, parsedConfig.options.outDir))
		: undefined;

	return {
		configDir,
		configPath: resolveRealFilePath(configPath),
		filePaths: new Set(
			parsedConfig.fileNames.map((filePath) => resolveRealFilePath(filePath)),
		),
		outDir,
		packageName,
		packageRoot,
		parsedConfig,
		referencedProjectConfigPaths:
			parsedConfig.projectReferences?.map((reference) =>
				resolveRealFilePath(
					path.resolve(
						configDir,
						reference.path,
						ts.sys.fileExists(path.resolve(configDir, reference.path))
							? ""
							: "tsconfig.json",
					),
				),
			) ?? [],
		rootDir,
	} satisfies WorkspaceProject;
}
