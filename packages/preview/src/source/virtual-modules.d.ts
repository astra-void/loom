declare module "virtual:loom-preview-workspace-index" {
	import type {
		PreviewEntryPayload,
		PreviewWorkspaceIndex,
	} from "@loom-dev/preview-engine";

	export const previewProtocolVersion: number;
	export const previewWorkspaceIndex: PreviewWorkspaceIndex;
	export const previewImporters: Record<
		string,
		() => Promise<
			Record<string, unknown> & { __previewEntryPayload: PreviewEntryPayload }
		>
	>;
}

declare module "virtual:loom-preview-entry:*" {
	import type { PreviewEntryPayload } from "@loom-dev/preview-engine";

	export const __previewEntryPayload: PreviewEntryPayload;
	const previewEntryModule: Record<string, unknown>;
	export default previewEntryModule;
}
