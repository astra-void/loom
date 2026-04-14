// @vitest-environment jsdom

import type {
	PreviewDiagnostic,
	PreviewEngineUpdate,
	PreviewEntryDescriptor,
	PreviewEntryPayload,
	PreviewWorkspaceIndex,
} from "@loom-dev/preview-engine";
import type { PreviewRuntimeIssue } from "@loom-dev/preview-runtime";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PREVIEW_ENGINE_PROTOCOL_VERSION } from "../../packages/preview-engine/src/types";
import userEvent from "../testUserEvent";

type MockImporter = () => Promise<Record<string, unknown>>;
type MockWorkspaceSnapshot = {
	entryPayloads: Record<string, PreviewEntryPayload>;
	importers: Record<string, MockImporter>;
	workspaceIndex: PreviewWorkspaceIndex;
};

const previewAppMocks = vi.hoisted(() => ({
	lastProps: undefined as
		| {
				entries: PreviewEntryDescriptor[];
				entryPayloads?: Record<string, PreviewEntryPayload>;
				loadEntry: (id: string) => Promise<unknown>;
				projectName: string;
		  }
		| undefined,
}));

const runtimeMocks = vi.hoisted(() => ({
	listener: undefined as ((issues: PreviewRuntimeIssue[]) => void) | undefined,
	subscribePreviewRuntimeIssues: vi.fn(),
}));

const moduleLoadMocks = vi.hoisted(() => ({
	loadPreviewModule: vi.fn(),
}));

const workspaceSnapshotMocks = vi.hoisted(() => ({
	initialSnapshot: undefined as MockWorkspaceSnapshot | undefined,
	reloadSnapshot: undefined as MockWorkspaceSnapshot | undefined,
	getInitialPreviewWorkspaceSnapshot: vi.fn(),
	reloadPreviewWorkspaceSnapshot: vi.fn(),
}));

vi.mock("@loom-dev/preview-runtime", () => ({
	subscribePreviewRuntimeIssues: runtimeMocks.subscribePreviewRuntimeIssues,
}));

vi.mock("../../packages/preview/src/shell/loadPreviewModule", () => ({
	loadPreviewModule: moduleLoadMocks.loadPreviewModule,
}));

vi.mock("../../packages/preview/src/shell/workspaceSnapshot", () => ({
	getInitialPreviewWorkspaceSnapshot:
		workspaceSnapshotMocks.getInitialPreviewWorkspaceSnapshot,
	reloadPreviewWorkspaceSnapshot:
		workspaceSnapshotMocks.reloadPreviewWorkspaceSnapshot,
}));

vi.mock("../../packages/preview/src/shell/PreviewApp", () => ({
	PreviewApp: (props: {
		entries: PreviewEntryDescriptor[];
		entryPayloads?: Record<string, PreviewEntryPayload>;
		loadEntry: (id: string) => Promise<unknown>;
		projectName: string;
	}) => {
		previewAppMocks.lastProps = props;

		return (
			<div>
				<div data-testid="project-name">{props.projectName}</div>
				{props.entries.map((entry) => (
					<button
						key={entry.id}
						onClick={() => {
							void props.loadEntry(entry.id);
						}}
						type="button"
					>
						{entry.title}
					</button>
				))}
			</div>
		);
	},
}));

function createEntryDescriptor(
	overrides: Partial<PreviewEntryDescriptor> &
		Pick<PreviewEntryDescriptor, "id" | "relativePath" | "title">,
): PreviewEntryDescriptor {
	const { id, relativePath, title, ...rest } = overrides;

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
		hasDefaultExport: false,
		hasPreviewExport: false,
		id,
		packageName: overrides.packageName ?? "@preview-fixtures/preview-shell",
		relativePath,
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
		sourceFilePath: overrides.sourceFilePath ?? `/virtual/${id}`,
		status: overrides.status ?? "ready",
		statusDetails:
			overrides.statusDetails ??
			({
				kind: "ready",
			} as const),
		targetName: overrides.targetName ?? "fixture",
		title,
		...rest,
	};
}

