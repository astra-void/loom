import fs from "node:fs";
import path from "node:path";
import { isFilePathUnderRoot, resolveRealFilePath } from "../pathUtils";

const DIRECTORY_SCAN_EXCLUDES = new Set([
	".git",
	".loom-preview-cache",
	"node_modules",
]);
const PACKAGE_JSON_FILE_NAME = "package.json";

export type WorkspacePackageJson = {
	exports?: unknown;
	main?: string;
	module?: string;
	name?: string;
	source?: string;
	types?: string;
};

export type WorkspacePackage = {
	packageJson: WorkspacePackageJson;
	packageName?: string;
	packageRoot: string;
	sourceRoots: string[];
	tsconfigPaths: string[];
};

export function isPathEqualOrContained(
	rootPath: string,
	candidatePath: string,
) {
	const normalizedRoot = resolveRealFilePath(rootPath);
	const normalizedCandidate = resolveRealFilePath(candidatePath);
	return (
		normalizedRoot === normalizedCandidate ||
		normalizedCandidate.startsWith(`${normalizedRoot}${path.sep}`) ||
		normalizedRoot.startsWith(`${normalizedCandidate}${path.sep}`)
	);
}

export function findWorkspaceRoot(startPaths: string[]) {
	const candidates = startPaths.map((startPath) =>
		resolveRealFilePath(startPath),
	);
	const markerRoots: string[] = [];

	for (const startPath of candidates) {
		let current = startPath;
		while (true) {
			if (
				fs.existsSync(path.join(current, "pnpm-workspace.yaml")) ||
				fs.existsSync(path.join(current, ".git"))
			) {
				markerRoots.push(current);
				break;
			}

			const parent = path.dirname(current);
			if (parent === current) {
				markerRoots.push(startPath);
				break;
			}

			current = parent;
		}
	}

	let commonPath = markerRoots[0] ?? process.cwd();
	for (const candidate of markerRoots.slice(1)) {
		while (!isPathEqualOrContained(commonPath, candidate)) {
			const parent = path.dirname(commonPath);
			if (parent === commonPath) {
				return commonPath;
			}

			commonPath = parent;
		}
	}

	return commonPath;
}

export function findNearestPackageRoot(filePath: string) {
	let current =
		fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()
			? filePath
			: path.dirname(filePath);

	while (true) {
		if (fs.existsSync(path.join(current, PACKAGE_JSON_FILE_NAME))) {
			return resolveRealFilePath(current);
		}

		const parent = path.dirname(current);
		if (parent === current) {
			return resolveRealFilePath(path.dirname(filePath));
		}

		current = parent;
	}
}

export function readPackageJson(packageRoot: string): WorkspacePackageJson {
	const packageJsonPath = path.join(packageRoot, PACKAGE_JSON_FILE_NAME);
	try {
		return JSON.parse(
			fs.readFileSync(packageJsonPath, "utf8"),
		) as WorkspacePackageJson;
	} catch {
		return {};
	}
}

export function scanWorkspacePackages(workspaceRoot: string) {
	const packages = new Map<string, WorkspacePackage>();

	const visit = (dirPath: string) => {
		const entries = fs.readdirSync(dirPath, { withFileTypes: true });
		for (const entry of entries) {
			if (!entry.isDirectory()) {
				continue;
			}

			if (DIRECTORY_SCAN_EXCLUDES.has(entry.name)) {
				continue;
			}

			const entryPath = path.join(dirPath, entry.name);
			const packageJsonPath = path.join(entryPath, PACKAGE_JSON_FILE_NAME);
			if (fs.existsSync(packageJsonPath)) {
				const packageRoot = resolveRealFilePath(entryPath);
				const packageJson = readPackageJson(packageRoot);
				packages.set(packageRoot, {
					packageJson,
					packageName: packageJson.name,
					packageRoot,
					sourceRoots: [],
					tsconfigPaths: [],
				});
			}

			visit(entryPath);
		}
	};

	visit(resolveRealFilePath(workspaceRoot));
	return packages;
}

export function collectPackageExportTargets(value: unknown): string[] {
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
	const preferredKeys = [
		"source",
		"types",
		"import",
		"module",
		"default",
		"require",
	];
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

export function splitBarePackageSpecifier(specifier: string) {
	if (
		specifier.startsWith(".") ||
		specifier.startsWith("/") ||
		specifier.startsWith("#")
	) {
		return undefined;
	}

	const parts = specifier.split("/");
	if (specifier.startsWith("@")) {
		if (parts.length < 2) {
			return undefined;
		}

		const packageName = `${parts[0]}/${parts[1]}`;
		return {
			packageName,
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

export function getWorkspacePackageForFile(
	workspacePackageList: WorkspacePackage[],
	filePath: string,
) {
	const normalizedFilePath = resolveRealFilePath(filePath);
	return workspacePackageList.find((workspacePackage) =>
		isFilePathUnderRoot(workspacePackage.packageRoot, normalizedFilePath),
	);
}
