import type { PreviewRuntimeIssue } from "@lattice-ui/preview-runtime";
import type { ComponentType } from "react";
import type { PreviewTransformDiagnostic, PreviewTransformMode, PreviewTransformOutcome } from "./transformTypes";

export type { PreviewTransformDiagnostic, PreviewTransformMode, PreviewTransformOutcome } from "./transformTypes";

export const PREVIEW_ENGINE_PROTOCOL_VERSION = 4;

export type PreviewPropKind =
  | "array"
  | "bigint"
  | "boolean"
  | "function"
  | "literal"
  | "number"
  | "object"
  | "react-element"
  | "react-node"
  | "string"
  | "union"
  | "unknown";

export type PreviewPropMetadata = {
  elementType?: PreviewPropMetadata;
  kind: PreviewPropKind;
  literal?: boolean | number | string | undefined;
  properties?: Record<string, PreviewPropMetadata>;
  required: boolean;
  type: string;
  unionTypes?: PreviewPropMetadata[];
};

export type PreviewComponentPropsMetadata = {
  componentName: string;
  props: Record<string, PreviewPropMetadata>;
};

export type PreviewDefinition<Props = Record<string, unknown>> = {
  entry?: ComponentType<Props>;
  title?: string;
  props?: Props;
  render?: () => unknown;
};

export type PreviewSourceTarget = {
  name: string;
  packageName?: string;
  packageRoot: string;
  sourceRoot: string;
};

export type PreviewExecutionMode = PreviewTransformMode;

export type PreviewEntryStatus =
  | "ready"
  | "needs_harness"
  | "ambiguous"
  | "blocked_by_transform"
  | "blocked_by_runtime"
  | "blocked_by_layout";

export type PreviewEntryStatusDetails =
  | {
      kind: "ready";
    }
  | {
      candidates?: string[];
      kind: "needs_harness";
      reason: "missing-explicit-contract" | "no-component-export";
    }
  | {
      candidates: string[];
      kind: "ambiguous";
      reason: "ambiguous-exports";
    }
  | {
      blockingCodes: string[];
      kind: "blocked_by_transform";
      reason: "transform-diagnostics";
    }
  | {
      issueCodes: string[];
      kind: "blocked_by_runtime";
      reason: "runtime-issues";
    }
  | {
      issueCodes: string[];
      kind: "blocked_by_layout";
      reason: "layout-issues";
    };

export type PreviewDiagnosticPhase = "discovery" | "layout" | "runtime" | "transform";
export type PreviewDiagnosticSeverity = "error" | "info" | "warning";

export type PreviewDiscoveryDiagnosticCode =
  | "AMBIGUOUS_COMPONENT_EXPORTS"
  | "DECLARATION_ONLY_BOUNDARY"
  | "GRAPH_CYCLE_DETECTED"
  | "MISSING_EXPLICIT_PREVIEW_CONTRACT"
  | "NO_COMPONENT_EXPORTS"
  | "PREVIEW_RENDER_MISSING"
  | "UNRESOLVED_IMPORT";

export type PreviewRenderTarget =
  | {
      kind: "component";
      exportName: "default" | string;
      usesPreviewProps: boolean;
    }
  | {
      contract: "preview.render";
      kind: "harness";
    }
  | {
      kind: "none";
      reason: "ambiguous-exports" | "missing-explicit-contract" | "no-component-export";
      candidates?: string[];
    };

export type PreviewSelection =
  | {
      contract: "preview.entry" | "preview.render";
      kind: "explicit";
    }
  | {
      kind: "unresolved";
      reason: "ambiguous-exports" | "missing-explicit-contract" | "no-component-export";
    };

export type PreviewGraphStopReason =
  | "declaration-only-boundary"
  | "external-dependency"
  | "graph-cycle"
  | "unresolved-import";

export type PreviewEntryCapabilities = {
  supportsHotUpdate: boolean;
  supportsLayoutDebug: boolean;
  supportsPropsEditing: boolean;
  supportsRuntimeMock: boolean;
};

export type PreviewDiagnosticsSummary = {
  byPhase: Record<PreviewDiagnosticPhase, number>;
  hasBlocking: boolean;
  total: number;
};

export type PreviewDiagnostic = {
  blocking?: boolean;
  code: PreviewDiscoveryDiagnosticCode | PreviewTransformDiagnostic["code"] | string;
  details?: string;
  entryId: string;
  file: string;
  importChain?: string[];
  phase: PreviewDiagnosticPhase;
  relativeFile: string;
  severity: PreviewDiagnosticSeverity;
  summary: string;
  symbol?: string;
  target: string;
};

export type PreviewGraphImportEdge = {
  crossesPackageBoundary: boolean;
  importerFile: string;
  importerProjectConfigPath?: string;
  originalResolvedFile?: string;
  resolution: "resolved" | "stopped";
  resolutionKind?:
    | "declaration-file"
    | "external-dependency"
    | "project-reference-source"
    | "source-file"
    | "workspace-package";
  resolvedFile?: string;
  resolvedProjectConfigPath?: string;
  specifier: string;
  stopReason?: PreviewGraphStopReason;
};

