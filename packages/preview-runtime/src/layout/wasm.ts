import initLayoutEngine, { createLayoutSession } from "@lattice-ui/layout-engine";
import layoutEngineWasmUrl from "@lattice-ui/layout-engine/layout_engine_bg.wasm?url";
import { type LayoutSessionLike } from "./controller";
import { normalizePreviewLayoutResult, type PreviewLayoutNode } from "./model";

let layoutEngineInitPromise: Promise<void> | undefined;

export function initializeLayoutEngine(): Promise<void> {
  if (!layoutEngineInitPromise) {
    layoutEngineInitPromise = initLayoutEngine({ module_or_path: layoutEngineWasmUrl })
      .then(() => undefined)
      .catch((error: unknown) => {
        layoutEngineInitPromise = undefined;
        throw error;
      });
  }

  return layoutEngineInitPromise;
}

class WasmLayoutSessionAdapter implements LayoutSessionLike {
  private readonly session = createLayoutSession();
  private viewport = {
    height: 0,
    width: 0,
  };

  public applyNodes(nodes: PreviewLayoutNode[]): void {
    this.session.applyNodes(nodes);
  }

  public computeDirty() {
    return normalizePreviewLayoutResult(this.session.computeDirty() as unknown, this.viewport);
  }

  public dispose(): void {
    this.session.dispose();
  }

  public removeNodes(nodeIds: string[]): void {
    this.session.removeNodes(nodeIds);
  }

  public setViewport(viewport: { height: number; width: number }): void {
    this.viewport = viewport;
    this.session.setViewport(viewport);
  }
}

export function createWasmLayoutSession(): LayoutSessionLike {
  return new WasmLayoutSessionAdapter();
}
