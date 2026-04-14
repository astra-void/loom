import { type PreviewBuildArtifactKind as EnginePreviewBuildArtifactKind, type PreviewBuildResult as EnginePreviewBuildResult, type PreviewExecutionMode } from "@loom-dev/preview-engine";
import type { LoadPreviewConfigOptions, PreviewConfig, ResolvedPreviewConfig } from "./config";
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
export type BuildPreviewArtifactsOptions = (LoadPreviewConfigOptions & BuildPreviewArtifactsOverrides) | (PreviewConfig & BuildPreviewArtifactsOverrides) | (ResolvedPreviewConfig & BuildPreviewArtifactsOverrides);
export type BuildPreviewModulesOptions = {
    reactAliases?: string[];
    reactRobloxAliases?: string[];
    targets: PreviewBuildTarget[];
    outDir?: string;
    runtimeModule?: string;
    runtimeAliases?: string[];
    failOnUnsupported?: boolean;
    transformMode?: PreviewExecutionMode;
};
export type BuildPreviewModulesResult = {
    outDir: string;
    removedFiles?: string[];
    writtenFiles: string[];
};
export declare class PreviewBuildError extends Error {
    readonly errors: PreviewTransformDiagnostic[];
    constructor(errors: PreviewTransformDiagnostic[]);
}
export declare function buildPreviewArtifacts(options?: BuildPreviewArtifactsOptions): Promise<PreviewBuildResult>;
export declare function buildPreviewModules(options: BuildPreviewModulesOptions): Promise<BuildPreviewModulesResult>;
