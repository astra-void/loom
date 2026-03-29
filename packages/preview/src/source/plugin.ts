import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { TransformPreviewSourceOptions } from "@loom-dev/compiler";
import {
	createPreviewEngine,
	createWorkspaceGraphService,
	isTransformableSourceFile,
	PREVIEW_ENGINE_PROTOCOL_VERSION,
	type PreviewEngine,
	type PreviewExecutionMode,
	type PreviewSourceTarget,
	type PreviewWorkspaceIndex,
	type WorkspaceGraphService,
} from "@loom-dev/preview-engine";
import type { PreviewRuntimeIssue } from "@loom-dev/preview-runtime";
import { createErrorWithCause } from "../errorWithCause";
import { normalizeTransformPreviewSourceResult } from "../transformResult";
import {
	createReactShimSpecifierMap,
	isInternalPreviewPackageName,
} from "./aliasConfig";
import {
	isFilePathIncludedByTarget,
	isFilePathUnderRoot,
	resolveFilePath,
	stripFileIdDecorations,
} from "./pathUtils";
import {
	type PreviewProgressScope,
	type PreviewProgressWriter,
	writePreviewTiming,
} from "./progress";
import {
	createUnresolvedPackageMockResolvePlugin,
	createUnresolvedPackageMockTransformPlugin,
	isBareModuleSpecifier,
} from "./robloxPackageMockPlugin";
import type {
	PreviewDevServer,
	PreviewPlugin,
	PreviewPluginOption,
} from "./viteTypes";

const WORKSPACE_INDEX_MODULE_ID = "virtual:loom-preview-workspace-index";
const RESOLVED_WORKSPACE_INDEX_MODULE_ID = `\0${WORKSPACE_INDEX_MODULE_ID}`;
const RUNTIME_MODULE_ID = "virtual:loom-preview-runtime";
const RESOLVED_RUNTIME_MODULE_ID = `\0${RUNTIME_MODULE_ID}`;
const ENTRY_MODULE_ID_PREFIX = "virtual:loom-preview-entry:";
const RESOLVED_ENTRY_MODULE_ID_PREFIX = `\0${ENTRY_MODULE_ID_PREFIX}`;
const PREVIEW_UPDATE_EVENT = "loom-preview:update";
const RUNTIME_ISSUES_EVENT = "loom-preview:runtime-issues";
const RBX_STYLE_HELPER_NAME = "__rbxStyle";
type CompilerModule =
	| typeof import("@loom-dev/compiler/sync")
	| typeof import("@loom-dev/compiler/wasm");
const nativeImport = new Function("specifier", "return import(specifier);") as (
	specifier: string,
) => Promise<typeof import("@loom-dev/compiler/wasm")>;

function loadCompilerModule() {
	if (process.env.VITEST) {
		return import(
			/* @vite-ignore */
			pathToFileURL(path.resolve(__dirname, "../../../compiler/sync.mjs")).href
		);
	}

	return nativeImport("@loom-dev/compiler/wasm");
}

function logPreviewTiming(
	label: string,
	startedAt: number,
	progressWriter?: PreviewProgressWriter,
	scope: PreviewProgressScope = "server",
) {
	writePreviewTiming(progressWriter, label, startedAt, { scope });
}

function createRbxStyleImport(runtimeModulePath: string) {
	return `import { ${RBX_STYLE_HELPER_NAME} } from ${JSON.stringify(runtimeModulePath)};\n`;
}

function resolvePreviewPackageEntry(candidates: string[], label: string) {
	const matchedPath = candidates.find((candidate) => fs.existsSync(candidate));
	if (!matchedPath) {
		throw new Error(`Unable to resolve ${label} entry.`);
	}

	return matchedPath.split(path.sep).join("/");
}

type TransformPreviewSourceInvocationOptions = TransformPreviewSourceOptions & {
	mode?: PreviewExecutionMode;
};

export type CreatePreviewVitePluginOptions = {
	reactAliases?: string[];
	reactRobloxAliases?: string[];
	previewEngine?: PreviewEngine;
	progressWriter?: PreviewProgressWriter;
	projectName: string;
	runtimeModule?: string;
	runtimeAliases?: string[];
	targets: PreviewSourceTarget[];
	transformMode?: PreviewExecutionMode;
	workspaceRoot: string;
};

