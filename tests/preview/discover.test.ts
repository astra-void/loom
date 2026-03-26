import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	createPackageTargetDiscovery,
	createStaticTargetsDiscovery,
	createWorkspaceTargetsDiscovery,
	loadPreviewConfig,
	resolvePreviewConfigObject,
} from "../../packages/preview/src/config";
import { createPreviewHeadlessSession } from "../../packages/preview/src/headless";
import { resolvePreviewServerConfig } from "../../packages/preview/src/source/server";
import { PREVIEW_ENGINE_PROTOCOL_VERSION } from "../../packages/preview-engine/src/types";
import { suppressExpectedStderrMessages } from "../testLogUtils";
const temporaryRoots: string[] = [];
let restoreExpectedLogs: (() => void) | undefined;

beforeEach(() => {
	restoreExpectedLogs = suppressExpectedStderrMessages([
		/The build was canceled/,
	]);
});

afterEach(() => {
	restoreExpectedLogs?.();
	restoreExpectedLogs = undefined;
	for (const root of temporaryRoots.splice(0)) {
		fs.rmSync(root, { force: true, recursive: true });
	}
});

function createTempRoot(prefix: string) {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
	temporaryRoots.push(root);
	return root;
}

function createPackage(
	root: string,
	relativePath: string,
	packageName: string,
	componentName = "ButtonPreview",
) {
	const packageRoot = path.join(root, relativePath);
	fs.mkdirSync(path.join(packageRoot, "src"), { recursive: true });
	fs.writeFileSync(
		path.join(packageRoot, "package.json"),
		JSON.stringify({ name: packageName }, null, 2),
	);
	fs.writeFileSync(
		path.join(packageRoot, "src", "Button.loom.tsx"),
		`
      export function ${componentName}() {
        return <frame />;
      }

      export const preview = {
        entry: ${componentName},
      };
    `,
		"utf8",
	);

	return {
		packageName,
		packageRoot,
		sourceRoot: path.join(packageRoot, "src"),
	};
}

function writeInlinePreviewConfig(
	configFilePath: string,
	options: {
		packageName: string;
		packageRoot: string;
		projectName: string;
		sourceRoot: string;
		targetName: string;
	},
) {
	const configDir = path.dirname(configFilePath);
	const relativePackageRoot = path
		.relative(configDir, options.packageRoot)
		.split(path.sep)
		.join("/");
	const relativeSourceRoot = path
		.relative(configDir, options.sourceRoot)
		.split(path.sep)
		.join("/");
	const configRelativePackageRoot = relativePackageRoot.startsWith(".")
		? relativePackageRoot
		: `./${relativePackageRoot}`;
	const configRelativeSourceRoot = relativeSourceRoot.startsWith(".")
		? relativeSourceRoot
		: `./${relativeSourceRoot}`;

	fs.writeFileSync(
		configFilePath,
		`
      export default {
        projectName: ${JSON.stringify(options.projectName)},
        targetDiscovery: {
          discoverTargets() {
            return [
              {
                name: ${JSON.stringify(options.targetName)},
                packageName: ${JSON.stringify(options.packageName)},
                packageRoot: ${JSON.stringify(configRelativePackageRoot || ".")},
                sourceRoot: ${JSON.stringify(configRelativeSourceRoot || "./src")},
              },
            ];
          },
        },
      };
    `,
		"utf8",
	);
}

