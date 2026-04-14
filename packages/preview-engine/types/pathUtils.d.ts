import type { PreviewSourceTarget } from "./types";
export declare function stripFileIdDecorations(filePath: string): string;
export declare function resolveFilePath(filePath: string): string;
export declare function resolveRealFilePath(filePath: string): string;
export declare function canonicalizeFilePath(filePath: string): string;
export declare function isFilePathUnderRoot(
	rootPath: string,
	filePath: string,
): boolean;
export declare function isFilePathIncludedByTarget(
	target: Pick<PreviewSourceTarget, "exclude" | "include" | "sourceRoot">,
	filePath: string,
): boolean;
