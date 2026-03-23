import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Writable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	createPreviewViteServer,
	resolvePreviewServerConfig,
} from "../../packages/preview/src/source/server";
import {
	suppressExpectedConsoleMessages,
	suppressExpectedStderrMessages,
} from "../testLogUtils";
vi.setConfig({ testTimeout: 15000 });

const temporaryRoots: string[] = [];

suppressExpectedConsoleMessages({ error: ["The build was canceled"] });
suppressExpectedStderrMessages([/The build was canceled/]);
afterEach(() => {
	for (const root of temporaryRoots.splice(0)) {
		fs.rmSync(root, { force: true, recursive: true });
	}
});

type MiddlewareResponse = {
	body: string;
	headers: Record<string, unknown>;
	statusCode: number;
};

type TestWritableResponse = Writable & {
	end: (chunk?: unknown) => void;
	getHeader: (name: string) => unknown;
	headers: Record<string, unknown>;
	setHeader: (name: string, value: unknown) => void;
	statusCode: number;
	writeHead: (
		statusCode: number,
		headers?: Record<string, unknown>,
	) => TestWritableResponse;
};

function writeFakeRbxtsReact(packageRoot: string) {
	const fakeReactRoot = path.join(packageRoot, "node_modules/@rbxts/react/src");
	fs.mkdirSync(fakeReactRoot, { recursive: true });
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
}

function createTempPreviewPackage() {
	const tempPackageRoot = fs.mkdtempSync(
		path.join(os.tmpdir(), "loom-preview-server-"),
	);
	const packageRoot = fs.realpathSync(tempPackageRoot);
	temporaryRoots.push(packageRoot);

	const sourceRoot = path.join(packageRoot, "src");
	fs.mkdirSync(sourceRoot, { recursive: true });

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
	writeFakeRbxtsReact(packageRoot);

	return {
		packageRoot,
		sourceFilePath: fs.realpathSync(path.join(sourceRoot, "Test.tsx")),
		sourceRoot: fs.realpathSync(sourceRoot),
		workspaceRoot: packageRoot,
	};
}

