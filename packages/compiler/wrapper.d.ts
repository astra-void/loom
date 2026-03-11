export type PreviewTransformMode = "strict-fidelity" | "compatibility" | "mocked" | "design-time";
export type PreviewTransformSeverity = "error" | "info" | "warning";

export interface UnsupportedPatternError {
  code: string;
  message: string;
  file: string;
  line: number;
  column: number;
  symbol?: string;
  target: string;
}

export interface PreviewTransformDiagnostic {
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
}

export interface PreviewTransformOutcome {
  fidelity: "preserved" | "degraded" | "metadata-only";
  kind: "ready" | "compatibility" | "mocked" | "blocked" | "design-time";
}

export interface TransformPreviewSourceOptions {
  filePath: string;
  mode?: PreviewTransformMode;
  runtimeModule: string;
  target: string;
}

export interface TransformPreviewSourceResult {
  code: string | null;
  errors: UnsupportedPatternError[];
  diagnostics: PreviewTransformDiagnostic[];
  outcome: PreviewTransformOutcome;
}

export declare function compile_tsx(code: string): string;
export declare function transformPreviewSource(
  code: string,
  options: TransformPreviewSourceOptions,
): TransformPreviewSourceResult;