export type PreviewSelectionTrace = {
  contract?: "preview.entry" | "preview.render";
  importChain: string[];
  requestedSymbol?: string;
  resolvedExportName?: string;
  symbolChain: string[];
};

export type PreviewGraphTrace = {
  boundaryHops: Array<{
    fromFile: string;
    fromPackageRoot: string;
    toFile: string;
    toPackageRoot: string;
  }>;
  imports: PreviewGraphImportEdge[];
  selection: PreviewSelectionTrace;
  stopReason?: PreviewGraphStopReason;
  traversedProjects?: Array<{
    configPath: string;
    packageName?: string;
    packageRoot: string;
  }>;
};

export type PreviewEntryDescriptor = {
  capabilities: PreviewEntryCapabilities;
  candidateExportNames: string[];
  diagnosticsSummary: PreviewDiagnosticsSummary;
  hasDefaultExport: boolean;
  hasPreviewExport: boolean;
  id: string;
  packageName: string;
  relativePath: string;
  renderTarget: PreviewRenderTarget;
  selection: PreviewSelection;
  sourceFilePath: string;
  status: PreviewEntryStatus;
  statusDetails: PreviewEntryStatusDetails;
  targetName: string;
  title: string;
};

export type PreviewRuntimeAdapter = {
  kind: "react-dom";
  moduleId: string;
};

export type PreviewTransformState = {
  mode: PreviewExecutionMode;
  outcome: PreviewTransformOutcome;
};

export type PreviewEntryPayload = {
  descriptor: PreviewEntryDescriptor;
  diagnostics: PreviewDiagnostic[];
  graphTrace: PreviewGraphTrace;
  propsMetadata?: PreviewComponentPropsMetadata;
  protocolVersion: number;
  runtimeAdapter: PreviewRuntimeAdapter;
  transform: PreviewTransformState;
};

export type PreviewWorkspaceIndex = {
  entries: PreviewEntryDescriptor[];
  projectName: string;
  protocolVersion: number;
  targets: PreviewSourceTarget[];
};

export type PreviewEngineSnapshot = {
  entries: Record<string, PreviewEntryPayload>;
  protocolVersion: number;
  workspaceIndex: PreviewWorkspaceIndex;
};

export type PreviewBuildArtifactKind = "module" | "entry-metadata" | "layout-schema";

export type PreviewBuildDiagnostic = PreviewDiagnostic | PreviewTransformDiagnostic;

export type PreviewBuiltArtifact = {
  cacheKey: string;
  diagnosticsSummary: PreviewDiagnosticsSummary;
  id: string;
  kind: PreviewBuildArtifactKind;
  materializedPath?: string;
  relativePath: string;
  reusedFromCache: boolean;
  sourceFilePath: string;
  targetName: string;
};

export type PreviewBuildOptions = {
  artifactKinds: PreviewBuildArtifactKind[];
  cacheDir?: string;
  concurrency?: number;
  outDir?: string;
  projectName: string;
  runtimeModule?: string;
  targets: PreviewSourceTarget[];
  transformMode?: PreviewExecutionMode;
  workspaceRoot?: string;
};

export type PreviewBuildResult = {
  builtArtifacts: PreviewBuiltArtifact[];
  cacheDir: string;
  diagnostics: PreviewBuildDiagnostic[];
  outDir?: string;
  removedFiles: string[];
  reusedArtifacts: PreviewBuiltArtifact[];
  writtenFiles: string[];
};

export type PreviewBuildOutputManifest = {
  artifactKinds: PreviewBuildArtifactKind[];
  files: Record<
    string,
    {
      cacheKey: string;
      sourceFilePath: string;
    }
  >;
  version: 2;
  workspaceRoot: string;
};

export type PreviewCachedArtifactMetadata = {
  artifactKind: PreviewBuildArtifactKind;
  cacheKey: string;
  createdAt: string;
  diagnostics: PreviewBuildDiagnostic[];
  engineVersion: number;
  sourceFilePath: string;
  targetName: string;
};

export type PreviewEngineUpdate = {
  changedEntryIds: string[];
  executionChangedEntryIds: string[];
  protocolVersion: number;
  registryChangedEntryIds: string[];
  removedEntryIds: string[];
  requiresFullReload: boolean;
  workspaceChanged: boolean;
  workspaceIndex: PreviewWorkspaceIndex;
};

export type CreatePreviewEngineOptions = {
  projectName: string;
  runtimeModule?: string;
  targets: PreviewSourceTarget[];
  transformMode?: PreviewExecutionMode;
};

export type PreviewEngineUpdateListener = (update: PreviewEngineUpdate) => void;

export interface PreviewEngine {
  dispose(): void;
  getEntryPayload(entryId: string): PreviewEntryPayload;
  getSnapshot(): PreviewEngineSnapshot;
  isTrackedSourceFile(filePath: string): boolean;
  getWorkspaceIndex(): PreviewWorkspaceIndex;
  invalidateSourceFiles(filePaths: string[]): PreviewEngineUpdate;
  onUpdate(listener: PreviewEngineUpdateListener): () => void;
  replaceRuntimeIssues(issues: PreviewRuntimeIssue[]): PreviewEngineUpdate;
}
