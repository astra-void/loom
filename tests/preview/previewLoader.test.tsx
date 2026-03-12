// @vitest-environment jsdom

import type {
	PreviewEntryDescriptor,
	PreviewEntryPayload,
} from "@loom-dev/preview-engine";
import { cleanup, render, screen } from "@testing-library/react";
import type React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadPreviewModule } from "../../packages/preview/src/shell/loadPreviewModule";
import { PreviewApp } from "../../packages/preview/src/shell/PreviewApp";
import { PreviewThemeProvider } from "../../packages/preview/src/shell/theme";

const PREVIEW_PROTOCOL_VERSION = 4;

function createEntryDescriptor(
	overrides: Partial<PreviewEntryDescriptor> &
		Pick<PreviewEntryDescriptor, "id" | "relativePath" | "title">,
): PreviewEntryDescriptor {
	return {
		candidateExportNames: [],
		capabilities: {
			supportsHotUpdate: true,
			supportsLayoutDebug: true,
			supportsPropsEditing: true,
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
		id: overrides.id,
		packageName: overrides.packageName ?? "@fixtures/workspace-preview",
		relativePath: overrides.relativePath,
		renderTarget:
			overrides.renderTarget ??
			({
				exportName: "default",
				kind: "component",
				usesPreviewProps: false,
			} as const),
		selection:
			overrides.selection ??
			({
				contract: "preview.entry",
				kind: "explicit",
			} as const),
		sourceFilePath: overrides.sourceFilePath ?? `/virtual/${overrides.id}`,
		status: overrides.status ?? "ready",
		statusDetails: overrides.statusDetails ?? ({ kind: "ready" } as const),
		targetName: overrides.targetName ?? "fixture",
		title: overrides.title,
		...overrides,
	};
}

function createPayload(entry: PreviewEntryDescriptor): PreviewEntryPayload {
	return {
		descriptor: entry,
		diagnostics: [],
		graphTrace: {
			boundaryHops: [],
			imports: [],
			selection: {
				importChain: [],
				symbolChain: [],
			},
		},
		protocolVersion: PREVIEW_PROTOCOL_VERSION,
		runtimeAdapter: {
			kind: "react-dom",
			moduleId: "virtual:loom-preview-runtime",
		},
		transform: {
			mode: "compatibility",
			outcome: {
				fidelity: "preserved",
				kind: "ready",
			},
		},
	};
}

function renderPreviewApp(app: React.ReactElement) {
	return render(<PreviewThemeProvider>{app}</PreviewThemeProvider>);
}

function createRetryableOptimizerError() {
	return Object.assign(
		new Error(
			'There is a new version of the pre-bundle for "/src/Test.tsx", a page reload is going to ask for it.',
		),
		{
			code: "ERR_OUTDATED_OPTIMIZED_DEP",
		},
	);
}

afterEach(() => {
	cleanup();
});

describe("loadPreviewModule", () => {
	it("retries transient optimized dependency invalidation errors and renders the preview", async () => {
		const entry = createEntryDescriptor({
			id: "fixture:Test.tsx",
			relativePath: "Test.tsx",
			title: "Test",
		});
		const payload = createPayload(entry);
		const importer = vi
			.fn<() => Promise<Record<string, unknown>>>()
			.mockRejectedValueOnce(createRetryableOptimizerError())
			.mockResolvedValue({
				default: () => <button type="button">Recovered preview</button>,
			});

		renderPreviewApp(
			<PreviewApp
				entries={[entry]}
				initialSelectedId={entry.id}
				loadEntry={() =>
					loadPreviewModule(importer).then((module) => ({
						module,
						payload,
					}))
				}
				projectName="@fixtures/workspace-preview"
			/>,
		);

		expect(
			await screen.findByRole("button", { name: "Recovered preview" }),
		).toBeTruthy();
		expect(importer).toHaveBeenCalledTimes(2);
	});

	it("surfaces a load error after the retryable import failure persists", async () => {
		const entry = createEntryDescriptor({
			id: "fixture:Broken.tsx",
			relativePath: "Broken.tsx",
			title: "Broken",
		});
		const importer = vi
			.fn<() => Promise<Record<string, unknown>>>()
			.mockRejectedValue(createRetryableOptimizerError());

		renderPreviewApp(
			<PreviewApp
				entries={[entry]}
				initialSelectedId={entry.id}
				loadEntry={() =>
					loadPreviewModule(importer).then((module) => ({
						module,
						payload: createPayload(entry),
					}))
				}
				projectName="@fixtures/workspace-preview"
			/>,
		);

		expect(
			await screen.findByText("Preview module failed to load."),
		).toBeTruthy();
		expect(importer).toHaveBeenCalledTimes(2);
	});
});
