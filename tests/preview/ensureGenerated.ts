import fs from "node:fs";
import path from "node:path";
import { buildPreviewModules, type BuildPreviewModulesResult } from "../../packages/preview/src/build";

let generationPromise: Promise<BuildPreviewModulesResult> | undefined;
export const GENERATED_COMPONENT_TARGET = "components-preview";

export function ensurePreviewGenerated() {
  if (!generationPromise) {
    const outDir = path.resolve(__dirname, ".generated-components-preview");
    const fixtureRoot = path.resolve(__dirname, "fixtures/components-preview");
    fs.rmSync(outDir, { force: true, recursive: true });
    fs.mkdirSync(outDir, { recursive: true });
    generationPromise = buildPreviewModules({
      targets: [
        {
          name: GENERATED_COMPONENT_TARGET,
          packageName: "@fixtures/components-preview",
          packageRoot: fixtureRoot,
          sourceRoot: path.join(fixtureRoot, "src"),
        },
      ],
      outDir,
      transformMode: "compatibility",
    });
  }

  return generationPromise;
}
