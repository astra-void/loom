import fs from "node:fs";
import path from "node:path";
import {
	buildPreviewArtifacts as buildPreviewArtifactsFromEngine,
	type PreviewBuildArtifactKind as EnginePreviewBuildArtifactKind,
	type PreviewBuildResult as EnginePreviewBuildResult,
	type PreviewBuildDiagnostic,
	type PreviewExecutionMode,
} from "@loom-dev/preview-engine";
import type {
	LoadPreviewConfigOptions,
	PreviewConfig,
	ResolvedPreviewConfig,
} from "./config";
import {
	loadPreviewBuildConfig,
	resolvePreviewConfigObject,
	resolvePreviewRuntimeModule,
} from "./config";
import type { PreviewTransformDiagnostic } from "./transformTypes";

export type PreviewBuildTarget = {
	name: string;
	packageName?: string;
	packageRoot?: string;
	sourceRoot: string;
};

export type PreviewBuildArtifactKind = EnginePreviewBuildArtifactKind;
export type PreviewBuildResult = EnginePreviewBuildResult;

export type UnsupportedPatternCode = PreviewTransformDiagnostic["code"];
export type UnsupportedPatternError = PreviewTransformDiagnostic;

export type BuildPreviewArtifactsOverrides = {
	artifactKinds?: PreviewBuildArtifactKind[];
	outDir?: string;
	runtimeModule?: string;
	transformMode?: PreviewExecutionMode;
};

export type BuildPreviewArtifactsOptions =
	| (LoadPreviewConfigOptions & BuildPreviewArtifactsOverrides)
	| (PreviewConfig & BuildPreviewArtifactsOverrides)
	| (ResolvedPreviewConfig & BuildPreviewArtifactsOverrides);

export type BuildPreviewModulesOptions = {
	targets: PreviewBuildTarget[];
	outDir?: string;
	runtimeModule?: string;
	failOnUnsupported?: boolean;
	transformMode?: PreviewExecutionMode;
};

export type BuildPreviewModulesResult = {
	outDir: string;
	removedFiles?: string[];
	writtenFiles: string[];
};

export class PreviewBuildError extends Error {
	readonly errors: PreviewTransformDiagnostic[];

	constructor(errors: PreviewTransformDiagnostic[]) {
		super(
			`Preview generation failed with ${errors.length} unsupported pattern(s).`,
		);
		this.errors = errors;
		this.name = "PreviewBuildError";
	}
}

function findNearestPackageRoot(startPath: string) {
	let current = path.resolve(startPath);

	while (true) {
		if (fs.existsSync(path.join(current, "package.json"))) {
			return current;
		}

		const parent = path.dirname(current);
		if (parent === current) {
			return path.resolve(startPath);
		}

		current = parent;
	}
}

function inferPreviewSourceTargets(targets: PreviewBuildTarget[]) {
	return targets.map((target) => {
		const sourceRoot = path.resolve(target.sourceRoot);
		const packageRoot = path.resolve(
			target.packageRoot ?? findNearestPackageRoot(sourceRoot),
		);
		return {
			name: target.name,
			packageName: target.packageName ?? target.name,
			packageRoot,
			sourceRoot,
		};
	});
}

function isTransformDiagnostic(
	diagnostic: PreviewBuildDiagnostic,
): diagnostic is PreviewTransformDiagnostic {
	return (
		"line" in diagnostic && "column" in diagnostic && !("phase" in diagnostic)
	);
}

function isResolvedPreviewConfig(
	options: BuildPreviewArtifactsOptions,
): options is ResolvedPreviewConfig & BuildPreviewArtifactsOverrides {
	return (
		typeof options === "object" &&
		options !== null &&
		"targets" in options &&
		Array.isArray(options.targets)
	);
}

function isPreviewConfig(
	options: BuildPreviewArtifactsOptions,
): options is PreviewConfig & BuildPreviewArtifactsOverrides {
	return (
		typeof options === "object" &&
		options !== null &&
		"targetDiscovery" in options
	);
}

async function resolveBuildPreviewConfig(
	options: BuildPreviewArtifactsOptions,
): Promise<ResolvedPreviewConfig> {
	if (isResolvedPreviewConfig(options)) {
		return options;
	}

	if (isPreviewConfig(options)) {
		return resolvePreviewConfigObject(options);
	}

	return loadPreviewBuildConfig(options);
}

function resolveOutputDirectory(outDir: string | undefined, cwd: string) {
	if (!outDir) {
		return undefined;
	}

	return path.isAbsolute(outDir) ? outDir : path.resolve(cwd, outDir);
}

export async function buildPreviewArtifacts(
	options: BuildPreviewArtifactsOptions = {},
): Promise<PreviewBuildResult> {
	const resolvedConfig = await resolveBuildPreviewConfig(options);

	return buildPreviewArtifactsFromEngine({
		artifactKinds: options.artifactKinds ?? ["module"],
		outDir: resolveOutputDirectory(options.outDir, resolvedConfig.cwd),
		projectName: resolvedConfig.projectName,
		runtimeModule: resolvePreviewRuntimeModule(
			options.runtimeModule ?? resolvedConfig.runtimeModule,
			resolvedConfig.configDir,
		),
		targets: resolvedConfig.targets,
		transformMode: options.transformMode ?? resolvedConfig.transformMode,
		workspaceRoot: resolvedConfig.workspaceRoot,
	});
}

export async function buildPreviewModules(
	options: BuildPreviewModulesOptions,
): Promise<BuildPreviewModulesResult> {
	const outDir = options.outDir ?? path.resolve(process.cwd(), "generated");
	const transformMode =
		options.transformMode ??
		(options.failOnUnsupported === false ? "compatibility" : "strict-fidelity");

	if (transformMode === "design-time") {
		throw new Error(
			"buildPreviewModules does not support design-time transform mode.",
		);
	}

	const result = await buildPreviewArtifactsFromEngine({
		artifactKinds: ["module"],
		outDir,
		projectName: "Preview Build",
		runtimeModule: options.runtimeModule,
		targets: inferPreviewSourceTargets(options.targets),
		transformMode,
	});

	const blockingErrors = result.diagnostics.filter(
		(diagnostic): diagnostic is PreviewTransformDiagnostic =>
			isTransformDiagnostic(diagnostic) && diagnostic.blocking,
	);
	if (blockingErrors.length > 0) {
		throw new PreviewBuildError(blockingErrors);
	}

	return {
		outDir,
		removedFiles: result.removedFiles,
		writtenFiles: result.writtenFiles,
	};
}
