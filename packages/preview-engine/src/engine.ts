import { createHash } from "node:crypto";
import fs from "node:fs";
import { transformPreviewSource } from "@lattice-ui/compiler";
import type { PreviewRuntimeIssue } from "@lattice-ui/preview-runtime";
import { type DiscoveredEntryState, discoverWorkspaceState, type WorkspaceDiscoverySnapshot } from "./discover";
import { isFilePathUnderRoot, resolveFilePath, resolveRealFilePath } from "./pathUtils";
import { normalizeTransformPreviewSourceResult } from "./transformResult";
import type {
  CreatePreviewEngineOptions,
  PreviewDiagnostic,
  PreviewEngine,
  PreviewEngineSnapshot,
  PreviewEngineUpdate,
  PreviewEngineUpdateListener,
  PreviewEntryPayload,
  PreviewEntryStatus,
  PreviewEntryStatusDetails,
  PreviewExecutionMode,
  PreviewSourceTarget,
  PreviewTransformDiagnostic,
  PreviewTransformOutcome,
  PreviewTransformState,
  PreviewWorkspaceIndex,
} from "./types";
import { PREVIEW_ENGINE_PROTOCOL_VERSION } from "./types";
import { isTransformableSourceFile } from "./workspaceGraph";

type CombinedSnapshotState = WorkspaceDiscoverySnapshot & {
  targetsByFilePath: Map<string, PreviewSourceTarget>;
};

type TargetSnapshotState = WorkspaceDiscoverySnapshot & {
  target: PreviewSourceTarget;
  trackedFilePaths: Set<string>;
};

type CachedPayload = {
  hash: string;
  payload: PreviewEntryPayload;
};

type CachedTransform = {
  diagnostics: PreviewTransformDiagnostic[];
  hash: string;
  outcome: PreviewTransformOutcome;
};

const TRACEABLE_SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".d.ts", ".d.tsx"]);

function hashText(value: string) {
  return createHash("sha1").update(value).digest("hex");
}

function getComparableFilePaths(filePath: string) {
  return [...new Set([resolveFilePath(filePath), resolveRealFilePath(filePath)])];
}

function normalizeTarget(target: PreviewSourceTarget): PreviewSourceTarget {
  return {
    ...target,
    packageName: target.packageName ?? target.name,
    packageRoot: resolveFilePath(target.packageRoot),
    sourceRoot: resolveFilePath(target.sourceRoot),
  };
}

function createTargetKey(target: PreviewSourceTarget) {
  return `${target.name}:${target.packageRoot}:${target.sourceRoot}`;
}

function isTraceableSourceFile(filePath: string) {
  const normalizedFilePath = resolveFilePath(filePath);
  return [...TRACEABLE_SOURCE_EXTENSIONS].some((extension) => normalizedFilePath.endsWith(extension));
}

function buildTargetSnapshot(projectName: string, target: PreviewSourceTarget): TargetSnapshotState {
  const snapshot = discoverWorkspaceState({
    projectName,
    targets: [target],
  });
  const trackedFilePaths = new Set<string>();

  for (const dependencyPaths of snapshot.entryDependencyPathsById.values()) {
    for (const dependencyPath of dependencyPaths) {
      for (const comparablePath of getComparableFilePaths(dependencyPath)) {
        trackedFilePaths.add(comparablePath);
      }
    }
  }

  return {
    ...snapshot,
    target,
    trackedFilePaths,
  };
}

function combineSnapshots(
  projectName: string,
  targets: PreviewSourceTarget[],
  snapshots: Map<string, TargetSnapshotState>,
): CombinedSnapshotState {
  const entryDependencyPathsById = new Map<string, string[]>();
  const entryStatesById = new Map<string, DiscoveredEntryState>();
  const targetsByFilePath = new Map<string, PreviewSourceTarget>();
  const entries: PreviewWorkspaceIndex["entries"] = [];

  for (const target of targets) {
    const snapshot = snapshots.get(createTargetKey(target));
    if (!snapshot) {
      continue;
    }

    for (const [entryId, entryState] of snapshot.entryStatesById.entries()) {
      entryStatesById.set(entryId, entryState);
      entries.push(entryState.descriptor);
    }

    for (const [entryId, dependencyPaths] of snapshot.entryDependencyPathsById.entries()) {
      entryDependencyPathsById.set(entryId, dependencyPaths);
      for (const dependencyPath of dependencyPaths) {
        for (const comparablePath of getComparableFilePaths(dependencyPath)) {
          if (!targetsByFilePath.has(comparablePath)) {
            targetsByFilePath.set(comparablePath, target);
          }
        }
      }
    }
  }

  entries.sort((left, right) => {
    if (left.targetName !== right.targetName) {
      return left.targetName.localeCompare(right.targetName);
    }

    return left.relativePath.localeCompare(right.relativePath);
  });

  return {
    entryDependencyPathsById,
    entryStatesById,
    targetsByFilePath,
    workspaceIndex: {
      entries,
      projectName,
      protocolVersion: PREVIEW_ENGINE_PROTOCOL_VERSION,
      targets,
    },
  };
}

