import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildPreviewArtifacts } from "@lattice-ui/preview-engine";
import { afterEach, describe, expect, it } from "vitest";
import { resolveRealFilePath } from "../../../packages/preview-engine/src/pathUtils";

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    fs.rmSync(root, { force: true, recursive: true });
  }
});

function createTempWorkspacePackage(files: Record<string, string>) {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lattice-preview-build-engine-"));
  const packageRoot = path.join(workspaceRoot, "packages", "fixture");
  const sourceRoot = path.join(packageRoot, "src");
  temporaryRoots.push(workspaceRoot);

  fs.mkdirSync(sourceRoot, { recursive: true });
  fs.writeFileSync(path.join(workspaceRoot, "pnpm-workspace.yaml"), 'packages:\n  - "packages/*"\n', "utf8");
  fs.writeFileSync(
    path.join(packageRoot, "package.json"),
    JSON.stringify({ name: "@fixtures/build-engine" }, null, 2),
    "utf8",
  );

  for (const [relativePath, content] of Object.entries(files)) {
    const filePath = path.join(packageRoot, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, "utf8");
  }

  return {
    cacheDir: path.join(workspaceRoot, ".lattice-preview-cache"),
    packageRoot,
    sourceRoot,
    workspaceRoot,
  };
}

function createTempWorkspacePackages(packages: Record<string, Record<string, string>>) {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lattice-preview-build-workspace-"));
  temporaryRoots.push(workspaceRoot);
  fs.writeFileSync(path.join(workspaceRoot, "pnpm-workspace.yaml"), 'packages:\n  - "packages/*"\n', "utf8");

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
      fs.writeFileSync(path.join(packageRoot, "package.json"), JSON.stringify({ name: packageName }, null, 2), "utf8");
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

function createBuildOptions(
  packageRoot: string,
  sourceRoot: string,
  workspaceRoot: string,
  overrides: Partial<Parameters<typeof buildPreviewArtifacts>[0]> = {},
) {
  return {
    artifactKinds: ["module"] as const,
    projectName: "Fixture Build",
    targets: [
      {
        name: "fixture",
        packageName: "@fixtures/build-engine",
        packageRoot,
        sourceRoot,
      },
    ],
    workspaceRoot,
    ...overrides,
  };
}

describe("buildPreviewArtifacts", () => {
  it("reuses a shared workspace cache across output directories", async () => {
    const { cacheDir, packageRoot, sourceRoot, workspaceRoot } = createTempWorkspacePackage({
      "src/index.tsx": `
        import { labelText } from "./support/labelText";

        export function Example() {
          return <textlabel Text={labelText} />;
        }
      `,
      "src/support/labelText.ts": `
        export const labelText = "ready";
      `,
    });
    const firstOutDir = path.join(workspaceRoot, "generated-a");
    const secondOutDir = path.join(workspaceRoot, "generated-b");

    const first = await buildPreviewArtifacts(
      createBuildOptions(packageRoot, sourceRoot, workspaceRoot, {
        artifactKinds: ["module"],
        outDir: firstOutDir,
      }),
    );
    expect(first.cacheDir).toBe(resolveRealFilePath(cacheDir));
    expect(first.reusedArtifacts).toHaveLength(0);
    expect(first.writtenFiles).toEqual(
      expect.arrayContaining([
        path.join(firstOutDir, "fixture", "index.tsx"),
        path.join(firstOutDir, "fixture", "support", "labelText.ts"),
      ]),
    );

    const second = await buildPreviewArtifacts(
      createBuildOptions(packageRoot, sourceRoot, workspaceRoot, {
        artifactKinds: ["module"],
        outDir: secondOutDir,
      }),
    );
    expect(second.reusedArtifacts).toHaveLength(second.builtArtifacts.length);
    expect(second.builtArtifacts.every((artifact) => artifact.reusedFromCache)).toBe(true);
    expect(second.writtenFiles).toEqual(
      expect.arrayContaining([
        path.join(secondOutDir, "fixture", "index.tsx"),
        path.join(secondOutDir, "fixture", "support", "labelText.ts"),
      ]),
    );

    const third = await buildPreviewArtifacts(
      createBuildOptions(packageRoot, sourceRoot, workspaceRoot, {
        artifactKinds: ["module"],
        outDir: secondOutDir,
      }),
    );
    expect(third.reusedArtifacts).toHaveLength(third.builtArtifacts.length);
    expect(third.writtenFiles).toEqual([]);
    expect(fs.existsSync(path.join(cacheDir, "transform"))).toBe(true);
  });

  it("recomputes only dependent artifacts when transitive inputs change", async () => {
    const { packageRoot, sourceRoot, workspaceRoot } = createTempWorkspacePackage({
      "src/index.tsx": `
        import { labelText } from "./support/labelText";

        export function Example() {
          return <textlabel Text={labelText} />;
        }
      `,
      "src/Extra.tsx": `
        export function Extra() {
          return <frame />;
        }
      `,
      "src/support/labelText.ts": `
        export const labelText = "ready";
      `,
    });
    const outDir = path.join(workspaceRoot, "generated");

    await buildPreviewArtifacts(
      createBuildOptions(packageRoot, sourceRoot, workspaceRoot, {
        artifactKinds: ["module"],
        outDir,
      }),
    );

    fs.writeFileSync(path.join(sourceRoot, "support", "labelText.ts"), 'export const labelText = "changed";\n', "utf8");

    const rebuilt = await buildPreviewArtifacts(
      createBuildOptions(packageRoot, sourceRoot, workspaceRoot, {
        artifactKinds: ["module"],
        outDir,
      }),
    );
    const artifactsById = new Map(rebuilt.builtArtifacts.map((artifact) => [artifact.id, artifact]));

    expect(artifactsById.get("fixture:index.tsx")?.reusedFromCache).toBe(false);
    expect(artifactsById.get("fixture:support/labelText.ts")?.reusedFromCache).toBe(false);
    expect(artifactsById.get("fixture:Extra.tsx")?.reusedFromCache).toBe(true);
  });

  it("treats cache keys as sensitive to transform mode and runtime module", async () => {
    const { packageRoot, sourceRoot, workspaceRoot } = createTempWorkspacePackage({
      "src/index.tsx": `
        export function Example() {
          return <frame />;
        }
      `,
    });

    const base = await buildPreviewArtifacts(
      createBuildOptions(packageRoot, sourceRoot, workspaceRoot, {
        artifactKinds: ["module"],
        transformMode: "compatibility",
      }),
    );
    expect(base.reusedArtifacts).toHaveLength(0);

    const same = await buildPreviewArtifacts(
      createBuildOptions(packageRoot, sourceRoot, workspaceRoot, {
        artifactKinds: ["module"],
        transformMode: "compatibility",
      }),
    );
    expect(same.builtArtifacts.every((artifact) => artifact.reusedFromCache)).toBe(true);

    const changedTransformMode = await buildPreviewArtifacts(
      createBuildOptions(packageRoot, sourceRoot, workspaceRoot, {
        artifactKinds: ["module"],
        transformMode: "strict-fidelity",
      }),
    );
    expect(changedTransformMode.builtArtifacts.every((artifact) => !artifact.reusedFromCache)).toBe(true);

    const changedRuntimeModule = await buildPreviewArtifacts(
      createBuildOptions(packageRoot, sourceRoot, workspaceRoot, {
        artifactKinds: ["module"],
        runtimeModule: "virtual:custom-preview-runtime",
        transformMode: "strict-fidelity",
      }),
    );
    expect(changedRuntimeModule.builtArtifacts.every((artifact) => !artifact.reusedFromCache)).toBe(true);
  });

  it("builds entry metadata and layout schema sidecars in metadata-only mode", async () => {
    const { packageRoot, sourceRoot, workspaceRoot } = createTempWorkspacePackage({
      "src/Card.tsx": `
        export function Card() {
          return <frame />;
        }

        export const preview = {
          entry: Card,
          title: "Card",
        };
      `,
    });
    const outDir = path.join(workspaceRoot, "metadata-build");

    const first = await buildPreviewArtifacts(
      createBuildOptions(packageRoot, sourceRoot, workspaceRoot, {
        artifactKinds: ["entry-metadata", "layout-schema"],
        outDir,
        transformMode: "design-time",
      }),
    );
    expect(first.builtArtifacts.map((artifact) => artifact.kind)).toEqual(["entry-metadata", "layout-schema"]);
    expect(first.writtenFiles).toEqual(
      expect.arrayContaining([
        path.join(outDir, "fixture", ".preview-engine", "entry-metadata", "Card.tsx.preview-entry.json"),
        path.join(outDir, "fixture", ".preview-engine", "layout-schema", "Card.tsx.preview-layout.json"),
      ]),
    );

    const metadataPayload = JSON.parse(
      fs.readFileSync(
        path.join(outDir, "fixture", ".preview-engine", "entry-metadata", "Card.tsx.preview-entry.json"),
        "utf8",
      ),
    ) as { descriptor: { id: string } };
    expect(metadataPayload.descriptor.id).toBe("fixture:Card.tsx");

    const second = await buildPreviewArtifacts(
      createBuildOptions(packageRoot, sourceRoot, workspaceRoot, {
        artifactKinds: ["entry-metadata", "layout-schema"],
        outDir,
        transformMode: "design-time",
      }),
    );
    expect(second.reusedArtifacts).toHaveLength(2);
    expect(second.writtenFiles).toEqual([]);
  });

  it("rejects unsafe target names and overlapping output directories", async () => {
    const { packageRoot, sourceRoot, workspaceRoot } = createTempWorkspacePackage({
      "src/index.tsx": `
        export function Safe() {
          return <frame />;
        }
      `,
    });

    await expect(
      buildPreviewArtifacts({
        artifactKinds: ["module"],
        outDir: path.join(workspaceRoot, "generated"),
        projectName: "Fixture Build",
        targets: [
          {
            name: "../escape",
            packageName: "@fixtures/build-engine",
            packageRoot,
            sourceRoot,
          },
        ],
        workspaceRoot,
      }),
    ).rejects.toThrow(/safe path segment/i);

    await expect(
      buildPreviewArtifacts(
        createBuildOptions(packageRoot, sourceRoot, workspaceRoot, {
          artifactKinds: ["module"],
          outDir: workspaceRoot,
        }),
      ),
    ).rejects.toThrow(/workspace root|source tree/i);

    await expect(
      buildPreviewArtifacts(
        createBuildOptions(packageRoot, sourceRoot, workspaceRoot, {
          artifactKinds: ["module"],
          outDir: sourceRoot,
        }),
      ),
    ).rejects.toThrow(/source tree/i);
  });

  it("reuses most artifacts in a large synthetic workspace warm build", async () => {
    const files: Record<string, string> = {
      "src/shared/theme.ts": 'export const themeName = "base";\n',
    };

    for (let index = 0; index < 24; index += 1) {
      files[`src/Component${index}.tsx`] =
        index % 2 === 0
          ? `
              import { themeName } from "./shared/theme";

              export function Component${index}() {
                return <textlabel Text={themeName} />;
              }
            `
          : `
              export function Component${index}() {
                return <frame />;
              }
            `;
    }

    const { packageRoot, sourceRoot, workspaceRoot } = createTempWorkspacePackage(files);
    const outDir = path.join(workspaceRoot, "large-generated");

    const cold = await buildPreviewArtifacts(
      createBuildOptions(packageRoot, sourceRoot, workspaceRoot, {
        artifactKinds: ["module"],
        outDir,
      }),
    );
    expect(cold.reusedArtifacts).toHaveLength(0);

    const warm = await buildPreviewArtifacts(
      createBuildOptions(packageRoot, sourceRoot, workspaceRoot, {
        artifactKinds: ["module"],
        outDir,
      }),
    );
    expect(warm.reusedArtifacts).toHaveLength(warm.builtArtifacts.length);
    expect(warm.writtenFiles).toEqual([]);

    fs.writeFileSync(path.join(sourceRoot, "shared", "theme.ts"), 'export const themeName = "updated";\n', "utf8");

    const invalidated = await buildPreviewArtifacts(
      createBuildOptions(packageRoot, sourceRoot, workspaceRoot, {
        artifactKinds: ["module"],
        outDir,
      }),
    );
    expect(invalidated.reusedArtifacts.length).toBeGreaterThan(0);
    expect(invalidated.reusedArtifacts.length).toBeLessThan(invalidated.builtArtifacts.length);
  });

  it("rebuilds target-owned modules when a workspace package dependency changes", async () => {
    const workspace = createTempWorkspacePackages({
      "@fixtures/shared": {
        "package.json": JSON.stringify({ name: "@fixtures/shared" }, null, 2),
        "src/theme.ts": 'export const themeName = "base";\n',
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
        "src/Entry.tsx": `
          import { themeName } from "@shared/theme";

          export function Entry() {
            return <textlabel Text={themeName} />;
          }
        `,
        "src/Static.tsx": `
          export function Static() {
            return <frame />;
          }
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
    const outDir = path.join(workspace.workspaceRoot, "generated");

    await buildPreviewArtifacts({
      artifactKinds: ["module"],
      outDir,
      projectName: "Workspace Build",
      targets: [
        {
          name: "ui",
          packageName: "@fixtures/ui",
          packageRoot: uiTarget.packageRoot,
          sourceRoot: uiTarget.sourceRoot,
        },
      ],
      workspaceRoot: workspace.workspaceRoot,
    });

    fs.writeFileSync(path.join(sharedTarget.sourceRoot, "theme.ts"), 'export const themeName = "updated";\n', "utf8");

    const rebuilt = await buildPreviewArtifacts({
      artifactKinds: ["module"],
      outDir,
      projectName: "Workspace Build",
      targets: [
        {
          name: "ui",
          packageName: "@fixtures/ui",
          packageRoot: uiTarget.packageRoot,
          sourceRoot: uiTarget.sourceRoot,
        },
      ],
      workspaceRoot: workspace.workspaceRoot,
    });

    const artifactsById = new Map(rebuilt.builtArtifacts.map((artifact) => [artifact.id, artifact]));
    expect(artifactsById.get("ui:Entry.tsx")?.reusedFromCache).toBe(false);
    expect(artifactsById.get("ui:Static.tsx")?.reusedFromCache).toBe(true);
    expect(rebuilt.builtArtifacts.some((artifact) => artifact.sourceFilePath.includes("/shared/"))).toBe(false);
  });
});
