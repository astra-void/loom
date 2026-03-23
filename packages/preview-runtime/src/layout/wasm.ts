import initLayoutEngine, { createLayoutSession } from "@loom-dev/layout-engine";
import type { LayoutSessionLike } from "./controller";
import { normalizePreviewLayoutResult, type PreviewLayoutNode } from "./model";

const LAYOUT_ENGINE_LOADER_KEY = "__loom_preview_layout_engine_loader__";
const EXPECTED_WASM_MAGIC_HEADER = [0x00, 0x61, 0x73, 0x6d] as const;

export type PreviewLayoutEngineModuleOrPath =
	| ArrayBuffer
	| Promise<ArrayBuffer | Uint8Array | URL | WebAssembly.Module | string>
	| Uint8Array
	| URL
	| WebAssembly.Module
	| string;

export type PreviewLayoutEngineInitOptions = {
	module_or_path?: PreviewLayoutEngineModuleOrPath;
};

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

function isValidLayoutEngineWasmMagic(bytes: Uint8Array): boolean {
	return EXPECTED_WASM_MAGIC_HEADER.every(
		(value, index) => bytes[index] === value,
	);
}

function formatLayoutEngineWasmHeader(bytes: Uint8Array): string {
	return Array.from(bytes.slice(0, EXPECTED_WASM_MAGIC_HEADER.length))
		.map((value) => value.toString(16).padStart(2, "0"))
		.join(" ");
}

export async function loadPreviewLayoutEngineWasmBytes(): Promise<Uint8Array> {
	if (typeof window === "undefined" || typeof fetch !== "function") {
		throw new Error(
			"Layout engine Wasm fetch path is unavailable outside a browser-like environment.",
		);
	}

	const { default: layoutEngineWasmUrl } = await import(
		"@loom-dev/layout-engine/layout_engine_bg.wasm?url"
	);
	const response = await fetch(resolveLayoutEngineWasmUrl(layoutEngineWasmUrl));
	if (!response.ok) {
		throw new Error(
			`Failed to fetch layout engine Wasm (${response.status}) from ${layoutEngineWasmUrl}`,
		);
	}

	const bytes = new Uint8Array(await response.arrayBuffer());
	if (!isValidLayoutEngineWasmMagic(bytes)) {
		throw new Error(
			`Invalid Wasm binary header from ${layoutEngineWasmUrl}. Expected 00 61 73 6d, received ${formatLayoutEngineWasmHeader(bytes)}`,
		);
	}

	return bytes;
}

function getDefaultPreviewLayoutEngineLoader(): PreviewLayoutEngineLoader | null {
	if (typeof window === "undefined" || typeof fetch !== "function") {
		return null;
	}

	return () => createLazyPromise(loadPreviewLayoutEngineWasmBytes);
}

export function initializeLayoutEngine(
	options?: PreviewLayoutEngineInitOptions,
): Promise<void> {
	if (!layoutEngineInitPromise) {
		const loader =
			options?.module_or_path === undefined
				? (getPreviewLayoutEngineLoader() ??
					getDefaultPreviewLayoutEngineLoader())
				: null;
		const moduleOrPath = options?.module_or_path ?? loader?.();
		layoutEngineInitPromise = initLayoutEngine(
			moduleOrPath === undefined
				? undefined
				: {
						module_or_path: moduleOrPath,
					},
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
