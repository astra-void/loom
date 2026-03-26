// @vitest-environment jsdom

import { TextDecoder, TextEncoder } from "node:util";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const appMocks = vi.hoisted(() => ({
	previewWorkspaceApp: vi.fn(),
	wasmTestApp: vi.fn(),
}));

vi.mock("../../packages/preview/src/shell/PreviewWorkspaceApp", () => ({
	PreviewWorkspaceApp: () => appMocks.previewWorkspaceApp(),
}));

vi.mock("../../packages/preview/src/shell/WasmTestApp", () => ({
	WasmTestApp: () => appMocks.wasmTestApp(),
}));

describe("preview harness shell", () => {
	beforeAll(() => {
		globalThis.TextEncoder = TextEncoder as typeof globalThis.TextEncoder;
		globalThis.TextDecoder = TextDecoder as typeof globalThis.TextDecoder;
		globalThis.Uint8Array = new globalThis.TextEncoder().encode("")
			.constructor as typeof globalThis.Uint8Array;
	});

	afterEach(() => {
		cleanup();
		appMocks.previewWorkspaceApp.mockReset();
		appMocks.wasmTestApp.mockReset();
		window.history.replaceState({}, "", "/");
	});

	it("provides system defaults to the workspace app branch", async () => {
		const { useSystem } = await import("../../packages/preview/src/index");

		function WorkspaceProbe() {
			const { density, mode, resolvedTheme } = useSystem();

			return (
				<div data-testid="workspace-probe">
					workspace:{density}:{mode}:{resolvedTheme}
				</div>
			);
		}

		function WasmProbe() {
			const { density, mode, resolvedTheme } = useSystem();

			return (
				<div data-testid="wasm-probe">
					wasm:{density}:{mode}:{resolvedTheme}
				</div>
			);
		}

		appMocks.previewWorkspaceApp.mockImplementation(() => <WorkspaceProbe />);
		appMocks.wasmTestApp.mockImplementation(() => <WasmProbe />);

		const { App } = await import("../../apps/preview-harness/src/App");
		render(<App />);

		await waitFor(() => {
			expect(screen.getByTestId("workspace-probe").textContent).toBe(
				"workspace:comfortable:system:light",
			);
		});
		expect(appMocks.previewWorkspaceApp).toHaveBeenCalledTimes(1);
		expect(appMocks.wasmTestApp).not.toHaveBeenCalled();
	});

	it("provides system defaults to the wasm branch", async () => {
		const { useSystem } = await import("../../packages/preview/src/index");

		function WorkspaceProbe() {
			const { density, mode, resolvedTheme } = useSystem();

			return (
				<div data-testid="workspace-probe">
					workspace:{density}:{mode}:{resolvedTheme}
				</div>
			);
		}

		function WasmProbe() {
			const { density, mode, resolvedTheme } = useSystem();

			return (
				<div data-testid="wasm-probe">
					wasm:{density}:{mode}:{resolvedTheme}
				</div>
			);
		}

		window.history.replaceState({}, "", "/?mode=wasm");
		appMocks.previewWorkspaceApp.mockImplementation(() => <WorkspaceProbe />);
		appMocks.wasmTestApp.mockImplementation(() => <WasmProbe />);

		const { App } = await import("../../apps/preview-harness/src/App");
		render(<App />);

		await waitFor(() => {
			expect(screen.getByTestId("wasm-probe").textContent).toBe(
				"wasm:comfortable:system:light",
			);
		});
		expect(appMocks.wasmTestApp).toHaveBeenCalledTimes(1);
		expect(appMocks.previewWorkspaceApp).not.toHaveBeenCalled();
	});

	it("mounts a portal container for scene content", async () => {
		const { Portal, usePortalContext } = await import(
			"@loom-dev/preview-runtime"
		);
		const { PreviewRenderShell } = await import(
			"../../packages/preview/src/shell/PreviewRenderShell"
		);

		function PortalProbe() {
			const { container } = usePortalContext();

			return (
				<div data-testid="portal-probe">
					{container ? "portal-ready" : "portal-missing"}
				</div>
			);
		}

		function PortalScene() {
			return (
				<Portal>
					<button type="button">Portal child</button>
				</Portal>
			);
		}

		render(
			<PreviewRenderShell>
				<PortalProbe />
				<PortalScene />
			</PreviewRenderShell>,
		);

		await waitFor(() => {
			expect(screen.getByTestId("portal-probe").textContent).toBe(
				"portal-ready",
			);
		});
		expect(screen.getByRole("button", { name: "Portal child" })).toBeTruthy();
	});
});
