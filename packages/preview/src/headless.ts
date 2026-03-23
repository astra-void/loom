import {
	createPreviewEngine,
	type PreviewEngine,
	type PreviewEngineSnapshot,
	type PreviewEntryDescriptor,
	type PreviewEntryPayload,
} from "@loom-dev/preview-engine";
import type { PreviewRuntimeIssue } from "@loom-dev/preview-runtime";
import type { ResolvedPreviewConfig } from "./config";
import { executeHeadlessEntry } from "./execution/headlessRunner";
import {
	classifyHeadlessExecutionResult,
	createDefaultHeadlessViewport,
	type PreviewHeadlessEntryExecutionResult,
	type PreviewHeadlessSnapshot,
	summarizeHeadlessExecution,
} from "./execution/headlessTypes";
import { getPreviewReadyWarningState } from "./execution/shared";
import {
	type CreatePreviewViteServerOptions,
	createPreviewViteServer,
	resolvePreviewRuntimeRootEntry,
	resolvePreviewServerConfig,
	type StartPreviewServerInput,
} from "./source/server";
import type { PreviewDevServer } from "./source/viteTypes";

export type {
	PreviewHeadlessEntryExecutionResult,
	PreviewHeadlessExecution,
	PreviewHeadlessExecutionSummary,
	PreviewHeadlessRenderStatus,
	PreviewHeadlessSnapshot,
} from "./execution/headlessTypes";
export type { PreviewReadyWarningState } from "./execution/shared";

export type PreviewHeadlessSessionRunOptions = {
	entryIds?: string[];
};

export type PreviewHeadlessSession = {
	dispose(): void;
	engine: PreviewEngine;
	getSnapshot(): PreviewHeadlessSnapshot;
	resolvedConfig: ResolvedPreviewConfig;
	run(
		options?: PreviewHeadlessSessionRunOptions,
	): Promise<PreviewHeadlessSnapshot>;
};

export type CreatePreviewHeadlessSessionOptions = StartPreviewServerInput;

type CollectedExecutionResult = Awaited<
	ReturnType<typeof executeHeadlessEntry>
>;

function getEngineSnapshot(engine: PreviewEngine): PreviewEngineSnapshot {
	if (
		typeof (
			engine as PreviewEngine & { getSnapshot?: () => PreviewEngineSnapshot }
		).getSnapshot === "function"
	) {
		return engine.getSnapshot();
	}

	const workspaceIndex = engine.getWorkspaceIndex();
	return {
		entries: Object.fromEntries(
			workspaceIndex.entries.map((entry) => [
				entry.id,
				engine.getEntryPayload(entry.id),
			]),
		),
		protocolVersion: workspaceIndex.protocolVersion,
		workspaceIndex,
	};
}

function getEntryIds(entries: PreviewEntryDescriptor[]) {
	return entries.map((entry) => entry.id);
}

function validateSelectedEntryIds(
	entries: PreviewEntryDescriptor[],
	selectedEntryIds?: string[],
) {
	if (!selectedEntryIds || selectedEntryIds.length === 0) {
		return getEntryIds(entries);
	}

	const entriesById = new Set(entries.map((entry) => entry.id));
	const dedupedEntryIds = [...new Set(selectedEntryIds)];
	for (const entryId of dedupedEntryIds) {
		if (!entriesById.has(entryId)) {
			throw new Error(`Unknown preview entry: ${entryId}`);
		}
	}

	return dedupedEntryIds;
}

function createSkippedExecution(): CollectedExecutionResult {
	return {
		issues: [],
		layoutDebug: null,
		loadIssue: null,
		render: {
			status: "skipped",
		},
		renderIssue: null,
		viewport: createDefaultHeadlessViewport(),
	};
}

function buildExecutionEntryResult(
	entryPayload: PreviewEntryPayload,
	collectedExecution: CollectedExecutionResult | undefined,
	selected: boolean,
): PreviewHeadlessEntryExecutionResult {
	const execution = collectedExecution ?? createSkippedExecution();
	const runtimeIssues = execution.issues.filter(
		(issue) => issue.phase === "runtime",
	);
	const layoutIssues = execution.issues.filter(
		(issue) => issue.phase === "layout",
	);
	const warningState = getPreviewReadyWarningState(
		entryPayload.descriptor.statusDetails,
		entryPayload.diagnostics.filter(
			(diagnostic) => diagnostic.phase !== "discovery",
		),
		execution.issues,
	);
	const baseExecutionResult = {
		degradedHostWarnings: runtimeIssues.filter(
			(issue) => issue.code === "DEGRADED_HOST_RENDER",
		),
		layoutDebug: execution.layoutDebug,
		layoutIssues,
		loadIssue: execution.loadIssue,
		render: execution.render,
		renderIssue: execution.renderIssue,
		runtimeIssues,
		viewport: execution.viewport,
		warningState,
	};

	return {
		...baseExecutionResult,
		severity: selected
			? classifyHeadlessExecutionResult(entryPayload, baseExecutionResult)
			: "skipped",
	};
}