function collectImpactedEntryIds(snapshot: CombinedSnapshotState | undefined, filePaths: string[]) {
  if (!snapshot) {
    return [];
  }

  const normalizedPaths = new Set(filePaths.flatMap((filePath) => getComparableFilePaths(filePath)));
  const impacted = new Set<string>();

  for (const [entryId, dependencyPaths] of snapshot.entryDependencyPathsById.entries()) {
    if (
      dependencyPaths.some((dependencyPath) =>
        getComparableFilePaths(dependencyPath).some((path) => normalizedPaths.has(path)),
      )
    ) {
      impacted.add(entryId);
    }
  }

  return [...impacted].sort((left, right) => left.localeCompare(right));
}

function relativeToPackage(packageRoot: string, filePath: string) {
  const normalizedPackageRoot = resolveRealFilePath(packageRoot).replace(/\\/g, "/");
  const normalizedFilePath = resolveRealFilePath(filePath).replace(/\\/g, "/");
  if (normalizedFilePath.startsWith(`${normalizedPackageRoot}/`)) {
    return normalizedFilePath.slice(normalizedPackageRoot.length + 1);
  }

  return normalizedFilePath;
}

function toTransformDiagnostic(
  entryState: DiscoveredEntryState,
  entryId: string,
  diagnostic: PreviewTransformDiagnostic,
): PreviewDiagnostic {
  return {
    ...(diagnostic.blocking === undefined ? {} : { blocking: diagnostic.blocking }),
    code: diagnostic.code,
    ...(diagnostic.details === undefined ? {} : { details: diagnostic.details }),
    entryId,
    file: diagnostic.file,
    phase: "transform",
    relativeFile: relativeToPackage(entryState.packageRoot, diagnostic.file),
    severity: diagnostic.severity,
    summary: diagnostic.summary,
    ...(diagnostic.symbol === undefined ? {} : { symbol: diagnostic.symbol }),
    target: diagnostic.target,
  };
}

function toRuntimeDiagnostic(issue: PreviewRuntimeIssue): PreviewDiagnostic {
  return {
    blocking: true,
    code: issue.code,
    ...(issue.codeFrame || issue.details
      ? {
          details: [issue.details, issue.codeFrame].filter(Boolean).join("\n\n"),
        }
      : {}),
    entryId: issue.entryId,
    file: issue.file,
    ...(issue.importChain ? { importChain: issue.importChain } : {}),
    phase: issue.phase,
    relativeFile: issue.relativeFile,
    severity: "error",
    summary: issue.summary,
    ...(issue.symbol ? { symbol: issue.symbol } : {}),
    target: issue.target,
  };
}

function createPayloadHash(entryState: DiscoveredEntryState, runtimeIssues: PreviewRuntimeIssue[]) {
  const dependencyHashes = entryState.dependencyPaths
    .map((dependencyPath) => {
      const sourceText = fs.existsSync(dependencyPath) ? fs.readFileSync(dependencyPath, "utf8") : "";
      return `${dependencyPath}:${hashText(sourceText)}`;
    })
    .join("|");

  return hashText(
    JSON.stringify({
      dependencyHashes,
      descriptor: entryState.descriptor,
      discoveryDiagnostics: entryState.discoveryDiagnostics,
      graphTrace: entryState.graphTrace,
      previewHasProps: entryState.previewHasProps,
      runtimeIssues,
    }),
  );
}

