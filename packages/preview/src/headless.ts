import { createPreviewEngine, type PreviewEngine, type PreviewEngineSnapshot } from "@lattice-ui/preview-engine";
import type { ResolvedPreviewConfig } from "./config";
import type { StartPreviewServerInput } from "./source/server";
import { resolvePreviewServerConfig } from "./source/server";

export type PreviewHeadlessSnapshot = PreviewEngineSnapshot;

export type PreviewHeadlessSession = {
  dispose(): void;
  engine: PreviewEngine;
  getSnapshot(): PreviewHeadlessSnapshot;
  resolvedConfig: ResolvedPreviewConfig;
};

export type CreatePreviewHeadlessSessionOptions = StartPreviewServerInput;

function getEngineSnapshot(engine: PreviewEngine): PreviewEngineSnapshot {
  if (typeof (engine as PreviewEngine & { getSnapshot?: () => PreviewEngineSnapshot }).getSnapshot === "function") {
    return engine.getSnapshot();
  }

  const workspaceIndex = engine.getWorkspaceIndex();
  return {
    entries: Object.fromEntries(workspaceIndex.entries.map((entry) => [entry.id, engine.getEntryPayload(entry.id)])),
    protocolVersion: workspaceIndex.protocolVersion,
    workspaceIndex,
  };
}

export async function createPreviewHeadlessSession(
  options: CreatePreviewHeadlessSessionOptions = {},
): Promise<PreviewHeadlessSession> {
  const resolvedConfig = await resolvePreviewServerConfig(options);
  const engine = createPreviewEngine({
    projectName: resolvedConfig.projectName,
    runtimeModule: resolvedConfig.runtimeModule,
    targets: resolvedConfig.targets,
    transformMode: resolvedConfig.transformMode,
  });

  return {
    dispose() {
      engine.dispose();
    },
    engine,
    getSnapshot() {
      return getEngineSnapshot(engine);
    },
    resolvedConfig,
  };
}
