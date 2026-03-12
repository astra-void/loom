import fs from "node:fs";
import path from "node:path";
import type { PreviewExecutionMode } from "@loom-dev/preview-engine";
import { searchForWorkspaceRoot } from "vite";
import type {
	LoadPreviewConfigOptions,
	PreviewConfig,
	ResolvedPreviewConfig,
} from "../config";
import { loadPreviewConfig, resolvePreviewConfigObject } from "../config";
import { createAutoMockPropsPlugin } from "./autoMockPlugin";
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
	const previewPlugin = createPreviewVitePlugin({
		projectName: resolvedConfig.projectName,
		runtimeModule: previewRuntimeRootEntry,
		targets: resolvedConfig.targets,
		transformMode: resolvedConfig.transformMode,
	});

	const server = await vite.createServer({
		appType: options.appType ?? "spa",
		assetsInclude: ["**/*.wasm"],
		cacheDir: resolvePreviewViteCacheDir(resolvedConfig.workspaceRoot),
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
			createAutoMockPropsPlugin({ targets: resolvedConfig.targets }),
			previewPlugin,
			reactPlugin(),
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
				allow: [shellRoot, ...resolvedConfig.server.fsAllow],
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