function createDefaultTransformOutcome(mode: PreviewExecutionMode): PreviewTransformOutcome {
  if (mode === "design-time") {
    return {
      fidelity: "metadata-only",
      kind: "design-time",
    };
  }

  return {
    fidelity: "preserved",
    kind: "ready",
  };
}

function mergeTransformOutcome(
  current: PreviewTransformOutcome,
  next: PreviewTransformOutcome | undefined,
  mode: PreviewExecutionMode,
): PreviewTransformOutcome {
  if (mode === "design-time") {
    return createDefaultTransformOutcome(mode);
  }

  const normalizedNext = next ?? createDefaultTransformOutcome(mode);
  if (current.kind === "blocked" || normalizedNext.kind === "blocked") {
    return {
      fidelity: "degraded",
      kind: "blocked",
    };
  }

  if (normalizedNext.kind === "mocked" || current.kind === "mocked") {
    return {
      fidelity: normalizedNext.fidelity === "degraded" || current.fidelity === "degraded" ? "degraded" : "preserved",
      kind: "mocked",
    };
  }

  if (normalizedNext.kind === "compatibility" || current.kind === "compatibility") {
    return {
      fidelity: "degraded",
      kind: "compatibility",
    };
  }

  return {
    fidelity: normalizedNext.fidelity === "degraded" || current.fidelity === "degraded" ? "degraded" : "preserved",
    kind: "ready",
  };
}

function computeTransformState(
  entryState: DiscoveredEntryState,
  entryId: string,
  runtimeModule: string,
  mode: PreviewExecutionMode,
  transformCache: Map<string, CachedTransform>,
) {
  const diagnostics = new Map<string, PreviewDiagnostic>();
  let outcome = createDefaultTransformOutcome(mode);

  for (const dependencyPath of entryState.dependencyPaths) {
    if (!fs.existsSync(dependencyPath) || !isTransformableSourceFile(dependencyPath)) {
      continue;
    }

    const sourceText = fs.readFileSync(dependencyPath, "utf8");
    const sourceHash = hashText(sourceText);
    const cacheKey = `${mode}:${runtimeModule}:${entryState.target.targetName}:${dependencyPath}`;
    const cachedTransform = transformCache.get(cacheKey);
    const transformed =
      cachedTransform?.hash === sourceHash
        ? cachedTransform
        : (() => {
            const result = normalizeTransformPreviewSourceResult(
              transformPreviewSource(sourceText, {
                filePath: dependencyPath,
                runtimeModule,
                target: entryState.target.targetName,
              }),
              mode,
            );
            const nextCachedTransform = {
              diagnostics: result.diagnostics,
              hash: sourceHash,
              outcome: result.outcome,
            } satisfies CachedTransform;
            transformCache.set(cacheKey, nextCachedTransform);
            return nextCachedTransform;
          })();

    outcome = mergeTransformOutcome(outcome, transformed.outcome, mode);

    for (const diagnostic of transformed.diagnostics) {
      const nextDiagnostic = toTransformDiagnostic(entryState, entryId, diagnostic);
      const key = `${nextDiagnostic.file}:${nextDiagnostic.code}:${nextDiagnostic.summary}:${nextDiagnostic.symbol ?? ""}`;
      diagnostics.set(key, nextDiagnostic);
    }
  }

  return {
    diagnostics: [...diagnostics.values()].sort((left, right) => {
      if (left.relativeFile !== right.relativeFile) {
        return left.relativeFile.localeCompare(right.relativeFile);
      }

      return left.code.localeCompare(right.code);
    }),
    outcome,
  };
}

function mergeDiagnostics(
  entryState: DiscoveredEntryState,
  transformDiagnostics: PreviewDiagnostic[],
  runtimeDiagnostics: PreviewDiagnostic[],
) {
  const diagnostics = [...entryState.discoveryDiagnostics, ...transformDiagnostics, ...runtimeDiagnostics];
  const byPhase = {
    discovery: 0,
    layout: 0,
    runtime: 0,
    transform: 0,
  } satisfies Record<PreviewDiagnostic["phase"], number>;

  for (const diagnostic of diagnostics) {
    byPhase[diagnostic.phase] += 1;
  }

  return {
    diagnostics,
    diagnosticsSummary: {
      byPhase,
      hasBlocking: diagnostics.some((diagnostic) => diagnostic.blocking === true || diagnostic.severity === "error"),
      total: diagnostics.length,
    },
  };
}

