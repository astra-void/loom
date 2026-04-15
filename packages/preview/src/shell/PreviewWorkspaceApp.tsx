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
	appendPreviewDebugEvent,
	defaultPreviewHotDebugState,
	type PreviewDebugEvent,
	type PreviewDebugEventKind,
	type PreviewHotDebugState,
} from "./debugState";
import {
	loadPreviewModule,
	type PreviewModuleLoadOptions,
	type PreviewWorkspaceModuleImporter,
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
	off?: (event: string, callback: (payload: unknown) => void) => void;
	on: (event: string, callback: (payload: unknown) => void) => void;
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

function createInitialHotDebugState(): PreviewHotDebugState {
	const hot = getHotContext();
	if (!hot) {
		return defaultPreviewHotDebugState;
	}

	return {
		available: true,
		connection: "connected",
		sendAvailable: typeof hot.send === "function",
		updateListener: "none",
		updateSequence: 0,
	};
}

function describeHotUpdate(update: PreviewEngineUpdate) {
	const parts = [
		`${update.changedEntryIds.length} changed`,
		`${update.removedEntryIds.length} removed`,
	];

	if (update.requiresFullReload) {
		parts.push("full reload requested");
	}

	return parts.join(", ");
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
	>(() => ({}));
	const importersRef = React.useRef(initialWorkspaceSnapshot.importers);
	const hotUpdateSequenceRef = React.useRef(0);
	const debugEventSequenceRef = React.useRef(0);
	const [debugEvents, setDebugEvents] = React.useState<PreviewDebugEvent[]>([]);
	const [hotDebugState, setHotDebugState] =
		React.useState<PreviewHotDebugState>(createInitialHotDebugState);

	const recordDebugEvent = React.useCallback(
		(kind: PreviewDebugEventKind, label: string, detail?: string) => {
			const sequence = debugEventSequenceRef.current + 1;
			debugEventSequenceRef.current = sequence;
			setDebugEvents((previousEvents) =>
				appendPreviewDebugEvent(previousEvents, {
					...(detail ? { detail } : {}),
					id: `workspace:${sequence}`,
					kind,
					label,
					sequence,
					timestamp: Date.now(),
				}),
			);
		},
		[],
	);

	const applyWorkspaceSnapshot = React.useCallback(
		(snapshot: ReturnType<typeof getInitialPreviewWorkspaceSnapshot>) => {
			importersRef.current = snapshot.importers;
			setWorkspaceIndex(snapshot.workspaceIndex);
			setEntryPayloads((previousPayloads) => {
				const nextPayloads: Record<string, PreviewEntryPayload> = {};

				for (const entryId of Object.keys(previousPayloads)) {
					if (snapshot.importers[entryId]) {
						nextPayloads[entryId] = previousPayloads[entryId];
					}
				}

				return nextPayloads;
			});
		},
		[],
	);

	const applyEntryPayload = React.useCallback(
		(entryId: string, payload: PreviewEntryPayload | undefined) => {
			if (!payload) {
				return;
			}

			recordDebugEvent(
				"entry-payload-applied",
				"Entry payload applied",
				entryId,
			);
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
		[recordDebugEvent],
	);

	const refreshEntryPayload = React.useCallback(
		(
			entryId: string,
			importer: PreviewWorkspaceModuleImporter,
			options?: PreviewModuleLoadOptions,
		) =>
			loadPreviewModule(importer, options).then((loadResult) => {
				const payload = (
					"__previewEntryPayload" in loadResult.module
						? loadResult.module.__previewEntryPayload
						: undefined
				) as PreviewEntryPayload | undefined;
				applyEntryPayload(entryId, payload);

				return {
					loadMetadata: loadResult.loadMetadata,
					module: loadResult.module,
					payload,
				};
			}),
		[applyEntryPayload],
	);

	const loadEntry = React.useCallback(
		(id: string, options?: PreviewModuleLoadOptions) => {
			const importer = importersRef.current[id];
			if (!importer) {
				return Promise.reject(
					new Error(`No preview importer registered for \`${id}\`.`),
				);
			}

			return refreshEntryPayload(id, importer, options);
		},
		[refreshEntryPayload],
	);

	React.useEffect(() => {
		const hot = getHotContext();
		if (!hot) {
			setHotDebugState(defaultPreviewHotDebugState);
			return;
		}

		setHotDebugState((previousState) => ({
			...previousState,
			available: true,
			connection:
				previousState.connection === "unavailable"
					? "connected"
					: previousState.connection,
			sendAvailable: typeof hot.send === "function",
			updateListener: "subscribed",
		}));

		const handleConnected = () => {
			setHotDebugState((previousState) => ({
				...previousState,
				available: true,
				connection: "connected",
			}));
		};

		const handleDisconnected = () => {
			setHotDebugState((previousState) => ({
				...previousState,
				available: true,
				connection: "disconnected",
			}));
		};

		const handleUpdate = (payload: unknown) => {
			const update = payload as PreviewEngineUpdate;
			const updateSequence = hotUpdateSequenceRef.current + 1;
			hotUpdateSequenceRef.current = updateSequence;
			const receivedAt = Date.now();
			recordDebugEvent(
				"hot-update-received",
				"Hot update received",
				describeHotUpdate(update),
			);
			setHotDebugState((previousState) => ({
				...previousState,
				available: true,
				connection:
					previousState.connection === "disconnected"
						? previousState.connection
						: "connected",
				lastUpdateAt: receivedAt,
				sendAvailable: typeof hot.send === "function",
				updateListener: "subscribed",
				updateSequence,
			}));

			void reloadPreviewWorkspaceSnapshot()
				.then((workspaceSnapshot) => {
					if (hotUpdateSequenceRef.current !== updateSequence) {
						return;
					}

					applyWorkspaceSnapshot(workspaceSnapshot);
					recordDebugEvent(
						"workspace-snapshot-reloaded",
						"Workspace snapshot reloaded",
						`${workspaceSnapshot.workspaceIndex.entries.length} entries`,
					);

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
		hot.on("vite:ws:connect", handleConnected);
		hot.on("vite:ws:disconnect", handleDisconnected);
		return () => {
			hot.off?.(PREVIEW_UPDATE_EVENT, handleUpdate);
			hot.off?.("vite:ws:connect", handleConnected);
			hot.off?.("vite:ws:disconnect", handleDisconnected);
			setHotDebugState((previousState) => ({
				...previousState,
				updateListener: "none",
			}));
		};
	}, [applyWorkspaceSnapshot, recordDebugEvent, refreshEntryPayload]);

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
			debugEvents={debugEvents}
			entries={workspaceIndex.entries}
			entryPayloads={entryPayloads}
			hotDebugState={hotDebugState}
			loadEntry={loadEntry}
			projectName={workspaceIndex.projectName}
		/>
	);
}