function createWorkspaceSourceResolvePlugin(
	getWorkspaceGraphService: () => WorkspaceGraphService,
	isBareModuleSpecifierFn: (specifier: string) => boolean,
): PreviewPluginOption {
	return {
		enforce: "pre",
		name: "loom-preview-workspace-source-resolve",
		resolveId(id, importer) {
			if (!isBareModuleSpecifierFn(id)) {
				return undefined;
			}

			const normalizedImporter = stripFileIdDecorations(importer ?? "");
			if (
				!normalizedImporter ||
				normalizedImporter.startsWith("\0") ||
				!path.isAbsolute(normalizedImporter)
			) {
				return undefined;
			}

			const resolution = getWorkspaceGraphService().resolveImport({
				importerFilePath: normalizedImporter,
				specifier: id,
			});
			if (
				!resolution?.followedFilePath ||
				!isTransformableSourceFile(resolution.followedFilePath)
			) {
				return undefined;
			}

			return resolution.followedFilePath;
		},
	};
}

function resolveBrowserReactShimEntry(fileName: string) {
	return resolvePreviewPackageEntry(
		[
			path.resolve(__dirname, `./react-shims/browser/${fileName}`),
			path.resolve(
				__dirname,
				`../../src/source/react-shims/browser/${fileName}`,
			),
		],
		`react shim ${fileName}`,
	);
}

function resolveBrowserReactRobloxShimEntry() {
	return resolvePreviewPackageEntry(
		[
			path.resolve(__dirname, "./react-shims/browser/react-roblox.js"),
			path.resolve(
				__dirname,
				"../../src/source/react-shims/browser/react-roblox.js",
			),
		],
		"react-roblox shim",
	);
}

function resolveRuntimeEntryPath() {
	const candidates = [
		path.resolve(__dirname, "../../../preview-runtime/src/index.ts"),
		path.resolve(__dirname, "../../../preview-runtime/dist/index.js"),
	];
	const candidate = candidates.find((filePath) => fs.existsSync(filePath));
	if (!candidate) {
		throw new Error("Unable to resolve @loom-dev/preview-runtime entry.");
	}

	return candidate.split(path.sep).join("/");
}

function resolvePreviewShellRoot() {
	return resolvePreviewPackageEntry(
		[
			path.resolve(__dirname, "../shell"),
			path.resolve(__dirname, "../../src/shell"),
		],
		"preview shell root",
	)
		.split(path.sep)
		.join("/");
}

function resolveMockEntryPath() {
	const candidates = [
		path.resolve(__dirname, "./robloxEnv.ts"),
		path.resolve(__dirname, "../../src/source/robloxEnv.ts"),
		path.resolve(__dirname, "./robloxEnv.js"),
	];
	const candidate = candidates.find((filePath) => fs.existsSync(filePath));
	if (!candidate) {
		throw new Error("Unable to resolve preview mock entry.");
	}

	return candidate.split(path.sep).join("/");
}

async function stripTypeSyntax(code: string, filePath: string) {
	const ts = await import("typescript");
	return ts.transpileModule(code, {
		compilerOptions: {
			jsx: ts.JsxEmit.Preserve,
			module: ts.ModuleKind.ESNext,
			target: ts.ScriptTarget.ESNext,
			verbatimModuleSyntax: true,
		},
		fileName: filePath,
	}).outputText;
}

async function transformPreviewSourceOrThrow(
	sourceText: string,
	options: TransformPreviewSourceInvocationOptions,
): Promise<ReturnType<typeof normalizeTransformPreviewSourceResult>> {
	const { mode = "strict-fidelity", ...compilerOptions } = options;

	try {
		const { transformPreviewSource } = await loadCompilerModule();
		return normalizeTransformPreviewSourceResult(
			transformPreviewSource(sourceText, {
				...compilerOptions,
				mode,
			}),
			mode,
		);
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error);
		throw createErrorWithCause(
			`Failed to parse preview source ${options.filePath}: ${detail}`,
			error,
		);
	}
}

