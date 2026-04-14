import {
	type PreviewLayoutDebugNode,
	type PreviewLayoutNode,
	type PreviewLayoutResult,
} from "./model";
export type LayoutSessionViewport = {
	height: number;
	width: number;
};
export interface LayoutSessionLike {
	applyNodes(nodes: PreviewLayoutNode[]): void;
	computeDirty(): PreviewLayoutResult;
	dispose(): void;
	removeNodes(nodeIds: string[]): void;
	setViewport(viewport: LayoutSessionViewport): void;
}
type LayoutControllerOptions = {
	sessionFactory?: () => LayoutSessionLike;
};
export declare class LayoutController {
	private readonly options;
	private readonly childIdsByParent;
	private readonly dirtyNodeIds;
	private readonly dirtyRootIds;
	private readonly nodes;
	private debugNodesById;
	private pendingRemovedIds;
	private pendingUpsertIds;
	private lastWasmComputeFailureSummary;
	private viewportDirty;
	private sessionNeedsRebuild;
	private result;
	private rootIds;
	private session;
	private viewport;
	constructor(options?: LayoutControllerOptions);
	compute(options?: { isReady?: boolean }): PreviewLayoutResult;
	dispose(): void;
	getDebugNode(nodeId: string): PreviewLayoutDebugNode | null;
	getRect(nodeId: string): import("./model").ComputedRect | null;
	hasNodes(): boolean;
	removeNode(nodeId: string): boolean;
	setViewport(viewport: LayoutSessionViewport): boolean;
	upsertNode(node: PreviewLayoutNode): boolean;
	private assertCompatibleNodeIdentity;
	private buildDebugTree;
	private collectSubtreeIds;
	private computeFallbackSubtreeFromRect;
	private computeGridChildren;
	private computeListChildren;
	private computeFallbackSubtree;
	private computeFallback;
	private computeWithSession;
	private getOrCreateSession;
	private markDirtyFromNode;
	private rebuildRelationships;
	private collectUnsupportedLayoutCapabilities;
	private resolveRootId;
}
