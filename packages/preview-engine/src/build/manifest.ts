import path from "node:path";
import type {
	PreviewBuildArtifactKind,
	PreviewBuildOutputManifest,
	PreviewExecutionMode,
	PreviewSourceTarget,
} from "../types";
import { hashText, readJsonFile } from "./fsUtils";

export const BUILD_MANIFEST_FILE = ".loom-preview-manifest.json";
export const BUILD_MANIFEST_VERSION = 2;

export function readOutputManifest(outDir: string): PreviewBuildOutputManifest {
	const manifestPath = path.join(outDir, BUILD_MANIFEST_FILE);
	const manifest = readJsonFile<PreviewBuildOutputManifest>(manifestPath);
	if (
		manifest &&
		manifest.version === BUILD_MANIFEST_VERSION &&
		typeof manifest.files === "object"
	) {
		return manifest;
	}

	return {
		artifactKinds: [],
		files: {},
		version: BUILD_MANIFEST_VERSION,
		workspaceRoot: "",
	};
}

export function createBuildManifestKey(options: {
	artifactKinds: PreviewBuildArtifactKind[];
	reactAliases: string[];
	reactRobloxAliases: string[];
	projectName: string;
	runtimeAliases: string[];
	targets: PreviewSourceTarget[];
	transformMode: PreviewExecutionMode;
}) {
	return hashText(
		JSON.stringify({
			artifactKinds: options.artifactKinds,
			reactAliases: options.reactAliases,
			reactRobloxAliases: options.reactRobloxAliases,
			projectName: options.projectName,
			runtimeAliases: options.runtimeAliases,
			targets: options.targets.map((target) => ({
				exclude: target.exclude,
				include: target.include,
				name: target.name,
				packageRoot: target.packageRoot,
				sourceRoot: target.sourceRoot,
			})),
			transformMode: options.transformMode,
		}),
	);
}