function createPayload(
	entry: PreviewEntryDescriptor,
	diagnostics: PreviewDiagnostic[] = [],
): PreviewEntryPayload {
	return {
		descriptor: entry,
		diagnostics,
		graphTrace: {
			boundaryHops: [],
			imports: [],
			selection: {
				importChain: [],
				symbolChain: [],
			},
		},
		protocolVersion: PREVIEW_ENGINE_PROTOCOL_VERSION,
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

function createWorkspaceSnapshot(
	entries: PreviewEntryDescriptor[],
	options?: {
		projectName?: string;
		payloads?: Record<string, PreviewEntryPayload>;
	},
): MockWorkspaceSnapshot {
	const payloads =
		options?.payloads ??
		Object.fromEntries(
			entries.map((entry) => [entry.id, createPayload(entry)]),
		);
	const importers = Object.fromEntries(
		Object.entries(payloads).map(([entryId, payload]) => [
			entryId,
			vi.fn(async () => ({
				__previewEntryPayload: payload,
				default: () => null,
			})),
		]),
	) as Record<string, MockImporter>;

	return {
		entryPayloads: payloads,
		importers,
		workspaceIndex: {
			entries,
			projectName: options?.projectName ?? "Workspace Preview",
			protocolVersion: PREVIEW_ENGINE_PROTOCOL_VERSION,
			targets: [],
		},
	};
}

function createUpdate(
	workspaceIndex: PreviewWorkspaceIndex,
	overrides: Partial<PreviewEngineUpdate> = {},
): PreviewEngineUpdate {
	return {
		changedEntryIds: [],
		executionChangedEntryIds: [],
		protocolVersion: PREVIEW_ENGINE_PROTOCOL_VERSION,
		registryChangedEntryIds: [],
		removedEntryIds: [],
		requiresFullReload: false,
		workspaceChanged: true,
		workspaceIndex,
		...overrides,
	};
}

function createRuntimeIssue(
	overrides: Partial<PreviewRuntimeIssue> = {},
): PreviewRuntimeIssue {
	return {
		blocking: false,
		code: "RUNTIME_WARNING",
		entryId: "alpha.tsx",
		file: "/virtual/alpha.tsx",
		kind: "RuntimeMockError",
		phase: "runtime",
		relativeFile: "alpha.tsx",
		severity: "warning",
		summary: "Runtime warning",
		target: "fixture",
		...overrides,
	};
}

function createHotContext() {
	const listeners = new Map<
		string,
		Set<(payload: PreviewEngineUpdate) => void>
	>();

	return {
		emit(event: string, payload: PreviewEngineUpdate) {
			for (const listener of listeners.get(event) ?? []) {
				listener(payload);
			}
		},
		off: vi.fn(
			(event: string, callback: (payload: PreviewEngineUpdate) => void) => {
				listeners.get(event)?.delete(callback);
			},
		),
		on: vi.fn(
			(event: string, callback: (payload: PreviewEngineUpdate) => void) => {
				const eventListeners = listeners.get(event) ?? new Set();
				eventListeners.add(callback);
				listeners.set(event, eventListeners);
			},
		),
		send: vi.fn(),
	};
}

async function renderWorkspaceApp() {
	const { PreviewWorkspaceApp } = await import(
		"../../packages/preview/src/shell/PreviewWorkspaceApp"
	);

	return render(<PreviewWorkspaceApp />);
}

beforeEach(() => {
	vi.resetModules();
	previewAppMocks.lastProps = undefined;
	moduleLoadMocks.loadPreviewModule.mockReset();
	moduleLoadMocks.loadPreviewModule.mockImplementation(
		(importer: MockImporter) => importer(),
	);

	runtimeMocks.listener = undefined;
	runtimeMocks.subscribePreviewRuntimeIssues.mockReset();
	runtimeMocks.subscribePreviewRuntimeIssues.mockImplementation(
		(listener: (issues: PreviewRuntimeIssue[]) => void) => {
			runtimeMocks.listener = listener;
			return () => {
				if (runtimeMocks.listener === listener) {
					runtimeMocks.listener = undefined;
				}
			};
		},
	);

	workspaceSnapshotMocks.getInitialPreviewWorkspaceSnapshot.mockReset();
	workspaceSnapshotMocks.getInitialPreviewWorkspaceSnapshot.mockImplementation(
		() => workspaceSnapshotMocks.initialSnapshot,
	);
	workspaceSnapshotMocks.reloadPreviewWorkspaceSnapshot.mockReset();
	workspaceSnapshotMocks.reloadPreviewWorkspaceSnapshot.mockImplementation(
		async () => workspaceSnapshotMocks.reloadSnapshot,
	);

	delete (globalThis as typeof globalThis & { __loomPreviewHot?: unknown })
		.__loomPreviewHot;
});

afterEach(() => {
	cleanup();
	delete (globalThis as typeof globalThis & { __loomPreviewHot?: unknown })
		.__loomPreviewHot;
});

describe("PreviewWorkspaceApp", () => {
	it("renders normally without a hot bridge", async () => {
		const alphaEntry = createEntryDescriptor({
			id: "alpha.tsx",
			relativePath: "alpha.tsx",
			title: "Alpha",
		});
		const initialSnapshot = createWorkspaceSnapshot([alphaEntry]);
		workspaceSnapshotMocks.initialSnapshot = initialSnapshot;
		workspaceSnapshotMocks.reloadSnapshot = initialSnapshot;

		await renderWorkspaceApp();

		expect(await screen.findByRole("button", { name: "Alpha" })).toBeTruthy();
		expect(screen.getByTestId("project-name").textContent).toBe(
			"Workspace Preview",
		);
		expect(runtimeMocks.subscribePreviewRuntimeIssues).not.toHaveBeenCalled();
	});

	it("refreshes the workspace snapshot after a hot update", async () => {
		const alphaEntry = createEntryDescriptor({
			id: "alpha.tsx",
			relativePath: "alpha.tsx",
			title: "Alpha",
		});
		const updatedAlphaEntry = createEntryDescriptor({
			id: "alpha.tsx",
			relativePath: "alpha.tsx",
			title: "Alpha Updated",
		});
		const initialSnapshot = createWorkspaceSnapshot([alphaEntry]);
		const reloadedSnapshot = createWorkspaceSnapshot([updatedAlphaEntry]);
		workspaceSnapshotMocks.initialSnapshot = initialSnapshot;
		workspaceSnapshotMocks.reloadSnapshot = reloadedSnapshot;

		const hot = createHotContext();
		(
			globalThis as typeof globalThis & { __loomPreviewHot?: unknown }
		).__loomPreviewHot = hot;

		await renderWorkspaceApp();
		expect(await screen.findByRole("button", { name: "Alpha" })).toBeTruthy();

		await act(async () => {
			hot.emit(
				"loom-preview:update",
				createUpdate(reloadedSnapshot.workspaceIndex, {
					changedEntryIds: [updatedAlphaEntry.id],
				}),
			);
		});

		await waitFor(() => {
			expect(
				screen.getByRole("button", { name: "Alpha Updated" }),
			).toBeTruthy();
		});
		expect(moduleLoadMocks.loadPreviewModule).toHaveBeenCalledWith(
			reloadedSnapshot.importers[updatedAlphaEntry.id],
		);
	});

	it("loads a newly added entry from the refreshed importer map", async () => {
		const alphaEntry = createEntryDescriptor({
			id: "alpha.tsx",
			relativePath: "alpha.tsx",
			title: "Alpha",
		});
		const betaEntry = createEntryDescriptor({
			id: "beta.tsx",
			relativePath: "beta.tsx",
			title: "Beta",
		});
		const initialSnapshot = createWorkspaceSnapshot([alphaEntry]);
		const reloadedSnapshot = createWorkspaceSnapshot([betaEntry]);
		workspaceSnapshotMocks.initialSnapshot = initialSnapshot;
		workspaceSnapshotMocks.reloadSnapshot = reloadedSnapshot;

		const hot = createHotContext();
		(
			globalThis as typeof globalThis & { __loomPreviewHot?: unknown }
		).__loomPreviewHot = hot;
		const user = userEvent.setup();

		await renderWorkspaceApp();
		expect(await screen.findByRole("button", { name: "Alpha" })).toBeTruthy();

		await act(async () => {
			hot.emit(
				"loom-preview:update",
				createUpdate(reloadedSnapshot.workspaceIndex, {
					removedEntryIds: [alphaEntry.id],
				}),
			);
		});

		await waitFor(() => {
			expect(screen.getByRole("button", { name: "Beta" })).toBeTruthy();
		});

		await user.click(screen.getByRole("button", { name: "Beta" }));

		await waitFor(() => {
			expect(moduleLoadMocks.loadPreviewModule).toHaveBeenCalledTimes(1);
		});
		expect(moduleLoadMocks.loadPreviewModule).toHaveBeenCalledWith(
			reloadedSnapshot.importers[betaEntry.id],
		);
	});

	it("forwards runtime issues through the hot bridge", async () => {
		const alphaEntry = createEntryDescriptor({
			id: "alpha.tsx",
			relativePath: "alpha.tsx",
			title: "Alpha",
		});
		const initialSnapshot = createWorkspaceSnapshot([alphaEntry]);
		workspaceSnapshotMocks.initialSnapshot = initialSnapshot;
		workspaceSnapshotMocks.reloadSnapshot = initialSnapshot;

		const hot = createHotContext();
		(
			globalThis as typeof globalThis & { __loomPreviewHot?: unknown }
		).__loomPreviewHot = hot;

		await renderWorkspaceApp();
		expect(await screen.findByRole("button", { name: "Alpha" })).toBeTruthy();
		expect(runtimeMocks.subscribePreviewRuntimeIssues).toHaveBeenCalledTimes(1);

		const issues = [createRuntimeIssue()];

		act(() => {
			runtimeMocks.listener?.(issues);
		});

		expect(hot.send).toHaveBeenCalledWith(
			"loom-preview:runtime-issues",
			issues,
		);
	});
});
