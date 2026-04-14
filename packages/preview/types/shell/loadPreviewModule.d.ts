import type { PreviewEntryPayload } from "@loom-dev/preview-engine";
export type PreviewWorkspaceModule = Record<string, unknown> & {
    __previewEntryPayload?: PreviewEntryPayload;
};
export type PreviewWorkspaceModuleImporter = () => Promise<PreviewWorkspaceModule>;
export declare function loadPreviewModule(importer: PreviewWorkspaceModuleImporter): Promise<PreviewWorkspaceModule>;
