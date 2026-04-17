import { spawnSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	renameSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const workspaceRoot = process.cwd();
const tarCommand = process.platform === "win32" ? "tar.exe" : "tar";
const packageManagerInvocation = resolvePackageManagerInvocation();

const localPackages = [
	{
		directory: path.join(workspaceRoot, "packages", "layout-engine"),
		name: "@loom-dev/layout-engine",
	},
	{
		directory: path.join(workspaceRoot, "packages", "compiler"),
		name: "@loom-dev/compiler",
	},
	{
		directory: path.join(workspaceRoot, "packages", "preview-runtime"),
		name: "@loom-dev/preview-runtime",
	},
	{
		directory: path.join(workspaceRoot, "packages", "preview-analysis"),
		name: "@loom-dev/preview-analysis",
	},
	{
		directory: path.join(workspaceRoot, "packages", "preview-engine"),
		name: "@loom-dev/preview-engine",
	},
	{
		directory: path.join(workspaceRoot, "packages", "preview"),
		name: "@loom-dev/preview",
	},
];

const externalPackages = [
	"@vitejs/plugin-react",
	"esbuild",
	"jsdom",
	"react",
	"react-dom",
	"typescript",
	"vite",
	"vite-plugin-top-level-await",
	"vite-plugin-wasm",
];
const packageResolutionRoots = [
	workspaceRoot,
	...localPackages.map((pkg) => pkg.directory),
];

function resolvePackageManagerInvocation() {
	const npmExecPath = process.env.npm_execpath;
	if (
		typeof npmExecPath === "string" &&
		npmExecPath.length > 0 &&
		existsSync(npmExecPath)
	) {
		return {
			args: [npmExecPath],
			command: process.execPath,
		};
	}

	return {
		args: [],
		command: "pnpm",
	};
}

function run(command, args, options = {}) {
	const result = spawnSync(command, args, {
		cwd: options.cwd ?? workspaceRoot,
		encoding: "utf8",
		env: { ...process.env, ...(options.env ?? {}) },
		stdio: options.captureOutput ? ["inherit", "pipe", "inherit"] : "inherit",
	});
	if (result.error) {
		throw result.error;
	}
	if ((result.status ?? 1) !== 0) {
		throw new Error(`Command failed: ${command} ${args.join(" ")}`);
	}
	return result;
}

function runPackageManager(args, options = {}) {
	return run(
		packageManagerInvocation.command,
		[...packageManagerInvocation.args, ...args],
		options,
	);
}

function packPackage(packageDirectory, destinationDirectory) {
	mkdirSync(destinationDirectory, { recursive: true });
	const result = runPackageManager(
		["pack", "--pack-destination", destinationDirectory],
		{ captureOutput: true, cwd: packageDirectory },
	);
	const outputLines = (result.stdout ?? "")
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line.length > 0);
	const lastLine = outputLines[outputLines.length - 1];
	if (lastLine) {
		const candidate = path.isAbsolute(lastLine)
			? lastLine
			: path.join(destinationDirectory, lastLine);
		if (existsSync(candidate)) {
			return candidate;
		}
	}

	const tarballs = readdirSync(destinationDirectory)
		.filter((entry) => entry.endsWith(".tgz"))
		.map((entry) => path.join(destinationDirectory, entry))
		.sort((left, right) => right.localeCompare(left));
	const tarball = tarballs[0];
	if (!tarball) {
		throw new Error(`Failed to locate packed tarball for ${packageDirectory}`);
	}
	return tarball;
}

function extractPackageTarball(tarballPath, destinationDirectory) {
	rmSync(destinationDirectory, { force: true, recursive: true });
	mkdirSync(destinationDirectory, { recursive: true });
	const extractionRoot = path.join(destinationDirectory, "__extract__");
	mkdirSync(extractionRoot, { recursive: true });
	run(tarCommand, ["-xzf", tarballPath, "-C", extractionRoot]);
	const extractedPackageDirectory = path.join(extractionRoot, "package");
	if (!existsSync(extractedPackageDirectory)) {
		throw new Error(
			`Packed tarball did not contain a package/ directory: ${tarballPath}`,
		);
	}
	for (const entry of readdirSync(extractedPackageDirectory)) {
		renameSync(
			path.join(extractedPackageDirectory, entry),
			path.join(destinationDirectory, entry),
		);
	}
	rmSync(extractionRoot, { force: true, recursive: true });
}

function packageInstallPath(nodeModulesRoot, packageName) {
	return path.join(nodeModulesRoot, ...packageName.split("/"));
}

