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
	severity: "error" | "pass" | "skipped" | "warning";
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
export declare function createDefaultHeadlessViewport(): PreviewHeadlessEntryViewport;
export declare function classifyHeadlessExecutionResult(
	entryPayload: PreviewEntryPayload,
	executionResult: Omit<PreviewHeadlessEntryExecutionResult, "severity">,
): "error" | "warning" | "pass";
export declare function summarizeHeadlessExecution(
	entryPayloads: Record<string, PreviewEntryPayload>,
	executionEntries: Record<string, PreviewHeadlessEntryExecutionResult>,
	selectedEntryCount: number,
): PreviewHeadlessExecutionSummary;
