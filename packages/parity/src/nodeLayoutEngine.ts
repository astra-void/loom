/**
 * Force the real WASM layout engine when capturing in Node/jsdom.
 *
 * Outside a browser the runtime tries to `fetch()` the layout-engine wasm, which
 * fails and silently falls back to the TS solver. Since the audited divergences
 * live in the WASM engine — and that is what the real preview renders with — the
 * parity capture must use it. This installs a file-reading loader (mirroring
 * `tests/preview/testLayoutEngineLoader.ts`) and initialises the engine.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import {
	initializeLayoutEngine,
	setPreviewLayoutEngineLoader,
} from "@loom-dev/preview-runtime";

export function resolveDefaultWasmPath(): string {
	return path.resolve(
		process.cwd(),
		"packages/layout-engine/pkg/layout_engine_bg.wasm",
	);
}

let cachedBytes: Uint8Array | undefined;

/**
 * Install a file-backed wasm loader and initialise the layout engine. Call once
 * before rendering any scene. Defaults to the workspace's built wasm artifact;
 * pass an explicit path when running from a different cwd.
 */
export async function installNodeLayoutEngine(
	wasmPath: string = resolveDefaultWasmPath(),
): Promise<void> {
	if (!cachedBytes) {
		cachedBytes = new Uint8Array(readFileSync(wasmPath));
	}
	const bytes = cachedBytes;
	setPreviewLayoutEngineLoader(() => new Uint8Array(bytes));
	await initializeLayoutEngine();
}
