import fs from "node:fs";
import path from "node:path";
import type { ResolvedPreviewConfig } from "../config";
import {
	isFilePathUnderRoot,
	resolveRealFilePath,
	stripFileIdDecorations,
} from "./pathUtils";
import {
	resolveLayoutEngineRoots,
	resolvePreviewRuntimeRoots,
	resolvePreviewShellRoot,
} from "./previewPackagePaths";
import type { PreviewPlugin, PreviewPluginOption } from "./viteTypes";

type ResolveHook = (
	this: unknown,
	source: string,
	importer?: string,
	options?: { ssr?: boolean },
) => unknown;
type LoadHook = (
	this: unknown,
	id: string,
	options?: { ssr?: boolean },
) => unknown;
type TransformHook = (
	this: unknown,
	code: string,
	id: string,
	options?: { ssr?: boolean },
) => unknown;
type HotUpdateHook = (this: unknown, context: { file: string }) => unknown;
type HookLike<THook extends (...args: never[]) => unknown> =
	| THook
	| ({ handler: THook } & Record<string, unknown>);

type PreviewScopedPluginScope = {
	dynamicRoots: Set<string>;
	roots: string[];
};

function flattenPluginOptions(
	plugins: PreviewPluginOption | PreviewPluginOption[],
): PreviewPluginOption[] {
	const pending = Array.isArray(plugins)
		? ([...plugins] as unknown[])
		: ([plugins] as unknown[]);
	const flattened: PreviewPluginOption[] = [];

	while (pending.length > 0) {
		const plugin = pending.shift();
		if (Array.isArray(plugin)) {
			pending.unshift(...plugin);
			continue;
		}

		if (plugin) {
			flattened.push(plugin as PreviewPluginOption);
		}
	}

	return flattened;
}

function normalizeId(id = "") {
	const normalizedId = stripFileIdDecorations(id);
	if (normalizedId.startsWith("/@id/__x00__/")) {
		return `\0${normalizedId.slice("/@id/__x00__/".length)}`;
	}

	if (normalizedId.startsWith("/@fs/") || path.isAbsolute(normalizedId)) {
		return resolveRealFilePath(normalizedId);
	}

	return normalizedId;
}

function getResolvedId(result: unknown) {
	if (typeof result === "string") {
		return result;
	}

	if (typeof result === "object" && result !== null && "id" in result) {
		const candidate = (result as { id?: unknown }).id;
		return typeof candidate === "string" ? candidate : undefined;
	}

	return undefined;
}

function findNearestPackageRoot(filePath: string) {
	let currentDir =
		fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()
			? filePath
			: path.dirname(filePath);

	for (;;) {
		const packageJsonPath = path.join(currentDir, "package.json");
		if (fs.existsSync(packageJsonPath)) {
			return currentDir;
		}

		const parentDir = path.dirname(currentDir);
		if (parentDir === currentDir) {
			return undefined;
		}

		currentDir = parentDir;
	}
}

function readPackageSourceRoot(packageRoot: string) {
	const packageJsonPath = path.join(packageRoot, "package.json");
	try {
		const packageJson = JSON.parse(
			fs.readFileSync(packageJsonPath, "utf8"),
		) as {
			source?: unknown;
		};
		if (typeof packageJson.source !== "string") {
			return undefined;
		}

		const sourcePath = resolveRealFilePath(
			path.resolve(packageRoot, packageJson.source),
		);
		return fs.existsSync(sourcePath) && fs.statSync(sourcePath).isDirectory()
			? sourcePath
			: path.dirname(sourcePath);
	} catch {
		return undefined;
	}
}

function isWithinRoot(filePath: string, rootPath: string) {
	return filePath === rootPath || isFilePathUnderRoot(rootPath, filePath);
}

function isPreviewVirtualId(id: string) {
	const normalizedId = normalizeId(id);
	return (
		normalizedId.startsWith("\0virtual:loom-preview") ||
		normalizedId.startsWith("virtual:loom-preview")
	);
}

function isPreviewPackageRequest(id: string) {
	return (
		id === "@loom-dev/preview-runtime" ||
		id.startsWith("@loom-dev/preview-runtime/") ||
		id === "@loom-dev/layout-engine" ||
		id.startsWith("@loom-dev/layout-engine/")
	);
}

function createPreviewScopedPluginScope(
	resolvedConfig: ResolvedPreviewConfig,
): PreviewScopedPluginScope {
	return {
		dynamicRoots: new Set(),
		roots: [
			resolvedConfig.workspaceRoot,
			...resolvedConfig.targets.map((target) => target.sourceRoot),
			resolvePreviewShellRoot(),
			...resolvePreviewRuntimeRoots(),
			...resolveLayoutEngineRoots(),
		].map((rootPath) => resolveRealFilePath(rootPath)),
	};
}

function isScopedPath(id: string, scope: PreviewScopedPluginScope) {
	const normalizedId = normalizeId(id);
	if (!normalizedId || normalizedId.startsWith("\0")) {
		return false;
	}

	if (!path.isAbsolute(normalizedId)) {
		return isPreviewPackageRequest(normalizedId);
	}

	return [...scope.roots, ...scope.dynamicRoots].some((rootPath) =>
		isWithinRoot(normalizedId, rootPath),
	);
}

