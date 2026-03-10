import fs from "node:fs";
import path from "node:path";
import { buildPreviewModules } from "../../../packages/preview/src/build";

let generationPromise: Promise<string> | undefined;

export function ensurePreviewGenerated() {
  if (!generationPromise) {
    const outDir = path.resolve(__dirname, ".generated-preview");
    fs.mkdirSync(outDir, { recursive: true });
    generationPromise = buildPreviewModules({
      targets: [
        {
          name: "checkbox",
          sourceRoot: path.resolve(__dirname, "../../../packages/checkbox/src"),
        },
        {
          name: "switch",
          sourceRoot: path.resolve(__dirname, "../../../packages/switch/src"),
        },
        {
          name: "dialog",
          sourceRoot: path.resolve(__dirname, "../../../packages/dialog/src"),
        },
      ],
      outDir,
      transformMode: "compatibility",
    }).then(() => outDir);
  }

  return generationPromise;
}
