import type { PreviewEntryDescriptor } from "@loom-dev/preview-engine";
import type {
	PreviewLayoutDebugNode,
	PreviewLayoutProbeSnapshot,
	PreviewRuntimeIssue,
} from "@loom-dev/preview-runtime";
import {
	defaultPreviewHotDebugState,
	type PreviewDebugEvent,
	type PreviewHotDebugState,
	type PreviewModuleLoadDebugState,
} from "./debugState";

export const PREVIEW_DEBUG_SNAPSHOT_VERSION = 1;

const DEFAULT_HOST_SAMPLE_LIMIT = 6;
const DEFAULT_RUNTIME_ISSUE_ITEM_LIMIT_SUMMARY = 20;
const DEFAULT_RUNTIME_ISSUE_ITEM_LIMIT_FULL = 200;

export type PreviewDebugSnapshotMode = "summary" | "full";

export type PreviewDebugSnapshotOptions = {
	includeLayoutTree?: boolean;
	generatedAt?: Date | string;
	hostSampleLimit?: number;
	mode?: PreviewDebugSnapshotMode;
	runtimeIssueItemLimit?: number;
};

export type PreviewDebugSnapshotInput = {
	events: PreviewDebugEvent[];
	hotDebugState?: PreviewHotDebugState;
	layoutProbe: PreviewLayoutProbeSnapshot;
	moduleLoadState: PreviewModuleLoadDebugState;
	runtimeIssues: PreviewRuntimeIssue[];
	selectedEntry?: PreviewEntryDescriptor;
};

export type PreviewDebugSnapshot = ReturnType<
	typeof createPreviewDebugSnapshot
>;

export type PreviewDebugGlobal = {
	exportSnapshot: (
		options?: PreviewDebugSnapshotOptions,
	) => PreviewDebugSnapshot;
	exportSnapshotJson: (options?: PreviewDebugSnapshotOptions) => string;
};

type ResolvedSnapshotOptions = {
	generatedAt: string;
	hostSampleLimit: number;
	includeLayoutTree: boolean;
	mode: PreviewDebugSnapshotMode;
	runtimeIssueItemLimit: number;
};

type PreviewLayoutHostSample = {
	nodeId: string;
	nodeType: string;
	reason: string;
};

declare global {
	interface Window {
		__loomPreviewDebug?: PreviewDebugGlobal;
	}
}

function incrementCount(map: Map<string, number>, key: string) {
	map.set(key, (map.get(key) ?? 0) + 1);
}

function toSortedCountRecord(counts: Map<string, number>) {
	return Object.fromEntries(
		[...counts.entries()].sort((left, right) =>
			left[0].localeCompare(right[0]),
		),
	);
}

function toLayoutProvenanceCounts(counts: Map<string, number>) {
	return {
		fallback: counts.get("fallback") ?? 0,
		wasm: counts.get("wasm") ?? 0,
	};
}

function toClampedLimit(value: number | undefined, fallback: number) {
	if (value === undefined || !Number.isFinite(value)) {
		return fallback;
	}

	return Math.max(0, Math.trunc(value));
}

function normalizeSnapshotOptions(
	options: PreviewDebugSnapshotOptions,
): ResolvedSnapshotOptions {
	const mode: PreviewDebugSnapshotMode = options.mode ?? "summary";
	const runtimeIssueItemLimitFallback =
		mode === "full"
			? DEFAULT_RUNTIME_ISSUE_ITEM_LIMIT_FULL
			: DEFAULT_RUNTIME_ISSUE_ITEM_LIMIT_SUMMARY;

	return {
		generatedAt: normalizeGeneratedAt(options.generatedAt),
		hostSampleLimit: toClampedLimit(
			options.hostSampleLimit,
			DEFAULT_HOST_SAMPLE_LIMIT,
		),
		includeLayoutTree: options.includeLayoutTree ?? false,
		mode,
		runtimeIssueItemLimit: toClampedLimit(
			options.runtimeIssueItemLimit,
			runtimeIssueItemLimitFallback,
		),
	};
}

function collectLayoutDebugNodes(roots: PreviewLayoutDebugNode[]) {
	const nodes: PreviewLayoutDebugNode[] = [];
	const visit = (node: PreviewLayoutDebugNode) => {
		nodes.push(node);
		for (const child of node.children) {
			visit(child);
		}
	};

	for (const root of roots) {
		visit(root);
	}

	return nodes;
}