function getWorkspaceModuleCode(
	previewEngine: ReturnType<typeof createPreviewEngine>,
	progressWriter?: PreviewProgressWriter,
) {
	const startedAt = Date.now();
	const discoveryWorkspaceIndex = (
		previewEngine as PreviewEngine & {
			getDiscoveryWorkspaceIndex(): PreviewWorkspaceIndex;
		}
	).getDiscoveryWorkspaceIndex();
	logPreviewTiming(
		"workspace index loaded",
		startedAt,
		progressWriter,
		"client",
	);
	const workspaceIndex = discoveryWorkspaceIndex;
	const importers = workspaceIndex.entries
		.map(
			(entry) =>
				`  ${JSON.stringify(entry.id)}: () => import(${JSON.stringify(
					`${ENTRY_MODULE_ID_PREFIX}${encodeURIComponent(entry.id)}`,
				)}),`,
		)
		.join("\n");

	return `export const previewProtocolVersion = ${JSON.stringify(PREVIEW_ENGINE_PROTOCOL_VERSION)};
export const previewWorkspaceIndex = ${JSON.stringify(workspaceIndex, null, 2)};
export const previewImporters = {
${importers}
};
`;
}

function renderEntryModule(
	previewEngine: ReturnType<typeof createPreviewEngine>,
	entryId: string,
	runtimeModulePath: string,
	progressWriter?: PreviewProgressWriter,
) {
	const startedAt = Date.now();
	const entry = (
		previewEngine as PreviewEngine & {
			getDiscoveryWorkspaceIndex(): PreviewWorkspaceIndex;
		}
	)
		.getDiscoveryWorkspaceIndex()
		.entries.find((candidate) => candidate.id === entryId);
	if (!entry) {
		throw new Error(`No preview entry registered for \`${entryId}\`.`);
	}
	logPreviewTiming(
		`entry index resolved (${entryId})`,
		startedAt,
		progressWriter,
		"client",
	);

	const payload = previewEngine.getEntryPayload(entryId);
	logPreviewTiming(
		`entry payload loaded (${entryId})`,
		startedAt,
		progressWriter,
		"client",
	);
	if (payload.descriptor.status !== "ready") {
		return `import * as __previewRuntimeModule from ${JSON.stringify(runtimeModulePath)};
export const __previewEntryPayload = ${JSON.stringify(payload, null, 2)};
export { __previewRuntimeModule };
const __previewBlockedModule = {};
export default __previewBlockedModule;
`;
	}

	const sourceFilePath = entry.sourceFilePath.split(path.sep).join("/");

	return `import * as __previewModule from ${JSON.stringify(sourceFilePath)};
import * as __previewRuntimeModule from ${JSON.stringify(runtimeModulePath)};
export * from ${JSON.stringify(sourceFilePath)};
const __previewDefault = __previewModule.default;
export default __previewDefault;
export const __previewEntryPayload = ${JSON.stringify(payload, null, 2)};
export { __previewRuntimeModule };
`;
}

function isWatchedCandidate(
	previewEngine: ReturnType<typeof createPreviewEngine>,
	filePath: string,
) {
	const normalizedFilePath = stripFileIdDecorations(filePath);
	return previewEngine.isTrackedSourceFile(normalizedFilePath);
}

function isTransformablePreviewSourceFile(filePath: string) {
	const normalizedFilePath = stripFileIdDecorations(filePath);
	return (
		isTransformableSourceFile(normalizedFilePath) &&
		!normalizedFilePath.endsWith(".d.loom.tsx")
	);
}

function getTransformTarget(targets: PreviewSourceTarget[], filePath: string) {
	const normalizedFilePath = stripFileIdDecorations(filePath);
	if (!isTransformablePreviewSourceFile(normalizedFilePath)) {
		return undefined;
	}

	return targets.find((target) =>
		isFilePathIncludedByTarget(target, normalizedFilePath),
	);
}

