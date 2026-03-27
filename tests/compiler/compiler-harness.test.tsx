// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "../testUserEvent";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const compilerMocks = vi.hoisted(() => ({
	compileTsx: vi.fn<(code: string) => string>(),
}));

vi.mock("@loom-dev/compiler/wasm", () => ({
	compile_tsx: compilerMocks.compileTsx,
}));

describe("compiler harness", () => {
	beforeEach(() => {
		compilerMocks.compileTsx.mockReset();
		compilerMocks.compileTsx.mockImplementation((code: string) => {
			if (code.includes("Missing closing tag")) {
				throw new Error("Unexpected end of input");
			}

			return [
				"export const App = () => null;",
				`// emitted from ${code.length} chars`,
			].join("\n");
		});
	});

	afterEach(() => {
		cleanup();
	});

	it("renders the default sample and compiles it", async () => {
		const { App } = await import("../../apps/compiler-harness/src/App");

		render(React.createElement(App));

		await waitFor(() => {
			expect(compilerMocks.compileTsx).toHaveBeenCalled();
		});

		expect(screen.getByText("Ready")).toBeTruthy();
		expect(screen.getByText(/emitted from/)).toBeTruthy();
		expect(screen.getByRole("button", { name: /Renderable/i })).toBeTruthy();
	});

	it("updates the output when the source changes", async () => {
		const { App } = await import("../../apps/compiler-harness/src/App");

		render(React.createElement(App));

		const editor = await screen.findByLabelText("Compiler input");
		await userEvent.clear(editor);
		await userEvent.type(
			editor,
			`export const App = () => <textlabel Text="Updated" />;`,
		);

		await waitFor(() => {
			expect(screen.getByText(/emitted from/)).toBeTruthy();
		});

		expect(compilerMocks.compileTsx).toHaveBeenCalled();
		expect(screen.getByDisplayValue(/Updated/)).toBeTruthy();
	});

	it("shows the error state for malformed TSX", async () => {
		const { App } = await import("../../apps/compiler-harness/src/App");

		render(React.createElement(App));

		const brokenButton = await screen.findByRole("button", { name: /Broken/i });
		await userEvent.click(brokenButton);

		await waitFor(() => {
			expect(
				screen.getByText("Compilation failed", { selector: ".error-title" }),
			).toBeTruthy();
		});

		expect(screen.getByText(/Unexpected end of input/)).toBeTruthy();
	});
});