function resolveInstalledPackagePath(packageName) {
	const resolveCandidates = [`${packageName}/package.json`, packageName];

	for (const candidate of resolveCandidates) {
		try {
			const resolvedPath = require.resolve(candidate, {
				paths: packageResolutionRoots,
			});
			const initialDirectory =
				candidate === packageName
					? path.dirname(resolvedPath)
					: path.dirname(resolvedPath);
			let currentDirectory = initialDirectory;

			while (true) {
				const packageJsonPath = path.join(currentDirectory, "package.json");
				if (existsSync(packageJsonPath)) {
					return currentDirectory;
				}

				const parentDirectory = path.dirname(currentDirectory);
				if (parentDirectory === currentDirectory) {
					break;
				}

				currentDirectory = parentDirectory;
			}
		} catch {}
	}

	return null;
}

function ensureDirectoryPackageLink(packageName, nodeModulesRoot) {
	const sourcePath = resolveInstalledPackagePath(packageName);
	if (!sourcePath) {
		console.warn(
			`[verify:preview-package] skipping missing workspace dependency: ${packageName}`,
		);
		return;
	}
	const destinationPath = packageInstallPath(nodeModulesRoot, packageName);
	mkdirSync(path.dirname(destinationPath), { recursive: true });
	rmSync(destinationPath, { force: true, recursive: true });
	symlinkSync(
		sourcePath,
		destinationPath,
		process.platform === "win32" ? "junction" : "dir",
	);
}

