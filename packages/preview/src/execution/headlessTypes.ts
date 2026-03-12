import type {
	PreviewEngineSnapshot,
	PreviewEntryPayload,
} from "@loom-dev/preview-engine";
import type {
	PreviewLayoutDebugPayload,
	PreviewRuntimeIssue,
} from "@loom-dev/preview-runtime";
import type { PreviewReadyWarningState } from "./shared";

export type PreviewHeadlessRenderStatus =
	| "load_failed"
	| "render_failed"
	| "rendered"
	| "skipped";

export type PreviewHeadlessEntryViewport = {
	height: number;
	ready: boolean;
	source: "window-fallback";
	width: number;
};

export type PreviewHeadlessEntryRenderResult = {
	status: PreviewHeadlessRenderStatus;
};

export type PreviewHeadlessEntryExecutionResult = {
	degradedHostWarnings: PreviewRuntimeIssue[];
	layoutDebug: PreviewLayoutDebugPayload | null;
	layoutIssues: PreviewRuntimeIssue[];
	loadIssue: PreviewRuntimeIssue | null;
	render: PreviewHeadlessEntryRenderResult;
	renderIssue: PreviewRuntimeIssue | null;
	runtimeIssues: PreviewRuntimeIssue[];
	severity: "error" | "pass" | "warning";
	viewport: PreviewHeadlessEntryViewport;
	warningState: PreviewReadyWarningState;
};

export type PreviewHeadlessExecutionSummary = {
	error: number;
	pass: number;
	selectedEntryCount: number;
	total: number;
	warning: number;
};

export type PreviewHeadlessExecution = {
	entries: Record<string, PreviewHeadlessEntryExecutionResult>;
	summary: PreviewHeadlessExecutionSummary;
};

export type PreviewHeadlessSnapshot = PreviewEngineSnapshot & {
	execution: PreviewHeadlessExecution;
};

export function createDefaultHeadlessViewport(): PreviewHeadlessEntryViewport {
	return {
		height: 600,
		ready: false,
		source: "window-fallback",
		width: 800,
	};
}

export function classifyHeadlessExecutionResult(
	entryPayload: PreviewEntryPayload,
	executionResult: Omit<PreviewHeadlessEntryExecutionResult, "severity">,
) {
	if (
		entryPayload.descriptor.status !== "ready" ||
		executionResult.render.status === "load_failed" ||
		executionResult.render.status === "render_failed"
	) {
		return "error" as const;
	}

	const hasWarningDiagnostics = entryPayload.diagnostics.some((diagnostic) => {
		const blocking = diagnostic.blocking ?? diagnostic.severity === "error";
		return !blocking;
	});

	if (
		hasWarningDiagnostics ||
		executionResult.warningState.warningCodes.length > 0 ||
		executionResult.warningState.degradedTargets.length > 0
	) {
		return "warning" as const;
	}

	return "pass" as const;
}

export function summarizeHeadlessExecution(
	entryPayloads: Record<string, PreviewEntryPayload>,
	executionEntries: Record<string, PreviewHeadlessEntryExecutionResult>,
	selectedEntryCount: number,
): PreviewHeadlessExecutionSummary {
	let error = 0;
	let pass = 0;
	let warning = 0;

	for (const [entryId, executionResult] of Object.entries(executionEntries)) {
		const entryPayload = entryPayloads[entryId];
		if (!entryPayload) {
			continue;
		}

		switch (executionResult.severity) {
			case "error":
				error += 1;
				break;
			case "warning":
				warning += 1;
				break;
			case "pass":
				pass += 1;
				break;
		}
	}

	return {
		error,
		pass,
		selectedEntryCount,
		total: Object.keys(entryPayloads).length,
		warning,
	};
}
