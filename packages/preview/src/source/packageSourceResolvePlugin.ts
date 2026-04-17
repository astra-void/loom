import fs from "node:fs";
import path from "node:path";
import { createNonMockableSpecifiers } from "./aliasConfig";
import { isBareModuleSpecifier } from "./robloxPackageMockPlugin";

type Plugin = import("vite").Plugin;

type SourcePackageJson = {
	exports?: unknown;
	main?: string;
	module?: string;
	name?: string;
	source?: string;
	types?: string;
};

type SourcePackageResolution = {
	packageName: string;
	packageRoot: string;
	sourceFilePath: string;
	sourceRoot: string;
};

const SOURCE_ENTRY_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx"]);
const UNSUPPORTED_RUNTIME_EXTENSIONS = new Set([".lua", ".luau"]);

function stripQuery(id: string) {
	return id.split("?", 1)[0] ?? id;
}

function normalizePath(filePath: string) {
	try {
		return (
			fs.realpathSync.native?.(filePath) ?? fs.realpathSync(filePath)
		).replace(/\\/g, "/");
	} catch {
		return path.resolve(filePath).replace(/\\/g, "/");
	}
}

function isDeclarationFile(filePath: string) {
	return (
		filePath.endsWith(".d.ts") ||
		filePath.endsWith(".d.tsx") ||
		filePath.endsWith(".d.mts") ||
		filePath.endsWith(".d.cts")
	);
}

function isUnsupportedRuntimeTarget(target: string) {
	const normalizedTarget = stripQuery(target).toLowerCase();
	return (
		isDeclarationFile(normalizedTarget) ||
		UNSUPPORTED_RUNTIME_EXTENSIONS.has(path.posix.extname(normalizedTarget))
	);
}

function collectPackageExportTargets(value: unknown): string[] {
	if (typeof value === "string") {
		return [value];
	}

	if (Array.isArray(value)) {
		return value.flatMap((entry) => collectPackageExportTargets(entry));
	}

	if (!value || typeof value !== "object") {
		return [];
	}

	const record = value as Record<string, unknown>;
	const preferredKeys = ["browser", "import", "module", "default", "require"];
	const preferredTargets = preferredKeys.flatMap((key) =>
		collectPackageExportTargets(record[key]),
	);
	if (preferredTargets.length > 0) {
		return preferredTargets;
	}

	return Object.values(record).flatMap((entry) =>
		collectPackageExportTargets(entry),
	);
}

function splitBarePackageSpecifier(specifier: string) {
	if (!isBareModuleSpecifier(specifier)) {
		return undefined;
	}

	const parts = specifier.split("/");
	if (specifier.startsWith("@")) {
		if (parts.length < 2) {
			return undefined;
		}

		return {
			packageName: `${parts[0]}/${parts[1]}`,
			subpath: parts.slice(2).join("/"),
		};
	}

	const [packageName, ...subpathParts] = parts;
	if (!packageName) {
		return undefined;
	}

	return {
		packageName,
		subpath: subpathParts.join("/"),
	};
}

function findPackageJsonPath(packageName: string, importer?: string) {
	const searchStart = importer
		? path.dirname(path.resolve(stripQuery(importer)))
		: process.cwd();
	let currentDir = searchStart;

	for (;;) {
		const packageJsonPath = path.join(
			currentDir,
			"node_modules",
			packageName,
			"package.json",
		);
		if (fs.existsSync(packageJsonPath)) {
			return packageJsonPath;
		}

		const parentDir = path.dirname(currentDir);
		if (parentDir === currentDir) {
			return undefined;
		}

		currentDir = parentDir;
	}
}

function readPackageJson(packageJsonPath: string) {
	try {
		return JSON.parse(
			fs.readFileSync(packageJsonPath, "utf8"),
		) as SourcePackageJson;
	} catch {
		return undefined;
	}
}

