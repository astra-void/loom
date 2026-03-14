import path from "node:path";
import ts from "typescript";

const TSCONFIG_FILE_NAME_RE = /^(?:tsconfig(?:\..+)?|jsconfig)\.json$/i;

export type TsconfigParseCache = {
	clear(): void;
	getParsed(tsconfigPath: string): ts.ParsedCommandLine;
};

function formatConfigDiagnostics(
	diagnostics: readonly ts.Diagnostic[],
): string {
	return ts.formatDiagnostics(diagnostics, {
		getCanonicalFileName: (value) => value,
		getCurrentDirectory: () => process.cwd(),
		getNewLine: () => "\n",
	});
}

export function isTsconfigLikeFile(filePath: string) {
	return TSCONFIG_FILE_NAME_RE.test(path.basename(filePath));
}

export function findNearestTsconfig(filePath: string) {
	return ts.findConfigFile(
		path.dirname(filePath),
		ts.sys.fileExists,
		"tsconfig.json",
	);
}

export function parseTsconfig(tsconfigPath: string) {
	const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
	if (configFile.error) {
		throw new Error(
			`Failed to read TypeScript config ${tsconfigPath}: ${formatConfigDiagnostics([configFile.error])}`,
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
		throw new Error(
			`Failed to parse TypeScript config ${tsconfigPath}: ${formatConfigDiagnostics(parsed.errors)}`,
		);
	}

	return parsed;
}

export function createTsconfigParseCache(): TsconfigParseCache {
	const parsedConfigsByPath = new Map<string, ts.ParsedCommandLine>();

	return {
		clear() {
			parsedConfigsByPath.clear();
		},
		getParsed(tsconfigPath: string) {
			const cachedParsed = parsedConfigsByPath.get(tsconfigPath);
			if (cachedParsed) {
				return cachedParsed;
			}

			const parsed = parseTsconfig(tsconfigPath);
			parsedConfigsByPath.set(tsconfigPath, parsed);
			return parsed;
		},
	};
}