function toSortedHostSamples(
	samples: PreviewLayoutHostSample[],
	limit: number,
) {
	if (limit <= 0 || samples.length === 0) {
		return [];
	}

	return samples
		.sort((left, right) => {
			const nodeTypeDelta = left.nodeType.localeCompare(right.nodeType);
			if (nodeTypeDelta !== 0) {
				return nodeTypeDelta;
			}

			const nodeIdDelta = left.nodeId.localeCompare(right.nodeId);
			if (nodeIdDelta !== 0) {
				return nodeIdDelta;
			}

			return left.reason.localeCompare(right.reason);
		})
		.slice(0, limit);
}

function getDegradedReason(node: PreviewLayoutDebugNode) {
	if (node.hostPolicy.placeholderBehavior === "container") {
		return "placeholder-container";
	}

	if (node.hostPolicy.placeholderBehavior === "opaque") {
		return "placeholder-opaque";
	}

	return "degraded-host";
}

function getFullSizeDefaultReason(node: PreviewLayoutDebugNode) {
	if (node.hostPolicy.placeholderBehavior === "none") {
		return "full-size-default";
	}

	return `full-size-default+placeholder-${node.hostPolicy.placeholderBehavior}`;
}

export function describeStatusDetails(
	statusDetails: PreviewEntryDescriptor["statusDetails"] | undefined,
) {
	if (!statusDetails) {
		return "No status details.";
	}

	switch (statusDetails.kind) {
		case "ready": {
			const parts = [
				statusDetails.fidelity ? `fidelity ${statusDetails.fidelity}` : null,
				(statusDetails.warningCodes?.length ?? 0) > 0
					? `warnings ${statusDetails.warningCodes?.join(", ")}`
					: null,
				(statusDetails.degradedTargets?.length ?? 0) > 0
					? `degraded ${statusDetails.degradedTargets?.join(", ")}`
					: null,
			].filter(Boolean);

			return parts.length > 0 ? parts.join("; ") : "ready";
		}
		case "needs_harness": {
			const candidates = statusDetails.candidates?.join(", ");
			return candidates
				? `${statusDetails.reason}; candidates ${candidates}`
				: statusDetails.reason;
		}
		case "ambiguous":
			return `${statusDetails.reason}; candidates ${statusDetails.candidates.join(", ")}`;
		case "blocked_by_transform":
			return `${statusDetails.reason}; blocking ${statusDetails.blockingCodes.join(", ")}`;
		case "blocked_by_runtime":
		case "blocked_by_layout":
			return `${statusDetails.reason}; issues ${statusDetails.issueCodes.join(", ")}`;
	}
}

export function summarizeLayoutDebug(
	layoutProbe: PreviewLayoutProbeSnapshot,
	hostSampleLimit = DEFAULT_HOST_SAMPLE_LIMIT,
) {
	const nodes = collectLayoutDebugNodes(layoutProbe.debug.roots);
	const provenanceCounts = new Map<string, number>();
	const layoutSourceCounts = new Map<string, number>();
	const degradedHostTypes = new Map<string, number>();
	const fullSizeDefaultHostTypes = new Map<string, number>();
	const degradedSamples: PreviewLayoutHostSample[] = [];
	const fullSizeDefaultSamples: PreviewLayoutHostSample[] = [];
	let placeholderHostCount = 0;
	let degradedHostCount = 0;
	let fullSizeDefaultHostCount = 0;

	for (const node of nodes) {
		incrementCount(provenanceCounts, node.provenance.source);
		incrementCount(layoutSourceCounts, node.layoutSource);

		if (node.hostPolicy.degraded) {
			degradedHostCount += 1;
			incrementCount(degradedHostTypes, node.nodeType);
			degradedSamples.push({
				nodeId: node.id,
				nodeType: node.nodeType,
				reason: getDegradedReason(node),
			});
		}

		if (node.hostPolicy.fullSizeDefault) {
			fullSizeDefaultHostCount += 1;
			incrementCount(fullSizeDefaultHostTypes, node.nodeType);
			fullSizeDefaultSamples.push({
				nodeId: node.id,
				nodeType: node.nodeType,
				reason: getFullSizeDefaultReason(node),
			});
		}

		if (node.hostPolicy.placeholderBehavior !== "none") {
			placeholderHostCount += 1;
		}
	}

	return {
		degradedHostCount,
		degradedHostTypes: toSortedCountRecord(degradedHostTypes),
		degradedSamples: toSortedHostSamples(degradedSamples, hostSampleLimit),
		fullSizeDefaultHostCount,
		fullSizeDefaultHostTypes: toSortedCountRecord(fullSizeDefaultHostTypes),
		fullSizeDefaultSamples: toSortedHostSamples(
			fullSizeDefaultSamples,
			hostSampleLimit,
		),
		layoutSourceCounts: toSortedCountRecord(layoutSourceCounts),
		nodeCount: nodes.length,
		placeholderHostCount,
		provenanceCounts: toLayoutProvenanceCounts(provenanceCounts),
	};
}

