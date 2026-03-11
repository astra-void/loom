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

function createPreviewModule(config = createResolvedConfig()) {
	const dispose = vi.fn();
	const snapshot = {
		entries: {},
		protocolVersion: "1",
		workspaceIndex: {
			entries: [],
			projectName: config.projectName,
			protocolVersion: "1",
		},
	};

	const previewModule: CliPreviewModule = {
		createPreviewHeadlessSession: vi.fn(async () => ({
			dispose,
			getSnapshot: () => snapshot,
		})),
		loadPreviewConfig: vi.fn(async () => config),
		startPreviewServer: vi.fn(async () => ({ close: vi.fn() })),
	};

	return {
		dispose,
		previewModule,
		snapshot,
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
		expect(helpOutput.read()).toContain("loom snapshot");

		const versionOutput = createWriter();
		await runCli(["--version"], {
			readCliVersionFn: () => "9.9.9",
			stdout: versionOutput.writer,
		});

		expect(versionOutput.read()).toBe("9.9.9\n");
	});

	it("rejects unknown and legacy copied commands", async () => {
		await expect(runCli(["doctor"])).rejects.toMatchObject({
			message: expect.stringContaining("preview-only"),
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
		expect(
			fileModule.previewModule.createPreviewHeadlessSession,
		).toHaveBeenCalledWith(
			expect.objectContaining({
				transformMode: "compatibility",
			}),
		);
		expect(fileModule.dispose).toHaveBeenCalledTimes(1);
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
	});
});
