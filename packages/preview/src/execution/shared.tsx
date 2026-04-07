import type {
	PreviewDiagnostic,
	PreviewEntryDescriptor,
} from "@loom-dev/preview-engine";
import {
	normalizePreviewRuntimeError,
	type PreviewRuntimeIssue,
} from "@loom-dev/preview-runtime";
import {
	analyzePreviewRuntimeError,
	type CapturedRenderError,
} from "./analyzeRuntimeError";

export type PreviewReadyWarningState = {
	degradedTargets: string[];
	fidelity: "degraded" | "preserved" | null;
	warningCodes: string[];
};

function uniqueSorted(values: Iterable<string>) {
	return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

export function isPreviewBlockingIssue(
	issue:
		| Pick<PreviewDiagnostic, "blocking" | "severity">
		| Pick<PreviewRuntimeIssue, "blocking" | "severity">,
) {
	return issue.blocking ?? issue.severity !== "warning";
}

export function getPreviewReadyWarningState(
	statusDetails: PreviewEntryDescriptor["statusDetails"] | undefined,
	diagnostics: PreviewDiagnostic[],
	runtimeIssues: PreviewRuntimeIssue[],
): PreviewReadyWarningState {
	const payloadWarningCodes =
		statusDetails?.kind === "ready" ? (statusDetails.warningCodes ?? []) : [];
	const payloadDegradedTargets =
		statusDetails?.kind === "ready"
			? (statusDetails.degradedTargets ?? [])
			: [];
	const fidelity =
		statusDetails?.kind === "ready" ? (statusDetails.fidelity ?? null) : null;
	const warningDiagnostics = diagnostics.filter(
		(diagnostic) => !isPreviewBlockingIssue(diagnostic),
	);
	const warningRuntimeIssues = runtimeIssues.filter(
		(issue) => !isPreviewBlockingIssue(issue),
	);
	const degradedTargets = uniqueSorted([
		...payloadDegradedTargets,
		...warningRuntimeIssues
			.filter((issue) => issue.code === "DEGRADED_HOST_RENDER")
			.map((issue) => issue.target),
	]);

	return {
		degradedTargets,
		fidelity: fidelity ?? (degradedTargets.length > 0 ? "degraded" : null),
		warningCodes: uniqueSorted([
			...payloadWarningCodes,
			...warningDiagnostics.map((diagnostic) => diagnostic.code),
			...warningRuntimeIssues.map((issue) => issue.code),
		]),
	};
}

export function describePreviewWarningState(
	warningState: PreviewReadyWarningState,
) {
	if (warningState.degradedTargets.length > 0) {
		return `Degraded placeholders: ${warningState.degradedTargets.join(", ")}.`;
	}

	if (warningState.warningCodes.length > 0) {
		return `Warnings: ${warningState.warningCodes.join(", ")}.`;
	}

	return "This preview stays renderable, but fidelity is reduced.";
}

export type { PreviewModule } from "../client/render";
export {
	createPreviewRenderNode,
	readPreviewDefinition,
} from "../client/render";

function getRuntimeIssueContext(entry: PreviewEntryDescriptor) {
	return {
		entryId: entry.id,
		file: entry.sourceFilePath,
		relativeFile: entry.relativePath,
		target: entry.targetName,
	};
}

export function createPreviewLoadIssue(
	entry: PreviewEntryDescriptor,
	error: unknown,
) {
	return normalizePreviewRuntimeError(
		{
			...getRuntimeIssueContext(entry),
			code: "MODULE_LOAD_ERROR",
			kind: "ModuleLoadError",
			phase: "runtime",
			summary: `Preview module failed to load: ${error instanceof Error ? error.message : String(error)}`,
		},
		error,
	);
}

export function createPreviewRenderIssue(
	entry: PreviewEntryDescriptor,
	error: unknown | CapturedRenderError,
) {
	return analyzePreviewRuntimeError(entry, error, {
		...getRuntimeIssueContext(entry),
		code: "RENDER_ERROR",
		kind: "TransformExecutionError",
		phase: "runtime",
	});
}
