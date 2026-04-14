import ts from "typescript";
export type TsconfigParseCache = {
	clear(): void;
	getParsed(tsconfigPath: string): ts.ParsedCommandLine;
};
export declare function isTsconfigLikeFile(filePath: string): boolean;
export declare function findNearestTsconfig(
	filePath: string,
): string | undefined;
export declare function parseTsconfig(
	tsconfigPath: string,
): ts.ParsedCommandLine;
export declare function createTsconfigParseCache(): TsconfigParseCache;