function createTempPreviewPackageWithPathAlias() {
	const tempWorkspaceRoot = fs.mkdtempSync(
		path.join(os.tmpdir(), "loom-preview-server-workspace-"),
	);
	const workspaceRoot = fs.realpathSync(tempWorkspaceRoot);
	temporaryRoots.push(workspaceRoot);

	const packageRoot = path.join(workspaceRoot, "packages/ui");
	const sourceRoot = path.join(packageRoot, "src");
	const sharedRoot = path.join(workspaceRoot, "packages/shared");
	const sharedSourceRoot = path.join(sharedRoot, "src");
	fs.mkdirSync(sourceRoot, { recursive: true });
	fs.mkdirSync(sharedSourceRoot, { recursive: true });

	fs.writeFileSync(
		path.join(workspaceRoot, "package.json"),
		JSON.stringify(
			{
				private: true,
				workspaces: ["packages/*"],
			},
			null,
			2,
		),
		"utf8",
	);
	fs.writeFileSync(
		path.join(packageRoot, "package.json"),
		JSON.stringify({ name: "@fixtures/ui" }, null, 2),
		"utf8",
	);
	fs.writeFileSync(
		path.join(sharedRoot, "package.json"),
		JSON.stringify({ name: "@fixtures/shared" }, null, 2),
		"utf8",
	);
	fs.writeFileSync(
		path.join(packageRoot, "tsconfig.json"),
		JSON.stringify(
			{
				compilerOptions: {
					allowSyntheticDefaultImports: true,
					baseUrl: "./src",
					jsx: "react",
					jsxFactory: "React.createElement",
					jsxFragmentFactory: "React.Fragment",
					module: "commonjs",
					moduleResolution: "Node",
					paths: {
						"shared/*": ["../../shared/src/*"],
					},
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
		path.join(sharedRoot, "tsconfig.json"),
		JSON.stringify(
			{
				compilerOptions: {
					jsx: "react",
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
		path.join(sharedSourceRoot, "buildInfo.ts"),
		[
			"// Generated File. Don't edit directly.",
			"export const BUILD_INFO = {",
			'\tlabel: "resolved-label",',
			"} as const;",
		].join("\n"),
		"utf8",
	);
	fs.writeFileSync(
		path.join(sourceRoot, "Test.tsx"),
		[
			'import React from "@rbxts/react";',
			"",
			'import { BUILD_INFO } from "shared/buildInfo";',
			"",
			"function Test() {",
			"\treturn <textlabel Text={BUILD_INFO.label} />;",
			"}",
			"",
			"export const preview = {",
			"\trender: () => <Test />,",
			"};",
		].join("\n"),
		"utf8",
	);
	writeFakeRbxtsReact(packageRoot);

	return {
		buildInfoPath: fs.realpathSync(path.join(sharedSourceRoot, "buildInfo.ts")),
		packageRoot,
		sourceFilePath: fs.realpathSync(path.join(sourceRoot, "Test.tsx")),
		sourceRoot: fs.realpathSync(sourceRoot),
		workspaceRoot,
	};
}

function writeWorkspacePathAliasTsconfig(
	packageRoot: string,
	aliasTargetRelativePath: string,
) {
	fs.writeFileSync(
		path.join(packageRoot, "tsconfig.json"),
		JSON.stringify(
			{
				compilerOptions: {
					allowSyntheticDefaultImports: true,
					baseUrl: "./src",
					jsx: "react",
					jsxFactory: "React.createElement",
					jsxFragmentFactory: "React.Fragment",
					module: "commonjs",
					moduleResolution: "Node",
					paths: {
						"shared/*": [aliasTargetRelativePath],
					},
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
}

function createTempPreviewPackageWithMutablePathAlias() {
	const tempWorkspaceRoot = fs.mkdtempSync(
		path.join(os.tmpdir(), "loom-preview-server-mutable-workspace-"),
	);
	const workspaceRoot = fs.realpathSync(tempWorkspaceRoot);
	temporaryRoots.push(workspaceRoot);

	const packageRoot = path.join(workspaceRoot, "packages/ui");
	const sourceRoot = path.join(packageRoot, "src");
	const sharedARoot = path.join(workspaceRoot, "packages/shared-a");
	const sharedBRoot = path.join(workspaceRoot, "packages/shared-b");
	const sharedASourceRoot = path.join(sharedARoot, "src");
	const sharedBSourceRoot = path.join(sharedBRoot, "src");
	fs.mkdirSync(sourceRoot, { recursive: true });
	fs.mkdirSync(sharedASourceRoot, { recursive: true });
	fs.mkdirSync(sharedBSourceRoot, { recursive: true });

	fs.writeFileSync(
		path.join(workspaceRoot, "package.json"),
		JSON.stringify(
			{
				private: true,
				workspaces: ["packages/*"],
			},
			null,
			2,
		),
		"utf8",
	);
	fs.writeFileSync(
		path.join(packageRoot, "package.json"),
		JSON.stringify({ name: "@fixtures/ui" }, null, 2),
		"utf8",
	);
	fs.writeFileSync(
		path.join(sharedARoot, "package.json"),
		JSON.stringify({ name: "@fixtures/shared-a" }, null, 2),
		"utf8",
	);
	fs.writeFileSync(
		path.join(sharedBRoot, "package.json"),
		JSON.stringify({ name: "@fixtures/shared-b" }, null, 2),
		"utf8",
	);
	writeWorkspacePathAliasTsconfig(packageRoot, "../../shared-a/src/*");
	fs.writeFileSync(
		path.join(sharedASourceRoot, "buildInfo.ts"),
		["export const BUILD_INFO = {", '\tlabel: "shared-a",', "} as const;"].join(
			"\n",
		),
		"utf8",
	);
	fs.writeFileSync(
		path.join(sharedBSourceRoot, "buildInfo.ts"),
		["export const BUILD_INFO = {", '\tlabel: "shared-b",', "} as const;"].join(
			"\n",
		),
		"utf8",
	);
	fs.writeFileSync(
		path.join(sourceRoot, "Test.tsx"),
		[
			'import React from "@rbxts/react";',
			"",
			'import { BUILD_INFO } from "shared/buildInfo";',
			"",
			"function Test() {",
			"\treturn <textlabel Text={BUILD_INFO.label} />;",
			"}",
			"",
			"export const preview = {",
			"\trender: () => <Test />,",
			"};",
		].join("\n"),
		"utf8",
	);
	writeFakeRbxtsReact(packageRoot);

	return {
		buildInfoPathA: fs.realpathSync(
			path.join(sharedASourceRoot, "buildInfo.ts"),
		),
		buildInfoPathB: fs.realpathSync(
			path.join(sharedBSourceRoot, "buildInfo.ts"),
		),
		packageRoot,
		sourceFilePath: fs.realpathSync(path.join(sourceRoot, "Test.tsx")),
		sourceRoot: fs.realpathSync(sourceRoot),
		tsconfigPath: fs.realpathSync(path.join(packageRoot, "tsconfig.json")),
		workspaceRoot,
	};
}

function createTempPreviewPackageWithAutoMockPathAlias() {
	const fixture = createTempPreviewPackageWithMutablePathAlias();
	fs.writeFileSync(
		fixture.sourceFilePath,
		[
			'import React from "@rbxts/react";',
			"",
			'import type { PreviewProps } from "shared/props";',
			"",
			"export function Test(props: PreviewProps) {",
			'\treturn <textlabel Text={"label" in props ? props.label : String(props.count)} />;',
			"}",
			"",
			"export const preview = {",
			"\tentry: Test,",
			"};",
		].join("\n"),
		"utf8",
	);
	const sharedAPropsPath = path.join(
		fixture.workspaceRoot,
		"packages/shared-a/src/props.ts",
	);
	const sharedBPropsPath = path.join(
		fixture.workspaceRoot,
		"packages/shared-b/src/props.ts",
	);
	fs.writeFileSync(
		sharedAPropsPath,
		"export type PreviewProps = { label: string };\n",
		"utf8",
	);
	fs.writeFileSync(
		sharedBPropsPath,
		"export type PreviewProps = { count: number };\n",
		"utf8",
	);

	return fixture;
}

function createTempPreviewPackageWithBaseUrlAlias() {
	const tempPackageRoot = fs.mkdtempSync(
		path.join(os.tmpdir(), "loom-preview-server-base-url-"),
	);
	const packageRoot = fs.realpathSync(tempPackageRoot);
	temporaryRoots.push(packageRoot);

	const sourceRoot = path.join(packageRoot, "src");
	const sharedSourceRoot = path.join(sourceRoot, "shared");
	fs.mkdirSync(sharedSourceRoot, { recursive: true });

	fs.writeFileSync(
		path.join(packageRoot, "package.json"),
		JSON.stringify({ name: "rbxts-react-preview-base-url" }, null, 2),
		"utf8",
	);
	fs.writeFileSync(
		path.join(packageRoot, "tsconfig.json"),
		JSON.stringify(
			{
				compilerOptions: {
					allowSyntheticDefaultImports: true,
					baseUrl: "./src",
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
		path.join(sharedSourceRoot, "buildInfo.ts"),
		[
			"// Generated File. Don't edit directly.",
			"export const BUILD_INFO = {",
			'\tlabel: "base-url-label",',
			"} as const;",
		].join("\n"),
		"utf8",
	);
	fs.writeFileSync(
		path.join(sourceRoot, "Test.tsx"),
		[
			'import React from "@rbxts/react";',
			"",
			'import { BUILD_INFO } from "shared/buildInfo";',
			"",
			"function Test() {",
			"\treturn <textlabel Text={BUILD_INFO.label} />;",
			"}",
			"",
			"export const preview = {",
			"\trender: () => <Test />,",
			"};",
		].join("\n"),
		"utf8",
	);
	writeFakeRbxtsReact(packageRoot);

	return {
		buildInfoPath: fs.realpathSync(path.join(sharedSourceRoot, "buildInfo.ts")),
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

function toResolvedId(result: unknown) {
	if (typeof result === "string") {
		return result;
	}

	if (
		typeof result === "object" &&
		result !== null &&
		"id" in result &&
		typeof result.id === "string"
	) {
		return result.id;
	}

	throw new Error("Expected Vite to return a resolved id.");
}

function readCapturedGroup(value: string, pattern: RegExp) {
	const match = value.match(pattern);
	const capturedValue = match?.[1];
	if (!capturedValue) {
		throw new Error(
			`Unable to find ${pattern.toString()} in response:\n${value.slice(0, 400)}`,
		);
	}

	return capturedValue;
}

function normalizePathSlashes(filePath: string) {
	return filePath.replace(/\\/g, "/");
}

function toFsUrl(filePath: string) {
	return `/@fs/${filePath.replace(/\\/g, "/")}`;
}

function requestServerPath(
	server: Awaited<ReturnType<typeof createPreviewViteServer>>,
	url: string,
): Promise<MiddlewareResponse> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		const request = {
			headers: { host: "localhost" },
			method: "GET",
			originalUrl: url,
			url,
		} as const;
		const response = new Writable({
			write(chunk, _encoding, callback) {
				chunks.push(
					Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)),
				);
				callback();
			},
		}) as TestWritableResponse;

		response.statusCode = 200;
		response.headers = {};
		response.setHeader = (name, value) => {
			response.headers[name.toLowerCase()] = value;
		};
		response.getHeader = (name) => response.headers[name.toLowerCase()];
		response.writeHead = (statusCode, headers = {}) => {
			response.statusCode = statusCode;
			for (const [name, value] of Object.entries(headers)) {
				response.setHeader(name, value);
			}
			return response;
		};
		response.end = (chunk) => {
			if (chunk) {
				chunks.push(
					Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)),
				);
			}
			resolve({
				body: Buffer.concat(chunks).toString("utf8"),
				headers: response.headers,
				statusCode: response.statusCode,
			});
		};

		server.middlewares.handle(
			request as never,
			response as never,
			(error?: unknown) => {
				if (error) {
					reject(error);
					return;
				}

				resolve({
					body: Buffer.concat(chunks).toString("utf8"),
					headers: response.headers,
					statusCode: response.statusCode,
				});
			},
		);
	});
}

describe("createPreviewViteServer", () => {
	it("serves runtime dependency roots for external package previews", async () => {
		const fixture = createTempPreviewPackage();
		const resolvedConfig = await resolvePreviewServerConfig({
			cwd: fixture.packageRoot,
			packageName: "rbxts-react-preview",
			packageRoot: fixture.packageRoot,
			sourceRoot: fixture.sourceRoot,
		});
		const server = await createPreviewViteServer(resolvedConfig, {
			appType: "custom",
			middlewareMode: true,
		});

		try {
			const runtimeModuleResponse = await requestServerPath(
				server,
				toFsUrl(
					path.resolve(process.cwd(), "packages/preview-runtime/src/index.ts"),
				),
			);
			expect(runtimeModuleResponse.statusCode).toBe(200);

			const layoutWasmModuleUrl = toFsUrl(
				path.resolve(
					process.cwd(),
					"packages/preview-runtime/src/layout/wasm.ts",
				),
			);
			const layoutWasmModuleResponse = await requestServerPath(
				server,
				layoutWasmModuleUrl,
			);
			expect(layoutWasmModuleResponse.statusCode).toBe(200);

			const layoutEngineJsUrl = readCapturedGroup(
				layoutWasmModuleResponse.body,
				/import initLayoutEngine, \{ createLayoutSession \} from "([^"]+\/packages\/layout-engine\/pkg\/layout_engine\.js)";/,
			);
			const layoutEngineJsResponse = await requestServerPath(
				server,
				layoutEngineJsUrl,
			);
			expect(layoutEngineJsResponse.statusCode).toBe(200);
			expect(layoutEngineJsResponse.body).toContain("LayoutSession");
			expect(layoutEngineJsResponse.body).not.toContain("403 Restricted");

			const layoutEngineWasmUrl = readCapturedGroup(
				layoutEngineJsResponse.body,
				/new URL\((?:'|")([^"']*layout_engine_bg\.wasm(?:\?[^"']*)?)(?:'|"),\s*import\.meta\.url\)/,
			);
			const layoutEngineWasmResponse = await requestServerPath(
				server,
				layoutEngineWasmUrl,
			);
			expect(layoutEngineWasmResponse.statusCode).toBe(200);
		} finally {
			await server.close();
		}
	}, 30000);

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
			middlewareMode: true,
		});

		try {
			expect(server.config.cacheDir).toBe(
				normalizePathSlashes(
					path.join(fixture.workspaceRoot, ".loom-preview-cache", "vite"),
				),
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
			expect(entryModuleCode).toContain(
				normalizePathSlashes(fixture.sourceFilePath),
			);

			const transformedSource = await server.transformRequest(
				fixture.sourceFilePath,
			);
			expect(transformedSource?.code).toContain("react_jsx-dev-runtime");
			expect(transformedSource?.code).toContain(
				"/packages/preview-runtime/src/index.ts",
			);

			const optimizedDependencyPath = path.join(
				fixture.workspaceRoot,
				".loom-preview-cache",
				"vite",
				"deps",
				"react-dom_client.js",
			);
			fs.mkdirSync(path.dirname(optimizedDependencyPath), {
				recursive: true,
			});
			fs.writeFileSync(
				optimizedDependencyPath,
				[
					'import { jsxDEV } from "react/jsx-dev-runtime";',
					"",
					"export const CachedDependency = () =>",
					'\tjsxDEV("div", {}, undefined, false, undefined, this);',
				].join("\n"),
				"utf8",
			);

			const transformedOptimizedDependency = await server.transformRequest(
				optimizedDependencyPath,
			);
			expect(transformedOptimizedDependency?.code).toContain("jsxDEV");
			expect(transformedOptimizedDependency?.code).not.toContain(
				"/@react-refresh",
			);
			expect(transformedOptimizedDependency?.code).not.toContain(
				"RefreshRuntime",
			);
		} finally {
			await server.close();
		}
	});

	it("resolves tsconfig paths aliases before unresolved package mocking", async () => {
		const fixture = createTempPreviewPackageWithPathAlias();
		const resolvedConfig = await resolvePreviewServerConfig({
			cwd: fixture.packageRoot,
			packageName: "@fixtures/ui",
			packageRoot: fixture.packageRoot,
			sourceRoot: fixture.sourceRoot,
		});
		const server = await createPreviewViteServer(resolvedConfig, {
			appType: "custom",
			middlewareMode: true,
		});

		try {
			const resolvedImportId = toResolvedId(
				await server.pluginContainer.resolveId(
					"shared/buildInfo",
					fixture.sourceFilePath,
				),
			);
			expect(normalizePathSlashes(resolvedImportId)).toBe(
				normalizePathSlashes(fixture.buildInfoPath),
			);

			const transformedSource = await server.transformRequest(
				fixture.sourceFilePath,
			);
			expect(transformedSource?.code).not.toContain(
				"loom-preview-unresolved-env",
			);
			expect(transformedSource?.code).not.toContain(
				"__loomUnresolvedEnvMock.BUILD_INFO",
			);
			expect(transformedSource?.code).toContain(
				fixture.buildInfoPath.replace(/\\/g, "/"),
			);
		} finally {
			await server.close();
		}
	});

	it("resolves external workspace tsconfig path aliases when config workspace differs", async () => {
		const fixture = createTempPreviewPackageWithPathAlias();
		const configRoot = fs.mkdtempSync(
			path.join(os.tmpdir(), "loom-preview-server-config-root-"),
		);
		temporaryRoots.push(configRoot);

		const server = await createPreviewViteServer(
			{
				configDir: configRoot,
				cwd: configRoot,
				mode: "config-file",
				projectName: "External Workspace Preview",
				server: {
					fsAllow: [
						configRoot,
						fixture.workspaceRoot,
						fixture.packageRoot,
						fixture.sourceRoot,
					],
					open: false,
					port: 4174,
				},
				targetDiscovery: [],
				targets: [
					{
						name: "ui",
						packageName: "@fixtures/ui",
						packageRoot: fixture.packageRoot,
						sourceRoot: fixture.sourceRoot,
					},
				],
				transformMode: "strict-fidelity",
				workspaceRoot: configRoot,
			},
			{
				appType: "custom",
				middlewareMode: true,
			},
		);

		try {
			const resolvedImportId = toResolvedId(
				await server.pluginContainer.resolveId(
					"shared/buildInfo",
					fixture.sourceFilePath,
				),
			);
			expect(normalizePathSlashes(resolvedImportId)).toBe(
				normalizePathSlashes(fixture.buildInfoPath),
			);

			const transformedSource = await server.transformRequest(
				fixture.sourceFilePath,
			);
			expect(transformedSource?.code).toContain(
				fixture.buildInfoPath.replace(/\\/g, "/"),
			);
		} finally {
			await server.close();
		}
	});

	it("clears tsconfig path caches and reloads after alias changes", async () => {
		const fixture = createTempPreviewPackageWithMutablePathAlias();
		const resolvedConfig = await resolvePreviewServerConfig({
			cwd: fixture.packageRoot,
			packageName: "@fixtures/ui",
			packageRoot: fixture.packageRoot,
			sourceRoot: fixture.sourceRoot,
		});
		const server = await createPreviewViteServer(resolvedConfig, {
			appType: "custom",
			middlewareMode: true,
		});
		const wsSendSpy = vi.spyOn(server.ws, "send");

		try {
			const initialResolvedImportId = toResolvedId(
				await server.pluginContainer.resolveId(
					"shared/buildInfo",
					fixture.sourceFilePath,
				),
			);
			expect(normalizePathSlashes(initialResolvedImportId)).toBe(
				normalizePathSlashes(fixture.buildInfoPathA),
			);

			const initialTransformedSource = await server.transformRequest(
				fixture.sourceFilePath,
			);
			expect(initialTransformedSource?.code).toContain(
				fixture.buildInfoPathA.replace(/\\/g, "/"),
			);

			writeWorkspacePathAliasTsconfig(
				fixture.packageRoot,
				"../../shared-b/src/*",
			);
			(
				server.watcher as unknown as {
					emit: (event: string, filePath: string) => void;
				}
			).emit("change", fixture.tsconfigPath);
			expect(wsSendSpy).toHaveBeenCalledWith({ type: "full-reload" });

			const nextResolvedImportId = toResolvedId(
				await server.pluginContainer.resolveId(
					"shared/buildInfo",
					fixture.sourceFilePath,
				),
			);
			expect(normalizePathSlashes(nextResolvedImportId)).toBe(
				normalizePathSlashes(fixture.buildInfoPathB),
			);

			const nextTransformedSource = await server.transformRequest(
				fixture.sourceFilePath,
			);
			expect(nextTransformedSource?.code).toContain(
				fixture.buildInfoPathB.replace(/\\/g, "/"),
			);
		} finally {
			wsSendSpy.mockRestore();
			await server.close();
		}
	});

	it("refreshes auto-mock props metadata after tsconfig alias changes", async () => {
		const fixture = createTempPreviewPackageWithAutoMockPathAlias();
		const resolvedConfig = await resolvePreviewServerConfig({
			cwd: fixture.packageRoot,
			packageName: "@fixtures/ui",
			packageRoot: fixture.packageRoot,
			sourceRoot: fixture.sourceRoot,
		});
		const server = await createPreviewViteServer(resolvedConfig, {
			appType: "custom",
			middlewareMode: true,
		});

		try {
			const initialTransformedSource = await server.transformRequest(
				fixture.sourceFilePath,
			);
			expect(initialTransformedSource?.code).toContain('"label": {');
			expect(initialTransformedSource?.code).not.toContain('"count": {');

			writeWorkspacePathAliasTsconfig(
				fixture.packageRoot,
				"../../shared-b/src/*",
			);
			(
				server.watcher as unknown as {
					emit: (event: string, filePath: string) => void;
				}
			).emit("change", fixture.tsconfigPath);

			const nextTransformedSource = await server.transformRequest(
				fixture.sourceFilePath,
			);
			expect(nextTransformedSource?.code).toContain('"count": {');
			expect(nextTransformedSource?.code).not.toContain('"label": {');
		} finally {
			await server.close();
		}
	});

	it("resolves baseUrl-backed workspace imports before unresolved package mocking", async () => {
		const fixture = createTempPreviewPackageWithBaseUrlAlias();
		const resolvedConfig = await resolvePreviewServerConfig({
			cwd: fixture.packageRoot,
			packageName: "rbxts-react-preview-base-url",
			packageRoot: fixture.packageRoot,
			sourceRoot: fixture.sourceRoot,
		});
		const server = await createPreviewViteServer(resolvedConfig, {
			appType: "custom",
			middlewareMode: true,
		});

		try {
			const resolvedImportId = toResolvedId(
				await server.pluginContainer.resolveId(
					"shared/buildInfo",
					fixture.sourceFilePath,
				),
			);
			expect(normalizePathSlashes(resolvedImportId)).toBe(
				normalizePathSlashes(fixture.buildInfoPath),
			);

			const transformedSource = await server.transformRequest(
				fixture.sourceFilePath,
			);
			expect(transformedSource?.code).not.toContain(
				"loom-preview-unresolved-env",
			);
			expect(transformedSource?.code).not.toContain(
				"__loomUnresolvedEnvMock.BUILD_INFO",
			);
			expect(transformedSource?.code).toContain(
				fixture.buildInfoPath.replace(/\\/g, "/"),
			);
		} finally {
			await server.close();
		}
	});
});