function writeConsumerFixture(consumerRoot) {
	mkdirSync(path.join(consumerRoot, "src"), { recursive: true });
	writeFileSync(
		path.join(consumerRoot, "package.json"),
		JSON.stringify(
			{
				name: "preview-package-smoke",
				private: true,
				type: "module",
			},
			null,
			2,
		),
		"utf8",
	);
	writeFileSync(
		path.join(consumerRoot, "loom.config.ts"),
		[
			'import { createStaticTargetsDiscovery, defineConfig } from "@loom-dev/preview";',
			"",
			"export default defineConfig({",
			'\tprojectName: "Packed Consumer Preview",',
			"\ttargetDiscovery: createStaticTargetsDiscovery([",
			"\t\t{",
			'\t\t\tname: "packed-consumer-preview",',
			'\t\t\tpackageName: "@fixtures/packed-consumer-preview",',
			'\t\t\tpackageRoot: ".",',
			'\t\t\tsourceRoot: "./src",',
			"\t\t},",
			"\t]),",
			"});",
		].join("\n"),
		"utf8",
	);
	writeFileSync(
		path.join(consumerRoot, "verify-preview-api.mjs"),
		[
			'import assert from "node:assert/strict";',
			'import fs from "node:fs";',
			'import path from "node:path";',
			'import { fileURLToPath } from "node:url";',
			"import {",
			"\tbuildPreviewArtifacts,",
			"\tcreatePreviewHeadlessSession,",
			"\tloadPreviewConfig,",
			"\tstartPreviewServer,",
			'} from "@loom-dev/preview";',
			'import { renderPreviewToString } from "@loom-dev/preview/client";',
			'import { createPreviewViteConfig, createPreviewVitePlugin } from "@loom-dev/preview/vite";',
			"",
			"const cwd = path.dirname(fileURLToPath(import.meta.url));",
			'assert.equal(typeof buildPreviewArtifacts, "function", "Expected buildPreviewArtifacts from @loom-dev/preview.");',
			'assert.equal(typeof createPreviewHeadlessSession, "function", "Expected createPreviewHeadlessSession from @loom-dev/preview.");',
			'assert.equal(typeof loadPreviewConfig, "function", "Expected loadPreviewConfig from @loom-dev/preview.");',
			'assert.equal(typeof renderPreviewToString, "function", "Expected renderPreviewToString from @loom-dev/preview/client.");',
			'assert.equal(typeof startPreviewServer, "function", "Expected startPreviewServer from @loom-dev/preview.");',
			'assert.equal(typeof createPreviewViteConfig, "function", "Expected createPreviewViteConfig from @loom-dev/preview/vite.");',
			'assert.equal(typeof createPreviewVitePlugin, "function", "Expected createPreviewVitePlugin from @loom-dev/preview/vite.");',
			"",
			"const PackedConsumerPreview = () => 'packed-consumer-client';",
			"const shellWrappedMarkup = renderPreviewToString({",
			"\tentry: {",
			"\t\tid: 'packed-consumer-client-entry',",
			"\t\trelativePath: 'src/ClientPreview.tsx',",
			"\t\trenderTarget: {",
			"\t\t\texportName: 'default',",
			"\t\t\tkind: 'component',",
			"\t\t\tusesPreviewProps: false,",
			"\t\t},",
			"\t\tsourceFilePath: path.join(cwd, 'src', 'ClientPreview.tsx'),",
			"\t\ttargetName: 'packed-consumer-preview',",
			"\t\ttitle: 'Client Preview',",
			"\t},",
			"\tmodule: {",
			"\t\tdefault: PackedConsumerPreview,",
			"\t},",
			"});",
			'assert.match(shellWrappedMarkup, /data-preview-layout-provider/, "Expected @loom-dev/preview/client to include shell markup by default.");',
			"const inlinePreviewMarkup = renderPreviewToString({",
			"\tentry: {",
			"\t\tid: 'packed-consumer-client-entry',",
			"\t\trelativePath: 'src/ClientPreview.tsx',",
			"\t\trenderTarget: {",
			"\t\t\texportName: 'default',",
			"\t\t\tkind: 'component',",
			"\t\t\tusesPreviewProps: false,",
			"\t\t},",
			"\t\tsourceFilePath: path.join(cwd, 'src', 'ClientPreview.tsx'),",
			"\t\ttargetName: 'packed-consumer-preview',",
			"\t\ttitle: 'Client Preview',",
			"\t},",
			"\tmodule: {",
			"\t\tdefault: PackedConsumerPreview,",
			"\t},",
			"\twrapInShell: false,",
			"});",
			'assert.match(inlinePreviewMarkup, /packed-consumer-client/, "Expected @loom-dev/preview/client to prerender inline preview markup when wrapInShell is false.");',
			"",
			"const resolvedConfig = await loadPreviewConfig({ cwd });",
			'assert.equal(resolvedConfig.projectName, "Packed Consumer Preview", "Expected loadPreviewConfig to honor loom.config.ts.");',
			'assert.equal(resolvedConfig.targets.length, 1, "Expected one packed consumer preview target.");',
			"const generatedViteConfig = createPreviewViteConfig(resolvedConfig);",
			'assert.ok(Array.isArray(generatedViteConfig.plugins), "Expected createPreviewViteConfig to return a plugins array.");',
			'assert.ok(generatedViteConfig.server?.fs?.allow?.includes(cwd), "Expected createPreviewViteConfig to preserve server fs allow roots.");',
			"",
			'const generatedPreviewRoot = path.resolve(cwd, "..", "generated-preview");',
			"const buildResult = await buildPreviewArtifacts({",
			"\tcwd,",
			"\toutDir: generatedPreviewRoot,",
			"});",
			'const generatedEntryPath = path.join(generatedPreviewRoot, "packed-consumer-preview", "Button.tsx");',
			'assert.ok(fs.existsSync(generatedEntryPath), "Expected buildPreviewArtifacts to emit the packed consumer entry.");',
			'assert.ok(buildResult.writtenFiles.includes(generatedEntryPath), "Expected buildPreviewArtifacts to report the emitted packed consumer entry.");',
			"",
			"const session = await createPreviewHeadlessSession({ cwd });",
			"try {",
			"\tconst snapshot = await session.run();",
			'\tassert.equal(snapshot.workspaceIndex.entries.length, 1, "Expected one preview entry in the headless snapshot.");',
			'\tassert.equal(snapshot.execution.summary.total, 1, "Expected headless execution summary to include one entry.");',
			"\tassert.ok(",
			"\t\tsnapshot.execution.summary.pass + snapshot.execution.summary.warning + snapshot.execution.summary.error >= 1,",
			'\t\t"Expected headless execution to classify the packed consumer entry.",',
			"\t);",
			"} finally {",
			"\tsession.dispose();",
			"}",
			"",
			"const server = await startPreviewServer({",
			"\t...resolvedConfig,",
			"\tserver: {",
			"\t\t...resolvedConfig.server,",
			"\t\topen: false,",
			"\t\tport: 0,",
			"\t},",
			"});",
			"try {",
			'\tassert.ok(server.config.root, "Expected the packed preview server to resolve a Vite root.");',
			"} finally {",
			"\tawait server.close();",
			"}",
			"",
			'console.log("preview-package-e2e-ok");',
		].join("\n"),
		"utf8",
	);
	writeFileSync(
		path.join(consumerRoot, "index.html"),
		[
			"<!doctype html>",
			'<html lang="en">',
			"\t<head>",
			'\t\t<meta charset="UTF-8" />',
			'\t\t<meta name="viewport" content="width=device-width, initial-scale=1.0" />',
			"\t\t<title>Preview Package Smoke</title>",
			"\t</head>",
			"\t<body>",
			'\t\t<div id="app"></div>',
			'\t\t<script type="module" src="/src/main.js"></script>',
			"\t</body>",
			"</html>",
		].join("\n"),
		"utf8",
	);
	writeFileSync(
		path.join(consumerRoot, "src", "Button.tsx"),
		[
			"export function ButtonPreview() {",
			'\treturn <frame Id="packed-consumer-button"><textlabel Text="Packed Consumer" /></frame>;',
			"}",
			"",
			"export const preview = {",
			"\tentry: ButtonPreview,",
			"};",
		].join("\n"),
		"utf8",
	);
	writeFileSync(
		path.join(consumerRoot, "src", "main.js"),
		[
			'import { previewWorkspaceIndex } from "virtual:loom-preview-workspace-index";',
			'const app = document.querySelector("#app");',
			"if (!app) {",
			'\tthrow new Error("Missing app root for preview smoke build.");',
			"}",
			'app.textContent = previewWorkspaceIndex.projectName + ":" + previewWorkspaceIndex.entries.length;',
		].join("\n"),
		"utf8",
	);
	writeFileSync(
		path.join(consumerRoot, "vite.config.mjs"),
		[
			'import react from "@vitejs/plugin-react";',
			'import { defineConfig } from "vite";',
			'import { loadPreviewConfig } from "@loom-dev/preview";',
			'import { createPreviewVitePlugin } from "@loom-dev/preview/vite";',
			'import topLevelAwait from "vite-plugin-top-level-await";',
			'import wasm from "vite-plugin-wasm";',
			"",
			"const resolvedConfig = await loadPreviewConfig({",
			"\tcwd: process.cwd(),",
			"});",
			"",
			"export default defineConfig({",
			"\tplugins: [",
			"\t\t...createPreviewVitePlugin({",
			"\t\t\tprojectName: resolvedConfig.projectName,",
			"\t\t\treactAliases: resolvedConfig.reactAliases,",
			"\t\t\treactRobloxAliases: resolvedConfig.reactRobloxAliases,",
			"\t\t\truntimeModule: resolvedConfig.runtimeModule,",
			"\t\t\truntimeAliases: resolvedConfig.runtimeAliases,",
			"\t\t\ttargets: resolvedConfig.targets,",
			"\t\t\ttransformMode: resolvedConfig.transformMode,",
			"\t\t\tworkspaceRoot: resolvedConfig.workspaceRoot,",
			"\t\t}),",
			"\t\treact(),",
			"\t\twasm(),",
			"\t\ttopLevelAwait(),",
			"\t],",
			"});",
		].join("\n"),
		"utf8",
	);
}

