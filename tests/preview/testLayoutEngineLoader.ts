import { readFileSync } from "node:fs";
import path from "node:path";
import { setPreviewLayoutEngineLoader } from "@loom-dev/preview-runtime";

const TEST_LAYOUT_WASM_PATH = path.resolve(
	process.cwd(),
	"packages/layout-engine/pkg/layout_engine_bg.wasm",
);

let cachedWasmBytes: Uint8Array | undefined;

function getTestLayoutWasmBytes() {
	if (!cachedWasmBytes) {
		cachedWasmBytes = new Uint8Array(readFileSync(TEST_LAYOUT_WASM_PATH));
	}

	return cachedWasmBytes;
}

export function installTestPreviewLayoutEngineLoader() {
	const wasmBytes = getTestLayoutWasmBytes();
	setPreviewLayoutEngineLoader(() => new Uint8Array(wasmBytes));
}

export function resetTestPreviewLayoutEngineLoader() {
	setPreviewLayoutEngineLoader(null);
}