function getTransformTargetName(
	workspaceGraphService: WorkspaceGraphService,
	previewEngine: ReturnType<typeof createPreviewEngine>,
	targets: PreviewSourceTarget[],
	previewShellRoot: string,
	filePath: string,
) {
	const normalizedFilePath = resolveFilePath(filePath);
	if (!isTransformablePreviewSourceFile(normalizedFilePath)) {
		return undefined;
	}

	const directTarget = getTransformTarget(targets, filePath);
	if (directTarget) {
		return directTarget.name;
	}

	const fileContext = workspaceGraphService.getFileContext(normalizedFilePath);
	if (!previewEngine.isTrackedSourceFile(normalizedFilePath)) {
		if (
			!isTransformablePreviewSourceFile(normalizedFilePath) ||
			!isFilePathUnderRoot(
				workspaceGraphService.workspaceRoot,
				normalizedFilePath,
			) ||
			isFilePathUnderRoot(previewShellRoot, normalizedFilePath) ||
			isInternalPreviewPackageName(fileContext.packageName)
		) {
			return undefined;
		}
	}

	return fileContext.packageName ?? targets[0]?.name;
}

function resolveWatchRoots(targets: PreviewSourceTarget[]) {
	return [
		...new Set(
			targets.map((target) => {
				const resolvedPath = path.resolve(target.sourceRoot);
				try {
					return (
						fs.realpathSync.native?.(resolvedPath) ??
						fs.realpathSync(resolvedPath)
					);
				} catch {
					return resolvedPath;
				}
			}),
		),
	].sort((left, right) => left.localeCompare(right));
}

function createRuntimeDependencyResolvePlugin(
	options: Pick<
		CreatePreviewVitePluginOptions,
		"reactAliases" | "reactRobloxAliases"
	>,
): PreviewPluginOption {
	const browserShimsRoot = resolvePreviewPackageEntry(
		[
			path.resolve(__dirname, "./react-shims/browser"),
			path.resolve(__dirname, "../../src/source/react-shims/browser"),
		],
		"react shims root",
	);
	const shimEntries = createReactShimSpecifierMap({
		mode: "browser",
		reactAliases: options.reactAliases,
		reactRobloxAliases: options.reactRobloxAliases,
		resolveReactRobloxShimEntry: () => resolveBrowserReactRobloxShimEntry(),
		resolveReactShimEntry: (fileName) => resolveBrowserReactShimEntry(fileName),
	});

	return {
		enforce: "pre",
		name: "loom-preview-runtime-dependency-resolve",
		resolveId(id, importer, options) {
			if (options?.ssr) {
				return undefined;
			}

			const replacement = shimEntries.get(id);
			if (!replacement) {
				return undefined;
			}

			const normalizedImporter = stripFileIdDecorations(importer ?? "")
				.split(path.sep)
				.join("/");
			if (normalizedImporter?.startsWith(browserShimsRoot)) {
				return undefined;
			}

			return replacement;
		},
	};
}

function isIgnorablePreviewRefreshError(error: unknown) {
	if (!error || typeof error !== "object") {
		return false;
	}

	const code = "code" in error ? (error as { code?: unknown }).code : undefined;
	return code === "ENOENT" || code === "ENOTDIR";
}