describe("preview bootstrap config", () => {
	it("prefers the nearest loom.config.ts over zero-config package-root mode", async () => {
		const workspaceRoot = createTempRoot("loom-preview-config-");
		const target = createPackage(
			workspaceRoot,
			"packages/button",
			"@fixtures/button",
		);
		writeInlinePreviewConfig(path.join(workspaceRoot, "loom.config.ts"), {
			packageName: target.packageName,
			packageRoot: target.packageRoot,
			projectName: "Workspace Preview",
			sourceRoot: target.sourceRoot,
			targetName: "button",
		});

		const resolvedConfig = await loadPreviewConfig({ cwd: target.packageRoot });

		expect(resolvedConfig.mode).toBe("config-file");
		expect(resolvedConfig.projectName).toBe("Workspace Preview");
		expect(resolvedConfig.targets).toEqual([
			expect.objectContaining({
				name: "button",
				packageName: "@fixtures/button",
				packageRoot: target.packageRoot,
				sourceRoot: target.sourceRoot,
			}),
		]);
	});

	it("falls back to zero-config package-root mode when no config file exists", async () => {
		const packageRoot = createTempRoot("loom-preview-package-root-");
		fs.mkdirSync(path.join(packageRoot, "src"), { recursive: true });
		fs.writeFileSync(
			path.join(packageRoot, "package.json"),
			JSON.stringify({ name: "@fixtures/package-root" }, null, 2),
		);
		fs.writeFileSync(
			path.join(packageRoot, "src", "Button.loom.tsx"),
			"export default function Button() { return <frame />; }\n",
		);

		const resolvedConfig = await loadPreviewConfig({ cwd: packageRoot });

		expect(resolvedConfig.mode).toBe("package-root");
		expect(resolvedConfig.projectName).toBe("@fixtures/package-root");
		expect(resolvedConfig.targets).toEqual([
			expect.objectContaining({
				name: "@fixtures/package-root",
				packageName: "@fixtures/package-root",
				packageRoot,
				sourceRoot: path.join(packageRoot, "src"),
			}),
		]);
	});

	it("prefers an explicit --config path over config lookup", async () => {
		const workspaceRoot = createTempRoot("loom-preview-explicit-config-");
		const primaryTarget = createPackage(
			workspaceRoot,
			"packages/primary",
			"@fixtures/primary",
		);
		const secondaryTarget = createPackage(
			workspaceRoot,
			"packages/secondary",
			"@fixtures/secondary",
		);
		writeInlinePreviewConfig(path.join(workspaceRoot, "loom.config.ts"), {
			packageName: primaryTarget.packageName,
			packageRoot: primaryTarget.packageRoot,
			projectName: "Primary Preview",
			sourceRoot: primaryTarget.sourceRoot,
			targetName: "primary",
		});

		const alternateConfigDir = path.join(workspaceRoot, "configs");
		fs.mkdirSync(alternateConfigDir, { recursive: true });
		const explicitConfigPath = path.join(
			alternateConfigDir,
			"explicit.loom.config.ts",
		);
		writeInlinePreviewConfig(explicitConfigPath, {
			packageName: secondaryTarget.packageName,
			packageRoot: secondaryTarget.packageRoot,
			projectName: "Explicit Preview",
			sourceRoot: secondaryTarget.sourceRoot,
			targetName: "secondary",
		});

		const resolvedConfig = await loadPreviewConfig({
			configFile: explicitConfigPath,
			cwd: primaryTarget.packageRoot,
		});

		expect(resolvedConfig.mode).toBe("config-file");
		expect(resolvedConfig.projectName).toBe("Explicit Preview");
		expect(resolvedConfig.targets).toEqual([
			expect.objectContaining({
				name: "secondary",
				packageName: "@fixtures/secondary",
				packageRoot: secondaryTarget.packageRoot,
			}),
		]);
	});

	it("resolves explicit relative --config paths from the provided cwd", async () => {
		const workspaceRoot = createTempRoot("loom-preview-relative-config-");
		const target = createPackage(
			workspaceRoot,
			"packages/button",
			"@fixtures/button",
		);
		const configFilePath = path.join(target.packageRoot, "loom.config.ts");
		writeInlinePreviewConfig(configFilePath, {
			packageName: target.packageName,
			packageRoot: target.packageRoot,
			projectName: "Relative Config",
			sourceRoot: target.sourceRoot,
			targetName: "button-relative-config",
		});

		const resolvedConfig = await loadPreviewConfig({
			configFile: "loom.config.ts",
			cwd: target.packageRoot,
		});

		expect(resolvedConfig.configFilePath).toBe(configFilePath);
		expect(resolvedConfig.projectName).toBe("Relative Config");
		expect(resolvedConfig.targets).toEqual([
			expect.objectContaining({
				name: "button-relative-config",
				packageRoot: target.packageRoot,
			}),
		]);
	});
});

