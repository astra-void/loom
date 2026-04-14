import fs from "node:fs";
export declare const CLI_BINARY_NAME = "loom";
export declare function getCliVersion(
	readFileSync?: typeof fs.readFileSync,
): string;
