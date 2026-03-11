"use strict";

const native = require("./index.js");

const PREVIEW_GLOBAL_CALL_PATTERN = /__previewGlobal\("([^"]+)"\)/g;

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function createDefaultTransformOutcome(mode) {
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

function toTransformDiagnostic(mode, error) {
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

function inferTransformOutcome(mode, diagnostics) {
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

function findIdentifierLocation(sourceText, identifier) {
  const match = new RegExp(`\\b${escapeRegExp(identifier)}\\b`).exec(sourceText);
  if (!match) {
    return {
      column: 1,
      line: 1,
    };
  }

  const prefix = sourceText.slice(0, match.index);
  const lines = prefix.split(/\r?\n/);

  return {
    column: lines[lines.length - 1].length + 1,
    line: lines.length,
  };
}

function collectMockDiagnostics(sourceText, transformedCode, options) {
  const diagnostics = [];
  const seenSymbols = new Set();

  for (const match of transformedCode.matchAll(PREVIEW_GLOBAL_CALL_PATTERN)) {
    const symbol = match[1];
    if (!symbol || seenSymbols.has(symbol)) {
      continue;
    }

    seenSymbols.add(symbol);
    const location = findIdentifierLocation(sourceText, symbol);
    diagnostics.push({
      blocking: false,
      code: "RUNTIME_MOCK_GLOBAL",
      column: location.column,
      details: `Preview will mock the runtime global \`${symbol}\` in the browser environment.`,
      file: options.filePath,
      line: location.line,
      severity: "warning",
      summary: `Preview will mock the runtime global \`${symbol}\`.`,
      symbol,
      target: options.target,
    });
  }

  return diagnostics;
}

function transformPreviewSource(code, options) {
  const mode = options && typeof options.mode === "string" ? options.mode : "strict-fidelity";
  const result = native.transformPreviewSource(code, options);
  const diagnostics = Array.isArray(result.errors) ? result.errors.map((error) => toTransformDiagnostic(mode, error)) : [];

  if (mode === "mocked" && typeof result.code === "string") {
    diagnostics.push(...collectMockDiagnostics(code, result.code, options));
  }

  const outcome = inferTransformOutcome(mode, diagnostics);

  return {
    ...result,
    code: outcome.kind === "blocked" || outcome.kind === "design-time" ? null : (result.code ?? null),
    diagnostics,
    outcome,
  };
}

module.exports = {
  ...native,
  transformPreviewSource,
};
