import type { LayoutSessionLike } from "./controller";
import { type PreviewLayoutNode } from "./model";
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
export declare function sanitizePreviewLayoutNodes(
	nodes: PreviewLayoutNode[],
): PreviewLayoutNode[];
export declare function setPreviewLayoutEngineLoader(
	loader: PreviewLayoutEngineLoader | null,
): void;
export declare function resolveLayoutEngineWasmUrl(url: string): string;
export declare function loadPreviewLayoutEngineWasmBytes(): Promise<Uint8Array>;
export declare function initializeLayoutEngine(
	options?: PreviewLayoutEngineInitOptions,
): Promise<void>;
export declare function createWasmLayoutSession(): LayoutSessionLike;
