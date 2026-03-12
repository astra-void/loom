import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPreviewHeadlessSession } from "../../packages/preview/src/headless";
import {
	suppressExpectedConsoleMessages,
	suppressExpectedStderrMessages,
} from "../testLogUtils";

const temporaryRoots: string[] = [];
let restoreExpectedLogs: (() => void) | undefined;

beforeEach(() => {
	const restoreConsole = suppressExpectedConsoleMessages({
		error: [
			"[vite] (ssr) Error when evaluating SSR module",
			"load failed",
			"render failed",
			"HeadlessRenderBoundary",
		],
		warn: ["DEGRADED_HOST_RENDER"],
	});
	const restoreStderr = suppressExpectedStderrMessages([
		/\[vite\] \(ssr\) Error when evaluating SSR module/,
		/load failed/,
	]);

	restoreExpectedLogs = () => {
		restoreConsole();
		restoreStderr();
	};
});

afterEach(() => {
	restoreExpectedLogs?.();
	restoreExpectedLogs = undefined;
	vi.restoreAllMocks();
	for (const root of temporaryRoots.splice(0)) {
		fs.rmSync(root, { force: true, recursive: true });
	}
});

function createTempPreviewPackage(files: Record<string, string>) {
	const packageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "loom-headless-"));
	temporaryRoots.push(packageRoot);

	for (const [relativePath, content] of Object.entries(files)) {
		const filePath = path.join(packageRoot, relativePath);
		fs.mkdirSync(path.dirname(filePath), { recursive: true });
		fs.writeFileSync(filePath, content, "utf8");
	}

	if (!fs.existsSync(path.join(packageRoot, "package.json"))) {
		fs.writeFileSync(
			path.join(packageRoot, "package.json"),
			JSON.stringify({ name: "@fixtures/headless-preview" }, null, 2),
			"utf8",
		);
	}

	return packageRoot;
}

