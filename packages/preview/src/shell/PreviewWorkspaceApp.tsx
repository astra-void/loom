import type {
	PreviewEngineUpdate,
	PreviewEntryPayload,
} from "@loom-dev/preview-engine";
import {
	type PreviewRuntimeIssue,
	subscribePreviewRuntimeIssues,
} from "@loom-dev/preview-runtime";
import React from "react";
import {
	type PreviewWorkspaceModuleImporter,
	loadPreviewModule,
} from "./loadPreviewModule";
import { PreviewApp } from "./PreviewApp";
import {
	getInitialPreviewWorkspaceSnapshot,
	reloadPreviewWorkspaceSnapshot,
} from "./workspaceSnapshot";

const PREVIEW_UPDATE_EVENT = "loom-preview:update";
const RUNTIME_ISSUES_EVENT = "loom-preview:runtime-issues";
const HOT_CONTEXT_GLOBAL_KEY = "__loomPreviewHot";

type HotContext = {
	off?: (
		event: string,
		callback: (update: PreviewEngineUpdate) => void,
	) => void;
	on: (event: string, callback: (update: PreviewEngineUpdate) => void) => void;
	send?: (event: string, data?: PreviewRuntimeIssue[]) => void;
};

function getHotContext(): HotContext | undefined {
	const globalRecord = globalThis as typeof globalThis & {
		[HOT_CONTEXT_GLOBAL_KEY]?: HotContext | null;
	};

	return globalRecord[HOT_CONTEXT_GLOBAL_KEY] ?? undefined;
}

function reloadPreviewPage() {
	if (typeof window === "undefined") {
		return;
	}

	window.location.reload();
}

export function PreviewWorkspaceApp() {
	const initialWorkspaceSnapshotRef = React.useRef<ReturnType<
		typeof getInitialPreviewWorkspaceSnapshot
	> | null>(null);
	if (!initialWorkspaceSnapshotRef.current) {
		initialWorkspaceSnapshotRef.current = getInitialPreviewWorkspaceSnapshot();
	}

	const initialWorkspaceSnapshot = initialWorkspaceSnapshotRef.current;
	const [workspaceIndex, setWorkspaceIndex] = React.useState(
		() => initialWorkspaceSnapshot.workspaceIndex,
	);
	const [entryPayloads, setEntryPayloads] = React.useState<
		Record<string, PreviewEntryPayload>
	>(() => initialWorkspaceSnapshot.entryPayloads);
	const importersRef = React.useRef(initialWorkspaceSnapshot.importers);
	const hotUpdateSequenceRef = React.useRef(0);

	const applyWorkspaceSnapshot = React.useCallback(
		(snapshot: ReturnType<typeof getInitialPreviewWorkspaceSnapshot>) => {
			importersRef.current = snapshot.importers;
			setWorkspaceIndex(snapshot.workspaceIndex);
			setEntryPayloads(snapshot.entryPayloads);
		},
		[],
	);

	const applyEntryPayload = React.useCallback(
		(entryId: string, payload: PreviewEntryPayload | undefined) => {
			if (!payload) {
				return;
			}

			setWorkspaceIndex((previousWorkspaceIndex) => ({
				...previousWorkspaceIndex,
				entries: previousWorkspaceIndex.entries.map((entry) =>
					entry.id === entryId ? payload.descriptor : entry,
				),
			}));
			setEntryPayloads((previousPayloads) => ({
				...previousPayloads,
				[entryId]: payload,
			}));
		},
		[],
	);

	const refreshEntryPayload = React.useCallback(
		(entryId: string, importer: PreviewWorkspaceModuleImporter) =>
			loadPreviewModule(importer).then((module) => {
				const payload = (
					"__previewEntryPayload" in module
						? module.__previewEntryPayload
						: undefined
				) as PreviewEntryPayload | undefined;
				applyEntryPayload(entryId, payload);

				return {
					module,
					payload,
				};
			}),
		[applyEntryPayload],
	);

	const loadEntry = React.useCallback(
		(id: string) => {
			const importer = importersRef.current[id];
			if (!importer) {
				return Promise.reject(
					new Error(`No preview importer registered for \`${id}\`.`),
				);
			}

			return refreshEntryPayload(id, importer);
		},
		[refreshEntryPayload],
	);

	React.useEffect(() => {
		const hot = getHotContext();
		if (!hot) {
			return;
		}

		const handleUpdate = (update: PreviewEngineUpdate) => {
			const updateSequence = hotUpdateSequenceRef.current + 1;
			hotUpdateSequenceRef.current = updateSequence;

			void reloadPreviewWorkspaceSnapshot()
				.then((workspaceSnapshot) => {
					if (hotUpdateSequenceRef.current !== updateSequence) {
						return;
					}

					applyWorkspaceSnapshot(workspaceSnapshot);

					for (const entryId of update.changedEntryIds) {
						const importer = workspaceSnapshot.importers[entryId];
						if (!importer) {
							continue;
						}

						void refreshEntryPayload(entryId, importer).catch(() => {});
					}
				})
				.catch(() => {
					if (hotUpdateSequenceRef.current !== updateSequence) {
						return;
					}

					reloadPreviewPage();
				});
		};

		hot.on(PREVIEW_UPDATE_EVENT, handleUpdate);
		return () => {
			hot.off?.(PREVIEW_UPDATE_EVENT, handleUpdate);
		};
	}, [applyWorkspaceSnapshot, refreshEntryPayload]);

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
			entries={workspaceIndex.entries}
			entryPayloads={entryPayloads}
			loadEntry={loadEntry}
			projectName={workspaceIndex.projectName}
		/>
	);
}
