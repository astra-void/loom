import fs from "node:fs";
import path from "node:path";
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
import {
	isFilePathIncludedByTarget,
	isFilePathUnderRoot,
	resolveFilePath,
	stripFileIdDecorations,
} from "./pathUtils";
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
const PREVIEW_TIMING_ENABLED = process.env.LOOM_PREVIEW_TIMINGS === "1";

function logPreviewTiming(label: string, startedAt: number) {
	if (!PREVIEW_TIMING_ENABLED) {
		return;
	}

	console.info(`[preview] ${label}: ${Date.now() - startedAt}ms`);
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
	previewEngine?: PreviewEngine;
	projectName: string;
	runtimeModule?: string;
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
) {
	const { mode = "strict-fidelity", ...compilerOptions } = options;

	try {
		const { normalizeTransformPreviewSourceResult, transformPreviewSource } =
			await import("@loom-dev/compiler");
		return normalizeTransformPreviewSourceResult(
			transformPreviewSource(sourceText, compilerOptions),
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
) {
	const startedAt = Date.now();
	const discoveryWorkspaceIndex = (
		previewEngine as PreviewEngine & {
			getDiscoveryWorkspaceIndex(): PreviewWorkspaceIndex;
		}
	).getDiscoveryWorkspaceIndex();
	logPreviewTiming("workspace index loaded", startedAt);
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
	logPreviewTiming(`entry index resolved (${entryId})`, startedAt);

	const payload = previewEngine.getEntryPayload(entryId);
	logPreviewTiming(`entry payload loaded (${entryId})`, startedAt);
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
			fileContext.packageName?.startsWith("@loom-dev/preview")
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

function createRuntimeDependencyResolvePlugin(): PreviewPluginOption {
	const browserShimsRoot = resolvePreviewPackageEntry(
		[
			path.resolve(__dirname, "./react-shims/browser"),
			path.resolve(__dirname, "../../src/source/react-shims/browser"),
		],
		"react shims root",
	);
	const shimEntries = new Map<string, string>([
		["react-dom/client", resolveBrowserReactShimEntry("react-dom-client.js")],
		["react-dom/server", resolveBrowserReactShimEntry("react-dom-server.js")],
		["react-dom", resolveBrowserReactShimEntry("react-dom.js")],
		[
			"react/jsx-dev-runtime",
			resolveBrowserReactShimEntry("react-jsx-dev-runtime.js"),
		],
		["react/jsx-runtime", resolveBrowserReactShimEntry("react-jsx-runtime.js")],
		["react", resolveBrowserReactShimEntry("react.js")],
		["@rbxts/react", resolveBrowserReactShimEntry("react.js")],
		["@rbxts/react-roblox", resolveBrowserReactRobloxShimEntry()],
	]);

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

			const normalizedImporter = stripFileIdDecorations(importer ?? "");
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
		projectName: options.projectName,
		runtimeModule: runtimeEntryPath,
		targets: options.targets,
		transformMode: options.transformMode ?? "strict-fidelity",
		workspaceRoot: options.workspaceRoot,
	} as Parameters<typeof createPreviewEngine>[0] & {
		workspaceRoot?: string;
	};
	let previewEngine: PreviewEngine | undefined;
	let workspaceGraphService: WorkspaceGraphService | undefined;
	const getWorkspaceGraphService = () => {
		if (!workspaceGraphService) {
			const startedAt = Date.now();
			workspaceGraphService = createWorkspaceGraphService({
				targets: options.targets,
				workspaceRoot: options.workspaceRoot,
			});
			logPreviewTiming("workspace graph service initialized", startedAt);
		}

		return workspaceGraphService;
	};
	const getPreviewEngine = () => {
		if (!previewEngine) {
			const startedAt = Date.now();
			previewEngine =
				options.previewEngine ?? createPreviewEngine(previewEngineOptions);
			logPreviewTiming("preview engine initialized", startedAt);
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

	const refreshPreviewEngine = (filePath: string) => {
		try {
			const update = getPreviewEngine().invalidateSourceFiles([filePath]);
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
				const update = getPreviewEngine().replaceRuntimeIssues(
					Array.isArray(issues) ? issues : [],
				);
				invalidateVirtualModules(update.changedEntryIds);
				configuredServer.ws.send({
					data: update,
					event: PREVIEW_UPDATE_EVENT,
					type: "custom",
				});
			});
			configuredServer.watcher.on("add", (filePath: string) => {
				const previewEngineInstance = getPreviewEngine();
				if (isWatchedCandidate(previewEngineInstance, filePath)) {
					refreshPreviewEngine(filePath);
				}
			});
			configuredServer.watcher.on("unlink", (filePath: string) => {
				const previewEngineInstance = getPreviewEngine();
				if (isWatchedCandidate(previewEngineInstance, filePath)) {
					refreshPreviewEngine(filePath);
				}
			});
		},
		handleHotUpdate(context: { file: string }) {
			const previewEngineInstance = getPreviewEngine();
			if (!isWatchedCandidate(previewEngineInstance, context.file)) {
				return undefined;
			}

			refreshPreviewEngine(context.file);
			return [];
		},
		load(id: string) {
			const previewEngineInstance = getPreviewEngine();

			if (id === RESOLVED_WORKSPACE_INDEX_MODULE_ID) {
				return getWorkspaceModuleCode(previewEngineInstance);
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
			const previewEngineInstance = getPreviewEngine();
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
				runtimeModule: runtimeEntryPath,
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

			const { compile_tsx } = await import("@loom-dev/compiler");
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
		createRuntimeDependencyResolvePlugin(),
		createUnresolvedPackageMockResolvePlugin(mockEntryPath),
		previewPlugin,
		createUnresolvedPackageMockTransformPlugin(),
	];
}