function hasSupportedRuntimeTarget(
	packageJson: SourcePackageJson,
	subpath: string,
) {
	const exportTarget =
		typeof packageJson.exports === "object" && packageJson.exports !== null
			? ((packageJson.exports as Record<string, unknown>)[
					subpath ? `./${subpath}` : "."
				] ?? (subpath ? undefined : packageJson.exports))
			: packageJson.exports;
	const runtimeTargets = [
		...collectPackageExportTargets(exportTarget),
		...(subpath ? [] : [packageJson.module, packageJson.main]),
	].filter((target): target is string => typeof target === "string");

	return runtimeTargets.some((target) => !isUnsupportedRuntimeTarget(target));
}

function createCandidateFilePaths(basePath: string) {
	const normalized = basePath.replace(/\\/g, "/");
	const extension = path.posix.extname(normalized);
	const withoutExtension = extension
		? normalized.slice(0, -extension.length)
		: normalized;

	return [
		normalized,
		...Array.from(
			SOURCE_ENTRY_EXTENSIONS,
			(entryExtension) => `${withoutExtension}${entryExtension}`,
		),
		...Array.from(SOURCE_ENTRY_EXTENSIONS, (entryExtension) =>
			path.posix.join(normalized, `index${entryExtension}`),
		),
	];
}

function resolveExistingSourceFile(candidates: string[]) {
	for (const candidate of candidates) {
		if (!fs.existsSync(candidate)) {
			continue;
		}

		const stat = fs.statSync(candidate);
		if (!stat.isFile()) {
			continue;
		}

		const normalizedCandidate = stripQuery(candidate).toLowerCase();
		if (SOURCE_ENTRY_EXTENSIONS.has(path.extname(normalizedCandidate))) {
			return normalizePath(candidate);
		}
	}

	return undefined;
}

function resolveSourcePackageSpecifier(
	specifier: string,
	importer?: string,
): SourcePackageResolution | undefined {
	const parsedSpecifier = splitBarePackageSpecifier(specifier);
	if (!parsedSpecifier) {
		return undefined;
	}

	const packageJsonPath = findPackageJsonPath(
		parsedSpecifier.packageName,
		importer,
	);
	if (!packageJsonPath) {
		return undefined;
	}

	const packageJson = readPackageJson(packageJsonPath);
	if (!packageJson || typeof packageJson.source !== "string") {
		return undefined;
	}

	if (hasSupportedRuntimeTarget(packageJson, parsedSpecifier.subpath)) {
		return undefined;
	}

	const packageRoot = normalizePath(path.dirname(packageJsonPath));
	const sourceEntryPath = path.resolve(packageRoot, packageJson.source);
	const sourceRoot =
		fs.existsSync(sourceEntryPath) && fs.statSync(sourceEntryPath).isDirectory()
			? normalizePath(sourceEntryPath)
			: normalizePath(path.dirname(sourceEntryPath));
	const sourceCandidates = parsedSpecifier.subpath
		? createCandidateFilePaths(path.join(sourceRoot, parsedSpecifier.subpath))
		: createCandidateFilePaths(sourceEntryPath);
	const sourceFilePath = resolveExistingSourceFile(sourceCandidates);
	if (!sourceFilePath) {
		return undefined;
	}

	return {
		packageName: parsedSpecifier.packageName,
		packageRoot,
		sourceFilePath,
		sourceRoot,
	};
}

export function createPackageSourceResolvePlugin(
	options: { reactAliases?: string[]; reactRobloxAliases?: string[] } = {},
): Plugin {
	const nonMockableSpecifiers = createNonMockableSpecifiers(options);

	return {
		enforce: "pre",
		name: "loom-preview-package-source-resolve",
		resolveId(id, importer, options) {
			if (options?.ssr || nonMockableSpecifiers.has(id)) {
				return undefined;
			}

			const resolution = resolveSourcePackageSpecifier(id, importer);
			if (!resolution) {
				return undefined;
			}

			return {
				id: resolution.sourceFilePath,
				meta: {
					"loom-preview": {
						packageName: resolution.packageName,
						packageRoot: resolution.packageRoot,
						sourceRoot: resolution.sourceRoot,
					},
				},
			};
		},
	};
}
