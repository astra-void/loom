import type { PreviewEntryDescriptor } from "@loom-dev/preview-engine";
import type { PreviewLayoutDebugPayload, PreviewRuntimeIssue } from "@loom-dev/preview-runtime";
import type { PreviewDevServer } from "../source/viteTypes";
import { type PreviewHeadlessEntryRenderResult, type PreviewHeadlessEntryViewport } from "./headlessTypes";
type HeadlessCollectedEntryExecution = {
    issues: PreviewRuntimeIssue[];
    layoutDebug: PreviewLayoutDebugPayload | null;
    loadIssue: PreviewRuntimeIssue | null;
    render: PreviewHeadlessEntryRenderResult;
    renderIssue: PreviewRuntimeIssue | null;
    viewport: PreviewHeadlessEntryViewport;
};
export declare function executeHeadlessEntry(server: PreviewDevServer, entry: PreviewEntryDescriptor, runtimeModuleId: string): Promise<HeadlessCollectedEntryExecution>;
export {};
