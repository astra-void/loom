import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runCli } from "../../packages/cli/src/cli";
import type {
	CliPreviewModule,
	CliResolvedPreviewConfig,
} from "../../packages/cli/src/preview";

const temporaryRoots: string[] = [];

afterEach(() => {
	for (const root of temporaryRoots.splice(0)) {
		fs.rmSync(root, { force: true, recursive: true });
	}
});

function createTempRoot(prefix: string) {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
	temporaryRoots.push(root);
	return root;
}

function createWriter() {
	let output = "";

	return {
		read() {
			return output;
		},
		writer: {
			write(chunk: string) {
				output += chunk;
				return true;
			},
		},
	};
}

function createResolvedConfig(
	overrides: Partial<CliResolvedPreviewConfig> = {},
): CliResolvedPreviewConfig {
	const base: CliResolvedPreviewConfig = {
		configDir: "/repo",
		configFilePath: "/repo/loom.config.ts",
		cwd: "/repo",
		mode: "config-file",
		projectName: "Loom Preview",
		server: {
			fsAllow: ["/repo"],
			open: false,
			port: 4174,
		},
		targetDiscovery: [{ discoverTargets: () => [] }],
		targets: [
			{
				name: "preview",
				packageName: "@fixtures/preview",
				packageRoot: "/repo",
				sourceRoot: "/repo/src",
			},
		],
		transformMode: "strict-fidelity",
		workspaceRoot: "/repo",
	};

	return {
		...base,
		...overrides,
		server: {
			...base.server,
			...(overrides.server ?? {}),
		},
	};
}

function createPreviewModule(
	config = createResolvedConfig(),
	snapshotOverride?: unknown,
) {
	const dispose = vi.fn();
	const run = vi.fn(async () => snapshot);
	const buildResult = {
		builtArtifacts: [
			{
				cacheKey: "artifact-cache-key",
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
				id: "preview:Button.tsx",
				kind: "module",
				materializedPath: "/repo/generated/preview/Button.tsx",
				relativePath: "Button.tsx",
				reusedFromCache: false,
				sourceFilePath: "/repo/src/Button.tsx",
				targetName: "preview",
			},
		],
		cacheDir: "/repo/.loom-preview-cache",
		diagnostics: [],
		outDir: "/repo/generated",
		removedFiles: [],
		reusedArtifacts: [],
		writtenFiles: ["/repo/generated/preview/Button.tsx"],
	};
	const snapshot = (snapshotOverride ?? {
		entries: {},
		execution: {
			entries: {},
			summary: {
				error: 0,
				pass: 0,
				selectedEntryCount: 0,
				total: 0,
				warning: 0,
			},
		},
		protocolVersion: "1",
		workspaceIndex: {
			entries: [],
			projectName: config.projectName,
			protocolVersion: "1",
		},
	}) as Record<string, unknown>;

	const previewModule: CliPreviewModule = {
		buildPreviewArtifacts: vi.fn(async () => buildResult),
		createPreviewHeadlessSession: vi.fn(async () => ({
			dispose,
			getSnapshot: () => snapshot,
			run,
		})),
		loadPreviewConfig: vi.fn(async () => config),
		startPreviewServer: vi.fn(async () => ({ close: vi.fn() })),
	};

	return {
		buildResult,
		dispose,
		previewModule,
		run,
		snapshot,
	};
}

