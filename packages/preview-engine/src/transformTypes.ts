import type {
  TransformPreviewSourceOptions as CompilerTransformPreviewSourceOptions,
  TransformPreviewSourceResult as CompilerTransformPreviewSourceResult,
} from "@lattice-ui/compiler";

export type PreviewTransformMode = "strict-fidelity" | "compatibility" | "mocked" | "design-time";
export type PreviewTransformSeverity = "error" | "info" | "warning";

export type PreviewTransformDiagnostic = {
  blocking: boolean;
  code: string;
  details?: string;
  file: string;
  line: number;
  column: number;
  severity: PreviewTransformSeverity;
  summary: string;
  symbol?: string;
  target: string;
};

export type PreviewTransformOutcome = {
  fidelity: "preserved" | "degraded" | "metadata-only";
  kind: "ready" | "compatibility" | "mocked" | "blocked" | "design-time";
};

export type TransformPreviewSourceOptions = CompilerTransformPreviewSourceOptions & {
  mode?: PreviewTransformMode;
};

export type TransformPreviewSourceResult = CompilerTransformPreviewSourceResult & {
  diagnostics?: PreviewTransformDiagnostic[];
  outcome?: PreviewTransformOutcome;
};

export type NormalizedTransformPreviewSourceResult = {
  code?: string;
  diagnostics: PreviewTransformDiagnostic[];
  outcome: PreviewTransformOutcome;
};
