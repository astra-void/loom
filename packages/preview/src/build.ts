import fs from "node:fs";
import path from "node:path";
import {
  buildPreviewArtifacts,
  type PreviewBuildDiagnostic,
  type PreviewExecutionMode,
} from "@lattice-ui/preview-engine";
import type { PreviewTransformDiagnostic } from "./transformTypes";

export type PreviewBuildTarget = {
  name: string;
  packageName?: string;
  packageRoot?: string;
  sourceRoot: string;
};

export type UnsupportedPatternCode = PreviewTransformDiagnostic["code"];
export type UnsupportedPatternError = PreviewTransformDiagnostic;

export type BuildPreviewModulesOptions = {
  targets: PreviewBuildTarget[];
  outDir?: string;
  runtimeModule?: string;
  failOnUnsupported?: boolean;
  transformMode?: PreviewExecutionMode;
};

export type BuildPreviewModulesResult = {
  outDir: string;
  removedFiles?: string[];
  writtenFiles: string[];
};

export class PreviewBuildError extends Error {
  readonly errors: PreviewTransformDiagnostic[];

  constructor(errors: PreviewTransformDiagnostic[]) {
    super(`Preview generation failed with ${errors.length} unsupported pattern(s).`);
    this.errors = errors;
    this.name = "PreviewBuildError";
  }
}

function findNearestPackageRoot(startPath: string) {
  let current = path.resolve(startPath);

  while (true) {
    if (fs.existsSync(path.join(current, "package.json"))) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return path.resolve(startPath);
    }

    current = parent;
  }
}

function inferPreviewSourceTargets(targets: PreviewBuildTarget[]) {
  return targets.map((target) => {
    const sourceRoot = path.resolve(target.sourceRoot);
    const packageRoot = path.resolve(target.packageRoot ?? findNearestPackageRoot(sourceRoot));
    return {
      name: target.name,
      packageName: target.packageName ?? target.name,
      packageRoot,
      sourceRoot,
    };
  });
}

function isTransformDiagnostic(diagnostic: PreviewBuildDiagnostic): diagnostic is PreviewTransformDiagnostic {
  return "line" in diagnostic && "column" in diagnostic;
}

export async function buildPreviewModules(options: BuildPreviewModulesOptions): Promise<BuildPreviewModulesResult> {
  const outDir = options.outDir ?? path.resolve(process.cwd(), "generated");
  const transformMode =
    options.transformMode ?? (options.failOnUnsupported === false ? "compatibility" : "strict-fidelity");

  if (transformMode === "design-time") {
    throw new Error("buildPreviewModules does not support design-time transform mode.");
  }

  const result = await buildPreviewArtifacts({
    artifactKinds: ["module"],
    outDir,
    projectName: "Preview Build",
    runtimeModule: options.runtimeModule,
    targets: inferPreviewSourceTargets(options.targets),
    transformMode,
  });

  const blockingErrors = result.diagnostics.filter(
    (diagnostic): diagnostic is PreviewTransformDiagnostic => isTransformDiagnostic(diagnostic) && diagnostic.blocking,
  );
  if (blockingErrors.length > 0) {
    throw new PreviewBuildError(blockingErrors);
  }

  return {
    outDir,
    removedFiles: result.removedFiles,
    writtenFiles: result.writtenFiles,
  };
}
