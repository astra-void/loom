import { type PreviewEngine } from "@loom-dev/preview-engine";
import type { ResolvedPreviewConfig } from "./config";
import { type PreviewHeadlessSnapshot } from "./execution/headlessTypes";
import { type StartPreviewServerInput } from "./source/server";
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
export declare function createPreviewHeadlessSession(
	options?: CreatePreviewHeadlessSessionOptions,
): Promise<PreviewHeadlessSession>;