describe("preview target discovery adapters", () => {
	it("createPackageTargetDiscovery reproduces the zero-config single-package target", async () => {
		const packageRoot = createTempRoot("loom-preview-package-discovery-");
		fs.mkdirSync(path.join(packageRoot, "src"), { recursive: true });
		fs.writeFileSync(
			path.join(packageRoot, "package.json"),
			JSON.stringify({ name: "@fixtures/button" }, null, 2),
		);

		const resolvedConfig = await resolvePreviewConfigObject(
			{
				projectName: "@fixtures/button",
				targetDiscovery: createPackageTargetDiscovery({
					name: "@fixtures/button",
					packageName: "@fixtures/button",
					packageRoot,
					sourceRoot: path.join(packageRoot, "src"),
				}),
			},
			{
				configDir: packageRoot,
				cwd: packageRoot,
			},
		);

		expect(resolvedConfig.mode).toBe("config-object");
		expect(resolvedConfig.targets).toEqual([
			{
				name: "@fixtures/button",
				packageName: "@fixtures/button",
				packageRoot,
				sourceRoot: path.join(packageRoot, "src"),
			},
		]);
	});

	it("createStaticTargetsDiscovery preserves explicit target lists", async () => {
		const workspaceRoot = createTempRoot("loom-preview-static-targets-");
		const buttonTarget = createPackage(
			workspaceRoot,
			"packages/button",
			"@fixtures/button",
		);
		const dialogTarget = createPackage(
			workspaceRoot,
			"packages/dialog",
			"@fixtures/dialog",
		);

		const resolvedConfig = await resolvePreviewConfigObject(
			{
				projectName: "Static Preview",
				targetDiscovery: createStaticTargetsDiscovery([
					{
						name: "button",
						packageName: buttonTarget.packageName,
						packageRoot: buttonTarget.packageRoot,
						sourceRoot: buttonTarget.sourceRoot,
					},
					{
						name: "dialog",
						packageName: dialogTarget.packageName,
						packageRoot: dialogTarget.packageRoot,
						sourceRoot: dialogTarget.sourceRoot,
					},
				]),
			},
			{
				configDir: workspaceRoot,
				cwd: workspaceRoot,
			},
		);

		expect(resolvedConfig.targets).toEqual([
			expect.objectContaining({
				name: "button",
				packageName: "@fixtures/button",
			}),
			expect.objectContaining({
				name: "dialog",
				packageName: "@fixtures/dialog",
			}),
		]);
	});

	it("includes external target workspace roots in fsAllow", async () => {
		const configWorkspaceRoot = createTempRoot("loom-preview-config-root-");
		const externalWorkspaceRoot = createTempRoot(
			"loom-preview-external-workspace-",
		);
		fs.writeFileSync(
			path.join(externalWorkspaceRoot, "pnpm-workspace.yaml"),
			'packages:\n  - "packages/*"\n',
			"utf8",
		);
		const externalTarget = createPackage(
			externalWorkspaceRoot,
			"packages/button",
			"@fixtures/external-button",
		);

		const resolvedConfig = await resolvePreviewConfigObject(
			{
				projectName: "External Targets",
				targetDiscovery: createStaticTargetsDiscovery([
					{
						name: "external-button",
						packageName: externalTarget.packageName,
						packageRoot: externalTarget.packageRoot,
						sourceRoot: externalTarget.sourceRoot,
					},
				]),
			},
			{
				configDir: configWorkspaceRoot,
				cwd: configWorkspaceRoot,
			},
		);

		expect(resolvedConfig.server.fsAllow).toEqual(
			expect.arrayContaining([
				fs.realpathSync(configWorkspaceRoot),
				fs.realpathSync(externalWorkspaceRoot),
				fs.realpathSync(externalTarget.packageRoot),
				fs.realpathSync(externalTarget.sourceRoot),
			]),
		);
	});

	it("createWorkspaceTargetsDiscovery prefers workspace manifests over stray package scans", async () => {
		const workspaceRoot = createTempRoot("loom-preview-workspace-manifest-");
		createPackage(workspaceRoot, "packages/button", "@fixtures/button");
		createPackage(workspaceRoot, "packages/dialog", "@fixtures/dialog");
		createPackage(workspaceRoot, "examples/sandbox", "@fixtures/sandbox");
		fs.writeFileSync(
			path.join(workspaceRoot, "pnpm-workspace.yaml"),
			'packages:\n  - "packages/*"\n',
			"utf8",
		);

		const resolvedConfig = await resolvePreviewConfigObject(
			{
				projectName: "Workspace Targets",
				targetDiscovery: createWorkspaceTargetsDiscovery({
					workspaceRoot,
				}),
			},
			{
				configDir: workspaceRoot,
				cwd: workspaceRoot,
			},
		);

		expect(resolvedConfig.targets).toEqual([
			expect.objectContaining({ name: "button" }),
			expect.objectContaining({ name: "dialog" }),
		]);
		expect(
			resolvedConfig.targets.some(
				(target) => target.packageName === "@fixtures/sandbox",
			),
		).toBe(false);
	});

	it("createWorkspaceTargetsDiscovery finds workspace packages and respects include/exclude filters", async () => {
		const workspaceRoot = createTempRoot("loom-preview-workspace-discovery-");
		const buttonTarget = createPackage(
			workspaceRoot,
			"packages/button",
			"@fixtures/button",
		);
		createPackage(workspaceRoot, "packages/dialog", "@fixtures/dialog");
		createPackage(
			workspaceRoot,
			"packages/internal-skip",
			"@fixtures/internal-skip",
		);
		fs.mkdirSync(path.join(workspaceRoot, "packages", "meta-only"), {
			recursive: true,
		});
		fs.writeFileSync(
			path.join(workspaceRoot, "packages", "meta-only", "package.json"),
			JSON.stringify({ name: "@fixtures/meta-only" }, null, 2),
		);

		const resolvedConfig = await resolvePreviewConfigObject(
			{
				projectName: "Workspace Targets",
				targetDiscovery: createWorkspaceTargetsDiscovery({
					exclude: ["internal-*", "@fixtures/dialog"],
					include: ["@fixtures/*"],
					workspaceRoot,
				}),
			},
			{
				configDir: workspaceRoot,
				cwd: workspaceRoot,
			},
		);

		expect(resolvedConfig.targets).toEqual([
			expect.objectContaining({
				name: "button",
				packageName: buttonTarget.packageName,
			}),
		]);
	});

	it("matches direct-child workspace package roots for ** include patterns", async () => {
		const workspaceRoot = createTempRoot("loom-preview-workspace-glob-");
		createPackage(workspaceRoot, "packages/button", "@fixtures/button");
		createPackage(workspaceRoot, "packages/dialog", "@fixtures/dialog");
		fs.writeFileSync(
			path.join(workspaceRoot, "pnpm-workspace.yaml"),
			'packages:\n  - "packages/*"\n',
			"utf8",
		);

		const resolvedConfig = await resolvePreviewConfigObject(
			{
				projectName: "Workspace Glob",
				targetDiscovery: createWorkspaceTargetsDiscovery({
					include: ["packages/**/button"],
					workspaceRoot,
				}),
			},
			{
				configDir: workspaceRoot,
				cwd: workspaceRoot,
			},
		);

		expect(resolvedConfig.targets).toEqual([
			expect.objectContaining({
				name: "button",
				packageName: "@fixtures/button",
			}),
		]);
	});

	it("fails early when discovered workspace targets resolve to duplicate names", async () => {
		const workspaceRoot = createTempRoot("loom-preview-duplicate-targets-");
		createPackage(workspaceRoot, "packages/foo-button", "@foo/button");
		createPackage(workspaceRoot, "packages/bar-button", "@bar/button");
		fs.writeFileSync(
			path.join(workspaceRoot, "pnpm-workspace.yaml"),
			'packages:\n  - "packages/*"\n',
			"utf8",
		);

		let resolvedError: unknown;
		try {
			await resolvePreviewConfigObject(
				{
					projectName: "Duplicate Workspace Targets",
					targetDiscovery: createWorkspaceTargetsDiscovery({ workspaceRoot }),
				},
				{
					configDir: workspaceRoot,
					cwd: workspaceRoot,
				},
			);
		} catch (error) {
			resolvedError = error;
		}

		expect(resolvedError).toBeInstanceOf(Error);
		if (!(resolvedError instanceof Error)) {
			throw new Error(
				"Expected duplicate workspace target discovery to throw.",
			);
		}

		expect(resolvedError.message).toContain("Duplicate preview target names");
		expect(resolvedError.message).toContain("@foo/button");
		expect(resolvedError.message).toContain("@bar/button");
		expect(resolvedError.message).toContain("button:");
	});
});

