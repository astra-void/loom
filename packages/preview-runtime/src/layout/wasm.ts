import initLayoutEngine, { createLayoutSession } from "@loom-dev/layout-engine";
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

function resolveLayoutEngineWasmUrl(url: string): string {
	try {
		return new URL(url).toString();
	} catch {
		const baseUrl =
			typeof window !== "undefined" &&
			window.location &&
			typeof window.location.href === "string"
				? window.location.href
				: typeof document !== "undefined" &&
						typeof document.baseURI === "string"
					? document.baseURI
					: undefined;

		if (!baseUrl) {
			return url;
		}

		return new URL(url, baseUrl).toString();
	}
}

function createLazyPromise<T>(factory: () => Promise<T>): Promise<T> {
	let promise: Promise<T> | undefined;

	const getPromise = () => {
		if (!promise) {
			promise = factory();
		}

		return promise;
	};

	return new Proxy(Object.create(null), {
		get(_target, property) {
			if (property === Symbol.toStringTag) {
				return "Promise";
			}

			if (
				property !== "then" &&
				property !== "catch" &&
				property !== "finally"
			) {
				return undefined;
			}

			const activePromise = getPromise();
			const value = activePromise[property];
			return typeof value === "function" ? value.bind(activePromise) : value;
		},
	}) as Promise<T>;
}

function getDefaultPreviewLayoutEngineLoader(): PreviewLayoutEngineLoader | null {
	if (typeof window === "undefined" || typeof fetch !== "function") {
		return null;
	}

	return () =>
		createLazyPromise(async () => {
			const { default: layoutEngineWasmUrl } = await import(
				"@loom-dev/layout-engine/layout_engine_bg.wasm?url"
			);
			const response = await fetch(
				resolveLayoutEngineWasmUrl(layoutEngineWasmUrl),
			);
			if (!response.ok) {
				throw new Error(
					`Failed to fetch layout engine Wasm (${response.status}) from ${layoutEngineWasmUrl}`,
				);
			}

			return new Uint8Array(await response.arrayBuffer());
		});
}

export function initializeLayoutEngine(): Promise<void> {
	if (!layoutEngineInitPromise) {
		const loader =
			getPreviewLayoutEngineLoader() ?? getDefaultPreviewLayoutEngineLoader();
		layoutEngineInitPromise = initLayoutEngine(
			loader
				? {
						module_or_path: loader(),
					}
				: undefined,
		)
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
