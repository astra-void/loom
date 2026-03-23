// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const layoutEngineMocks = vi.hoisted(() => ({
	computeLayout: vi.fn(),
}));
const previewRuntimeMocks = vi.hoisted(() => ({
	initializeLayoutEngine: vi.fn<
		(options?: { module_or_path?: Uint8Array }) => Promise<void>
	>(() => Promise.resolve(undefined)),
	loadPreviewLayoutEngineWasmBytes: vi.fn<() => Promise<Uint8Array>>(() =>
		Promise.resolve(new Uint8Array([0x00, 0x61, 0x73, 0x6d])),
	),
}));

vi.mock("@loom-dev/layout-engine", () => ({
	compute_layout: layoutEngineMocks.computeLayout,
}));
vi.mock("@loom-dev/preview-runtime", () => ({
	initializeLayoutEngine: previewRuntimeMocks.initializeLayoutEngine,
	loadPreviewLayoutEngineWasmBytes:
		previewRuntimeMocks.loadPreviewLayoutEngineWasmBytes,
}));

describe("WasmTestApp", () => {
	beforeEach(() => {
		vi.resetModules();
		vi.restoreAllMocks();
		layoutEngineMocks.computeLayout.mockReset();
		previewRuntimeMocks.initializeLayoutEngine.mockReset();
		previewRuntimeMocks.initializeLayoutEngine.mockResolvedValue(undefined);
		previewRuntimeMocks.loadPreviewLayoutEngineWasmBytes.mockReset();
		previewRuntimeMocks.loadPreviewLayoutEngineWasmBytes.mockResolvedValue(
			new Uint8Array([0x00, 0x61, 0x73, 0x6d]),
		);
		layoutEngineMocks.computeLayout.mockReturnValue({
			CenterBox: {
				height: 100,
				width: 300,
				x: 810,
				y: 490,
			},
			Root: {
				height: 1080,
				width: 1920,
				x: 0,
				y: 0,
			},
		});
	});

	afterEach(() => {
		cleanup();
		vi.unstubAllGlobals();
	});

	it("uses the shared preview-runtime Wasm bootstrap before computing layout", async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
		const { WasmTestApp } = await import(
			"../../packages/preview/src/shell/WasmTestApp"
		);
		const { PreviewThemeProvider } = await import(
			"../../packages/preview/src/shell/theme"
		);

		render(
			<PreviewThemeProvider>
				<WasmTestApp />
			</PreviewThemeProvider>,
		);

		await waitFor(() => {
			expect(
				previewRuntimeMocks.loadPreviewLayoutEngineWasmBytes,
			).toHaveBeenCalledTimes(1);
		});
		await waitFor(() => {
			expect(previewRuntimeMocks.initializeLayoutEngine).toHaveBeenCalledWith({
				module_or_path: expect.any(Uint8Array),
			});
		});
		await waitFor(() => {
			expect(layoutEngineMocks.computeLayout).toHaveBeenCalledTimes(1);
		});

		expect(fetchMock).not.toHaveBeenCalled();
		expect(await screen.findByText(/CenterBox/)).toBeTruthy();
	});
});