export function createPreviewVitePlugin(
	options: CreatePreviewVitePluginOptions,
): PreviewPluginOption[] {
	const runtimeEntryPath = (
		options.runtimeModule ?? resolveRuntimeEntryPath()
	).replace(/\\/g, "/");
	const previewShellRoot = resolvePreviewShellRoot();
	const rbxStyleImport = createRbxStyleImport(runtimeEntryPath);
	const mockEntryPath = resolveMockEntryPath();
	const previewEngineOptions = {
		reactAliases: options.reactAliases,
		reactRobloxAliases: options.reactRobloxAliases,
		projectName: options.projectName,
		runtimeModule: runtimeEntryPath,
		runtimeAliases: options.runtimeAliases,
		targets: options.targets,
		transformMode: options.transformMode ?? "strict-fidelity",
		workspaceRoot: options.workspaceRoot,
	} as Omit<Parameters<typeof createPreviewEngine>[0], "compiler">;
	let previewEngine: PreviewEngine | undefined;
	let compilerPromise: Promise<CompilerModule> | undefined;
	let workspaceGraphService: WorkspaceGraphService | undefined;
	const getWorkspaceGraphService = () => {
		if (!workspaceGraphService) {
			const startedAt = Date.now();
			workspaceGraphService = createWorkspaceGraphService({
				targets: options.targets,
				workspaceRoot: options.workspaceRoot,
			});
			logPreviewTiming(
				"workspace graph service initialized",
				startedAt,
				options.progressWriter,
				"client",
			);
		}

		return workspaceGraphService;
	};
	const getCompiler = async () => {
		if (!compilerPromise) {
			compilerPromise = loadCompilerModule();
		}

		return compilerPromise;
	};
	const getPreviewEngine = async () => {
		if (!previewEngine) {
			const startedAt = Date.now();
			previewEngine =
				options.previewEngine ??
				createPreviewEngine({
					...previewEngineOptions,
					compiler: await getCompiler(),
				} as Parameters<typeof createPreviewEngine>[0]);
			logPreviewTiming(
				"preview engine initialized",
				startedAt,
				options.progressWriter,
				"client",
			);
		}

		return previewEngine;
	};
	const watchRoots = resolveWatchRoots(options.targets);
	let server: PreviewDevServer | undefined;

	const invalidateVirtualModules = (entryIds: string[]) => {
		if (!server) {
			return;
		}

		const workspaceModule = server.moduleGraph.getModuleById(
			RESOLVED_WORKSPACE_INDEX_MODULE_ID,
		);
		if (workspaceModule) {
			server.moduleGraph.invalidateModule(workspaceModule);
		}

		for (const entryId of entryIds) {
			const entryModule = server.moduleGraph.getModuleById(
				`${RESOLVED_ENTRY_MODULE_ID_PREFIX}${encodeURIComponent(entryId)}`,
			);
			if (entryModule) {
				server.moduleGraph.invalidateModule(entryModule);
			}
		}
	};

	const refreshPreviewEngine = async (filePath: string) => {
		try {
			const update = (await getPreviewEngine()).invalidateSourceFiles([
				filePath,
			]);
			invalidateVirtualModules(update.changedEntryIds);

			if (server) {
				if (update.requiresFullReload) {
					server.ws.send({ type: "full-reload" });
				} else {
					server.ws.send({
						data: update,
						event: PREVIEW_UPDATE_EVENT,
						type: "custom",
					});
				}
			}

			return update;
		} catch (error) {
			if (isIgnorablePreviewRefreshError(error)) {
				return undefined;
			}
			throw error;
		}
	};

	const previewPlugin: PreviewPlugin = {
		name: "loom-preview-source-first",
		enforce: "pre",
		configureServer(configuredServer: PreviewDevServer) {
			server = configuredServer;
			configuredServer.watcher.add(watchRoots);
			(
				configuredServer.ws as PreviewDevServer["ws"] & {
					on?: (
						event: string,
						listener: (payload: PreviewRuntimeIssue[]) => void,
					) => void;
				}
			).on?.(RUNTIME_ISSUES_EVENT, (issues: PreviewRuntimeIssue[]) => {
				void getPreviewEngine().then((previewEngineInstance) => {
					const update = previewEngineInstance.replaceRuntimeIssues(
						Array.isArray(issues) ? issues : [],
					);
					invalidateVirtualModules(update.changedEntryIds);
					configuredServer.ws.send({
						data: update,
						event: PREVIEW_UPDATE_EVENT,
						type: "custom",
					});
				});
			});
			configuredServer.watcher.on("add", (filePath: string) => {
				void getPreviewEngine().then((previewEngineInstance) => {
					if (!isWatchedCandidate(previewEngineInstance, filePath)) {
						return;
					}

					void refreshPreviewEngine(filePath);
				});
			});
			configuredServer.watcher.on("unlink", (filePath: string) => {
				void getPreviewEngine().then((previewEngineInstance) => {
					if (isWatchedCandidate(previewEngineInstance, filePath)) {
						void refreshPreviewEngine(filePath);
					}
				});
			});
		},
		async handleHotUpdate(context: { file: string }) {
			const previewEngineInstance = await getPreviewEngine();
			if (!isWatchedCandidate(previewEngineInstance, context.file)) {
				return undefined;
			}

			await refreshPreviewEngine(context.file);
			return [];
		},
		async load(id: string) {
			const previewEngineInstance = await getPreviewEngine();

			if (id === RESOLVED_WORKSPACE_INDEX_MODULE_ID) {
				return getWorkspaceModuleCode(
					previewEngineInstance,
					options.progressWriter,
				);
			}

			if (id === RESOLVED_RUNTIME_MODULE_ID) {
				return `export * from ${JSON.stringify(runtimeEntryPath)};\n`;
			}

			if (id.startsWith(RESOLVED_ENTRY_MODULE_ID_PREFIX)) {
				const entryId = decodeURIComponent(
					id.slice(RESOLVED_ENTRY_MODULE_ID_PREFIX.length),
				);
				return renderEntryModule(
					previewEngineInstance,
					entryId,
					runtimeEntryPath,
					options.progressWriter,
				);
			}

			return undefined;
		},
		resolveId(id: string) {
			if (id === WORKSPACE_INDEX_MODULE_ID) {
				return RESOLVED_WORKSPACE_INDEX_MODULE_ID;
			}

			if (id === RUNTIME_MODULE_ID) {
				return RESOLVED_RUNTIME_MODULE_ID;
			}

			if (id.startsWith(ENTRY_MODULE_ID_PREFIX)) {
				return `${RESOLVED_ENTRY_MODULE_ID_PREFIX}${id.slice(ENTRY_MODULE_ID_PREFIX.length)}`;
			}

			return undefined;
		},
		async transform(code: string, id: string) {
			const previewEngineInstance = await getPreviewEngine();
			const workspaceGraphServiceInstance = getWorkspaceGraphService();
			const filePath = stripFileIdDecorations(id);
			const targetName = getTransformTargetName(
				workspaceGraphServiceInstance,
				previewEngineInstance,
				options.targets,
				previewShellRoot,
				filePath,
			);
			if (!targetName) {
				return undefined;
			}

			const transformed = await transformPreviewSourceOrThrow(code, {
				filePath,
				mode: options.transformMode ?? "strict-fidelity",
				reactAliases: options.reactAliases,
				reactRobloxAliases: options.reactRobloxAliases,
				runtimeModule: runtimeEntryPath,
				runtimeAliases: options.runtimeAliases,
				target: targetName,
			});
			if (transformed.code == null) {
				const diagnosticMessage =
					transformed.diagnostics
						.map((diagnostic) => `${diagnostic.code}: ${diagnostic.summary}`)
						.join("\n") || "Preview transform did not emit executable code.";
				throw new Error(
					`Transform mode ${options.transformMode ?? "strict-fidelity"} blocked ${filePath}.\n${diagnosticMessage}`,
				);
			}

			const { compile_tsx } = await getCompiler();
			let transformedCode = compile_tsx(transformed.code);
			transformedCode = await stripTypeSyntax(transformedCode, filePath);
			if (
				transformedCode.includes(RBX_STYLE_HELPER_NAME) &&
				!transformedCode.includes(rbxStyleImport.trim())
			) {
				transformedCode = `${rbxStyleImport}${transformedCode}`;
			}

			return {
				code: transformedCode,
				map: null,
			};
		},
	};

	return [
		createWorkspaceSourceResolvePlugin(
			getWorkspaceGraphService,
			isBareModuleSpecifier,
		),
		createRuntimeDependencyResolvePlugin({
			reactAliases: options.reactAliases,
			reactRobloxAliases: options.reactRobloxAliases,
		}),
		createUnresolvedPackageMockResolvePlugin(mockEntryPath, {
			reactAliases: options.reactAliases,
			reactRobloxAliases: options.reactRobloxAliases,
		}),
		previewPlugin,
		createUnresolvedPackageMockTransformPlugin({
			reactAliases: options.reactAliases,
			reactRobloxAliases: options.reactRobloxAliases,
		}),
	];
}
