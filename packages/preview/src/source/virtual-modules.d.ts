declare module "virtual:lattice-preview-workspace-index" {
  import type { PreviewEntryPayload, PreviewWorkspaceIndex } from "@lattice-ui/preview-engine";

  export const previewProtocolVersion: number;
  export const previewEntryPayloads: Record<string, PreviewEntryPayload>;
  export const previewWorkspaceIndex: PreviewWorkspaceIndex;
  export const previewImporters: Record<
    string,
    () => Promise<Record<string, unknown> & { __previewEntryPayload: PreviewEntryPayload }>
  >;
}

declare module "virtual:lattice-preview-entry:*" {
  import type { PreviewEntryPayload } from "@lattice-ui/preview-engine";

  export const __previewEntryPayload: PreviewEntryPayload;
  const previewEntryModule: Record<string, unknown>;
  export default previewEntryModule;
}