function main() {
	const tempRoot = mkdtempSync(path.join(os.tmpdir(), "loom-preview-package-"));
	try {
		runPackageManager(["run", "build:native"]);
		runPackageManager(["--filter", "@loom-dev/preview-runtime", "build"]);
		runPackageManager(["--filter", "@loom-dev/preview-analysis", "build"]);
		runPackageManager(["--filter", "@loom-dev/preview-engine", "build"]);
		runPackageManager(["--filter", "@loom-dev/preview", "build"]);

		const tarballRoot = path.join(tempRoot, "tarballs");
		const consumerRoot = path.join(tempRoot, "consumer");
		const consumerNodeModules = path.join(consumerRoot, "node_modules");
		mkdirSync(tarballRoot, { recursive: true });
		mkdirSync(consumerNodeModules, { recursive: true });

		for (const localPackage of localPackages) {
			const tarballPath = packPackage(localPackage.directory, tarballRoot);
			extractPackageTarball(
				tarballPath,
				packageInstallPath(consumerNodeModules, localPackage.name),
			);
		}

		for (const externalPackage of externalPackages) {
			ensureDirectoryPackageLink(externalPackage, consumerNodeModules);
		}

		writeConsumerFixture(consumerRoot);

		run(process.execPath, [path.join(consumerRoot, "verify-preview-api.mjs")], {
			cwd: consumerRoot,
		});
		const vitePackagePath = resolveInstalledPackagePath("vite");
		if (!vitePackagePath) {
			throw new Error(
				"Missing required dependency in the workspace install: vite",
			);
		}
		run(
			process.execPath,
			[path.join(vitePackagePath, "bin", "vite.js"), "build"],
			{
				cwd: consumerRoot,
			},
		);
	} finally {
		rmSync(tempRoot, { force: true, recursive: true });
	}
}

main();
