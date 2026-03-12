import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	createPreviewViteServer,
	resolvePreviewServerConfig,
} from "../../packages/preview/src/source/server";

const temporaryRoots: string[] = [];

afterEach(() => {
	for (const root of temporaryRoots.splice(0)) {
		fs.rmSync(root, { force: true, recursive: true });
	}
});

function createTempPreviewPackage() {
	const tempPackageRoot = fs.mkdtempSync(
		path.join(os.tmpdir(), "loom-preview-server-"),
	);
	const packageRoot = fs.realpathSync(tempPackageRoot);
	temporaryRoots.push(packageRoot);

	const sourceRoot = path.join(packageRoot, "src");
	const fakeReactRoot = path.join(packageRoot, "node_modules/@rbxts/react/src");
	fs.mkdirSync(sourceRoot, { recursive: true });
	fs.mkdirSync(fakeReactRoot, { recursive: true });

	fs.writeFileSync(
		path.join(packageRoot, "package.json"),
		JSON.stringify({ name: "rbxts-react-preview" }, null, 2),
		"utf8",
	);
	fs.writeFileSync(
		path.join(packageRoot, "tsconfig.json"),
		JSON.stringify(
			{
				compilerOptions: {
					allowSyntheticDefaultImports: true,
					jsx: "react",
					jsxFactory: "React.createElement",
					jsxFragmentFactory: "React.Fragment",
					module: "commonjs",
					moduleResolution: "Node",
					strict: true,
					target: "ESNext",
				},
				include: ["src"],
			},
			null,
			2,
		),
		"utf8",
	);
	fs.writeFileSync(
		path.join(packageRoot, "src/Test.tsx"),
		[
			'import React from "@rbxts/react";',
			"",
			"function Test() {",
			'\treturn <frame><textlabel Text="test" /></frame>;',
			"}",
			"",
			"export const preview = {",
			"\trender: () => <Test />,",
			"};",
		].join("\n"),
		"utf8",
	);
	fs.writeFileSync(
		path.join(packageRoot, "node_modules/@rbxts/react/package.json"),
		JSON.stringify(
			{
				name: "@rbxts/react",
				types: "src/index.d.ts",
			},
			null,
			2,
		),
		"utf8",
	);
	fs.writeFileSync(
		path.join(fakeReactRoot, "index.d.ts"),
		[
			"declare namespace React {",
			"\tfunction createElement(...args: any[]): any;",
			"\tconst Fragment: any;",
			"}",
			"",
			"declare const React: {",
			"\tcreateElement: typeof React.createElement;",
			"\tFragment: typeof React.Fragment;",
			"};",
			"",
			"export = React;",
		].join("\n"),
		"utf8",
	);

	return {
		packageRoot,
		sourceFilePath: fs.realpathSync(path.join(sourceRoot, "Test.tsx")),
		sourceRoot: fs.realpathSync(sourceRoot),
		workspaceRoot: packageRoot,
	};
}

function toLoadedCode(result: unknown) {
	if (typeof result === "string") {
		return result;
	}

	if (
		typeof result === "object" &&
		result !== null &&
		"code" in result &&
		typeof result.code === "string"
	) {
		return result.code;
	}

	throw new Error("Expected Vite to return loaded module code.");
}

describe("createPreviewViteServer", () => {
	it("uses a project-scoped cache and pre-optimizes React deps for @rbxts/react previews", async () => {
		const fixture = createTempPreviewPackage();
		const resolvedConfig = await resolvePreviewServerConfig({
			cwd: fixture.packageRoot,
			packageName: "rbxts-react-preview",
			packageRoot: fixture.packageRoot,
			sourceRoot: fixture.sourceRoot,
		});
		const server = await createPreviewViteServer(resolvedConfig, {
			appType: "custom",
		});

		try {
			expect(server.config.cacheDir).toBe(
				path.join(fixture.workspaceRoot, ".loom-preview-cache", "vite"),
			);
			expect(server.config.optimizeDeps.include).toEqual(
				expect.arrayContaining([
					"react",
					"react-dom",
					"react/jsx-runtime",
					"react/jsx-dev-runtime",
				]),
			);

			const workspaceModuleCode = toLoadedCode(
				await server.pluginContainer.load(
					"\0virtual:loom-preview-workspace-index",
				),
			);
			expect(workspaceModuleCode).toContain(
				'"id": "rbxts-react-preview:Test.tsx"',
			);
			expect(workspaceModuleCode).toContain('"status": "ready"');

			const entryModuleCode = toLoadedCode(
				await server.pluginContainer.load(
					"\0virtual:loom-preview-entry:rbxts-react-preview%3ATest.tsx",
				),
			);
			expect(entryModuleCode).toContain(fixture.sourceFilePath);

			const transformedSource = await server.transformRequest(
				fixture.sourceFilePath,
			);
			expect(transformedSource?.code).toContain("react_jsx-dev-runtime");
			expect(transformedSource?.code).toContain(
				"/packages/preview-runtime/src/index.ts",
			);
		} finally {
			await server.close();
		}
	});
});