function resolvePayloadStatus(
  baseStatus: PreviewEntryStatus,
  baseStatusDetails: PreviewEntryStatusDetails,
  transform: PreviewTransformState,
  transformDiagnostics: PreviewDiagnostic[],
  runtimeDiagnostics: PreviewDiagnostic[],
): Pick<PreviewEntryPayload["descriptor"], "status" | "statusDetails"> {
  if (baseStatus === "needs_harness" || baseStatus === "ambiguous") {
    return {
      status: baseStatus,
      statusDetails: baseStatusDetails,
    };
  }

  if (transform.outcome.kind === "blocked" || transform.outcome.kind === "design-time") {
    return {
      status: "blocked_by_transform",
      statusDetails: {
        blockingCodes: transformDiagnostics
          .filter((diagnostic) => diagnostic.blocking)
          .map((diagnostic) => diagnostic.code),
        kind: "blocked_by_transform",
        reason: "transform-diagnostics",
      },
    };
  }

  const runtimeIssues = runtimeDiagnostics.filter((diagnostic) => diagnostic.phase === "runtime");
  if (runtimeIssues.length > 0) {
    return {
      status: "blocked_by_runtime",
      statusDetails: {
        issueCodes: runtimeIssues.map((diagnostic) => diagnostic.code),
        kind: "blocked_by_runtime",
        reason: "runtime-issues",
      },
    };
  }

  const layoutIssues = runtimeDiagnostics.filter((diagnostic) => diagnostic.phase === "layout");
  if (layoutIssues.length > 0) {
    return {
      status: "blocked_by_layout",
      statusDetails: {
        issueCodes: layoutIssues.map((diagnostic) => diagnostic.code),
        kind: "blocked_by_layout",
        reason: "layout-issues",
      },
    };
  }

  return {
    status: "ready",
    statusDetails: {
      kind: "ready",
    },
  };
}

function groupRuntimeIssues(issues: PreviewRuntimeIssue[]) {
  const issuesByEntryId = new Map<string, PreviewRuntimeIssue[]>();

  for (const issue of issues) {
    const entryId = issue.entryId;
    if (!entryId) {
      continue;
    }

    const existing = issuesByEntryId.get(entryId) ?? [];
    existing.push(issue);
    issuesByEntryId.set(entryId, existing);
  }

  for (const [entryId, entryIssues] of issuesByEntryId.entries()) {
    issuesByEntryId.set(
      entryId,
      [...entryIssues].sort((left, right) => {
        if (left.phase !== right.phase) {
          return left.phase.localeCompare(right.phase);
        }

        if (left.code !== right.code) {
          return left.code.localeCompare(right.code);
        }

        return left.summary.localeCompare(right.summary);
      }),
    );
  }

  return issuesByEntryId;
}

function collectChangedEntryIds(
  previousWorkspaceIndex: PreviewWorkspaceIndex,
  nextWorkspaceIndex: PreviewWorkspaceIndex,
  initialChangedEntryIds: Iterable<string>,
) {
  const changedEntryIds = new Set<string>(initialChangedEntryIds);
  const previousEntriesById = new Map(previousWorkspaceIndex.entries.map((entry) => [entry.id, entry]));

  for (const entry of nextWorkspaceIndex.entries) {
    const previousEntry = previousEntriesById.get(entry.id);
    if (!previousEntry || JSON.stringify(previousEntry) !== JSON.stringify(entry)) {
      changedEntryIds.add(entry.id);
    }
  }

  return [...changedEntryIds].sort((left, right) => left.localeCompare(right));
}

class PreviewEngineImpl implements PreviewEngine {
  private readonly listeners = new Set<PreviewEngineUpdateListener>();
  private readonly normalizedTargets: PreviewSourceTarget[];
  private readonly payloadCache = new Map<string, CachedPayload>();
  private readonly runtimeIssuesByEntryId = new Map<string, PreviewRuntimeIssue[]>();
  private readonly targetSnapshots = new Map<string, TargetSnapshotState>();
  private readonly transformCache = new Map<string, CachedTransform>();
  private snapshot: CombinedSnapshotState;

