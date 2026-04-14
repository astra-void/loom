import type { PreviewEntryDescriptor } from "@loom-dev/preview-engine";
import { type PreviewRuntimeIssueContext } from "@loom-dev/preview-runtime";
export type CapturedRenderError = {
	componentStack?: string | null;
	error: unknown;
};
export declare function analyzePreviewRuntimeError(
	entry: PreviewEntryDescriptor,
	rawError: unknown | CapturedRenderError,
	defaultContext: PreviewRuntimeIssueContext,
): import("@loom-dev/preview-runtime").PreviewRuntimeIssue;
