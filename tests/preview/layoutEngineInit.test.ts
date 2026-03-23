import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const layoutEngineMocks = vi.hoisted(() => ({
	createLayoutSession: vi.fn(),
	init: vi.fn<() => Promise<void>>(() => Promise.resolve(undefined)),
}));

vi.mock("@loom-dev/layout-engine", () => ({
	createLayoutSession: layoutEngineMocks.createLayoutSession,
	default: layoutEngineMocks.init,
}));

type PreviewRuntimeWasmModule =
	typeof import("../../packages/preview-runtime/src/layout/wasm");

describe("preview runtime layout engine initialization", () => {
	let previewRuntime: PreviewRuntimeWasmModule | undefined;

	async function loadPreviewRuntime() {
		previewRuntime = await import(
			"../../packages/preview-runtime/src/layout/wasm"
		);
		previewRuntime.setPreviewLayoutEngineLoader(null);
		return previewRuntime;
	}

	beforeEach(() => {
		vi.resetModules();
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
		layoutEngineMocks.createLayoutSession.mockReset();
		layoutEngineMocks.init.mockReset();
		layoutEngineMocks.init.mockResolvedValue(undefined);
		previewRuntime = undefined;
	});

	afterEach(() => {
		previewRuntime?.setPreviewLayoutEngineLoader(null);
		vi.unstubAllGlobals();
	});

	it("uses the layout engine package default module path when no loader is registered", async () => {
		const previewRuntime = await loadPreviewRuntime();

		await previewRuntime.initializeLayoutEngine();

		expect(layoutEngineMocks.init).toHaveBeenCalledTimes(1);
		expect(layoutEngineMocks.init).toHaveBeenCalledWith(undefined);
	});

	it("loads and validates the browser Wasm asset through the shared helper", async () => {
		const wasmUrl = (
			await import("@loom-dev/layout-engine/layout_engine_bg.wasm?url")
		).default;
		const expectedFetchUrl = new URL(wasmUrl, "http://localhost/").toString();
		const wasmBytes = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00]);
		const fetchMock = vi
			.spyOn(globalThis, "fetch")
			.mockResolvedValue(new Response(wasmBytes, { status: 200 }));

		vi.stubGlobal("window", {
			location: { href: "http://localhost/" },
		});
		const previewRuntime = await loadPreviewRuntime();

		await expect(
			previewRuntime.loadPreviewLayoutEngineWasmBytes(),
		).resolves.toEqual(wasmBytes);
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(fetchMock).toHaveBeenCalledWith(expectedFetchUrl);
	});

	it("fails shared Wasm loading when the magic header is invalid", async () => {
		const invalidBytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response(invalidBytes, { status: 200 }),
		);

		vi.stubGlobal("window", {
			location: { href: "http://localhost/" },
		});
		const previewRuntime = await loadPreviewRuntime();

		await expect(
			previewRuntime.loadPreviewLayoutEngineWasmBytes(),
		).rejects.toThrow(/Invalid Wasm binary header .* received 50 4b 03 04/i);
	});

	it("fetches the browser Wasm asset when window is available and no loader is registered", async () => {
		const wasmUrl = (
			await import("@loom-dev/layout-engine/layout_engine_bg.wasm?url")
		).default;
		const expectedFetchUrl = new URL(wasmUrl, "http://localhost/").toString();
		const wasmBytes = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00]);
		const fetchMock = vi
			.spyOn(globalThis, "fetch")
			.mockResolvedValue(new Response(wasmBytes, { status: 200 }));

		vi.stubGlobal("window", {
			location: { href: "http://localhost/" },
		});
		const previewRuntime = await loadPreviewRuntime();

		await previewRuntime.initializeLayoutEngine();
		expect(layoutEngineMocks.init).toHaveBeenCalledTimes(1);

		const initArg = layoutEngineMocks.init.mock.calls[0]?.[0] as
			| { module_or_path: Promise<Uint8Array> | Uint8Array }
			| undefined;
		expect(initArg).toBeDefined();
		const loadedBytes = await initArg?.module_or_path;
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(fetchMock).toHaveBeenCalledWith(expectedFetchUrl);
		expect(loadedBytes).toBeInstanceOf(Uint8Array);
		expect(Array.from(loadedBytes ?? [])).toEqual(Array.from(wasmBytes));
	});

	it("prefers the registered loader over the browser Wasm fetch path", async () => {
		const wasmBytes = new Uint8Array([0x00, 0x61, 0x73, 0x6d]);
		const loader = vi.fn(() => wasmBytes);
		const fetchMock = vi.spyOn(globalThis, "fetch");

		vi.stubGlobal("window", {
			location: { href: "http://localhost/" },
		});
		const previewRuntime = await loadPreviewRuntime();
		previewRuntime.setPreviewLayoutEngineLoader(loader);
		await previewRuntime.initializeLayoutEngine();

		expect(fetchMock).not.toHaveBeenCalled();
		expect(loader).toHaveBeenCalledTimes(1);
		expect(layoutEngineMocks.init).toHaveBeenCalledWith({
			module_or_path: wasmBytes,
		});
	});

	it("uses explicit init input without consulting the default or registered loaders", async () => {
		const explicitBytes = new Uint8Array([0x00, 0x61, 0x73, 0x6d]);
		const loader = vi.fn(() => new Uint8Array([0x01, 0x02, 0x03, 0x04]));
		const fetchMock = vi.spyOn(globalThis, "fetch");

		vi.stubGlobal("window", {
			location: { href: "http://localhost/" },
		});
		const previewRuntime = await loadPreviewRuntime();
		previewRuntime.setPreviewLayoutEngineLoader(loader);

		await previewRuntime.initializeLayoutEngine({
			module_or_path: explicitBytes,
		});

		expect(fetchMock).not.toHaveBeenCalled();
		expect(loader).not.toHaveBeenCalled();
		expect(layoutEngineMocks.init).toHaveBeenCalledWith({
			module_or_path: explicitBytes,
		});
	});
});