  public constructor(private readonly options: CreatePreviewEngineOptions) {
    this.normalizedTargets = options.targets.map(normalizeTarget);
    for (const target of this.normalizedTargets) {
      this.targetSnapshots.set(createTargetKey(target), buildTargetSnapshot(options.projectName, target));
    }
    this.snapshot = combineSnapshots(options.projectName, this.normalizedTargets, this.targetSnapshots);
  }

  public dispose() {
    this.listeners.clear();
    this.payloadCache.clear();
    this.runtimeIssuesByEntryId.clear();
    this.targetSnapshots.clear();
    this.transformCache.clear();
  }

  public getEntryPayload(entryId: string) {
    const entryState = this.snapshot.entryStatesById.get(entryId);
    if (!entryState) {
      throw new Error(`Unknown preview entry: ${entryId}`);
    }

    const runtimeIssues = this.runtimeIssuesByEntryId.get(entryId) ?? [];
    const payloadHash = createPayloadHash(entryState, runtimeIssues);
    const cachedPayload = this.payloadCache.get(entryId);
    if (cachedPayload?.hash === payloadHash) {
      return cachedPayload.payload;
    }

    const transform = computeTransformState(
      entryState,
      entryId,
      this.options.runtimeModule ?? "virtual:lattice-preview-runtime",
      this.options.transformMode ?? "strict-fidelity",
      this.transformCache,
    );
    const runtimeDiagnostics = runtimeIssues.map(toRuntimeDiagnostic);
    const merged = mergeDiagnostics(entryState, transform.diagnostics, runtimeDiagnostics);
    const resolvedStatus = resolvePayloadStatus(
      entryState.descriptor.status,
      entryState.descriptor.statusDetails,
      {
        mode: this.options.transformMode ?? "strict-fidelity",
        outcome: transform.outcome,
      },
      transform.diagnostics,
      runtimeDiagnostics,
    );
    const payload: PreviewEntryPayload = {
      descriptor: {
        ...entryState.descriptor,
        diagnosticsSummary: merged.diagnosticsSummary,
        status: resolvedStatus.status,
        statusDetails: resolvedStatus.statusDetails,
      },
      diagnostics: merged.diagnostics,
      graphTrace: entryState.graphTrace,
      protocolVersion: PREVIEW_ENGINE_PROTOCOL_VERSION,
      runtimeAdapter: {
        kind: "react-dom",
        moduleId: this.options.runtimeModule ?? "virtual:lattice-preview-runtime",
      },
      transform: {
        mode: this.options.transformMode ?? "strict-fidelity",
        outcome: transform.outcome,
      },
    };

    this.payloadCache.set(entryId, {
      hash: payloadHash,
      payload,
    });

    return payload;
  }

  public getSnapshot(): PreviewEngineSnapshot {
    const workspaceIndex = this.getWorkspaceIndex();
    return {
      entries: Object.fromEntries(workspaceIndex.entries.map((entry) => [entry.id, this.getEntryPayload(entry.id)])),
      protocolVersion: PREVIEW_ENGINE_PROTOCOL_VERSION,
      workspaceIndex,
    };
  }

  public isTrackedSourceFile(filePath: string) {
    const comparablePaths = getComparableFilePaths(filePath);
    if (comparablePaths.some((candidatePath) => this.snapshot.targetsByFilePath.has(candidatePath))) {
      return true;
    }

    if (!isTraceableSourceFile(filePath)) {
      return false;
    }

    return this.normalizedTargets.some((target) =>
      comparablePaths.some((candidatePath) => isFilePathUnderRoot(target.sourceRoot, candidatePath)),
    );
  }

  public getWorkspaceIndex() {
    const entries = this.snapshot.workspaceIndex.entries.map((entry) => this.getEntryPayload(entry.id).descriptor);
    return {
      ...this.snapshot.workspaceIndex,
      entries,
    } satisfies PreviewWorkspaceIndex;
  }