function normalizeGeneratedAt(value?: Date | string) {
	if (value instanceof Date) {
		return value.toISOString();
	}

	return value ?? new Date().toISOString();
}

function normalizeTimestamp(timestamp: number) {
	if (!Number.isFinite(timestamp)) {
		return null;
	}

	return new Date(timestamp).toISOString();
}

function compareText(left: string | undefined, right: string | undefined) {
	return (left ?? "").localeCompare(right ?? "");
}

function getRuntimeIssueSeverityBucket(issue: PreviewRuntimeIssue) {
	if (issue.blocking || issue.severity === "error") {
		return "error" as const;
	}

	if (issue.severity === "info") {
		return "info" as const;
	}

	return "warning" as const;
}

function getRuntimeIssueSeverityRank(
	severity: ReturnType<typeof getRuntimeIssueSeverityBucket>,
) {
	switch (severity) {
		case "error":
			return 0;
		case "warning":
			return 1;
		case "info":
			return 2;
	}
}

function summarizeRuntimeIssues(
	issues: PreviewRuntimeIssue[],
	options: ResolvedSnapshotOptions,
) {
	let errors = 0;
	let infos = 0;
	let warnings = 0;

	const normalizedIssues = issues.map((issue, index) => {
		const severity = getRuntimeIssueSeverityBucket(issue);
		if (severity === "error") {
			errors += 1;
		} else if (severity === "info") {
			infos += 1;
		} else {
			warnings += 1;
		}

		return {
			index,
			issue,
			severity,
		};
	});

	const sortedIssues = normalizedIssues.sort((left, right) => {
		const severityDelta =
			getRuntimeIssueSeverityRank(left.severity) -
			getRuntimeIssueSeverityRank(right.severity);
		if (severityDelta !== 0) {
			return severityDelta;
		}

		const codeDelta = left.issue.code.localeCompare(right.issue.code);
		if (codeDelta !== 0) {
			return codeDelta;
		}

		const phaseDelta = left.issue.phase.localeCompare(right.issue.phase);
		if (phaseDelta !== 0) {
			return phaseDelta;
		}

		const kindDelta = left.issue.kind.localeCompare(right.issue.kind);
		if (kindDelta !== 0) {
			return kindDelta;
		}

		const targetDelta = left.issue.target.localeCompare(right.issue.target);
		if (targetDelta !== 0) {
			return targetDelta;
		}

		const relativeFileDelta = left.issue.relativeFile.localeCompare(
			right.issue.relativeFile,
		);
		if (relativeFileDelta !== 0) {
			return relativeFileDelta;
		}

		const summaryDelta = left.issue.summary.localeCompare(right.issue.summary);
		if (summaryDelta !== 0) {
			return summaryDelta;
		}

		const symbolDelta = compareText(left.issue.symbol, right.issue.symbol);
		if (symbolDelta !== 0) {
			return symbolDelta;
		}

		return left.index - right.index;
	});

	const visibleIssues = sortedIssues.slice(0, options.runtimeIssueItemLimit);
	const items = visibleIssues.map(({ issue, severity }) => {
		return {
			code: issue.code,
			kind: issue.kind,
			phase: issue.phase,
			target: issue.target,
			relativeFile: issue.relativeFile,
			severity,
			summary: issue.summary,
			...(issue.blocking ? { blocking: true } : {}),
			...(issue.details ? { details: issue.details } : {}),
			...(issue.symbol ? { symbol: issue.symbol } : {}),
		};
	});
	const truncated = sortedIssues.length > items.length;

	return {
		errors,
		infos,
		itemLimit: options.runtimeIssueItemLimit,
		items,
		omittedItemCount: truncated ? sortedIssues.length - items.length : 0,
		total: issues.length,
		truncated,
		warnings,
	};
}

function summarizeSelectedEntry(entry: PreviewEntryDescriptor | undefined) {
	if (!entry) {
		return null;
	}

	return {
		id: entry.id,
		relativePath: entry.relativePath,
		targetName: entry.targetName,
		status: entry.status,
		statusDetails: {
			kind: entry.statusDetails?.kind ?? null,
			summary: describeStatusDetails(entry.statusDetails),
		},
	};
}

