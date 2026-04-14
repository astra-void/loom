import type {
	PreviewDiagnostic,
	PreviewEntryDescriptor,
} from "@loom-dev/preview-engine";
import { type PreviewRuntimeIssue } from "@loom-dev/preview-runtime";
import { type CapturedRenderError } from "./analyzeRuntimeError";
export type PreviewReadyWarningState = {
	degradedTargets: string[];
	fidelity: "degraded" | "preserved" | null;
	warningCodes: string[];
};
export declare function isPreviewBlockingIssue(
	issue:
		| Pick<PreviewDiagnostic, "blocking" | "severity">
		| Pick<PreviewRuntimeIssue, "blocking" | "severity">,
): boolean;
export declare function getPreviewReadyWarningState(
	statusDetails: PreviewEntryDescriptor["statusDetails"] | undefined,
	diagnostics: PreviewDiagnostic[],
	runtimeIssues: PreviewRuntimeIssue[],
): PreviewReadyWarningState;
export declare function describePreviewWarningState(
	warningState: PreviewReadyWarningState,
): string;
export type { PreviewModule } from "../client/render";
export {
	createPreviewRenderNode,
	readPreviewDefinition,
} from "../client/render";
export declare function createPreviewLoadIssue(
	entry: PreviewEntryDescriptor,
	error: unknown,
): PreviewRuntimeIssue;
export declare function createPreviewRenderIssue(
	entry: PreviewEntryDescriptor,
	error: unknown | CapturedRenderError,
): PreviewRuntimeIssue;
