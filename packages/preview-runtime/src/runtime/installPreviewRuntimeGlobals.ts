import { Enum } from "./Enum";
import { installPreviewRuntimePolyfills } from "./polyfills";
import { RunService } from "./RunService";
import { task } from "./task";

export interface PreviewRuntimeGlobalTarget {
  Enum?: typeof Enum;
  RunService?: typeof RunService;
  print?: (...args: unknown[]) => void;
  task?: typeof task;
  tostring?: (value: unknown) => string;
}

export function installPreviewRuntimeGlobals(
  target: PreviewRuntimeGlobalTarget = globalThis as PreviewRuntimeGlobalTarget,
) {
  installPreviewRuntimePolyfills(target as typeof globalThis);

  if (target.Enum === undefined) {
    target.Enum = Enum;
  }

  if (target.RunService === undefined) {
    target.RunService = RunService;
  }

  if (target.task === undefined) {
    target.task = task;
  }

  return target;
}

export default installPreviewRuntimeGlobals;
