import type { PreviewWorkspaceIndex } from "@loom-dev/preview-engine";
import type { PreviewWorkspaceModuleImporter } from "./loadPreviewModule";
export type PreviewWorkspaceSnapshot = {
    importers: Record<string, PreviewWorkspaceModuleImporter>;
    workspaceIndex: PreviewWorkspaceIndex;
};
export declare function getInitialPreviewWorkspaceSnapshot(): PreviewWorkspaceSnapshot;
export declare function reloadPreviewWorkspaceSnapshot(): Promise<PreviewWorkspaceSnapshot>;
