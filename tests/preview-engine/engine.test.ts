import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createPreviewEngine } from "@loom-dev/preview-engine";
import type { PreviewRuntimeIssue } from "@loom-dev/preview-runtime";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { resolveRealFilePath } from "../../packages/preview-engine/src/pathUtils";

const temporaryRoots: string[] = [];
let compiler: Awaited<typeof import("../../packages/compiler/sync.mjs")>;

beforeAll(async () => {
	compiler = await import("../../packages/compiler/sync.mjs");
});

afterAll(() => {
	compiler = undefined as never;
});

afterEach(() => {
	for (const root of temporaryRoots.splice(0)) {
		fs.rmSync(root, { force: true, recursive: true });
	}
});

function createTempPreviewPackage(files: Record<string, string>) {
	const packageRoot = fs.mkdtempSync(
		path.join(os.tmpdir(), "loom-preview-engine-"),
	);
	temporaryRoots.push(packageRoot);

	for (const [relativePath, content] of Object.entries(files)) {
		const filePath = path.join(packageRoot, relativePath);
		fs.mkdirSync(path.dirname(filePath), { recursive: true });
		fs.writeFileSync(filePath, content, "utf8");
	}

	if (!fs.existsSync(path.join(packageRoot, "package.json"))) {
		fs.writeFileSync(
			path.join(packageRoot, "package.json"),
			JSON.stringify({ name: "@fixtures/preview-engine" }),
			"utf8",
		);
	}

	return {
		packageRoot,
		sourceRoot: path.join(packageRoot, "src"),
	};
}

function createTempPreviewWorkspace(
	packages: Record<string, Record<string, string>>,
) {
	const workspaceRoot = fs.mkdtempSync(
		path.join(os.tmpdir(), "loom-preview-workspace-engine-"),
	);
	temporaryRoots.push(workspaceRoot);
	fs.writeFileSync(
		path.join(workspaceRoot, "pnpm-workspace.yaml"),
		'packages:\n  - "packages/*"\n',
		"utf8",
	);

	const packageMap = new Map<
		string,
		{
			packageRoot: string;
			sourceRoot: string;
		}
	>();

	for (const [packageName, files] of Object.entries(packages)) {
		const packageSlug = packageName.split("/").pop() ?? packageName;
		const packageRoot = path.join(workspaceRoot, "packages", packageSlug);
		const sourceRoot = path.join(packageRoot, "src");
		packageMap.set(packageName, { packageRoot, sourceRoot });

		for (const [relativePath, content] of Object.entries(files)) {
			const filePath = path.join(packageRoot, relativePath);
			fs.mkdirSync(path.dirname(filePath), { recursive: true });
			fs.writeFileSync(filePath, content, "utf8");
		}

		if (!fs.existsSync(path.join(packageRoot, "package.json"))) {
			fs.writeFileSync(
				path.join(packageRoot, "package.json"),
				JSON.stringify({ name: packageName }, null, 2),
				"utf8",
			);
		}
	}

	return {
		getPackage(packageName: string) {
			const target = packageMap.get(packageName);
			if (!target) {
				throw new Error(`Unknown workspace package: ${packageName}`);
			}

			return target;
		},
		workspaceRoot,
	};
}

function createEngineForPackage(
	packageRoot: string,
	sourceRoot: string,
	transformMode:
		| "strict-fidelity"
		| "compatibility"
		| "mocked"
		| "design-time" = "strict-fidelity",
) {
	return createPreviewEngine({
		compiler,
		projectName: "Fixture Preview",
		targets: [
			{
				name: "fixture",
				packageName: "@fixtures/preview-engine",
				packageRoot,
				sourceRoot,
			},
		],
		transformMode,
	});
}

function sanitizePaths<T>(value: T, packageRoot: string): T {
	const normalizedRoots = new Set([
		packageRoot.replace(/\\/g, "/"),
		resolveRealFilePath(packageRoot).replace(/\\/g, "/"),
		`/private${packageRoot.replace(/\\/g, "/")}`,
	]);
	const visit = (current: unknown): unknown => {
		if (typeof current === "string") {
			let next = current.replace(/\\/g, "/");
			for (const normalizedRoot of normalizedRoots) {
				next = next.replaceAll(normalizedRoot, "<pkg>");
			}

			next = next.replaceAll("/private<pkg>", "<pkg>");
			return next;
		}

		if (Array.isArray(current)) {
			return current.map(visit);
		}

		if (current && typeof current === "object") {
			return Object.fromEntries(
				Object.entries(current).map(([key, nextValue]) => [
					key,
					visit(nextValue),
				]),
			);
		}

		return current;
	};

	return visit(value) as T;
}

