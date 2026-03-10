import { previewEntryPayloads, previewImporters, previewWorkspaceIndex } from "virtual:lattice-preview-workspace-index";
import type { PreviewEngineUpdate, PreviewEntryDescriptor, PreviewEntryPayload } from "@lattice-ui/preview-engine";
import { type PreviewRuntimeIssue, subscribePreviewRuntimeIssues } from "@lattice-ui/preview-runtime";
import React from "react";
import { PreviewApp } from "./PreviewApp";

const PREVIEW_UPDATE_EVENT = "lattice-preview:update";
const RUNTIME_ISSUES_EVENT = "lattice-preview:runtime-issues";

type HotContext = {
  off?: (event: string, callback: (update: PreviewEngineUpdate) => void) => void;
  on: (event: string, callback: (update: PreviewEngineUpdate) => void) => void;
  send?: (event: string, data?: PreviewRuntimeIssue[]) => void;
};

function getHotContext(): HotContext | undefined {
  try {
    const readHotContext = Function("return import.meta.hot") as unknown as () => HotContext | undefined;
    return readHotContext();
  } catch {
    return undefined;
  }
}

export function PreviewWorkspaceApp() {
  const [entries, setEntries] = React.useState<PreviewEntryDescriptor[]>(() => previewWorkspaceIndex.entries);
  const [entryPayloads, setEntryPayloads] = React.useState<Record<string, PreviewEntryPayload>>(
    () => previewEntryPayloads,
  );

  React.useEffect(() => {
    const hot = getHotContext();
    if (!hot) {
      return;
    }

    const handleUpdate = (update: PreviewEngineUpdate) => {
      setEntries(update.workspaceIndex.entries);
      setEntryPayloads((previousPayloads) => {
        const nextPayloads = { ...previousPayloads };
        for (const removedEntryId of update.removedEntryIds) {
          delete nextPayloads[removedEntryId];
        }
        return nextPayloads;
      });

      for (const entryId of update.changedEntryIds) {
        const importer = previewImporters[entryId];
        if (!importer) {
          continue;
        }

        void importer().then((module) => {
          const payload = ("__previewEntryPayload" in module ? module.__previewEntryPayload : undefined) as
            | PreviewEntryPayload
            | undefined;
          if (!payload) {
            return;
          }

          setEntryPayloads((previousPayloads) => ({
            ...previousPayloads,
            [entryId]: payload,
          }));
        });
      }
    };

    hot.on(PREVIEW_UPDATE_EVENT, handleUpdate);
    return () => {
      hot.off?.(PREVIEW_UPDATE_EVENT, handleUpdate);
    };
  }, []);

  React.useEffect(() => {
    const hot = getHotContext();
    if (!hot?.send) {
      return;
    }

    const unsubscribe = subscribePreviewRuntimeIssues((issues) => {
      hot.send?.(RUNTIME_ISSUES_EVENT, issues);
    });

    return () => {
      unsubscribe();
    };
  }, []);

  return (
    <PreviewApp
      entries={entries}
      entryPayloads={entryPayloads}
      loadEntry={(id) => {
        const importer = previewImporters[id];
        if (!importer) {
          return Promise.reject(new Error(`No preview importer registered for \`${id}\`.`));
        }

        return importer().then((module) => {
          const payload = ("__previewEntryPayload" in module ? module.__previewEntryPayload : undefined) as
            | PreviewEntryPayload
            | undefined;

          if (payload) {
            setEntries((previousEntries) =>
              previousEntries.map((entry) => (entry.id === id ? payload.descriptor : entry)),
            );
            setEntryPayloads((previousPayloads) => ({
              ...previousPayloads,
              [id]: payload,
            }));
          }

          return {
            module,
            payload,
          };
        });
      }}
      projectName={previewWorkspaceIndex.projectName}
    />
  );
}