describe("createPreviewHeadlessSession", () => {
	it("renders preview.entry and preview.render entries into execution results", async () => {
		const packageRoot = createTempPreviewPackage({
			"src/ComponentEntry.tsx": `
				export function ComponentEntry() {
					return <frame Id="component-root"><textlabel Id="component-label" Text="Component" /></frame>;
				}

				export const preview = {
					entry: ComponentEntry,
				};
			`,
			"src/HarnessEntry.tsx": `
				export function HarnessCard() {
					return <frame Id="harness-card"><textlabel Id="harness-label" Text="Harness" /></frame>;
				}

				export const preview = {
					render: () => <HarnessCard />,
				};
			`,
		});

		const session = await createPreviewHeadlessSession({ cwd: packageRoot });

		try {
			const snapshot = session.getSnapshot();
			const componentId = snapshot.workspaceIndex.entries.find((entry) =>
				entry.relativePath.endsWith("ComponentEntry.tsx"),
			)?.id;
			const harnessId = snapshot.workspaceIndex.entries.find((entry) =>
				entry.relativePath.endsWith("HarnessEntry.tsx"),
			)?.id;

			expect(componentId).toBeTruthy();
			expect(harnessId).toBeTruthy();
			if (!componentId || !harnessId) {
				throw new Error("Expected component and harness entries to exist.");
			}

			expect(snapshot.execution.entries[componentId]).toMatchObject({
				render: {
					status: "rendered",
				},
				severity: "pass",
			});
			expect(snapshot.execution.entries[harnessId]).toMatchObject({
				render: {
					status: "rendered",
				},
				severity: "pass",
			});
		} finally {
			session.dispose();
		}
	});

	it("records load and render failures as runtime-blocking execution results", async () => {
		const packageRoot = createTempPreviewPackage({
			"src/LoadFailure.tsx": `
				throw new Error("load failed");

				export function LoadFailure() {
					return <frame />;
				}

				export const preview = {
					entry: LoadFailure,
				};
			`,
			"src/RenderFailure.tsx": `
				export function RenderFailure() {
					throw new Error("render failed");
				}

				export const preview = {
					entry: RenderFailure,
				};
			`,
		});

		const session = await createPreviewHeadlessSession({ cwd: packageRoot });

		try {
			const snapshot = session.getSnapshot();
			const loadEntryId = snapshot.workspaceIndex.entries.find((entry) =>
				entry.relativePath.endsWith("LoadFailure.tsx"),
			)?.id;
			const renderEntryId = snapshot.workspaceIndex.entries.find((entry) =>
				entry.relativePath.endsWith("RenderFailure.tsx"),
			)?.id;

			expect(loadEntryId).toBeTruthy();
			expect(renderEntryId).toBeTruthy();
			if (!loadEntryId || !renderEntryId) {
				throw new Error("Expected load and render failure entries to exist.");
			}

			expect(snapshot.execution.entries[loadEntryId]).toMatchObject({
				loadIssue: expect.objectContaining({
					code: "MODULE_LOAD_ERROR",
				}),
				render: {
					status: "load_failed",
				},
				severity: "error",
			});
			expect(snapshot.execution.entries[renderEntryId]).toMatchObject({
				render: {
					status: "render_failed",
				},
				renderIssue: expect.objectContaining({
					code: "RENDER_ERROR",
				}),
				severity: "error",
			});
			expect(snapshot.entries[loadEntryId]?.descriptor.status).toBe(
				"blocked_by_runtime",
			);
			expect(snapshot.entries[renderEntryId]?.descriptor.status).toBe(
				"blocked_by_runtime",
			);
		} finally {
			session.dispose();
		}
	});

	it("captures degraded host warnings, layout debug, and viewport metadata", async () => {
		const packageRoot = createTempPreviewPackage({
			"src/ViewportEntry.tsx": `
				export function ViewportEntry() {
					return (
						<screengui Id="viewport-screen">
							<viewportframe Id="viewport-frame" />
						</screengui>
					);
				}

				export const preview = {
					entry: ViewportEntry,
				};
			`,
		});

		const session = await createPreviewHeadlessSession({ cwd: packageRoot });

		try {
			const snapshot = session.getSnapshot();
			const entryId = snapshot.workspaceIndex.entries[0]?.id;
			expect(entryId).toBeTruthy();
			if (!entryId) {
				throw new Error("Expected viewport entry to exist.");
			}

			expect(snapshot.execution.entries[entryId]).toMatchObject({
				degradedHostWarnings: [
					expect.objectContaining({
						code: "DEGRADED_HOST_RENDER",
						target: "ViewportFrame",
					}),
				],
				render: {
					status: "rendered",
				},
				severity: "warning",
				viewport: {
					height: 600,
					ready: true,
					source: "window-fallback",
					width: 800,
				},
				warningState: {
					degradedTargets: ["ViewportFrame"],
					fidelity: "degraded",
				},
			});
			expect(snapshot.execution.entries[entryId]?.layoutDebug).toEqual(
				expect.objectContaining({
					viewport: {
						height: 600,
						width: 800,
					},
				}),
			);
			expect(snapshot.entries[entryId]?.descriptor.status).toBe("ready");
		} finally {
			session.dispose();
		}
	});

	it("waits for delayed effect mounts before finalizing layout debug", async () => {
		const packageRoot = createTempPreviewPackage({
			"src/DelayedEntry.tsx": `
				import React from "react";

				export function DelayedEntry() {
					const [ready, setReady] = React.useState(false);

					React.useEffect(() => {
						const timeoutId = window.setTimeout(() => {
							setReady(true);
						}, 0);

						return () => {
							window.clearTimeout(timeoutId);
						};
					}, []);

					if (!ready) {
						return null;
					}

					return (
						<screengui Id="delayed-screen">
							<frame Id="delayed-frame">
								<textlabel Id="delayed-label" Text="Delayed label" />
							</frame>
						</screengui>
					);
				}

				export const preview = {
					entry: DelayedEntry,
				};
			`,
		});

		let session: Awaited<
			ReturnType<typeof createPreviewHeadlessSession>
		> | null = null;

		try {
			session = await createPreviewHeadlessSession({ cwd: packageRoot });
			const snapshot = session.getSnapshot();
			const entryId = snapshot.workspaceIndex.entries[0]?.id;
			expect(entryId).toBeTruthy();
			if (!entryId) {
				throw new Error("Expected delayed entry to exist.");
			}

			expect(snapshot.execution.entries[entryId]?.render.status).toBe(
				"rendered",
			);
			expect(
				String(
					JSON.stringify(snapshot.execution.entries[entryId]?.layoutDebug),
				).includes("delayed-label"),
			).toBe(true);
		} finally {
			session?.dispose();
		}
	});

	it("restores temporary preview globals after headless execution", async () => {
		const packageRoot = createTempPreviewPackage({
			"src/RestoreProbe.tsx": `
				export function RestoreProbe() {
					return <frame Id="restore-probe" />;
				}

				export const preview = {
					entry: RestoreProbe,
				};
			`,
		});
		const probeKey = "__loom_headless_restore_probe__";
		const globalPrototypeHost = Object.getPrototypeOf(globalThis);
		const initialGlobalPrototypeParent = globalPrototypeHost
			? Object.getPrototypeOf(globalPrototypeHost)
			: null;

		expect(probeKey in globalThis).toBe(false);

		const session = await createPreviewHeadlessSession({ cwd: packageRoot });

		try {
			expect(session.getSnapshot().workspaceIndex.entries).toHaveLength(1);
		} finally {
			session.dispose();
		}

		expect(probeKey in globalThis).toBe(false);
		expect(
			globalPrototypeHost
				? Object.getPrototypeOf(globalPrototypeHost)
				: initialGlobalPrototypeParent,
		).toBe(initialGlobalPrototypeParent);
	});
});
