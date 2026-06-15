import path from "node:path";
import type {
	PreviewCachedArtifactMetadata,
	PreviewEntryPayload,
	PreviewExecutionMode,
	PreviewSourceTarget,
	PreviewTransformOutcome,
} from "../types";
import { ensureDirectory, hashText } from "./fsUtils";

const CACHE_NAMESPACES = [
	"transform",
	"entry-metadata",
	"layout-schema",
	"manifests",
] as const;

export type CacheNamespace = (typeof CACHE_NAMESPACES)[number];

export type BuildVersionFingerprint = {
	compilerVersion: string;
	engineVersion: string;
	previewRuntimeVersion: string;
	protocolVersion: number;
};

export type SourceModuleRecord = {
	configHash: string;
	dependencyGraphHash: string;
	dependencyPaths: string[];
	relativePath: string;
	sourceFilePath: string;
	sourceHash: string;
	target: PreviewSourceTarget;
};

export type CachedModuleArtifactRecord = PreviewCachedArtifactMetadata & {
	artifactKind: "module";
	dependencyGraphHash: string;
	id: string;
	outcome: PreviewTransformOutcome;
	outputCode: string | undefined;
	relativePath: string;
	sourceHash: string;
};

export type CachedEntryMetadataArtifactRecord =
	PreviewCachedArtifactMetadata & {
		artifactKind: "entry-metadata";
		id: string;
		payload: PreviewEntryPayload;
		relativePath: string;
	};

export type PreviewLayoutSchemaSidecar = {
	descriptor: PreviewEntryPayload["descriptor"];
	diagnosticsSummary: PreviewEntryPayload["descriptor"]["diagnosticsSummary"];
	entryId: string;
	graphTrace: PreviewEntryPayload["graphTrace"];
	runtimeAdapter: PreviewEntryPayload["runtimeAdapter"];
	supportsLayoutDebug: boolean;
	transform: PreviewEntryPayload["transform"];
};

export type CachedLayoutSchemaArtifactRecord = PreviewCachedArtifactMetadata & {
	artifactKind: "layout-schema";
	id: string;
	relativePath: string;
	schema: PreviewLayoutSchemaSidecar;
};

type CacheKeyOptions = {
	reactAliases: string[];
	reactRobloxAliases: string[];
	runtimeModule: string;
	runtimeAliases: string[];
	transformMode: PreviewExecutionMode;
	versions: BuildVersionFingerprint;
};

export function getNamespaceDir(cacheDir: string, namespace: CacheNamespace) {
	return path.join(cacheDir, namespace);
}

export function ensureCacheDirectories(cacheDir: string) {
	for (const namespace of CACHE_NAMESPACES) {
		ensureDirectory(getNamespaceDir(cacheDir, namespace));
	}
}

export function createModuleCacheKey(
	record: SourceModuleRecord,
	options: CacheKeyOptions,
) {
	return hashText(
		JSON.stringify({
			artifactKind: "module",
			configHash: record.configHash,
			dependencyGraphHash: record.dependencyGraphHash,
			reactAliases: options.reactAliases,
			reactRobloxAliases: options.reactRobloxAliases,
			protocolVersion: options.versions.protocolVersion,
			relativePath: record.relativePath,
			runtimeModule: options.runtimeModule,
			runtimeAliases: options.runtimeAliases,
			sourceHash: record.sourceHash,
			targetName: record.target.name,
			transformMode: options.transformMode,
			versions: options.versions,
		}),
	);
}

export function createEntryPayloadCacheKey(
	payload: PreviewEntryPayload,
	options: CacheKeyOptions,
) {
	return hashText(
		JSON.stringify({
			artifactKind: "entry-metadata",
			reactAliases: options.reactAliases,
			reactRobloxAliases: options.reactRobloxAliases,
			payload,
			protocolVersion: options.versions.protocolVersion,
			runtimeModule: options.runtimeModule,
			runtimeAliases: options.runtimeAliases,
			targetName: payload.descriptor.targetName,
			transformMode: options.transformMode,
			versions: options.versions,
		}),
	);
}

export function createLayoutSchemaCacheKey(
	schema: PreviewLayoutSchemaSidecar,
	options: CacheKeyOptions,
) {
	return hashText(
		JSON.stringify({
			artifactKind: "layout-schema",
			reactAliases: options.reactAliases,
			reactRobloxAliases: options.reactRobloxAliases,
			protocolVersion: options.versions.protocolVersion,
			runtimeModule: options.runtimeModule,
			runtimeAliases: options.runtimeAliases,
			schema,
			targetName: schema.descriptor.targetName,
			transformMode: options.transformMode,
			versions: options.versions,
		}),
	);
}

export function getModuleCachePath(cacheDir: string, cacheKey: string) {
	return path.join(getNamespaceDir(cacheDir, "transform"), `${cacheKey}.json`);
}

export function getEntryMetadataCachePath(cacheDir: string, cacheKey: string) {
	return path.join(
		getNamespaceDir(cacheDir, "entry-metadata"),
		`${cacheKey}.json`,
	);
}

export function getLayoutSchemaCachePath(cacheDir: string, cacheKey: string) {
	return path.join(
		getNamespaceDir(cacheDir, "layout-schema"),
		`${cacheKey}.json`,
	);
}
