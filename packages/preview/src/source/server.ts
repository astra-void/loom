import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type { PreviewExecutionMode } from "@loom-dev/preview-engine";
import ts from "typescript";
import { searchForWorkspaceRoot } from "vite";
import type {
	LoadPreviewConfigOptions,
	PreviewConfig,
	ResolvedPreviewConfig,
} from "../config";
import { loadPreviewConfig, resolvePreviewConfigObject } from "../config";
import { createAutoMockPropsPlugin } from "./autoMockPlugin";
import { isFilePathUnderRoot, resolveRealFilePath } from "./pathUtils";
import { createPreviewVitePlugin } from "./plugin";
import type {
	PreviewPluginOption,
	ReactPluginModule,
	ViteModule,
	ViteTopLevelAwaitPluginModule,
	ViteWasmPluginModule,
} from "./viteTypes";

const DEFAULT_PORT = 4174;
const PREVIEW_VITE_CACHE_DIR = path.join(".loom-preview-cache", "vite");
const PREVIEW_OPTIMIZE_DEPS_INCLUDE = [
	"react",
	"react-dom",
	"react/jsx-runtime",
	"react/jsx-dev-runtime",
];
const DEFAULT_REACT_PLUGIN_EXCLUDE_RE = /\/node_modules\//;
const UNSUPPORTED_RUNTIME_EXTENSIONS = new Set([".lua", ".luau"]);
const PACKAGE_JSON_FILE_NAME = "package.json";

export type StartPreviewServerOptions = {
	configFile?: string;
	cwd?: string;
	packageName: string;
	packageRoot: string;
	port?: number;
	runtimeModule?: string;
	sourceRoot: string;
	transformMode?: PreviewExecutionMode;
};

export type StartPreviewServerInput =
	| LoadPreviewConfigOptions
	| PreviewConfig
	| ResolvedPreviewConfig
	| StartPreviewServerOptions;

export type CreatePreviewViteServerOptions = {
	appType?: "custom" | "spa";
	middlewareMode?: boolean;
};

type PackageManifest = {
	dependencies?: Record<string, string>;
	optionalDependencies?: Record<string, string>;
	peerDependencies?: Record<string, string>;
};

function resolvePreviewPackageEntry(candidates: string[], label: string) {
	const matchedPath = candidates.find((candidate) => fs.existsSync(candidate));
	if (!matchedPath) {
		throw new Error(`Unable to resolve ${label} entry.`);
	}

	return matchedPath;
}

function resolveShellRoot() {
	return resolvePreviewPackageEntry(
		[
			path.resolve(__dirname, "../shell"),
			path.resolve(__dirname, "../../src/shell"),
		],
		"preview shell root",
	);
}

export function resolvePreviewRuntimeRootEntry() {
	return resolvePreviewPackageEntry(
		[
			path.resolve(__dirname, "../../../preview-runtime/src/index.ts"),
			path.resolve(__dirname, "../../../preview-runtime/dist/index.js"),
		],
		"preview runtime root",
	);
}

function resolveReactShimEntry(fileName: string) {
	return resolvePreviewPackageEntry(
		[
			path.resolve(__dirname, `./react-shims/${fileName}`),
			path.resolve(__dirname, `../../src/source/react-shims/${fileName}`),
		],
		`react shim ${fileName}`,
	);
}