function createCheckSnapshot(projectName = "Loom Preview") {
	return {
		entries: {
			"preview:Viewport.tsx": {
				descriptor: {
					id: "preview:Viewport.tsx",
					relativePath: "Viewport.tsx",
					status: "ready",
					targetName: "preview",
					title: "Viewport",
				},
				diagnostics: [],
			},
			"preview:Broken.tsx": {
				descriptor: {
					id: "preview:Broken.tsx",
					relativePath: "Broken.tsx",
					status: "blocked_by_runtime",
					targetName: "preview",
					title: "Broken",
				},
				diagnostics: [
					{
						blocking: true,
						code: "RENDER_ERROR",
						phase: "runtime",
						severity: "error",
						summary: "Preview render failed.",
					},
				],
			},
		},
		execution: {
			entries: {
				"preview:Viewport.tsx": {
					degradedHostWarnings: [
						{
							code: "DEGRADED_HOST_RENDER",
							phase: "runtime",
							severity: "warning",
							summary: "ViewportFrame rendered with degraded preview behavior.",
							target: "ViewportFrame",
						},
					],
					layoutDebug: {
						dirtyNodeIds: [],
						roots: [],
						viewport: {
							height: 600,
							width: 800,
						},
					},
					layoutIssues: [],
					loadIssue: null,
					render: {
						status: "rendered",
					},
					renderIssue: null,
					runtimeIssues: [
						{
							code: "DEGRADED_HOST_RENDER",
							phase: "runtime",
							severity: "warning",
							summary: "ViewportFrame rendered with degraded preview behavior.",
							target: "ViewportFrame",
						},
					],
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
						warningCodes: ["DEGRADED_HOST_RENDER"],
					},
				},
				"preview:Broken.tsx": {
					degradedHostWarnings: [],
					layoutDebug: null,
					layoutIssues: [],
					loadIssue: null,
					render: {
						status: "render_failed",
					},
					renderIssue: {
						code: "RENDER_ERROR",
						phase: "runtime",
						severity: "error",
						summary: "Preview render failed.",
						target: "preview",
					},
					runtimeIssues: [
						{
							code: "RENDER_ERROR",
							phase: "runtime",
							severity: "error",
							summary: "Preview render failed.",
							target: "preview",
						},
					],
					severity: "error",
					viewport: {
						height: 600,
						ready: true,
						source: "window-fallback",
						width: 800,
					},
					warningState: {
						degradedTargets: [],
						fidelity: null,
						warningCodes: [],
					},
				},
			},
			summary: {
				error: 1,
				pass: 0,
				selectedEntryCount: 2,
				total: 2,
				warning: 1,
			},
		},
		protocolVersion: "1",
		workspaceIndex: {
			entries: [
				{
					id: "preview:Viewport.tsx",
					relativePath: "Viewport.tsx",
					status: "ready",
					targetName: "preview",
					title: "Viewport",
				},
				{
					id: "preview:Broken.tsx",
					relativePath: "Broken.tsx",
					status: "blocked_by_runtime",
					targetName: "preview",
					title: "Broken",
				},
			],
			projectName,
		},
	};
}

