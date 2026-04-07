// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import type { PreviewEntryDescriptor } from "../../packages/preview-engine/src/types";
import {
	createPreviewElement,
	hydratePreview,
	mountPreview,
	renderPreviewToStaticMarkup,
	renderPreviewToString,
} from "../../packages/preview/src/client";

const baseEntry: PreviewEntryDescriptor = {
	candidateExportNames: ["default"],
	capabilities: {
		supportsHotUpdate: true,
		supportsLayoutDebug: true,
		supportsPropsEditing: false,
		supportsRuntimeMock: true,
	},
	diagnosticsSummary: {
		byPhase: {
			discovery: 0,
			layout: 0,
			runtime: 0,
			transform: 0,
		},
		hasBlocking: false,
		total: 0,
	},
	hasDefaultExport: true,
	hasPreviewExport: false,
	id: "client-preview-entry",
	packageName: "@fixtures/client-preview",
	relativePath: "src/Preview.tsx",
	renderTarget: {
		exportName: "default",
		kind: "component",
		usesPreviewProps: false,
	},
	selection: {
		contract: "preview.entry",
		kind: "explicit",
	},
	sourceFilePath: "/virtual/src/Preview.tsx",
	status: "ready",
	statusDetails: {
		kind: "ready",
	},
	targetName: "client-preview",
	title: "Client Preview",
};

afterEach(() => {
	cleanup();
	delete (globalThis as typeof globalThis & { game?: unknown }).game;
	delete (globalThis as typeof globalThis & { task?: unknown }).task;
});

function createComponentEntry(): PreviewEntryDescriptor {
	return {
		...baseEntry,
	};
}

function createHarnessEntry(): PreviewEntryDescriptor {
	return {
		...baseEntry,
		hasPreviewExport: true,
		renderTarget: {
			contract: "preview.render",
			kind: "harness",
		},
		selection: {
			contract: "preview.render",
			kind: "explicit",
		},
	};
}

describe("@loom-dev/preview/client", () => {
	it("createPreviewElement renders component entries", () => {
		const previewElement = createPreviewElement({
			entry: createComponentEntry(),
			module: {
				default: function ComponentPreview() {
					return <div>component preview</div>;
				},
			},
		});

		render(previewElement);

		expect(screen.getByText("component preview")).toBeTruthy();
	});

	it("createPreviewElement renders harness entries", () => {
		const previewElement = createPreviewElement({
			entry: createHarnessEntry(),
			module: {
				preview: {
					render() {
						return <div>harness preview</div>;
					},
				},
			},
		});

		render(previewElement);

		expect(screen.getByText("harness preview")).toBeTruthy();
	});

	it("mountPreview renders into a container and restores preview globals on dispose", async () => {
		const container = document.createElement("div");
		document.body.append(container);

		let handle:
			| ReturnType<typeof mountPreview>
			| undefined;
		await act(async () => {
			handle = mountPreview({
				container,
				entry: createComponentEntry(),
				module: {
					default: function MountedPreview() {
						return <div>mounted preview</div>;
					},
				},
			});
		});

		await waitFor(() => {
			expect(container.textContent).toContain("mounted preview");
		});
		expect((globalThis as typeof globalThis & { game?: unknown }).game).toBeDefined();

		await act(async () => {
			handle?.dispose();
		});

		expect(container.textContent).toBe("");
		expect(
			(globalThis as typeof globalThis & { game?: unknown }).game,
		).toBeUndefined();
	});

	it("hydratePreview hydrates prerendered markup", async () => {
		const container = document.createElement("div");
		document.body.append(container);
		container.innerHTML = renderPreviewToString({
			entry: createComponentEntry(),
			module: {
				default: function HydratedPreview() {
					return <div>hydrated preview</div>;
				},
			},
		});

		let handle:
			| ReturnType<typeof hydratePreview>
			| undefined;
		await act(async () => {
			handle = hydratePreview({
				container,
				entry: createComponentEntry(),
				module: {
					default: function HydratedPreview() {
						return <div>hydrated preview</div>;
					},
				},
			});
		});

		await waitFor(() => {
			expect(container.textContent).toContain("hydrated preview");
		});

		await act(async () => {
			handle?.dispose();
		});
	});

	it("renderPreviewToString and renderPreviewToStaticMarkup prerender markup and restore globals", () => {
		const markup = renderPreviewToString({
			entry: createComponentEntry(),
			module: {
				default: function StringPreview() {
					return <div>string preview</div>;
				},
			},
		});
		const staticMarkup = renderPreviewToStaticMarkup({
			entry: createHarnessEntry(),
			module: {
				preview: {
					render() {
						return <div>static preview</div>;
					},
				},
			},
		});

		expect(markup).toContain("string preview");
		expect(staticMarkup).toContain("static preview");
		expect(
			(globalThis as typeof globalThis & { game?: unknown }).game,
		).toBeUndefined();
	});
});
