import type { UnsupportedPatternError } from "@lattice-ui/compiler";
import type {
  NormalizedTransformPreviewSourceResult,
  PreviewTransformDiagnostic,
  PreviewTransformMode,
  PreviewTransformOutcome,
  TransformPreviewSourceResult,
} from "./transformTypes";

function createDefaultTransformOutcome(mode: PreviewTransformMode): PreviewTransformOutcome {
  if (mode === "design-time") {
    return {
      fidelity: "metadata-only",
      kind: "design-time",
    };
  }

  return {
    fidelity: "preserved",
    kind: "ready",
  };
}

function toTransformDiagnostic(mode: PreviewTransformMode, error: UnsupportedPatternError): PreviewTransformDiagnostic {
  const blocking = mode === "strict-fidelity";

  return {
    blocking,
    code: error.code,
    column: error.column,
    details: error.message,
    file: error.file,
    line: error.line,
    severity: blocking ? "error" : "warning",
    summary: error.message,
    ...(error.symbol ? { symbol: error.symbol } : {}),
    target: error.target,
  };
}

function inferTransformOutcome(
  mode: PreviewTransformMode,
  diagnostics: PreviewTransformDiagnostic[],
): PreviewTransformOutcome {
  if (mode === "design-time") {
    return createDefaultTransformOutcome(mode);
  }

  if (diagnostics.length === 0) {
    return createDefaultTransformOutcome(mode);
  }

  if (mode === "strict-fidelity") {
    return {
      fidelity: "degraded",
      kind: "blocked",
    };
  }

  return {
    fidelity: "degraded",
    kind: mode === "mocked" ? "mocked" : "compatibility",
  };
}

export function normalizeTransformPreviewSourceResult(
  result: TransformPreviewSourceResult,
  mode: PreviewTransformMode,
): NormalizedTransformPreviewSourceResult {
  const diagnostics = Array.isArray(result.diagnostics)
    ? result.diagnostics
    : Array.isArray(result.errors)
      ? result.errors.map((error) => toTransformDiagnostic(mode, error))
      : [];
  const outcome = result.outcome ?? inferTransformOutcome(mode, diagnostics);

  return {
    code: outcome.kind === "blocked" || outcome.kind === "design-time" ? undefined : (result.code ?? undefined),
    diagnostics,
    outcome,
  };
}