describe("loom cli", () => {
	it("prints help and version", async () => {
		const helpOutput = createWriter();
		await runCli([], {
			readCliVersionFn: () => "9.9.9",
			stdout: helpOutput.writer,
		});

		expect(helpOutput.read()).toContain("Loom CLI");
		expect(helpOutput.read()).toContain("loom preview");
		expect(helpOutput.read()).toContain("loom build");
		expect(helpOutput.read()).toContain("loom snapshot");
		expect(helpOutput.read()).toContain("loom check");

		const versionOutput = createWriter();
		await runCli(["--version"], {
			readCliVersionFn: () => "9.9.9",
			stdout: versionOutput.writer,
		});

		expect(versionOutput.read()).toBe("9.9.9\n");
	});

	it("rejects unknown and legacy copied commands", async () => {
		await expect(runCli(["doctor"])).rejects.toMatchObject({
			message: expect.stringContaining("not supported"),
		});
		await expect(runCli(["wat"])).rejects.toMatchObject({
			message: expect.stringContaining("Unknown command"),
		});
	});

	it("starts the preview server with resolved config plus CLI overrides", async () => {
		const { previewModule } = createPreviewModule();

		await runCli(
			[
				"preview",
				"--cwd",
				"/workspace",
				"--config",
				"/workspace/loom.config.ts",
				"--port",
				"4175",
				"--host",
				"0.0.0.0",
				"--open",
				"--transform-mode",
				"compatibility",
			],
			{
				loadPreviewModuleFn: async () => previewModule,
			},
		);

		expect(previewModule.loadPreviewConfig).toHaveBeenCalledWith({
			configFile: "/workspace/loom.config.ts",
			cwd: "/workspace",
		});
		expect(previewModule.startPreviewServer).toHaveBeenCalledWith(
			expect.objectContaining({
				transformMode: "compatibility",
				server: expect.objectContaining({
					host: "0.0.0.0",
					open: true,
					port: 4175,
				}),
			}),
		);
	});

	it("supports serve as a preview alias", async () => {
		const { previewModule } = createPreviewModule();

		await runCli(["serve", "--cwd", "/workspace"], {
			loadPreviewModuleFn: async () => previewModule,
		});

		expect(previewModule.startPreviewServer).toHaveBeenCalledTimes(1);
	});

	it("builds preview artifacts through the config-aware preview API", async () => {
		const stdoutWriter = createWriter();
		const { buildResult, previewModule } = createPreviewModule();

		await runCli(
			[
				"build",
				"--cwd",
				"/workspace",
				"--config",
				"/workspace/loom.config.ts",
				"--out-dir",
				"/artifacts",
				"--artifact-kind",
				"entry-metadata",
				"--artifact-kind",
				"layout-schema",
				"--transform-mode",
				"design-time",
			],
			{
				loadPreviewModuleFn: async () => previewModule,
				stdout: stdoutWriter.writer,
			},
		);

		expect(previewModule.buildPreviewArtifacts).toHaveBeenCalledWith({
			artifactKinds: ["entry-metadata", "layout-schema"],
			configFile: "/workspace/loom.config.ts",
			cwd: "/workspace",
			outDir: "/artifacts",
			transformMode: "design-time",
		});
		expect(JSON.parse(stdoutWriter.read())).toEqual(buildResult);
		expect(previewModule.loadPreviewConfig).not.toHaveBeenCalled();
	});

	it("defaults loom build to module artifacts when none are specified", async () => {
		const stdoutWriter = createWriter();
		const { previewModule } = createPreviewModule();

		await runCli(["build", "--out-dir", "/artifacts"], {
			loadPreviewModuleFn: async () => previewModule,
			stdout: stdoutWriter.writer,
		});

		expect(previewModule.buildPreviewArtifacts).toHaveBeenCalledWith({
			artifactKinds: ["module"],
			outDir: "/artifacts",
		});
	});

	it("prints resolved config JSON for explicit config and package-root fallback", async () => {
		const explicitConfig = createResolvedConfig();
		const explicitWriter = createWriter();
		const explicitModule = createPreviewModule(explicitConfig);

		await runCli(
			[
				"config",
				"--cwd",
				"/workspace",
				"--config",
				"/workspace/loom.config.ts",
			],
			{
				loadPreviewModuleFn: async () => explicitModule.previewModule,
				stdout: explicitWriter.writer,
			},
		);

		expect(explicitModule.previewModule.loadPreviewConfig).toHaveBeenCalledWith(
			{
				configFile: "/workspace/loom.config.ts",
				cwd: "/workspace",
			},
		);
		expect(JSON.parse(explicitWriter.read())).toEqual(
			expect.objectContaining({
				configFilePath: "/repo/loom.config.ts",
				mode: "config-file",
			}),
		);
		expect(JSON.parse(explicitWriter.read())).not.toHaveProperty(
			"targetDiscovery",
		);

		const fallbackWriter = createWriter();
		const fallbackModule = createPreviewModule(
			createResolvedConfig({
				configFilePath: undefined,
				mode: "package-root",
			}),
		);

		await runCli(["config", "--cwd", "/workspace"], {
			loadPreviewModuleFn: async () => fallbackModule.previewModule,
			stdout: fallbackWriter.writer,
		});

		expect(fallbackModule.previewModule.loadPreviewConfig).toHaveBeenCalledWith(
			{
				cwd: "/workspace",
			},
		);
		expect(JSON.parse(fallbackWriter.read())).toEqual(
			expect.objectContaining({
				mode: "package-root",
			}),
		);
	});

	it("emits snapshots to stdout by default and writes files when requested", async () => {
		const stdoutWriter = createWriter();
		const stdoutModule = createPreviewModule();

		await runCli(["snapshot", "--cwd", "/workspace"], {
			loadPreviewModuleFn: async () => stdoutModule.previewModule,
			stdout: stdoutWriter.writer,
		});

		expect(JSON.parse(stdoutWriter.read())).toEqual(stdoutModule.snapshot);
		expect(stdoutModule.run).toHaveBeenCalledTimes(1);
		expect(stdoutModule.run).toHaveBeenCalledWith();
		expect(stdoutModule.dispose).toHaveBeenCalledTimes(1);

		const outputRoot = createTempRoot("loom-cli-snapshot-");
		const outputPath = path.join(outputRoot, "snapshot.json");
		const fileWriter = createWriter();
		const fileModule = createPreviewModule();

		await runCli(
			["snapshot", "--output", outputPath, "--transform-mode", "compatibility"],
			{
				loadPreviewModuleFn: async () => fileModule.previewModule,
				stdout: fileWriter.writer,
			},
		);

		expect(fileWriter.read()).toBe("");
		expect(JSON.parse(fs.readFileSync(outputPath, "utf8"))).toEqual(
			fileModule.snapshot,
		);
		expect(fileModule.run).toHaveBeenCalledTimes(1);
		expect(fileModule.run).toHaveBeenCalledWith();
		expect(
			fileModule.previewModule.createPreviewHeadlessSession,
		).toHaveBeenCalledWith(
			expect.objectContaining({
				transformMode: "compatibility",
			}),
		);
		expect(fileModule.dispose).toHaveBeenCalledTimes(1);
	});

	it("resolves snapshot --output relative to the resolved cwd", async () => {
	const packageRoot = createTempRoot("loom-cli-snapshot-relative-output-");
	const outputPath = path.join(packageRoot, "preview-snapshot.json");
	const fileModule = createPreviewModule(
		createResolvedConfig({
			configDir: packageRoot,
			configFilePath: path.join(packageRoot, "loom.config.ts"),
			cwd: packageRoot,
			server: { fsAllow: [packageRoot] },
			targets: [
				{
					name: "preview",
					packageName: "@fixtures/preview",
					packageRoot,
					sourceRoot: path.join(packageRoot, "src"),
				},
			],
			workspaceRoot: packageRoot,
		}),
	);

	await runCli(
		["snapshot", "--cwd", packageRoot, "--output", "./preview-snapshot.json"],
		{
			loadPreviewModuleFn: async () => fileModule.previewModule,
		},
	);

	expect(JSON.parse(fs.readFileSync(outputPath, "utf8"))).toEqual(
		fileModule.snapshot,
	);
	expect(fileModule.previewModule.loadPreviewConfig).toHaveBeenCalledWith({
		cwd: packageRoot,
	});
});
it("emits preview checks in pretty and json formats", async () => {
		const checkSnapshot = createCheckSnapshot();
		const prettyWriter = createWriter();
		const prettyModule = createPreviewModule(undefined, checkSnapshot);

		await expect(
			runCli(["check", "--cwd", "/workspace"], {
				loadPreviewModuleFn: async () => prettyModule.previewModule,
				stdout: prettyWriter.writer,
			}),
		).rejects.toMatchObject({
			message: expect.stringContaining("Preview check failed"),
		});

		expect(prettyWriter.read()).toContain("Loom Preview");
		expect(prettyModule.run).toHaveBeenCalledWith();
		expect(prettyWriter.read()).toContain("WARNING preview:Viewport.tsx");
		expect(prettyWriter.read()).toContain("ERROR preview:Broken.tsx");

		const jsonWriter = createWriter();
		const jsonModule = createPreviewModule(undefined, checkSnapshot);

		await expect(
			runCli(["check", "--format", "json", "--fail-on", "warning"], {
				loadPreviewModuleFn: async () => jsonModule.previewModule,
				stdout: jsonWriter.writer,
			}),
		).rejects.toMatchObject({
			message: expect.stringContaining("Preview check failed"),
		});

		expect(jsonModule.run).toHaveBeenCalledWith();
		expect(JSON.parse(jsonWriter.read())).toEqual(
			expect.objectContaining({
				failOn: "warning",
				projectName: "Loom Preview",
				summary: {
					error: 1,
					pass: 0,
					selectedEntryCount: 2,
					total: 2,
					warning: 1,
				},
			}),
		);
	});

	it("supports loom check entry filtering and validates duplicate entries", async () => {
		const checkSnapshot = createCheckSnapshot();
		const filteredWriter = createWriter();
		const filteredModule = createPreviewModule(undefined, checkSnapshot);

		await expect(
			runCli(
				["check", "--entry", "preview:Viewport.tsx", "--fail-on", "warning"],
				{
					loadPreviewModuleFn: async () => filteredModule.previewModule,
					stdout: filteredWriter.writer,
				},
			),
		).rejects.toMatchObject({
			message: expect.stringContaining("Preview check failed"),
		});

		expect(
			filteredModule.previewModule.createPreviewHeadlessSession,
		).toHaveBeenCalledTimes(1);
		expect(filteredModule.run).toHaveBeenCalledWith({
			entryIds: ["preview:Viewport.tsx"],
		});

		await expect(
			runCli(["check", "--entry", "a", "--entry", "b"]),
		).rejects.toMatchObject({
			message: expect.stringContaining("Duplicate --entry"),
		});
	});

	it("validates port, option values, and transform modes", async () => {
		await expect(runCli(["preview", "--port", "0"])).rejects.toMatchObject({
			message: expect.stringContaining("Invalid --port"),
		});
		await expect(runCli(["snapshot", "--output"])).rejects.toMatchObject({
			message: expect.stringContaining("Missing value for --output"),
		});
		await expect(
			runCli(["preview", "--transform-mode", "mocked"]),
		).rejects.toMatchObject({
			message: expect.stringContaining("Invalid --transform-mode"),
		});
		await expect(runCli(["build"])).rejects.toMatchObject({
			message: expect.stringContaining("requires --out-dir"),
		});
		await expect(
			runCli(["build", "--out-dir", "/artifacts", "--artifact-kind", "wat"]),
		).rejects.toMatchObject({
			message: expect.stringContaining("Invalid --artifact-kind"),
		});
		await expect(
			runCli([
				"build",
				"--out-dir",
				"/artifacts",
				"--artifact-kind",
				"entry-metadata",
				"--artifact-kind",
				"entry-metadata",
			]),
		).rejects.toMatchObject({
			message: expect.stringContaining("Duplicate --artifact-kind"),
		});
		await expect(
			runCli([
				"build",
				"--out-dir",
				"/artifacts",
				"--transform-mode",
				"design-time",
			]),
		).rejects.toMatchObject({
			message: expect.stringContaining(
				"Design-time builds do not support module artifacts",
			),
		});
		await expect(
			runCli([
				"build",
				"--out-dir",
				"/artifacts",
				"--artifact-kind",
				"module",
				"--transform-mode",
				"design-time",
			]),
		).rejects.toMatchObject({
			message: expect.stringContaining(
				"Design-time builds do not support module artifacts",
			),
		});
	});
});
