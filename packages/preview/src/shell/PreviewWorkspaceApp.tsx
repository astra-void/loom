import {
	previewEntryPayloads,
	previewImporters,
	previewWorkspaceIndex,
} from "virtual:loom-preview-workspace-index";
import type {
	PreviewEngineUpdate,
	PreviewEntryDescriptor,
	PreviewEntryPayload,
} from "@loom-dev/preview-engine";
import {
	type PreviewRuntimeIssue,
	subscribePreviewRuntimeIssues,
} from "@loom-dev/preview-runtime";
import React from "react";
import { loadPreviewModule } from "./loadPreviewModule";
import { PreviewApp } from "./PreviewApp";

const PREVIEW_UPDATE_EVENT = "loom-preview:update";
const RUNTIME_ISSUES_EVENT = "loom-preview:runtime-issues";

type HotContext = {
	off?: (
		event: string,
		callback: (update: PreviewEngineUpdate) => void,
	) => void;
	on: (event: string, callback: (update: PreviewEngineUpdate) => void) => void;
	send?: (event: string, data?: PreviewRuntimeIssue[]) => void;
};

function getHotContext(): HotContext | undefined {
	try {
		const readHotContext = Function(
			"return import.meta.hot",
		) as unknown as () => HotContext | undefined;
		return readHotContext();
	} catch {
		return undefined;
	}
}

export function PreviewWorkspaceApp() {
	const [entries, setEntries] = React.useState<PreviewEntryDescriptor[]>(
		() => previewWorkspaceIndex.entries,
	);
	const [entryPayloads, setEntryPayloads] = React.useState<
		Record<string, PreviewEntryPayload>
	>(() => previewEntryPayloads);

	const applyEntryPayload = React.useCallback(
		(entryId: string, payload: PreviewEntryPayload | undefined) => {
			if (!payload) {
				return;
			}

			setEntries((previousEntries) =>
				previousEntries.map((entry) =>
					entry.id === entryId ? payload.descriptor : entry,
				),
			);
			setEntryPayloads((previousPayloads) => ({
				...previousPayloads,
				[entryId]: payload,
			}));
		},
		[],
	);

	const loadEntry = React.useCallback(
		(id: string) => {
			const importer = previewImporters[id];
			if (!importer) {
				return Promise.reject(
					new Error(`No preview importer registered for \`${id}\`.`),
				);
			}

			return loadPreviewModule(importer).then((module) => {
				const payload = (
					"__previewEntryPayload" in module
						? module.__previewEntryPayload
						: undefined
				) as PreviewEntryPayload | undefined;
				applyEntryPayload(id, payload);

				return {
					module,
					payload,
				};
			});
		},
		[applyEntryPayload],
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

				void loadPreviewModule(importer)
					.then((module) => {
						const payload = (
							"__previewEntryPayload" in module
								? module.__previewEntryPayload
								: undefined
						) as PreviewEntryPayload | undefined;
						applyEntryPayload(entryId, payload);
					})
					.catch(() => {});
			}
		};

		hot.on(PREVIEW_UPDATE_EVENT, handleUpdate);
		return () => {
			hot.off?.(PREVIEW_UPDATE_EVENT, handleUpdate);
		};
	}, [applyEntryPayload]);

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
			loadEntry={loadEntry}
			projectName={previewWorkspaceIndex.projectName}
		/>
	);
}
