// @vitest-environment node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { copyDirectoryContents } from "../../packages/preview/scripts/copy-assets.mjs";

const temporaryRoots: string[] = [];

afterEach(() => {
	for (const root of temporaryRoots.splice(0)) {
		fs.rmSync(root, { force: true, recursive: true });
	}
});

function createTempRoot() {
	const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "loom-preview-copy-"));
	const root = fs.realpathSync(tempRoot);
	temporaryRoots.push(root);
	return root;
}

describe("preview copy-assets script", () => {
	it("copies nested browser shims into the dist tree", () => {
		const packageRoot = createTempRoot();
		const sourceRoot = path.join(packageRoot, "src/source/react-shims");
		const browserRoot = path.join(sourceRoot, "browser");
		const distRoot = path.join(packageRoot, "dist/source/react-shims");

		fs.mkdirSync(browserRoot, { recursive: true });
		fs.writeFileSync(path.join(sourceRoot, "react.js"), "react", "utf8");
		fs.writeFileSync(
			path.join(browserRoot, "react.js"),
			"browser-react",
			"utf8",
		);
		fs.writeFileSync(
			path.join(browserRoot, "react-dom.js"),
			"browser-react-dom",
			"utf8",
		);
		fs.writeFileSync(
			path.join(browserRoot, "react-dom-client.js"),
			"browser-react-dom-client",
			"utf8",
		);
		fs.writeFileSync(
			path.join(browserRoot, "react-jsx-runtime.js"),
			"browser-react-jsx-runtime",
			"utf8",
		);
		fs.writeFileSync(
			path.join(browserRoot, "react-roblox.js"),
			"browser-react-roblox",
			"utf8",
		);

		copyDirectoryContents(sourceRoot, distRoot);

		expect(fs.readFileSync(path.join(distRoot, "react.js"), "utf8")).toBe(
			"react",
		);
		expect(
			fs.readFileSync(path.join(distRoot, "browser/react.js"), "utf8"),
		).toBe("browser-react");
		expect(
			fs.readFileSync(path.join(distRoot, "browser/react-dom.js"), "utf8"),
		).toBe("browser-react-dom");
		expect(
			fs.readFileSync(
				path.join(distRoot, "browser/react-dom-client.js"),
				"utf8",
			),
		).toBe("browser-react-dom-client");
		expect(
			fs.readFileSync(
				path.join(distRoot, "browser/react-jsx-runtime.js"),
				"utf8",
			),
		).toBe("browser-react-jsx-runtime");
		expect(
			fs.readFileSync(path.join(distRoot, "browser/react-roblox.js"), "utf8"),
		).toBe("browser-react-roblox");
	});
});
