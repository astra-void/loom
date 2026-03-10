import { normalizePreviewNodeId } from "../internal/robloxValues";
import {
  areNodesEqual,
  computeNodeRect,
  createEmptyLayoutResult,
  createViewportRect,
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

function compareIds(left: string, right: string) {
  return left.localeCompare(right);
}

function cloneViewport(viewport: LayoutSessionViewport): LayoutSessionViewport {
  return {
    height: viewport.height,
    width: viewport.width,
  };
}

function buildDebugNodeMap(
  nodes: PreviewLayoutDebugNode[],
  map = new Map<string, PreviewLayoutDebugNode>(),
): Map<string, PreviewLayoutDebugNode> {
  for (const node of nodes) {
    map.set(node.id, node);
    buildDebugNodeMap(node.children, map);
  }

  return map;
}

export class LayoutController {
  private readonly childIdsByParent = new Map<string, string[]>();
  private readonly dirtyNodeIds = new Set<string>();
  private readonly dirtyRootIds = new Set<string>();
  private readonly nodes = new Map<string, PreviewLayoutNode>();
  private debugNodesById = new Map<string, PreviewLayoutDebugNode>();
  private pendingRemovedIds = new Set<string>();
  private result: PreviewLayoutResult = createEmptyLayoutResult({ height: 0, width: 0 });
  private rootIds: string[] = [];
  private session: LayoutSessionLike | null = null;
  private viewport: LayoutSessionViewport = {
    height: 0,
    width: 0,
  };

  public constructor(private readonly options: LayoutControllerOptions = {}) {}

  public compute(preferSession: boolean): PreviewLayoutResult {
    const nextResult = preferSession ? this.computeWithSession() : this.computeFallback();
    this.result = nextResult;
    this.debugNodesById = buildDebugNodeMap(nextResult.debug.roots);
    this.dirtyNodeIds.clear();
    this.dirtyRootIds.clear();
    this.pendingRemovedIds.clear();
    return nextResult;
  }

  public dispose() {
    this.session?.dispose();
    this.session = null;
    this.childIdsByParent.clear();
    this.debugNodesById.clear();
    this.dirtyNodeIds.clear();
    this.dirtyRootIds.clear();
    this.nodes.clear();
    this.pendingRemovedIds.clear();
    this.result = createEmptyLayoutResult({ height: 0, width: 0 });
    this.rootIds = [];
  }

  public getDebugNode(nodeId: string): PreviewLayoutDebugNode | null {
    const normalizedNodeId = normalizePreviewNodeId(nodeId) ?? nodeId;
    return this.debugNodesById.get(normalizedNodeId) ?? null;
  }

  public getRect(nodeId: string) {
    const normalizedNodeId = normalizePreviewNodeId(nodeId) ?? nodeId;
    return this.result.rects[normalizedNodeId] ?? null;
  }

  public hasNodes() {
    return this.nodes.size > 0;
  }

  public removeNode(nodeId: string): boolean {
    const normalizedNodeId = normalizePreviewNodeId(nodeId) ?? nodeId;
    const existingNode = this.nodes.get(normalizedNodeId);
    if (!existingNode) {
      return false;
    }

    const affectedIds = this.collectSubtreeIds(normalizedNodeId);
    this.markDirtyFromNode(normalizedNodeId);
    for (const affectedId of affectedIds) {
      this.nodes.delete(affectedId);
      this.dirtyNodeIds.add(affectedId);
      this.pendingRemovedIds.add(affectedId);
    }

    this.rebuildRelationships();
    this.session?.removeNodes(affectedIds);
    return true;
  }

  public setViewport(viewport: LayoutSessionViewport): boolean {
    if (this.viewport.width === viewport.width && this.viewport.height === viewport.height) {
      return false;
    }

    this.viewport = cloneViewport(viewport);
    this.session?.setViewport(viewport);
    for (const rootId of this.rootIds) {
      this.dirtyRootIds.add(rootId);
    }
    for (const nodeId of this.nodes.keys()) {
      this.dirtyNodeIds.add(nodeId);
    }
    return true;
  }

  public upsertNode(node: PreviewLayoutNode): boolean {
    const previousNode = this.nodes.get(node.id);
    if (previousNode && areNodesEqual(previousNode, node)) {
      return false;
    }

    if (previousNode) {
      this.markDirtyFromNode(previousNode.id);
      if (previousNode.parentId && previousNode.parentId !== node.parentId) {
        this.markDirtyFromNode(previousNode.parentId);
      }
    }

    this.nodes.set(node.id, node);
    this.rebuildRelationships();
    this.markDirtyFromNode(node.id);
    this.dirtyNodeIds.add(node.id);
    this.session?.applyNodes([node]);
    return true;
  }

  private buildDebugTree(
    nodeId: string,
    parentConstraints: { height: number; width: number; x: number; y: number } | null,
    provenance: "fallback" | "wasm",
  ): PreviewLayoutDebugNode | null {
    const node = this.nodes.get(nodeId);
    if (!node) {
      return null;
    }

    const rect = this.result.rects[nodeId] ?? null;
    const childIds = this.childIdsByParent.get(nodeId) ?? [];

    return {
      children: childIds
        .map((childId) => this.buildDebugTree(childId, rect, provenance))
        .filter((child): child is PreviewLayoutDebugNode => child !== null),
      debugLabel: node.debugLabel,
      id: node.id,
      intrinsicSize: node.intrinsicSize ?? null,
      kind: node.kind,
      layoutSource: node.kind === "root" ? "root-default" : node.layout.size ? "explicit-size" : "intrinsic-size",
      nodeType: node.nodeType,
      parentConstraints,
      parentId: node.parentId,
      provenance: {
        detail:
          provenance === "wasm" ? "computed by layout-engine session" : "computed by preview-runtime fallback solver",
        source: provenance,
      },
      rect,
      styleHints: node.styleHints,
    };
  }

  private collectSubtreeIds(nodeId: string, visited = new Set<string>()): string[] {
    if (visited.has(nodeId)) {
      return [];
    }

    visited.add(nodeId);
    const childIds = this.childIdsByParent.get(nodeId) ?? [];
    const descendants = childIds.flatMap((childId) => this.collectSubtreeIds(childId, visited));
    return [nodeId, ...descendants];
  }

  private computeFallback(): PreviewLayoutResult {
    if (this.nodes.size === 0) {
      return createEmptyLayoutResult(this.viewport);
    }

    const dirtyRootIds = this.getDirtyRootIds();
    const nextRects: Record<string, { height: number; width: number; x: number; y: number }> = {
      ...this.result.rects,
    };

    for (const removedId of this.pendingRemovedIds) {
      delete nextRects[removedId];
    }

    const viewportRect = createViewportRect(this.viewport.width, this.viewport.height);

    for (const rootId of dirtyRootIds) {
      for (const affectedId of this.collectSubtreeIds(rootId)) {
        delete nextRects[affectedId];
      }

      this.computeFallbackSubtree(rootId, viewportRect, nextRects);
    }

    const provisionalResult: PreviewLayoutResult = {
      debug: createEmptyLayoutResult(this.viewport).debug,
      dirtyNodeIds: [...new Set([...this.getDirtyNodeIds(), ...this.pendingRemovedIds])].sort(compareIds),
      rects: nextRects,
    };

    this.result = provisionalResult;

    return {
      debug: {
        dirtyNodeIds: provisionalResult.dirtyNodeIds,
        roots: this.rootIds
          .map((rootId) => this.buildDebugTree(rootId, viewportRect, "fallback"))
          .filter((node): node is PreviewLayoutDebugNode => node !== null),
        viewport: cloneViewport(this.viewport),
      },
      dirtyNodeIds: provisionalResult.dirtyNodeIds,
      rects: provisionalResult.rects,
    };
  }

  private computeFallbackSubtree(
    nodeId: string,
    parentRect: { height: number; width: number; x: number; y: number },
    output: Record<string, { height: number; width: number; x: number; y: number }>,
  ) {
    const node = this.nodes.get(nodeId);
    if (!node) {
      return;
    }

    const { rect } = computeNodeRect(node, parentRect);
    output[node.id] = rect;

    const childIds = this.childIdsByParent.get(nodeId) ?? [];
    for (const childId of childIds) {
      this.computeFallbackSubtree(childId, rect, output);
    }
  }

  private computeWithSession(): PreviewLayoutResult {
    const session = this.getOrCreateSession();
    const nextResult = session.computeDirty();
    return {
      ...nextResult,
      debug: {
        ...nextResult.debug,
        dirtyNodeIds: [...nextResult.dirtyNodeIds].sort(compareIds),
        roots: nextResult.debug.roots,
        viewport: cloneViewport(this.viewport),
      },
      dirtyNodeIds: [...nextResult.dirtyNodeIds].sort(compareIds),
      rects: nextResult.rects,
    };
  }

  private getDirtyRootIds() {
    if (this.dirtyRootIds.size > 0) {
      return [...this.dirtyRootIds].sort(compareIds);
    }

    if (Object.keys(this.result.rects).length === 0) {
      return [...this.rootIds];
    }

    return [];
  }

  private getDirtyNodeIds() {
    if (this.dirtyNodeIds.size > 0) {
      return [...this.dirtyNodeIds].sort(compareIds);
    }

    if (Object.keys(this.result.rects).length === 0) {
      return [...this.nodes.keys()].sort(compareIds);
    }

    return [];
  }

  private getOrCreateSession() {
    if (!this.session) {
      const nextSession = this.options.sessionFactory?.();
      if (!nextSession) {
        throw new Error("Layout session factory did not return a session.");
      }

      this.session = nextSession;
      this.session.setViewport(this.viewport);
      if (this.nodes.size > 0) {
        this.session.applyNodes([...this.nodes.values()]);
      }
    }

    return this.session;
  }

  private markDirtyFromNode(nodeId: string) {
    const rootId = this.resolveRootId(nodeId);
    if (rootId) {
      this.dirtyRootIds.add(rootId);
    }
  }

  private rebuildRelationships() {
    this.childIdsByParent.clear();

    for (const node of this.nodes.values()) {
      if (!node.parentId) {
        continue;
      }

      const existing = this.childIdsByParent.get(node.parentId) ?? [];
      if (!existing.includes(node.id)) {
        existing.push(node.id);
        existing.sort(compareIds);
        this.childIdsByParent.set(node.parentId, existing);
      }
    }

    this.rootIds = [...this.nodes.values()]
      .filter((node) => !node.parentId || !this.nodes.has(node.parentId))
      .map((node) => node.id)
      .sort(compareIds);
  }

  private resolveRootId(nodeId: string) {
    let cursor: string | undefined = nodeId;
    let lastKnownId: string | undefined;
    const visited = new Set<string>();

    while (cursor) {
      if (visited.has(cursor)) {
        return lastKnownId ?? cursor;
      }

      visited.add(cursor);
      const node = this.nodes.get(cursor);
      if (!node) {
        return lastKnownId;
      }

      lastKnownId = node.id;
      cursor = node.parentId && this.nodes.has(node.parentId) ? node.parentId : undefined;
    }

    return lastKnownId;
  }
}