describe("createPreviewEngine", () => {
	it("keeps legacy-only entries in needs_harness without auto-render selection", () => {
		const { packageRoot, sourceRoot } = createTempPreviewPackage({
			"src/Legacy.loom.tsx": `
        export function Legacy() {
          return <frame />;
        }
      `,
		});

		const engine = createEngineForPackage(packageRoot, sourceRoot);

		expect(engine.getWorkspaceIndex().entries[0]).toMatchObject({
			relativePath: "Legacy.loom.tsx",
			renderTarget: {
				kind: "none",
				reason: "missing-explicit-contract",
			},
			selection: {
				kind: "unresolved",
				reason: "missing-explicit-contract",
			},
			status: "needs_harness",
			statusDetails: {
				kind: "needs_harness",
				reason: "missing-explicit-contract",
			},
		});
	});

	it("resolves preview.entry through imported and re-exported symbols", () => {
		const { packageRoot, sourceRoot } = createTempPreviewPackage({
			"src/Showcase.tsx": `
        export function Showcase() {
          return <frame />;
        }
      `,
			"src/ReExport.loom.tsx": `
        import { Showcase } from "./Showcase";

        export { Showcase as ExplicitCard };

        export const preview = ({
          entry: Showcase,
          props: {
            checked: true,
          },
          title: "Explicit Card",
        }) as const;
      `,
		});

		const engine = createEngineForPackage(packageRoot, sourceRoot);

		expect(
			engine
				.getWorkspaceIndex()
				.entries.find((entry) => entry.relativePath === "ReExport.loom.tsx"),
		).toMatchObject({
			renderTarget: {
				exportName: "ExplicitCard",
				kind: "component",
				usesPreviewProps: true,
			},
			selection: {
				contract: "preview.entry",
				kind: "explicit",
			},
			status: "ready",
			statusDetails: {
				kind: "ready",
			},
			title: "Explicit Card",
		});
	});

	it("follows tsconfig path aliases across workspace package boundaries", () => {
		const workspace = createTempPreviewWorkspace({
			"@fixtures/shared": {
				"package.json": JSON.stringify({ name: "@fixtures/shared" }, null, 2),
				"src/Card.tsx": `
          export function SharedCard() {
            return <frame />;
          }
        `,
				"tsconfig.json": JSON.stringify(
					{
						compilerOptions: {
							jsx: "preserve",
							module: "ESNext",
							moduleResolution: "Node",
							target: "ESNext",
						},
						include: ["src/**/*.ts", "src/**/*.tsx"],
					},
					null,
					2,
				),
			},
			"@fixtures/ui": {
				"package.json": JSON.stringify({ name: "@fixtures/ui" }, null, 2),
				"src/Entry.loom.tsx": `
          import { SharedCard } from "@shared/Card";

          export { SharedCard as UiCard };

          export const preview = {
            entry: SharedCard,
            title: "UI Card",
          };
        `,
				"tsconfig.json": JSON.stringify(
					{
						compilerOptions: {
							baseUrl: "./src",
							jsx: "preserve",
							module: "ESNext",
							moduleResolution: "Node",
							paths: {
								"@shared/*": ["../../shared/src/*"],
							},
							target: "ESNext",
						},
						include: ["src/**/*.ts", "src/**/*.tsx"],
						references: [{ path: "../shared" }],
					},
					null,
					2,
				),
			},
		});

		const sharedTarget = workspace.getPackage("@fixtures/shared");
		const uiTarget = workspace.getPackage("@fixtures/ui");
		const engine = createPreviewEngine({
			compiler,
			projectName: "Workspace Preview",
			targets: [
				{
					name: "ui",
					packageName: "@fixtures/ui",
					packageRoot: uiTarget.packageRoot,
					sourceRoot: uiTarget.sourceRoot,
				},
			],
			transformMode: "compatibility",
		});

		expect(engine.getWorkspaceIndex().entries).toEqual([
			expect.objectContaining({
				relativePath: "Entry.loom.tsx",
				renderTarget: expect.objectContaining({
					exportName: "UiCard",
					kind: "component",
				}),
				selection: expect.objectContaining({
					contract: "preview.entry",
					kind: "explicit",
				}),
				status: "ready",
				statusDetails: {
					kind: "ready",
				},
			}),
		]);

		const payload = sanitizePaths(
			engine.getEntryPayload("ui:Entry.loom.tsx"),
			workspace.workspaceRoot,
		);
		expect(
			payload.diagnostics.some(
				(diagnostic) => diagnostic.code === "DECLARATION_ONLY_BOUNDARY",
			),
		).toBe(false);
		expect(payload.graphTrace).toMatchObject({
			boundaryHops: [
				{
					fromFile: "<pkg>/packages/ui/src/Entry.loom.tsx",
					fromPackageRoot: "<pkg>/packages/ui",
					toFile: "<pkg>/packages/shared/src/Card.tsx",
					toPackageRoot: "<pkg>/packages/shared",
				},
			],
			imports: [
				expect.objectContaining({
					importerProjectConfigPath: "<pkg>/packages/ui/tsconfig.json",
					resolution: "resolved",
					resolutionKind: "source-file",
					resolvedFile: "<pkg>/packages/shared/src/Card.tsx",
					resolvedProjectConfigPath: "<pkg>/packages/shared/tsconfig.json",
					specifier: "@shared/Card",
				}),
			],
			selection: expect.objectContaining({
				importChain: [
					"<pkg>/packages/ui/src/Entry.loom.tsx",
					"<pkg>/packages/shared/src/Card.tsx",
				],
				resolvedExportName: "UiCard",
			}),
			traversedProjects: expect.arrayContaining([
				expect.objectContaining({
					configPath: "<pkg>/packages/ui/tsconfig.json",
					packageRoot: "<pkg>/packages/ui",
				}),
				expect.objectContaining({
					configPath: "<pkg>/packages/shared/tsconfig.json",
					packageRoot: "<pkg>/packages/shared",
				}),
			]),
		});
	expect(sharedTarget.sourceRoot).toBe(
		path.join(workspace.workspaceRoot, "packages", "shared", "src"),
	);
	});

	it("maps workspace package declaration outputs under out back to source files", () => {
		const workspace = createTempPreviewWorkspace({
			"@fixtures/core": {
				"package.json": JSON.stringify(
					{
						name: "@fixtures/core",
						types: "out/index.d.ts",
					},
					null,
					2,
				),
				"out/index.d.ts": `export { CoreThing } from "../src/index";\n`,
				"src/index.tsx": `
          export function CoreThing() {
            return <frame />;
          }
        `,
				"tsconfig.json": JSON.stringify(
					{
						compilerOptions: {
							composite: true,
							module: "ESNext",
							moduleResolution: "Node",
							outDir: "out",
							rootDir: "src",
							target: "ESNext",
						},
						include: ["src/**/*.ts", "src/**/*.tsx"],
					},
					null,
					2,
				),
			},
			"@fixtures/ui": {
				"package.json": JSON.stringify({ name: "@fixtures/ui" }, null, 2),
				"src/Entry.loom.tsx": `
          import { CoreThing } from "@fixtures/core";

          export function Entry() {
            return <CoreThing />;
          }

          export const preview = {
            entry: Entry,
          };
        `,
				"tsconfig.json": JSON.stringify(
					{
						compilerOptions: {
							jsx: "preserve",
							module: "ESNext",
							moduleResolution: "Node",
							target: "ESNext",
						},
						include: ["src/**/*.ts", "src/**/*.tsx"],
						references: [{ path: "../core" }],
					},
					null,
					2,
				),
			},
		});

		const uiTarget = workspace.getPackage("@fixtures/ui");
		const engine = createPreviewEngine({
			compiler,
			projectName: "Workspace Preview",
			targets: [
				{
					name: "ui",
					packageName: "@fixtures/ui",
					packageRoot: uiTarget.packageRoot,
					sourceRoot: uiTarget.sourceRoot,
				},
			],
			transformMode: "compatibility",
		});

		const payload = sanitizePaths(
			engine.getEntryPayload("ui:Entry.loom.tsx"),
			workspace.workspaceRoot,
		);
		expect(
			payload.diagnostics.some(
				(diagnostic) => diagnostic.code === "DECLARATION_ONLY_BOUNDARY",
			),
		).toBe(false);
		expect(payload.graphTrace.imports).toContainEqual(
			expect.objectContaining({
				importerProjectConfigPath: "<pkg>/packages/ui/tsconfig.json",
				resolution: "resolved",
				resolutionKind: "workspace-package",
				resolvedFile: "<pkg>/packages/core/src/index.tsx",
				specifier: "@fixtures/core",
			}),
		);
		expect(payload.graphTrace.selection).toMatchObject({
			resolvedExportName: "Entry",
		});
	});

	it("resolves workspace package declaration outputs back to source and invalidates dependents", () => {
		const workspace = createTempPreviewWorkspace({
			"@fixtures/shared": {
				"package.json": JSON.stringify(
					{
						name: "@fixtures/shared",
						types: "dist/index.d.ts",
					},
					null,
					2,
				),
				"dist/index.d.ts": `export { SharedCard } from "../src/index";\n`,
				"src/index.tsx": `
          export function SharedCard() {
            return <frame />;
          }
        `,
				"tsconfig.json": JSON.stringify(
					{
						compilerOptions: {
							composite: true,
							jsx: "preserve",
							module: "ESNext",
							moduleResolution: "Node",
							outDir: "dist",
							rootDir: "src",
							target: "ESNext",
						},
						include: ["src/**/*.ts", "src/**/*.tsx"],
					},
					null,
					2,
				),
			},
			"@fixtures/ui": {
				"package.json": JSON.stringify({ name: "@fixtures/ui" }, null, 2),
				"src/Entry.loom.tsx": `
          import { SharedCard } from "@fixtures/shared";

          export { SharedCard as DeclaredCard };

          export const preview = {
            entry: SharedCard,
          };
        `,
				"tsconfig.json": JSON.stringify(
					{
						compilerOptions: {
							jsx: "preserve",
							module: "ESNext",
							moduleResolution: "Node",
							target: "ESNext",
						},
						include: ["src/**/*.ts", "src/**/*.tsx"],
						references: [{ path: "../shared" }],
					},
					null,
					2,
				),
			},
		});

		const sharedTarget = workspace.getPackage("@fixtures/shared");
		const uiTarget = workspace.getPackage("@fixtures/ui");
		const engine = createPreviewEngine({
			compiler,
			projectName: "Workspace Preview",
			targets: [
				{
					name: "ui",
					packageName: "@fixtures/ui",
					packageRoot: uiTarget.packageRoot,
					sourceRoot: uiTarget.sourceRoot,
				},
			],
			transformMode: "compatibility",
		});

		expect(engine.getWorkspaceIndex().entries).toEqual([
			expect.objectContaining({
				relativePath: "Entry.loom.tsx",
				renderTarget: expect.objectContaining({
					exportName: "DeclaredCard",
					kind: "component",
				}),
			}),
		]);

		const payload = sanitizePaths(
			engine.getEntryPayload("ui:Entry.loom.tsx"),
			workspace.workspaceRoot,
		);
		expect(payload.graphTrace.imports).toEqual([
			expect.objectContaining({
				resolution: "resolved",
				resolutionKind: "workspace-package",
				resolvedFile: "<pkg>/packages/shared/src/index.tsx",
				specifier: "@fixtures/shared",
			}),
		]);

		fs.writeFileSync(
			path.join(sharedTarget.sourceRoot, "index.tsx"),
			`
        export function SharedCard() {
          return <textlabel Text="updated" />;
        }
      `,
			"utf8",
		);

		const update = engine.invalidateSourceFiles([
			path.join(sharedTarget.sourceRoot, "index.tsx"),
		]);
		expect(update.changedEntryIds).toEqual(["ui:Entry.loom.tsx"]);
		expect(update.registryChangedEntryIds).toEqual(["ui:Entry.loom.tsx"]);
		expect(update.executionChangedEntryIds).toEqual([]);
		expect(update.removedEntryIds).toEqual([]);
		expect(update.requiresFullReload).toBe(false);
	});

	it("tracks top-level CommonJS dependencies for invalidation", () => {
		const { packageRoot, sourceRoot } = createTempPreviewPackage({
			"src/support/runtime.ts": `
        export const label = "initial";
      `,
			"src/AccordionBasicScene.loom.tsx": `
        import Runtime = require("./support/runtime");

        const runtime = require("./support/runtime");

        export function AccordionBasicScene() {
          return <frame />;
        }

        export const preview = {
          entry: AccordionBasicScene,
          props: {
            label: Runtime.label,
            title: runtime.label,
          },
        };
      `,
		});

		const engine = createEngineForPackage(packageRoot, sourceRoot, "compatibility");
		engine.getWorkspaceIndex();
		const runtimePath = path.join(sourceRoot, "support", "runtime.ts");
		const update = engine.invalidateSourceFiles([runtimePath]);

		expect(update.changedEntryIds).toEqual(["fixture:AccordionBasicScene.loom.tsx"]);
		expect(update.registryChangedEntryIds).toEqual([
			"fixture:AccordionBasicScene.loom.tsx",
		]);
		expect(update.workspaceChanged).toBe(true);
	});

	it("emits stable workspace and payload protocol snapshots", () => {
		const { packageRoot, sourceRoot } = createTempPreviewPackage({
			"src/Broken.loom.tsx": `
        export function Broken() {
          return <viewportframe />;
        }
      `,
			"src/Harness.loom.tsx": `
        export const preview = ({
          render: () => <frame />,
          title: "Harness Demo",
        }) as const;
      `,
		});

		const engine = createEngineForPackage(packageRoot, sourceRoot);
		const snapshot = sanitizePaths(engine.getSnapshot(), packageRoot);

		expect(snapshot.protocolVersion).toBe(4);
		expect(snapshot.entries["fixture:Broken.loom.tsx"]).toMatchObject({
			descriptor: {
				status: "needs_harness",
				statusDetails: {
					kind: "needs_harness",
					reason: "missing-explicit-contract",
				},
			},
		});
		expect(snapshot.workspaceIndex.protocolVersion).toBe(4);
		expect(snapshot.workspaceIndex.entries[0]).toMatchObject({
			relativePath: "Broken.loom.tsx",
			status: "needs_harness",
			statusDetails: {
				kind: "needs_harness",
				reason: "missing-explicit-contract",
			},
		});
		expect(snapshot.workspaceIndex.entries[1]).toMatchObject({
			relativePath: "Harness.loom.tsx",
			status: "ready",
			statusDetails: {
				kind: "ready",
			},
		});
	});

	it("keeps compatibility-mode transform diagnostics non-blocking in the workspace index", () => {
		const { packageRoot, sourceRoot } = createTempPreviewPackage({
			"src/Broken.loom.tsx": `
        export function Broken() {
          return <part />;
        }

        export const preview = {
          entry: Broken,
        };
      `,
		});

		const engine = createEngineForPackage(
			packageRoot,
			sourceRoot,
			"compatibility",
		);

		expect(engine.getWorkspaceIndex().entries[0]).toMatchObject({
			relativePath: "Broken.loom.tsx",
			status: "ready",
			statusDetails: {
				fidelity: "degraded",
				kind: "ready",
				warningCodes: ["UNSUPPORTED_HOST_ELEMENT"],
			},
		});
		expect(engine.getEntryPayload("fixture:Broken.loom.tsx")).toMatchObject({
			descriptor: {
				status: "ready",
				statusDetails: {
					fidelity: "degraded",
					kind: "ready",
					warningCodes: ["UNSUPPORTED_HOST_ELEMENT"],
				},
			},
			transform: {
				mode: "compatibility",
				outcome: {
					kind: "compatibility",
				},
			},
		});
	});

	it("surfaces unresolved free identifiers as ready compatibility warnings", () => {
		const { packageRoot, sourceRoot } = createTempPreviewPackage({
			"src/Broken.loom.tsx": `
        export const value = gamee.GetService("Players");

        export function Broken() {
          return <frame />;
        }

        export const preview = {
          entry: Broken,
        };
      `,
		});

		const engine = createEngineForPackage(
			packageRoot,
			sourceRoot,
			"compatibility",
		);

		expect(engine.getWorkspaceIndex().entries[0]).toMatchObject({
			relativePath: "Broken.loom.tsx",
			status: "ready",
			statusDetails: {
				fidelity: "degraded",
				kind: "ready",
				warningCodes: ["UNRESOLVED_FREE_IDENTIFIER"],
			},
		});
		expect(engine.getEntryPayload("fixture:Broken.loom.tsx")).toMatchObject({
			descriptor: {
				status: "ready",
				statusDetails: {
					fidelity: "degraded",
					kind: "ready",
					warningCodes: ["UNRESOLVED_FREE_IDENTIFIER"],
				},
			},
			diagnostics: [
				expect.objectContaining({
					blocking: false,
					code: "UNRESOLVED_FREE_IDENTIFIER",
					phase: "transform",
					severity: "warning",
					symbol: "gamee",
				}),
			],
			transform: {
				mode: "compatibility",
				outcome: {
					kind: "compatibility",
				},
			},
		});
	});

	it("keeps degraded runtime warnings in ready status details", () => {
		const { packageRoot, sourceRoot } = createTempPreviewPackage({
			"src/Runtime.loom.tsx": `
        export function Runtime() {
          return <viewportframe />;
        }

        export const preview = {
          entry: Runtime,
        };
      `,
		});

		const engine = createEngineForPackage(
			packageRoot,
			sourceRoot,
			"compatibility",
		);
		const issues: PreviewRuntimeIssue[] = [
			{
				blocking: false,
				code: "DEGRADED_HOST_RENDER",
				entryId: "fixture:Runtime.loom.tsx",
				file: path.join(sourceRoot, "Runtime.loom.tsx"),
				kind: "RuntimeMockError",
				phase: "runtime",
				relativeFile: "src/Runtime.loom.tsx",
				severity: "warning",
				summary: "ViewportFrame rendered with degraded preview behavior.",
				target: "ViewportFrame",
			},
		];

		engine.replaceRuntimeIssues(issues);

		expect(engine.getWorkspaceIndex().entries[0]).toMatchObject({
			relativePath: "Runtime.loom.tsx",
			status: "ready",
			statusDetails: {
				degradedTargets: ["ViewportFrame"],
				fidelity: "degraded",
				kind: "ready",
				warningCodes: ["DEGRADED_HOST_RENDER"],
			},
		});
		expect(engine.getEntryPayload("fixture:Runtime.loom.tsx")).toMatchObject({
			descriptor: {
				status: "ready",
				statusDetails: {
					degradedTargets: ["ViewportFrame"],
					fidelity: "degraded",
					kind: "ready",
					warningCodes: ["DEGRADED_HOST_RENDER"],
				},
			},
			diagnostics: [
				expect.objectContaining({
					blocking: false,
					code: "DEGRADED_HOST_RENDER",
					phase: "runtime",
					severity: "warning",
				}),
			],
		});
	});

	it("promotes transform blocking only in strict-fidelity mode", () => {
		const { packageRoot, sourceRoot } = createTempPreviewPackage({
			"src/Broken.loom.tsx": `
        export function Broken() {
          return <part />;
        }

        export const preview = {
          entry: Broken,
        };
      `,
		});

		const engine = createEngineForPackage(
			packageRoot,
			sourceRoot,
			"strict-fidelity",
		);

		expect(engine.getWorkspaceIndex().entries[0]).toMatchObject({
			relativePath: "Broken.loom.tsx",
			status: "blocked_by_transform",
			statusDetails: {
				kind: "blocked_by_transform",
				reason: "transform-diagnostics",
			},
		});
		expect(engine.getEntryPayload("fixture:Broken.loom.tsx")).toMatchObject({
			descriptor: {
				status: "blocked_by_transform",
				statusDetails: {
					kind: "blocked_by_transform",
					reason: "transform-diagnostics",
				},
			},
			transform: {
				mode: "strict-fidelity",
				outcome: {
					kind: "blocked",
				},
			},
		});
	});

	it("blocks unresolved free identifiers in strict-fidelity workspace status", () => {
		const { packageRoot, sourceRoot } = createTempPreviewPackage({
			"src/Broken.loom.tsx": `
        export const value = gamee.GetService("Players");

        export function Broken() {
          return <frame />;
        }

        export const preview = {
          entry: Broken,
        };
      `,
		});

		const engine = createEngineForPackage(
			packageRoot,
			sourceRoot,
			"strict-fidelity",
		);

		expect(engine.getWorkspaceIndex().entries[0]).toMatchObject({
			relativePath: "Broken.loom.tsx",
			status: "blocked_by_transform",
			statusDetails: {
				kind: "blocked_by_transform",
				reason: "transform-diagnostics",
			},
		});
		expect(engine.getEntryPayload("fixture:Broken.loom.tsx")).toMatchObject({
			descriptor: {
				status: "blocked_by_transform",
				statusDetails: {
					kind: "blocked_by_transform",
					reason: "transform-diagnostics",
				},
			},
			diagnostics: [
				expect.objectContaining({
					blocking: true,
					code: "UNRESOLVED_FREE_IDENTIFIER",
					phase: "transform",
					severity: "error",
					symbol: "gamee",
				}),
			],
			transform: {
				mode: "strict-fidelity",
				outcome: {
					kind: "blocked",
				},
			},
		});
	});

	it("ingests runtime issues into entry status and diagnostics", () => {
		const { packageRoot, sourceRoot } = createTempPreviewPackage({
			"src/Runtime.loom.tsx": `
        export function Runtime() {
          return <frame />;
        }

        export const preview = {
          entry: Runtime,
        };
      `,
		});

		const engine = createEngineForPackage(
			packageRoot,
			sourceRoot,
			"compatibility",
		);
		const issues: PreviewRuntimeIssue[] = [
			{
				code: "MODULE_LOAD_ERROR",
				entryId: "fixture:Runtime.loom.tsx",
				file: path.join(sourceRoot, "Runtime.loom.tsx"),
				kind: "ModuleLoadError",
				phase: "runtime",
				relativeFile: "src/Runtime.loom.tsx",
				summary: "Preview module failed to load.",
				target: "fixture",
			},
		];

		const update = engine.replaceRuntimeIssues(issues);

		expect(update.executionChangedEntryIds).toEqual(["fixture:Runtime.loom.tsx"]);
		expect(update.registryChangedEntryIds).toEqual([]);
		expect(update.workspaceChanged).toBe(false);
		expect(engine.getEntryPayload("fixture:Runtime.loom.tsx")).toMatchObject({
			descriptor: {
				status: "blocked_by_runtime",
				statusDetails: {
					issueCodes: ["MODULE_LOAD_ERROR"],
					kind: "blocked_by_runtime",
					reason: "runtime-issues",
				},
			},
			diagnostics: [
				expect.objectContaining({
					code: "MODULE_LOAD_ERROR",
					phase: "runtime",
					severity: "error",
				}),
			],
		});
	});

	it("reports entry-scoped invalidation updates without requiring full reload", () => {
		const { packageRoot, sourceRoot } = createTempPreviewPackage({
			"src/AnimatedSlot.loom.tsx": `
        export function AnimatedSlot() {
          return <frame />;
        }
      `,
		});

		const engine = createEngineForPackage(packageRoot, sourceRoot);
		engine.getWorkspaceIndex();
		const sourceFile = path.join(sourceRoot, "AnimatedSlot.loom.tsx");

		fs.writeFileSync(
			sourceFile,
			`
        export function Alpha() {
          return <frame />;
        }

        export function Beta() {
          return <frame />;
        }
      `,
			"utf8",
		);

		const update = engine.invalidateSourceFiles([sourceFile]);

		expect(update).toMatchObject({
			changedEntryIds: ["fixture:AnimatedSlot.loom.tsx"],
			registryChangedEntryIds: ["fixture:AnimatedSlot.loom.tsx"],
			executionChangedEntryIds: [],
			requiresFullReload: false,
			workspaceChanged: true,
		});
		expect(update.workspaceIndex.entries[0]).toMatchObject({
			renderTarget: {
				kind: "none",
				reason: "ambiguous-exports",
			},
			status: "ambiguous",
			statusDetails: {
				candidates: ["Alpha", "Beta"],
				kind: "ambiguous",
				reason: "ambiguous-exports",
			},
		});
	});
});
