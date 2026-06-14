declare module "virtual:loom-preview-workspace-index" {
	import type { PreviewWorkspaceIndex } from "@loom-dev/preview-engine";

	export const previewProtocolVersion: number;
	export const previewWorkspaceIndex: PreviewWorkspaceIndex;
	export const previewImporters: Record<
		string,
		() => Promise<Record<string, unknown>>
	>;
}