describe("preview bootstrap normalization", () => {
	it("normalizes shorthand server options and config-based options to the same resolved shape", async () => {
		const packageRoot = createTempRoot("loom-preview-server-config-");
		fs.mkdirSync(path.join(packageRoot, "src"), { recursive: true });
		fs.writeFileSync(
			path.join(packageRoot, "package.json"),
			JSON.stringify({ name: "@fixtures/button" }, null, 2),
		);

		const shorthandConfig = await resolvePreviewServerConfig({
			packageName: "@fixtures/button",
			packageRoot,
			sourceRoot: path.join(packageRoot, "src"),
		});
		const configObject = await resolvePreviewServerConfig({
			projectName: "@fixtures/button",
			targetDiscovery: createPackageTargetDiscovery({
				name: "@fixtures/button",
				packageName: "@fixtures/button",
				packageRoot,
				sourceRoot: path.join(packageRoot, "src"),
			}),
			workspaceRoot: packageRoot,
		});

		expect(configObject.projectName).toBe(shorthandConfig.projectName);
		expect(configObject.transformMode).toBe(shorthandConfig.transformMode);
		expect(configObject.targets).toEqual(shorthandConfig.targets);
		expect(configObject.workspaceRoot).toBe(shorthandConfig.workspaceRoot);
	});

	it("creates headless snapshots from the engine protocol source of truth", async () => {
		const packageRoot = createTempRoot("loom-preview-headless-");
		fs.mkdirSync(path.join(packageRoot, "src"), { recursive: true });
		fs.writeFileSync(
			path.join(packageRoot, "package.json"),
			JSON.stringify({ name: "@fixtures/headless" }, null, 2),
		);
		fs.writeFileSync(
			path.join(packageRoot, "src", "Button.loom.tsx"),
			`
        export function ButtonPreview() {
          return <frame />;
        }

        export const preview = ({
          entry: ButtonPreview,
          title: "Button",
        }) as const;
      `,
			"utf8",
		);

		const session = await createPreviewHeadlessSession({ cwd: packageRoot });
		try {
			const snapshot = session.getSnapshot();

			expect(snapshot.protocolVersion).toBe(PREVIEW_ENGINE_PROTOCOL_VERSION);
			expect(snapshot.workspaceIndex).toEqual(
				session.engine.getWorkspaceIndex(),
			);
			expect(snapshot.workspaceIndex.entries).toEqual([
				expect.objectContaining({
					title: "Button",
					relativePath: "Button.loom.tsx",
					selection: expect.objectContaining({ kind: "explicit" }),
					status: "ready",
				}),
			]);
			expect(Object.values(snapshot.entries)).toEqual([
				expect.objectContaining({
					descriptor: expect.objectContaining({
						relativePath: "Button.loom.tsx",
						status: "ready",
					}),
				}),
			]);
		} finally {
			session.dispose();
		}
	});
});
