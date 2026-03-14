import { mkdtempSync, mkdirSync, readdirSync, rmSync, symlinkSync, writeFileSync, existsSync, renameSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const workspaceRoot = process.cwd();
const tarCommand = process.platform === "win32" ? "tar.exe" : "tar";
const packageManagerInvocation = resolvePackageManagerInvocation();

const localPackages = [
	{ directory: path.join(workspaceRoot, "packages", "layout-engine"), name: "@loom-dev/layout-engine" },
	{ directory: path.join(workspaceRoot, "packages", "compiler"), name: "@loom-dev/compiler" },
	{ directory: path.join(workspaceRoot, "packages", "preview-runtime"), name: "@loom-dev/preview-runtime" },
	{ directory: path.join(workspaceRoot, "packages", "preview-engine"), name: "@loom-dev/preview-engine" },
	{ directory: path.join(workspaceRoot, "packages", "preview"), name: "@loom-dev/preview" },
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
const packageResolutionRoots = [workspaceRoot, ...localPackages.map((pkg) => pkg.directory)];

function resolvePackageManagerInvocation() {
	const npmExecPath = process.env.npm_execpath;
	if (typeof npmExecPath === "string" && npmExecPath.length > 0 && existsSync(npmExecPath)) {
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
		throw new Error(`Packed tarball did not contain a package/ directory: ${tarballPath}`);
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
	try {
		return path.dirname(
			require.resolve(`${packageName}/package.json`, {
				paths: packageResolutionRoots,
			}),
		);
	} catch {
		return null;
	}
}

function ensureDirectoryPackageLink(packageName, nodeModulesRoot) {
	const sourcePath = resolveInstalledPackagePath(packageName);
	if (!sourcePath) {
		console.warn(`[verify:preview-package] skipping missing workspace dependency: ${packageName}`);
		return;
	}
	const destinationPath = packageInstallPath(nodeModulesRoot, packageName);
	mkdirSync(path.dirname(destinationPath), { recursive: true });
	rmSync(destinationPath, { force: true, recursive: true });
	symlinkSync(sourcePath, destinationPath, process.platform === "win32" ? "junction" : "dir");
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
		path.join(consumerRoot, "smoke-import.mjs"),
		[
			'import * as preview from "@loom-dev/preview";',
			'if (!preview || typeof preview.loadPreviewConfig !== "function") {',
			'\tthrow new Error("@loom-dev/preview did not expose loadPreviewConfig in the packed artifact.");',
			'}',
			'console.log("preview-import-ok", Object.keys(preview).length);',
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
			'\t\t<title>Preview Package Smoke</title>',
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
		path.join(consumerRoot, "src", "main.js"),
		[
			'import * as preview from "@loom-dev/preview";',
			'const app = document.querySelector("#app");',
			'if (!app) {',
			'\tthrow new Error("Missing app root for preview smoke build.");',
			'}',
			'app.textContent = `preview exports: ${Object.keys(preview).length}`;',
		].join("\n"),
		"utf8",
	);
	writeFileSync(
		path.join(consumerRoot, "vite.config.mjs"),
		[
			'import { defineConfig } from "vite";',
			'export default defineConfig({});',
		].join("\n"),
		"utf8",
	);
}

function main() {
	const tempRoot = mkdtempSync(path.join(os.tmpdir(), "loom-preview-package-"));
	try {
		runPackageManager(["run", "build:native"]);
		runPackageManager(["--filter", "@loom-dev/preview-runtime", "build"]);
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

		run(process.execPath, [path.join(consumerRoot, "smoke-import.mjs")], {
			cwd: consumerRoot,
		});
		const vitePackagePath = resolveInstalledPackagePath("vite");
		if (!vitePackagePath) {
			throw new Error("Missing required dependency in the workspace install: vite");
		}
		run(process.execPath, [path.join(vitePackagePath, "bin", "vite.js"), "build"], {
			cwd: consumerRoot,
		});
	} finally {
		rmSync(tempRoot, { force: true, recursive: true });
	}
}

main();