import { type WorkspaceDiscoveryEntryState } from "./previewGraphWasm";
import type {
	CreatePreviewEngineOptions,
	PreviewEntryDescriptor,
	PreviewWorkspaceIndex,
} from "./types";
type TargetContext = {
	exclude?: string[];
	include?: string[];
	packageName: string;
	packageRoot: string;
	name: string;
	sourceRoot: string;
	targetName: string;
};
export type DiscoveredEntryState = WorkspaceDiscoveryEntryState & {
	target: TargetContext;
};
export type WorkspaceDiscoverySnapshot = {
	entryDependencyPathsById: Map<string, string[]>;
	entryStatesById: Map<string, DiscoveredEntryState>;
	workspaceIndex: PreviewWorkspaceIndex;
};
export declare function discoverWorkspaceState(
	options: Pick<
		CreatePreviewEngineOptions,
		"projectName" | "targets" | "workspaceRoot"
	>,
): {
	entryDependencyPathsById: Map<string, string[]>;
	entryStatesById: Map<string, DiscoveredEntryState>;
	workspaceIndex: {
		entries: PreviewEntryDescriptor[];
		projectName: string;
		protocolVersion: number;
		targets: import("./types").PreviewSourceTarget[];
	};
};