function summarizeModuleLoad(state: PreviewModuleLoadDebugState) {
	return {
		state: state.state,
		outcome: state.outcome ?? null,
		retried: state.retried,
		...(state.entryId ? { entryId: state.entryId } : {}),
		...(state.message ? { message: state.message } : {}),
		...(state.retry
			? {
					retry: {
						reason: state.retry.reason,
						message: state.retry.message,
						...(state.retry.code ? { code: state.retry.code } : {}),
					},
				}
			: { retry: null }),
	};
}

function summarizeHotDebugState(state: PreviewHotDebugState | undefined) {
	const hotDebugState = state ?? defaultPreviewHotDebugState;

	return {
		available: hotDebugState.available,
		connection: hotDebugState.connection,
		sendAvailable: hotDebugState.sendAvailable,
		updateListener: hotDebugState.updateListener,
		updateSequence: hotDebugState.updateSequence,
		...(hotDebugState.lastUpdateAt
			? { lastUpdateAt: normalizeTimestamp(hotDebugState.lastUpdateAt) }
			: {}),
	};
}

function summarizeLayoutProbe(
	layoutProbe: PreviewLayoutProbeSnapshot,
	options: ResolvedSnapshotOptions,
) {
	const layoutSummary = summarizeLayoutDebug(
		layoutProbe,
		options.hostSampleLimit,
	);

	return {
		viewport: {
			width: layoutProbe.viewport.width,
			height: layoutProbe.viewport.height,
			ready: layoutProbe.viewportReady,
		},
		probe: {
			ready: layoutProbe.isReady,
			revision: layoutProbe.revision,
			error: layoutProbe.error,
		},
		nodeCount: layoutSummary.nodeCount,
		degradedHostCount: layoutSummary.degradedHostCount,
		degradedHostTypes: layoutSummary.degradedHostTypes,
		degradedSamples: layoutSummary.degradedSamples,
		fullSizeDefaultHostCount: layoutSummary.fullSizeDefaultHostCount,
		fullSizeDefaultHostTypes: layoutSummary.fullSizeDefaultHostTypes,
		fullSizeDefaultSamples: layoutSummary.fullSizeDefaultSamples,
		placeholderHostCount: layoutSummary.placeholderHostCount,
		provenanceCounts: layoutSummary.provenanceCounts,
		layoutSourceCounts: layoutSummary.layoutSourceCounts,
		...(options.includeLayoutTree
			? {
					tree: layoutProbe.debug.roots,
				}
			: {}),
	};
}

function summarizeTimeline(events: PreviewDebugEvent[]) {
	const orderedEvents = [...events].sort((left, right) => {
		const timestampDelta = left.timestamp - right.timestamp;
		if (timestampDelta !== 0) {
			return timestampDelta;
		}

		const sequenceDelta = left.sequence - right.sequence;
		if (sequenceDelta !== 0) {
			return sequenceDelta;
		}

		const kindDelta = left.kind.localeCompare(right.kind);
		if (kindDelta !== 0) {
			return kindDelta;
		}

		return left.id.localeCompare(right.id);
	});
	const perKindCounts = new Map<string, number>();

	return orderedEvents.map((event, index) => {
		const kindSequence = (perKindCounts.get(event.kind) ?? 0) + 1;
		perKindCounts.set(event.kind, kindSequence);

		return {
			order: index + 1,
			kindSequence,
			timestamp: normalizeTimestamp(event.timestamp),
			kind: event.kind,
			label: event.label,
			...(event.detail ? { detail: event.detail } : {}),
		};
	});
}

export function createPreviewDebugSnapshot(
	input: PreviewDebugSnapshotInput,
	options: PreviewDebugSnapshotOptions = {},
) {
	const resolvedOptions = normalizeSnapshotOptions(options);

	return {
		metadata: {
			schemaVersion: PREVIEW_DEBUG_SNAPSHOT_VERSION,
			generatedAt: resolvedOptions.generatedAt,
			mode: resolvedOptions.mode,
			options: {
				includeLayoutTree: resolvedOptions.includeLayoutTree,
				hostSampleLimit: resolvedOptions.hostSampleLimit,
				runtimeIssueItemLimit: resolvedOptions.runtimeIssueItemLimit,
			},
		},
		selectedEntry: summarizeSelectedEntry(input.selectedEntry),
		moduleLoad: summarizeModuleLoad(input.moduleLoadState),
		hot: summarizeHotDebugState(input.hotDebugState),
		runtimeIssues: summarizeRuntimeIssues(input.runtimeIssues, resolvedOptions),
		layout: summarizeLayoutProbe(input.layoutProbe, resolvedOptions),
		timeline: summarizeTimeline(input.events),
	};
}

export function stringifyPreviewDebugSnapshot(snapshot: PreviewDebugSnapshot) {
	return JSON.stringify(snapshot, null, 2);
}
