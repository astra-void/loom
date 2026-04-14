export type PreviewExecutionMode =
	| "strict-fidelity"
	| "compatibility"
	| "mocked"
	| "design-time";
export type PreviewRuntimeIssueSeverity = "error" | "info" | "warning";
export type PreviewRuntimeIssueKind =
	| "ModuleLoadError"
	| "TransformExecutionError"
	| "TransformValidationError"
	| "UnsupportedPatternError"
	| "RuntimeMockError"
	| "LayoutExecutionError"
	| "LayoutValidationError";
export type PreviewRuntimeIssuePhase = "transform" | "runtime" | "layout";
export type PreviewRuntimeIssue = {
	blocking?: boolean;
	code: string;
	entryId: string;
	file: string;
	kind: PreviewRuntimeIssueKind;
	phase: PreviewRuntimeIssuePhase;
	relativeFile: string;
	severity?: PreviewRuntimeIssueSeverity;
	summary: string;
	target: string;
	codeFrame?: string;
	details?: string;
	importChain?: string[];
	symbol?: string;
	stack?: string;
};
export type PreviewRuntimeIssueContext = Partial<
	Omit<PreviewRuntimeIssue, "kind" | "phase" | "summary">
> & {
	kind?: PreviewRuntimeIssueKind;
	phase?: PreviewRuntimeIssuePhase;
	summary?: string;
};
type PreviewRuntimeErrorOptions = PreviewRuntimeIssueContext & {
	cause?: unknown;
	summary: string;
};
type PreviewRuntimeIssueListener = (issues: PreviewRuntimeIssue[]) => void;
export interface PreviewRuntimeReporter {
	clear(): void;
	getIssues(): PreviewRuntimeIssue[];
	publish(issue: PreviewRuntimeIssue): void;
	setContext(context: PreviewRuntimeIssueContext | null): void;
	subscribe(listener: PreviewRuntimeIssueListener): () => void;
}
export declare class PreviewRuntimeError extends Error {
	readonly code: string;
	readonly details?: string;
	readonly entryId?: string;
	readonly file?: string;
	readonly importChain?: string[];
	readonly kind: PreviewRuntimeIssueKind;
	readonly phase: PreviewRuntimeIssuePhase;
	readonly relativeFile?: string;
	readonly severity: PreviewRuntimeIssueSeverity;
	readonly summary: string;
	readonly blocking: boolean;
	readonly symbol?: string;
	readonly target?: string;
	readonly codeFrame?: string;
	constructor(
		kind: PreviewRuntimeIssueKind,
		options: PreviewRuntimeErrorOptions,
	);
	toIssue(context?: PreviewRuntimeIssueContext | null): PreviewRuntimeIssue;
}
declare class FixedPreviewRuntimeError extends PreviewRuntimeError {}
export declare class ModuleLoadError extends FixedPreviewRuntimeError {
	constructor(options: PreviewRuntimeErrorOptions);
}
export declare class TransformExecutionError extends FixedPreviewRuntimeError {
	constructor(options: PreviewRuntimeErrorOptions);
}
export declare class TransformValidationError extends FixedPreviewRuntimeError {
	constructor(options: PreviewRuntimeErrorOptions);
}
export declare class UnsupportedPatternError extends FixedPreviewRuntimeError {
	constructor(options: PreviewRuntimeErrorOptions);
}
export declare class RuntimeMockError extends FixedPreviewRuntimeError {
	constructor(options: PreviewRuntimeErrorOptions);
}
export declare class LayoutExecutionError extends FixedPreviewRuntimeError {
	constructor(options: PreviewRuntimeErrorOptions);
}
export declare class LayoutValidationError extends FixedPreviewRuntimeError {
	constructor(options: PreviewRuntimeErrorOptions);
}
export declare function getPreviewRuntimeReporter(): PreviewRuntimeReporter;
export declare function getPreviewRuntimeIssues(): PreviewRuntimeIssue[];
export declare function clearPreviewRuntimeIssues(): void;
export declare function subscribePreviewRuntimeIssues(
	listener: PreviewRuntimeIssueListener,
): () => void;
export declare function setPreviewRuntimeIssueContext(
	context: PreviewRuntimeIssueContext | null,
): void;
export declare function normalizePreviewRuntimeError(
	context: PreviewRuntimeIssueContext,
	error: unknown,
): PreviewRuntimeIssue;
export declare function publishPreviewRuntimeIssue(
	issueOrError: PreviewRuntimeIssue | PreviewRuntimeError | unknown,
	context?: PreviewRuntimeIssueContext,
): PreviewRuntimeIssue;
/**
 * @deprecated use `publishPreviewRuntimeIssue(normalizePreviewRuntimeError(...))`
 */
export declare function reportPreviewRuntimeError(
	scope: string,
	error: unknown,
): void;
