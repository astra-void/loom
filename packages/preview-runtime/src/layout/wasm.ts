import initLayoutEngine, { createLayoutSession } from "@loom-dev/layout-engine";
import layoutEngineWasmUrl from "@loom-dev/layout-engine/layout_engine_bg.wasm?url";
import type { LayoutSessionLike } from "./controller";
import { normalizePreviewLayoutResult, type PreviewLayoutNode } from "./model";

const LAYOUT_ENGINE_LOADER_KEY = "__loom_preview_layout_engine_loader__";

export type PreviewLayoutEngineModuleOrPath =
	| ArrayBuffer
	| Promise<ArrayBuffer | Uint8Array | URL | WebAssembly.Module | string>
	| Uint8Array
	| URL
	| WebAssembly.Module
	| string;

export type PreviewLayoutEngineLoader = () => PreviewLayoutEngineModuleOrPath;

let layoutEngineInitPromise: Promise<void> | undefined;

function getPreviewLayoutEngineLoader() {
	const globalRecord = globalThis as typeof globalThis & {
		[LAYOUT_ENGINE_LOADER_KEY]?: PreviewLayoutEngineLoader | null;
	};

	return globalRecord[LAYOUT_ENGINE_LOADER_KEY] ?? null;
}

export function setPreviewLayoutEngineLoader(
	loader: PreviewLayoutEngineLoader | null,
) {
	const globalRecord = globalThis as typeof globalThis & {
		[LAYOUT_ENGINE_LOADER_KEY]?: PreviewLayoutEngineLoader | null;
	};

	globalRecord[LAYOUT_ENGINE_LOADER_KEY] = loader;
}

export function initializeLayoutEngine(): Promise<void> {
	if (!layoutEngineInitPromise) {
		const loader = getPreviewLayoutEngineLoader();
		const moduleOrPath = loader ? loader() : layoutEngineWasmUrl;
		layoutEngineInitPromise = initLayoutEngine({
			module_or_path: moduleOrPath,
		})
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
		return normalizePreviewLayoutResult(
			this.session.computeDirty() as unknown,
			this.viewport,
		);
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
