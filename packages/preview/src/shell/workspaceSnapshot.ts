import {
	previewImporters,
	previewWorkspaceIndex,
} from "virtual:loom-preview-workspace-index";
import type { PreviewWorkspaceIndex } from "@loom-dev/preview-engine";
import type { PreviewWorkspaceModuleImporter } from "./loadPreviewModule";

const RESOLVED_WORKSPACE_MODULE_URL =
	"/@id/__x00__virtual:loom-preview-workspace-index";

type PreviewWorkspaceModule = {
	previewImporters: Record<string, PreviewWorkspaceModuleImporter>;
	previewWorkspaceIndex: PreviewWorkspaceIndex;
};

export type PreviewWorkspaceSnapshot = {
	importers: Record<string, PreviewWorkspaceModuleImporter>;
	workspaceIndex: PreviewWorkspaceIndex;
};

function toPreviewWorkspaceSnapshot(
	module: PreviewWorkspaceModule,
): PreviewWorkspaceSnapshot {
	return {
		importers: module.previewImporters,
		workspaceIndex: module.previewWorkspaceIndex,
	};
}

export function getInitialPreviewWorkspaceSnapshot() {
	return toPreviewWorkspaceSnapshot({
		previewImporters,
		previewWorkspaceIndex,
	});
}

export async function reloadPreviewWorkspaceSnapshot() {
	const module = (await import(
		/* @vite-ignore */ `${RESOLVED_WORKSPACE_MODULE_URL}?t=${Date.now()}`
	)) as PreviewWorkspaceModule;

	return toPreviewWorkspaceSnapshot(module);
}