function trackResolvedPackageSourceRoot(
	result: unknown,
	scope: PreviewScopedPluginScope,
) {
	const resolvedId = getResolvedId(result);
	if (!resolvedId) {
		return;
	}

	const normalizedId = normalizeId(resolvedId);
	if (!path.isAbsolute(normalizedId)) {
		return;
	}

	const packageRoot = findNearestPackageRoot(normalizedId);
	if (!packageRoot) {
		return;
	}

	const sourceRoot = readPackageSourceRoot(packageRoot);
	if (!sourceRoot || !isWithinRoot(normalizedId, sourceRoot)) {
		return;
	}

	scope.dynamicRoots.add(resolveRealFilePath(sourceRoot));
}

function shouldHandleResolve(
	source: string,
	importer: string | undefined,
	options: { ssr?: boolean } | undefined,
	scope: PreviewScopedPluginScope,
) {
	if (options?.ssr) {
		return false;
	}

	if (isPreviewVirtualId(source)) {
		return true;
	}

	if (isPreviewPackageRequest(source)) {
		return importer ? isScopedPath(importer, scope) : true;
	}

	return importer ? isScopedPath(importer, scope) : isScopedPath(source, scope);
}

function shouldHandleLoadOrTransform(
	id: string,
	options: { ssr?: boolean } | undefined,
	scope: PreviewScopedPluginScope,
) {
	if (options?.ssr) {
		return false;
	}

	return isPreviewVirtualId(id) || isScopedPath(id, scope);
}

function getHookHandler<THook extends (...args: never[]) => unknown>(
	hook: HookLike<THook> | undefined,
): THook | undefined {
	if (typeof hook === "function") {
		return hook;
	}

	return hook?.handler;
}

function wrapHook<THook extends (...args: never[]) => unknown>(
	hook: HookLike<THook>,
	handler: THook,
): HookLike<THook> {
	return typeof hook === "function" ? handler : { ...hook, handler };
}

function wrapPlugin(
	plugin: PreviewPluginOption,
	scope: PreviewScopedPluginScope,
): PreviewPluginOption {
	if (
		!plugin ||
		typeof plugin !== "object" ||
		Array.isArray(plugin) ||
		"then" in plugin
	) {
		return plugin;
	}

	const pluginRecord = plugin as PreviewPlugin;
	const wrappedPlugin = {
		...pluginRecord,
	} as PreviewPlugin;

	const resolveId = getHookHandler<ResolveHook>(
		pluginRecord.resolveId as HookLike<ResolveHook> | undefined,
	);
	if (resolveId) {
		const wrappedResolveId: ResolveHook = function (source, importer, options) {
			if (!shouldHandleResolve(source, importer, options, scope)) {
				return null;
			}

			const result = resolveId.call(this, source, importer, options);
			if (result && typeof (result as Promise<unknown>).then === "function") {
				return Promise.resolve(result).then((resolvedResult) => {
					trackResolvedPackageSourceRoot(resolvedResult, scope);
					return resolvedResult;
				});
			}

			trackResolvedPackageSourceRoot(result, scope);
			return result;
		};
		wrappedPlugin.resolveId = wrapHook(
			pluginRecord.resolveId as HookLike<ResolveHook>,
			wrappedResolveId,
		) as PreviewPlugin["resolveId"];
	}

	const load = getHookHandler<LoadHook>(
		pluginRecord.load as HookLike<LoadHook> | undefined,
	);
	if (load) {
		const wrappedLoad: LoadHook = function (id, options) {
			if (!shouldHandleLoadOrTransform(id, options, scope)) {
				return null;
			}

			return load.call(this, id, options);
		};
		wrappedPlugin.load = wrapHook(
			pluginRecord.load as HookLike<LoadHook>,
			wrappedLoad,
		) as PreviewPlugin["load"];
	}

	const transform = getHookHandler<TransformHook>(
		pluginRecord.transform as HookLike<TransformHook> | undefined,
	);
	if (transform) {
		const wrappedTransform: TransformHook = function (code, id, options) {
			if (!shouldHandleLoadOrTransform(id, options, scope)) {
				return null;
			}

			return transform.call(this, code, id, options);
		};
		wrappedPlugin.transform = wrapHook(
			pluginRecord.transform as HookLike<TransformHook>,
			wrappedTransform,
		) as PreviewPlugin["transform"];
	}

	const handleHotUpdate = getHookHandler<HotUpdateHook>(
		pluginRecord.handleHotUpdate as HookLike<HotUpdateHook> | undefined,
	);
	if (handleHotUpdate) {
		const wrappedHandleHotUpdate: HotUpdateHook = function (context) {
			if (!shouldHandleLoadOrTransform(context.file, undefined, scope)) {
				return undefined;
			}

			return handleHotUpdate.call(this, context);
		};
		wrappedPlugin.handleHotUpdate = wrapHook(
			pluginRecord.handleHotUpdate as HookLike<HotUpdateHook>,
			wrappedHandleHotUpdate,
		) as PreviewPlugin["handleHotUpdate"];
	}

	return wrappedPlugin;
}

export function createScopedPreviewPlugins(
	plugins: PreviewPluginOption | PreviewPluginOption[],
	resolvedConfig: ResolvedPreviewConfig,
) {
	const scope = createPreviewScopedPluginScope(resolvedConfig);
	return flattenPluginOptions(plugins).map((plugin) =>
		wrapPlugin(plugin, scope),
	);
}