function normalizeResolvedImporter(importer?: string) {
	if (!importer) {
		return undefined;
	}

	return importer
		.split("?", 1)[0]
		?.replace(/^\/@fs\//, "/")
		.replace(/^\/@id\/__x00__/, "\0");
}

function isAbsoluteFileSpecifier(specifier: string) {
	return /^[A-Za-z]:[\\/]/.test(specifier);
}

function hasUriScheme(specifier: string) {
	return /^[A-Za-z][A-Za-z+.-]*:/.test(specifier);
}

function isBareModuleSpecifier(specifier: string) {
	return !(
		specifier.startsWith(".") ||
		specifier.startsWith("/") ||
		specifier.startsWith("\\") ||
		specifier.startsWith("\0") ||
		isAbsoluteFileSpecifier(specifier) ||
		hasUriScheme(specifier)
	);
}

function isDeclarationFilePath(filePath: string) {
	const normalizedPath = filePath.replace(/\\/g, "/").toLowerCase();
	return (
		normalizedPath.endsWith(".d.ts") ||
		normalizedPath.endsWith(".d.mts") ||
		normalizedPath.endsWith(".d.cts")
	);
}

function isNodeModulesFilePath(filePath: string) {
	return filePath.replace(/\\/g, "/").includes("/node_modules/");
}

function isUnsupportedRuntimeFilePath(filePath: string) {
	return UNSUPPORTED_RUNTIME_EXTENSIONS.has(
		path.extname(filePath).toLowerCase(),
	);
}

function findNearestTsconfig(filePath: string) {
	return ts.findConfigFile(
		path.dirname(filePath),
		ts.sys.fileExists,
		"tsconfig.json",
	);
}

function parseTsconfig(tsconfigPath: string) {
	const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
	if (configFile.error) {
		const message = ts.formatDiagnostic(configFile.error, {
			getCanonicalFileName: (value) => value,
			getCurrentDirectory: () => process.cwd(),
			getNewLine: () => "\n",
		});
		throw new Error(
			`Failed to read TypeScript config ${tsconfigPath}: ${message}`,
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
		const message = ts.formatDiagnostics(parsed.errors, {
			getCanonicalFileName: (value) => value,
			getCurrentDirectory: () => process.cwd(),
			getNewLine: () => "\n",
		});
		throw new Error(
			`Failed to parse TypeScript config ${tsconfigPath}: ${message}`,
		);
	}

	return parsed;
}

function createTsconfigPathResolvePlugin(
	workspaceRoot: string,
): PreviewPluginOption {
	const configCache = new Map<string, ts.ParsedCommandLine>();
	const resolvedWorkspaceRoot = resolveRealFilePath(workspaceRoot);

	return {
		enforce: "pre",
		name: "loom-preview-tsconfig-path-resolve",
		resolveId(id, importer) {
			if (!isBareModuleSpecifier(id)) {
				return undefined;
			}

			const normalizedImporter = normalizeResolvedImporter(importer);
			if (
				!normalizedImporter ||
				normalizedImporter.startsWith("\0") ||
				!path.isAbsolute(normalizedImporter)
			) {
				return undefined;
			}

			const importerFilePath = resolveRealFilePath(normalizedImporter);
			if (
				(importerFilePath !== resolvedWorkspaceRoot &&
					!isFilePathUnderRoot(resolvedWorkspaceRoot, importerFilePath)) ||
				isNodeModulesFilePath(importerFilePath)
			) {
				return undefined;
			}

			const tsconfigPath = findNearestTsconfig(importerFilePath);
			if (!tsconfigPath) {
				return undefined;
			}

			const parsedConfig =
				configCache.get(tsconfigPath) ??
				(() => {
					const nextParsed = parseTsconfig(tsconfigPath);
					configCache.set(tsconfigPath, nextParsed);
					return nextParsed;
				})();
			const resolution = ts.resolveModuleName(
				id,
				importerFilePath,
				parsedConfig.options,
				ts.sys,
			);
			const rawResolvedFilePath = resolution.resolvedModule?.resolvedFileName;
			if (!rawResolvedFilePath) {
				return undefined;
			}

			if (
				isNodeModulesFilePath(rawResolvedFilePath) ||
				isDeclarationFilePath(rawResolvedFilePath) ||
				isUnsupportedRuntimeFilePath(rawResolvedFilePath)
			) {
				return undefined;
			}

			const resolvedFilePath = resolveRealFilePath(rawResolvedFilePath);
			if (
				!isFilePathUnderRoot(resolvedWorkspaceRoot, resolvedFilePath) ||
				isDeclarationFilePath(resolvedFilePath) ||
				isUnsupportedRuntimeFilePath(resolvedFilePath)
			) {
				return undefined;
			}

			return resolvedFilePath;
		},
	};
}

function createRuntimeDependencyResolvePlugin(): PreviewPluginOption {
	const reactShimsRoot = resolvePreviewPackageEntry(
		[
			path.resolve(__dirname, "./react-shims"),
			path.resolve(__dirname, "../../src/source/react-shims"),
		],
		"react shims root",
	);
	const shimEntries = new Map<string, string>([
		[
			"react/jsx-dev-runtime",
			resolveReactShimEntry("react-jsx-dev-runtime.js"),
		],
		["react/jsx-runtime", resolveReactShimEntry("react-jsx-runtime.js")],
		["react", resolveReactShimEntry("react.js")],
	]);

	return {
		enforce: "pre",
		name: "loom-preview-runtime-dependency-resolve",
		resolveId(id, importer) {
			const replacement = shimEntries.get(id);
			if (!replacement) {
				return undefined;
			}

			const normalizedImporter = normalizeResolvedImporter(importer);
			if (normalizedImporter?.startsWith(reactShimsRoot)) {
				return undefined;
			}

			return replacement;
		},
	};
}

function createRuntimeDependencyAliases() {
	return [
		{
			find: "react/jsx-dev-runtime",
			replacement: resolveReactShimEntry("react-jsx-dev-runtime.js"),
		},
		{
			find: "react/jsx-runtime",
			replacement: resolveReactShimEntry("react-jsx-runtime.js"),
		},
		{
			find: "react",
			replacement: resolveReactShimEntry("react.js"),
		},
	];
}

function resolvePreviewViteCacheDir(workspaceRoot: string) {
	return path.resolve(workspaceRoot, PREVIEW_VITE_CACHE_DIR);
}

function findPackageRoot(filePath: string) {
	let currentPath = path.dirname(resolveRealFilePath(filePath));

	while (true) {
		const packageJsonPath = path.join(currentPath, PACKAGE_JSON_FILE_NAME);
		if (fs.existsSync(packageJsonPath)) {
			return currentPath;
		}

		const parentPath = path.dirname(currentPath);
		if (parentPath === currentPath) {
			return undefined;
		}

		currentPath = parentPath;
	}
}

function readPackageManifest(packageRoot: string): PackageManifest {
	return JSON.parse(
		fs.readFileSync(path.join(packageRoot, PACKAGE_JSON_FILE_NAME), "utf8"),
	) as PackageManifest;
}

function getLoomRuntimeDependencyNames(manifest: PackageManifest) {
	return [
		...new Set(
			[
				manifest.dependencies,
				manifest.optionalDependencies,
				manifest.peerDependencies,
			]
				.flatMap((dependencies) => Object.keys(dependencies ?? {}))
				.filter((dependencyName) => dependencyName.startsWith("@loom-dev/")),
		),
	].sort((left, right) => left.localeCompare(right));
}

function resolvePreviewRuntimeDependencyRoots(runtimeEntryPath: string) {
	const resolvedRuntimeEntryPath = resolveRealFilePath(path.resolve(runtimeEntryPath));
	const runtimePackageRoot = findPackageRoot(resolvedRuntimeEntryPath);
	if (!runtimePackageRoot) {
		return [];
	}

	const runtimeRequire = createRequire(resolvedRuntimeEntryPath);
	const runtimeManifest = readPackageManifest(runtimePackageRoot);
	const dependencyRoots = new Set<string>([
		resolveRealFilePath(runtimePackageRoot),
	]);

	for (const dependencyName of getLoomRuntimeDependencyNames(runtimeManifest)) {
		try {
			const dependencyEntryPath = runtimeRequire.resolve(dependencyName);
			const dependencyPackageRoot = findPackageRoot(dependencyEntryPath);
			if (dependencyPackageRoot) {
				dependencyRoots.add(resolveRealFilePath(dependencyPackageRoot));
			}
		} catch {
			// Unresolved runtime deps should still surface through Vite resolution.
		}
	}

	return [...dependencyRoots].sort((left, right) =>
		left.localeCompare(right),
	);
}

function createPreviewFsAllowRoots(
	shellRoot: string,
	configuredRoots: string[],
	runtimeEntryPath: string,
) {
	return [
		...new Set(
			[
				shellRoot,
				...configuredRoots,
				...resolvePreviewRuntimeDependencyRoots(runtimeEntryPath),
			].map((rootPath) => resolveRealFilePath(path.resolve(rootPath))),
		),
	].sort((left, right) => left.localeCompare(right));
}

function escapeRegExp(value: string) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function createPreviewReactPluginExclude(cacheDir: string) {
	const normalizedDepsDir = `${cacheDir.split(path.sep).join("/")}/deps/`;
	return [
		DEFAULT_REACT_PLUGIN_EXCLUDE_RE,
		new RegExp(`^${escapeRegExp(normalizedDepsDir)}`),
	];
}

function isResolvedPreviewConfig(
	value: StartPreviewServerInput,
): value is ResolvedPreviewConfig {
	return (
		typeof value === "object" &&
		value !== null &&
		"targets" in value &&
		Array.isArray(value.targets)
	);
}

function isShorthandServerOptions(
	value: StartPreviewServerInput,
): value is StartPreviewServerOptions {
	return (
		typeof value === "object" &&
		value !== null &&
		"packageRoot" in value &&
		"sourceRoot" in value
	);
}

function isPreviewConfig(
	value: StartPreviewServerInput,
): value is PreviewConfig {
	return (
		typeof value === "object" && value !== null && "targetDiscovery" in value
	);
}

export async function resolvePreviewServerConfig(
	options: StartPreviewServerInput = {},
): Promise<ResolvedPreviewConfig> {
	if (isResolvedPreviewConfig(options)) {
		return options;
	}

	if (isPreviewConfig(options)) {
		return resolvePreviewConfigObject(options);
	}

	if (isShorthandServerOptions(options)) {
		const workspaceRoot = path.resolve(
			searchForWorkspaceRoot(options.packageRoot),
		);
		return {
			configDir: path.resolve(options.packageRoot),
			cwd: path.resolve(options.cwd ?? options.packageRoot),
			mode: "package-root",
			projectName: options.packageName,
			runtimeModule: options.runtimeModule,
			server: {
				fsAllow: [
					path.resolve(options.packageRoot),
					path.resolve(options.sourceRoot),
					workspaceRoot,
				],
				open: false,
				port: options.port ?? DEFAULT_PORT,
			},
			targetDiscovery: [],
			targets: [
				{
					name: options.packageName,
					packageName: options.packageName,
					packageRoot: path.resolve(options.packageRoot),
					sourceRoot: path.resolve(options.sourceRoot),
				},
			],
			transformMode: options.transformMode ?? "strict-fidelity",
			workspaceRoot,
		};
	}

	return loadPreviewConfig(options);
}

export async function startPreviewServer(
	options: StartPreviewServerInput = {},
) {
	const resolvedConfig = await resolvePreviewServerConfig(options);
	const server = await createPreviewViteServer(resolvedConfig);
	await server.listen();
	process.stdout.write(
		`Previewing ${resolvedConfig.projectName} from ${resolvedConfig.workspaceRoot}\n`,
	);
	server.printUrls();

	return server;
}

export async function createPreviewViteServer(
	resolvedConfig: ResolvedPreviewConfig,
	options: CreatePreviewViteServerOptions = {},
) {
	const vite = (await import("vite")) as unknown as ViteModule;
	const reactPlugin = (
		(await import("@vitejs/plugin-react")) as unknown as ReactPluginModule
	).default;
	const wasmPlugin = (
		(await import("vite-plugin-wasm")) as unknown as ViteWasmPluginModule
	).default;
	const topLevelAwaitPlugin = (
		(await import(
			"vite-plugin-top-level-await"
		)) as unknown as ViteTopLevelAwaitPluginModule
	).default;

	const shellRoot = resolveShellRoot();
	const previewRuntimeRootEntry =
		resolvedConfig.runtimeModule ?? resolvePreviewRuntimeRootEntry();
	const previewViteCacheDir = resolvePreviewViteCacheDir(
		resolvedConfig.workspaceRoot,
	);
	const previewFsAllowRoots = createPreviewFsAllowRoots(
		shellRoot,
		resolvedConfig.server.fsAllow,
		previewRuntimeRootEntry,
	);
	const previewPlugin = createPreviewVitePlugin({
		projectName: resolvedConfig.projectName,
		runtimeModule: previewRuntimeRootEntry,
		targets: resolvedConfig.targets,
		transformMode: resolvedConfig.transformMode,
	});

	const server = await vite.createServer({
		appType: options.appType ?? "spa",
		assetsInclude: ["**/*.wasm"],
		cacheDir: previewViteCacheDir,
		configFile: false,
		optimizeDeps: {
			exclude: ["@loom-dev/layout-engine", "layout-engine"],
			include: PREVIEW_OPTIMIZE_DEPS_INCLUDE,
			...(options.middlewareMode
				? {
						entries: [],
						noDiscovery: true,
					}
				: {}),
		},
		plugins: [
			...(options.middlewareMode
				? [createRuntimeDependencyResolvePlugin()]
				: []),
			createTsconfigPathResolvePlugin(resolvedConfig.workspaceRoot),
			createAutoMockPropsPlugin({ targets: resolvedConfig.targets }),
			previewPlugin,
			reactPlugin({
				exclude: createPreviewReactPluginExclude(previewViteCacheDir),
			}),
			wasmPlugin(),
			topLevelAwaitPlugin(),
		],
		resolve: {
			alias: [
				...(options.middlewareMode ? createRuntimeDependencyAliases() : []),
				{
					find: "@loom-dev/preview-runtime",
					replacement: previewRuntimeRootEntry,
				},
			],
			dedupe: ["react", "react-dom"],
		},
		root: shellRoot,
		server: {
			fs: {
				allow: previewFsAllowRoots,
			},
			host: resolvedConfig.server.host,
			...(options.middlewareMode
				? {
						hmr: false,
						middlewareMode: true,
						ws: false,
					}
				: {}),
			open: resolvedConfig.server.open,
			port: resolvedConfig.server.port,
		},
		ssr: options.middlewareMode
			? {
					noExternal: [/^react(?:$|\/)/, /^react-dom(?:$|\/)/],
				}
			: undefined,
	});

	return server;
}