  public invalidateSourceFiles(filePaths: string[]) {
    const normalizedPaths = [...new Set(filePaths.flatMap((filePath) => getComparableFilePaths(filePath)))];
    const previousSnapshot = this.snapshot;
    const previousWorkspaceIndex = this.getWorkspaceIndex();
    const previousImpactedIds = collectImpactedEntryIds(previousSnapshot, normalizedPaths);
    const affectedTargets = this.normalizedTargets.filter((target) =>
      normalizedPaths.some(
        (filePath) =>
          isFilePathUnderRoot(target.sourceRoot, filePath) ||
          this.targetSnapshots.get(createTargetKey(target))?.trackedFilePaths.has(filePath),
      ),
    );

    if (affectedTargets.length === 0) {
      return {
        changedEntryIds: [],
        executionChangedEntryIds: [],
        protocolVersion: PREVIEW_ENGINE_PROTOCOL_VERSION,
        registryChangedEntryIds: [],
        removedEntryIds: [],
        requiresFullReload: false,
        workspaceChanged: false,
        workspaceIndex: previousWorkspaceIndex,
      } satisfies PreviewEngineUpdate;
    }

    for (const target of affectedTargets) {
      this.targetSnapshots.set(createTargetKey(target), buildTargetSnapshot(this.options.projectName, target));
    }

    this.snapshot = combineSnapshots(this.options.projectName, this.normalizedTargets, this.targetSnapshots);

    const removedEntryIds = [...previousSnapshot.entryStatesById.keys()]
      .filter((entryId) => !this.snapshot.entryStatesById.has(entryId))
      .sort((left, right) => left.localeCompare(right));
    for (const removedEntryId of removedEntryIds) {
      this.runtimeIssuesByEntryId.delete(removedEntryId);
    }

    const nextWorkspaceIndex = this.getWorkspaceIndex();
    const nextImpactedIds = collectImpactedEntryIds(this.snapshot, normalizedPaths);
    const registryChangedEntryIds = collectChangedEntryIds(previousWorkspaceIndex, nextWorkspaceIndex, [
      ...previousImpactedIds,
      ...nextImpactedIds,
    ]);

    for (const entryId of [...registryChangedEntryIds, ...removedEntryIds]) {
      this.payloadCache.delete(entryId);
    }

    const update: PreviewEngineUpdate = {
      changedEntryIds: registryChangedEntryIds,
      executionChangedEntryIds: [],
      protocolVersion: PREVIEW_ENGINE_PROTOCOL_VERSION,
      registryChangedEntryIds,
      removedEntryIds,
      requiresFullReload: false,
      workspaceChanged: registryChangedEntryIds.length > 0 || removedEntryIds.length > 0,
      workspaceIndex: nextWorkspaceIndex,
    };

    this.emitUpdate(update);
    return update;
  }

  public onUpdate(listener: PreviewEngineUpdateListener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public replaceRuntimeIssues(issues: PreviewRuntimeIssue[]) {
    const previousWorkspaceIndex = this.getWorkspaceIndex();
    const previousEntryIds = new Set(this.runtimeIssuesByEntryId.keys());
    const nextRuntimeIssuesByEntryId = groupRuntimeIssues(
      issues.filter((issue) => this.snapshot.entryStatesById.has(issue.entryId)),
    );

    this.runtimeIssuesByEntryId.clear();
    for (const [entryId, entryIssues] of nextRuntimeIssuesByEntryId.entries()) {
      this.runtimeIssuesByEntryId.set(entryId, entryIssues);
    }

    const changedEntryIds = new Set<string>([...previousEntryIds, ...nextRuntimeIssuesByEntryId.keys()]);
    for (const entryId of changedEntryIds) {
      this.payloadCache.delete(entryId);
    }

    const nextWorkspaceIndex = this.getWorkspaceIndex();
    const executionChangedEntryIds = collectChangedEntryIds(
      previousWorkspaceIndex,
      nextWorkspaceIndex,
      changedEntryIds,
    );
    const update: PreviewEngineUpdate = {
      changedEntryIds: executionChangedEntryIds,
      executionChangedEntryIds,
      protocolVersion: PREVIEW_ENGINE_PROTOCOL_VERSION,
      registryChangedEntryIds: [],
      removedEntryIds: [],
      requiresFullReload: false,
      workspaceChanged: false,
      workspaceIndex: nextWorkspaceIndex,
    };

    this.emitUpdate(update);
    return update;
  }

  private emitUpdate(update: PreviewEngineUpdate) {
    for (const listener of this.listeners) {
      listener(update);
    }
  }
}

export function createPreviewEngine(options: CreatePreviewEngineOptions): PreviewEngine {
  return new PreviewEngineImpl({
    ...options,
    transformMode: options.transformMode ?? "strict-fidelity",
  });
}
