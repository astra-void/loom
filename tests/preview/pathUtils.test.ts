import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { isFilePathIncludedByTarget } from "../../packages/preview/src/source/pathUtils";

const temporaryRoots: string[] = [];

afterEach(() => {
	for (const root of temporaryRoots.splice(0)) {
		fs.rmSync(root, { force: true, recursive: true });
	}
});

function createTempRoot(prefix: string) {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
	temporaryRoots.push(root);
	return root;
}

describe("isFilePathIncludedByTarget", () => {
	it("matches direct-child and nested paths for ** include patterns", () => {
		const sourceRoot = createTempRoot("loom-preview-path-utils-");
		const directChildFile = path.join(
			sourceRoot,
			"preview-targets",
			"PreviewShellCard.tsx",
		);
		const nestedFile = path.join(
			sourceRoot,
			"preview-targets",
			"nested",
			"NestedCard.tsx",
		);
		fs.mkdirSync(path.dirname(directChildFile), { recursive: true });
		fs.mkdirSync(path.dirname(nestedFile), { recursive: true });
		fs.writeFileSync(
			directChildFile,
			"export const PreviewShellCard = () => <frame />;\n",
			"utf8",
		);
		fs.writeFileSync(
			nestedFile,
			"export const NestedCard = () => <frame />;\n",
			"utf8",
		);

		const target = {
			include: ["preview-targets/**/*.tsx"],
			sourceRoot,
		};

		expect(isFilePathIncludedByTarget(target, directChildFile)).toBe(true);
		expect(isFilePathIncludedByTarget(target, nestedFile)).toBe(true);
	});
});
