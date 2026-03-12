import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	buildPreviewArtifacts,
	buildPreviewModules,
} from "../../packages/preview/src/index";

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

function createWorkspacePackage(
	workspaceRoot: string,
	options: {
		componentName?: string;
		packageName: string;
		packagePath: string;
		sourceFile?: string;
		sourceText?: string;
	},
) {
	const packageRoot = path.join(workspaceRoot, options.packagePath);
	const sourceRoot = path.join(packageRoot, "src");
	const sourceFile = options.sourceFile ?? "Button.tsx";
	const componentName = options.componentName ?? "ButtonPreview";

	fs.mkdirSync(sourceRoot, { recursive: true });
	fs.writeFileSync(
		path.join(packageRoot, "package.json"),
		JSON.stringify({ name: options.packageName }, null, 2),
		"utf8",
	);
	fs.writeFileSync(
		path.join(sourceRoot, sourceFile),
		options.sourceText ??
			`
        export function ${componentName}() {
          return <frame />;
        }

        export const preview = {
          entry: ${componentName},
          title: "Preview",
        };
      `,
		"utf8",
	);

	return {
		packageRoot,
		sourceRoot,
		sourceFile,
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

describe("buildPreviewArtifacts", () => {
	it("reuses nearest loom.config.ts target discovery for module builds", async () => {
		const workspaceRoot = createTempRoot("loom-preview-build-config-aware-");
		const target = createWorkspacePackage(workspaceRoot, {
			packageName: "@fixtures/button",
			packagePath: "packages/button",
		});
		writeInlinePreviewConfig(path.join(workspaceRoot, "loom.config.ts"), {
			packageName: "@fixtures/button",
			packageRoot: target.packageRoot,
			projectName: "Workspace Build",
			sourceRoot: target.sourceRoot,
			targetName: "button-build",
		});
		const outDir = path.join(workspaceRoot, "generated");

		const result = await buildPreviewArtifacts({
			cwd: target.packageRoot,
			outDir,
		});

		expect(result.outDir).toBe(outDir);
		expect(result.writtenFiles).toEqual(
			expect.arrayContaining([
				path.join(outDir, "button-build", target.sourceFile),
			]),
		);
	});

	it("falls back to package-root mode when no config file exists", async () => {
		const packageRoot = createTempRoot("loom-preview-build-package-root-");
		const sourceRoot = path.join(packageRoot, "src");
		const outDirRoot = createTempRoot("loom-preview-build-output-");
		const outDir = path.join(outDirRoot, "generated");

		fs.mkdirSync(sourceRoot, { recursive: true });
		fs.writeFileSync(
			path.join(packageRoot, "package.json"),
			JSON.stringify({ name: "package-root" }, null, 2),
			"utf8",
		);
		fs.writeFileSync(
			path.join(sourceRoot, "Button.tsx"),
			`
        export function ButtonPreview() {
          return <frame />;
        }

        export const preview = {
          entry: ButtonPreview,
        };
      `,
			"utf8",
		);

		const result = await buildPreviewArtifacts({
			cwd: packageRoot,
			outDir,
		});

		expect(result.writtenFiles).toEqual(
			expect.arrayContaining([path.join(outDir, "package-root", "Button.tsx")]),
		);
	});

	it("loads loom.config.ts with build context for config-aware builds", async () => {
		const workspaceRoot = createTempRoot("loom-preview-build-context-");
		const target = createWorkspacePackage(workspaceRoot, {
			packageName: "@fixtures/contextual",
			packagePath: "packages/contextual",
		});
		const configFilePath = path.join(workspaceRoot, "loom.config.ts");
		const configDir = path.dirname(configFilePath);
		const relativePackageRoot = path
			.relative(configDir, target.packageRoot)
			.split(path.sep)
			.join("/");
		const relativeSourceRoot = path
			.relative(configDir, target.sourceRoot)
			.split(path.sep)
			.join("/");
		const outDir = path.join(workspaceRoot, "generated");

		fs.writeFileSync(
			configFilePath,
			`
      export default ({ command, mode }) => ({
        projectName: \`\${command}:\${mode}\`,
        targetDiscovery: {
          discoverTargets() {
            return [
              {
                name: command === "build" ? "build-target" : "serve-target",
                packageName: "@fixtures/contextual",
                packageRoot: "./${relativePackageRoot}",
                sourceRoot: "./${relativeSourceRoot}",
              },
            ];
          },
        },
      });
    `,
			"utf8",
		);

		const result = await buildPreviewArtifacts({
			cwd: target.packageRoot,
			outDir,
		});

		expect(result.writtenFiles).toEqual(
			expect.arrayContaining([
				path.join(outDir, "build-target", target.sourceFile),
			]),
		);
		expect(
			result.writtenFiles.some((filePath) =>
				filePath.includes(path.join("serve-target", target.sourceFile)),
			),
		).toBe(false);
	});

	it("builds design-time metadata artifacts through the config-aware wrapper", async () => {
		const workspaceRoot = createTempRoot("loom-preview-build-design-time-");
		const target = createWorkspacePackage(workspaceRoot, {
			packageName: "@fixtures/metadata",
			packagePath: "packages/metadata",
			sourceFile: "Card.tsx",
		});
		writeInlinePreviewConfig(path.join(workspaceRoot, "loom.config.ts"), {
			packageName: "@fixtures/metadata",
			packageRoot: target.packageRoot,
			projectName: "Metadata Build",
			sourceRoot: target.sourceRoot,
			targetName: "metadata-target",
		});
		const outDir = path.join(workspaceRoot, "metadata-build");

		const result = await buildPreviewArtifacts({
			artifactKinds: ["entry-metadata", "layout-schema"],
			cwd: target.packageRoot,
			outDir,
			transformMode: "design-time",
		});

		expect(result.builtArtifacts.map((artifact) => artifact.kind)).toEqual([
			"entry-metadata",
			"layout-schema",
		]);
		expect(result.writtenFiles).toEqual(
			expect.arrayContaining([
				path.join(
					outDir,
					"metadata-target",
					".preview-engine",
					"entry-metadata",
					"Card.tsx.preview-entry.json",
				),
				path.join(
					outDir,
					"metadata-target",
					".preview-engine",
					"layout-schema",
					"Card.tsx.preview-layout.json",
				),
			]),
		);
	});
});

describe("buildPreviewModules", () => {
	it("continues to reject design-time mode from the module-only wrapper", async () => {
		const fixtureRoot = createTempRoot(
			"loom-preview-build-modules-design-time-",
		);
		const sourceRoot = path.join(fixtureRoot, "src");

		fs.mkdirSync(sourceRoot, { recursive: true });
		fs.writeFileSync(
			path.join(sourceRoot, "Button.tsx"),
			"export function ButtonPreview() { return <frame />; }\n",
			"utf8",
		);

		await expect(
			buildPreviewModules({
				targets: [{ name: "modules-only", sourceRoot }],
				transformMode: "design-time",
			}),
		).rejects.toThrow(/does not support design-time/i);
	});
});
