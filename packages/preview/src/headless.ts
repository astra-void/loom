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

function buildExecutionEntryResult(
	entryPayload: PreviewEntryPayload,
	collectedExecution: CollectedExecutionResult | undefined,
): PreviewHeadlessEntryExecutionResult {
	const execution = collectedExecution ?? {
		issues: [],
		layoutDebug: null,
		loadIssue: null,
		render: {
			status: "skipped" as const,
		},
		renderIssue: null,
		viewport: createDefaultHeadlessViewport(),
	};
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
		severity: classifyHeadlessExecutionResult(
			entryPayload,
			baseExecutionResult,
		),
	};
}

function buildHeadlessSnapshot(
	engine: PreviewEngine,
	collectedExecutionsById: Map<string, CollectedExecutionResult>,
	selectedEntryCount: number,
): PreviewHeadlessSnapshot {
	const engineSnapshot = getEngineSnapshot(engine);
	const executionEntries = Object.fromEntries(
		Object.entries(engineSnapshot.entries).map(([entryId, entryPayload]) => [
			entryId,
			buildExecutionEntryResult(
				entryPayload,
				collectedExecutionsById.get(entryId),
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
				selectedEntryCount,
			),
		},
	};
}

async function createHeadlessPreviewServer(
	resolvedConfig: ResolvedPreviewConfig,
) {
	const serverOptions: CreatePreviewViteServerOptions = {
		appType: "custom",
		middlewareMode: true,
	};

	return createPreviewViteServer(resolvedConfig, serverOptions);
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
	const initialSnapshot = getEngineSnapshot(engine);
	const runnableEntryIds = new Set(
		initialSnapshot.workspaceIndex.entries
			.filter((entry) => entry.status === "ready")
			.map((entry) => entry.id),
	);
	const collectedExecutionsById = new Map<string, CollectedExecutionResult>();
	const server = (await createHeadlessPreviewServer(
		resolvedConfig,
	)) as PreviewDevServer;
	const runtimeModuleId =
		resolvedConfig.runtimeModule ?? resolvePreviewRuntimeRootEntry();
	let latestSnapshot = buildHeadlessSnapshot(
		engine,
		collectedExecutionsById,
		initialSnapshot.workspaceIndex.entries.length,
	);
	let disposed = false;

	const session: PreviewHeadlessSession = {
		dispose() {
			if (disposed) {
				return;
			}

			disposed = true;
			engine.dispose();
			void server.close().catch(() => {});
		},
		engine,
		getSnapshot() {
			return latestSnapshot;
		},
		resolvedConfig,
		async run(runOptions: PreviewHeadlessSessionRunOptions = {}) {
			if (disposed) {
				throw new Error("Preview headless session has already been disposed.");
			}

			const currentEntries = engine.getWorkspaceIndex().entries;
			const selectedEntryIds = validateSelectedEntryIds(
				currentEntries,
				runOptions.entryIds,
			);

			for (const entryId of selectedEntryIds) {
				const entry = initialSnapshot.workspaceIndex.entries.find(
					(candidateEntry) => candidateEntry.id === entryId,
				);
				if (!entry) {
					throw new Error(`Unknown preview entry: ${entryId}`);
				}

				if (!runnableEntryIds.has(entryId)) {
					collectedExecutionsById.set(entryId, {
						issues: [],
						layoutDebug: null,
						loadIssue: null,
						render: {
							status: "skipped",
						},
						renderIssue: null,
						viewport: createDefaultHeadlessViewport(),
					});
					continue;
				}

				collectedExecutionsById.set(
					entryId,
					await executeHeadlessEntry(server, entry, runtimeModuleId),
				);
			}

			const allRuntimeIssues: PreviewRuntimeIssue[] = [
				...collectedExecutionsById.values(),
			].flatMap((execution) => execution.issues);
			engine.replaceRuntimeIssues(allRuntimeIssues);
			latestSnapshot = buildHeadlessSnapshot(
				engine,
				collectedExecutionsById,
				selectedEntryIds.length,
			);
			return latestSnapshot;
		},
	};

	await session.run();
	return session;
}