function buildHeadlessSnapshot(
	engine: PreviewEngine,
	collectedExecutionsById: Map<string, CollectedExecutionResult>,
	selectedEntryIds: string[],
): PreviewHeadlessSnapshot {
	const engineSnapshot = getEngineSnapshot(engine);
	const selectedEntryIdSet = new Set(selectedEntryIds);
	const executionEntries = Object.fromEntries(
		Object.entries(engineSnapshot.entries).map(([entryId, entryPayload]) => [
			entryId,
			buildExecutionEntryResult(
				entryPayload,
				collectedExecutionsById.get(entryId),
				selectedEntryIdSet.has(entryId),
			),
		]),
	);

	return {
		...engineSnapshot,
		execution: {
			entries: executionEntries,
			summary: summarizeHeadlessExecution(
				engineSnapshot.entries,
				executionEntries,
				selectedEntryIds.length,
			),
		},
	};
}

async function createHeadlessPreviewServer(
	resolvedConfig: ResolvedPreviewConfig,
	engine: PreviewEngine,
) {
	const serverOptions: CreatePreviewViteServerOptions = {
		appType: "custom",
		middlewareMode: true,
		previewEngine: engine,
	};

	return createPreviewViteServer(resolvedConfig, serverOptions);
}

export async function createPreviewHeadlessSession(
	options: CreatePreviewHeadlessSessionOptions = {},
): Promise<PreviewHeadlessSession> {
	const resolvedConfig = await resolvePreviewServerConfig(options);
	const runtimeModuleId = (
		resolvedConfig.runtimeModule ?? resolvePreviewRuntimeRootEntry()
	).replace(/\\/g, "/");
	const engine = createPreviewEngine({
		projectName: resolvedConfig.projectName,
		runtimeModule: runtimeModuleId,
		targets: resolvedConfig.targets,
		transformMode: resolvedConfig.transformMode,
	});
	let collectedExecutionsById = new Map<string, CollectedExecutionResult>();
	let selectedEntryIds: string[] = [];
	let disposed = false;
	let syncingRuntimeIssues = false;
	const server = (await createHeadlessPreviewServer(
		resolvedConfig,
		engine,
	)) as PreviewDevServer;

	const resetExecutionState = () => {
		collectedExecutionsById = new Map<string, CollectedExecutionResult>();
		selectedEntryIds = [];
	};
	const syncRuntimeIssues = (issues: PreviewRuntimeIssue[]) => {
		syncingRuntimeIssues = true;
		try {
			engine.replaceRuntimeIssues(issues);
		} finally {
			syncingRuntimeIssues = false;
		}
	};
	const unsubscribeEngineUpdates = engine.onUpdate(() => {
		if (disposed || syncingRuntimeIssues) {
			return;
		}

		resetExecutionState();
	});
	const getCurrentSnapshot = () =>
		buildHeadlessSnapshot(engine, collectedExecutionsById, selectedEntryIds);

	const session: PreviewHeadlessSession = {
		dispose() {
			if (disposed) {
				return;
			}

			disposed = true;
			try {
				server.watcher.removeAllListeners();
			} catch {
				// Ignore watcher teardown errors during synchronous disposal.
			}
			try {
				void server.watcher.close().catch(() => {});
			} catch {
				// Ignore watcher teardown errors during synchronous disposal.
			}
			unsubscribeEngineUpdates();
			engine.dispose();
			void server.close().catch(() => {});
		},
		engine,
		getSnapshot() {
			return getCurrentSnapshot();
		},
		resolvedConfig,
		async run(runOptions: PreviewHeadlessSessionRunOptions = {}) {
			if (disposed) {
				throw new Error("Preview headless session has already been disposed.");
			}

			syncRuntimeIssues([]);
			const currentEntries = engine.getWorkspaceIndex().entries;
			const nextSelectedEntryIds = validateSelectedEntryIds(
				currentEntries,
				runOptions.entryIds,
			);
			const entriesById = new Map(
				currentEntries.map((entry) => [entry.id, entry]),
			);
			const nextCollectedExecutionsById = new Map<
				string,
				CollectedExecutionResult
			>();

			for (const entryId of nextSelectedEntryIds) {
				const entry = entriesById.get(entryId);
				if (!entry) {
					throw new Error(`Unknown preview entry: ${entryId}`);
				}

				if (entry.status !== "ready") {
					nextCollectedExecutionsById.set(entryId, createSkippedExecution());
					continue;
				}

				nextCollectedExecutionsById.set(
					entryId,
					await executeHeadlessEntry(server, entry, runtimeModuleId),
				);
			}

			selectedEntryIds = nextSelectedEntryIds;
			collectedExecutionsById = nextCollectedExecutionsById;
			const allRuntimeIssues: PreviewRuntimeIssue[] = [
				...collectedExecutionsById.values(),
			].flatMap((execution) => execution.issues);
			syncRuntimeIssues(allRuntimeIssues);
			return getCurrentSnapshot();
		},
	};

	return session;
}
