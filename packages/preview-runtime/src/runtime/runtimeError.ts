const PREFIX = "@lattice-ui/preview-runtime";
const REPORTER_KEY = Symbol.for("lattice-ui.preview-runtime.reporter");

export type PreviewExecutionMode = "strict-fidelity" | "compatibility" | "mocked" | "design-time";
export type PreviewRuntimeIssueKind =
  | "ModuleLoadError"
  | "TransformExecutionError"
  | "TransformValidationError"
  | "UnsupportedPatternError"
  | "RuntimeMockError"
  | "LayoutExecutionError"
  | "LayoutValidationError";
export type PreviewRuntimeIssuePhase = "transform" | "runtime" | "layout";

export type PreviewRuntimeIssue = {
  code: string;
  entryId: string;
  file: string;
  kind: PreviewRuntimeIssueKind;
  phase: PreviewRuntimeIssuePhase;
  relativeFile: string;
  summary: string;
  target: string;
  codeFrame?: string;
  details?: string;
  importChain?: string[];
  symbol?: string;
};

export type PreviewRuntimeIssueContext = Partial<Omit<PreviewRuntimeIssue, "kind" | "phase" | "summary">> & {
  kind?: PreviewRuntimeIssueKind;
  phase?: PreviewRuntimeIssuePhase;
  summary?: string;
};

type PreviewRuntimeErrorOptions = PreviewRuntimeIssueContext & {
  cause?: unknown;
  summary: string;
};

type PreviewRuntimeIssueListener = (issues: PreviewRuntimeIssue[]) => void;

export interface PreviewRuntimeReporter {
  clear(): void;
  getIssues(): PreviewRuntimeIssue[];
  publish(issue: PreviewRuntimeIssue): void;
  setContext(context: PreviewRuntimeIssueContext | null): void;
  subscribe(listener: PreviewRuntimeIssueListener): () => void;
}

function toErrorSummary(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function defaultPhaseForKind(kind: PreviewRuntimeIssueKind): PreviewRuntimeIssuePhase {
  switch (kind) {
    case "LayoutExecutionError":
    case "LayoutValidationError":
      return "layout";
    case "TransformExecutionError":
    case "TransformValidationError":
    case "UnsupportedPatternError":
      return "transform";
    case "ModuleLoadError":
    case "RuntimeMockError":
    default:
      return "runtime";
  }
}

function defaultCodeForKind(kind: PreviewRuntimeIssueKind) {
  switch (kind) {
    case "ModuleLoadError":
      return "MODULE_LOAD_ERROR";
    case "TransformExecutionError":
      return "TRANSFORM_EXECUTION_ERROR";
    case "TransformValidationError":
      return "TRANSFORM_VALIDATION_ERROR";
    case "UnsupportedPatternError":
      return "UNSUPPORTED_PATTERN";
    case "RuntimeMockError":
      return "RUNTIME_MOCK_ERROR";
    case "LayoutExecutionError":
      return "LAYOUT_EXECUTION_ERROR";
    case "LayoutValidationError":
      return "LAYOUT_VALIDATION_ERROR";
  }
}

function normalizeContext(context?: PreviewRuntimeIssueContext | null) {
  return context ?? {};
}

export class PreviewRuntimeError extends Error {
  public readonly code: string;
  public readonly details?: string;
  public readonly entryId?: string;
  public readonly file?: string;
  public readonly importChain?: string[];
  public readonly kind: PreviewRuntimeIssueKind;
  public readonly phase: PreviewRuntimeIssuePhase;
  public readonly relativeFile?: string;
  public readonly summary: string;
  public readonly symbol?: string;
  public readonly target?: string;
  public readonly codeFrame?: string;

  public constructor(kind: PreviewRuntimeIssueKind, options: PreviewRuntimeErrorOptions) {
    super(options.summary);
    this.name = kind;
    if (options.cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = options.cause;
    }
    this.kind = kind;
    this.phase = options.phase ?? defaultPhaseForKind(kind);
    this.code = options.code ?? defaultCodeForKind(kind);
    this.summary = options.summary;
    this.entryId = options.entryId;
    this.file = options.file;
    this.relativeFile = options.relativeFile;
    this.target = options.target;
    this.details = options.details;
    this.codeFrame = options.codeFrame;
    this.symbol = options.symbol;
    this.importChain = options.importChain;
  }

  public toIssue(context?: PreviewRuntimeIssueContext | null): PreviewRuntimeIssue {
    const normalized = normalizeContext(context);

    return {
      code: normalized.code ?? this.code,
      codeFrame: normalized.codeFrame ?? this.codeFrame,
      details: normalized.details ?? this.details,
      entryId: normalized.entryId ?? this.entryId ?? "unknown-entry",
      file: normalized.file ?? this.file ?? "<runtime>",
      importChain: normalized.importChain ?? this.importChain,
      kind: normalized.kind ?? this.kind,
      phase: normalized.phase ?? this.phase,
      relativeFile: normalized.relativeFile ?? this.relativeFile ?? "<runtime>",
      summary: normalized.summary ?? this.summary,
      symbol: normalized.symbol ?? this.symbol,
      target: normalized.target ?? this.target ?? "preview-runtime",
    };
  }
}

class FixedPreviewRuntimeError extends PreviewRuntimeError {
  public constructor(kind: PreviewRuntimeIssueKind, options: PreviewRuntimeErrorOptions) {
    super(kind, options);
  }
}

export class ModuleLoadError extends FixedPreviewRuntimeError {
  public constructor(options: PreviewRuntimeErrorOptions) {
    super("ModuleLoadError", options);
  }
}

export class TransformExecutionError extends FixedPreviewRuntimeError {
  public constructor(options: PreviewRuntimeErrorOptions) {
    super("TransformExecutionError", options);
  }
}

export class TransformValidationError extends FixedPreviewRuntimeError {
  public constructor(options: PreviewRuntimeErrorOptions) {
    super("TransformValidationError", options);
  }
}

export class UnsupportedPatternError extends FixedPreviewRuntimeError {
  public constructor(options: PreviewRuntimeErrorOptions) {
    super("UnsupportedPatternError", options);
  }
}

export class RuntimeMockError extends FixedPreviewRuntimeError {
  public constructor(options: PreviewRuntimeErrorOptions) {
    super("RuntimeMockError", options);
  }
}

export class LayoutExecutionError extends FixedPreviewRuntimeError {
  public constructor(options: PreviewRuntimeErrorOptions) {
    super("LayoutExecutionError", options);
  }
}

export class LayoutValidationError extends FixedPreviewRuntimeError {
  public constructor(options: PreviewRuntimeErrorOptions) {
    super("LayoutValidationError", options);
  }
}

function createRuntimeError(kind: PreviewRuntimeIssueKind, options: PreviewRuntimeErrorOptions) {
  switch (kind) {
    case "ModuleLoadError":
      return new ModuleLoadError(options);
    case "TransformExecutionError":
      return new TransformExecutionError(options);
    case "TransformValidationError":
      return new TransformValidationError(options);
    case "UnsupportedPatternError":
      return new UnsupportedPatternError(options);
    case "RuntimeMockError":
      return new RuntimeMockError(options);
    case "LayoutExecutionError":
      return new LayoutExecutionError(options);
    case "LayoutValidationError":
      return new LayoutValidationError(options);
  }
}

class PreviewRuntimeReporterStore implements PreviewRuntimeReporter {
  private context: PreviewRuntimeIssueContext | null = null;
  private issues: PreviewRuntimeIssue[] = [];
  private readonly listeners = new Set<PreviewRuntimeIssueListener>();

  public clear() {
    this.issues = [];
    this.emit();
  }

  public getIssues() {
    return [...this.issues];
  }

  public publish(issue: PreviewRuntimeIssue) {
    this.issues = [...this.issues, issue];
    this.emit();
    console.error(`${PREFIX}:${issue.kind}`, issue);
  }

  public setContext(context: PreviewRuntimeIssueContext | null) {
    this.context = context;
  }

  public getContext() {
    return this.context;
  }

  public subscribe(listener: PreviewRuntimeIssueListener) {
    this.listeners.add(listener);
    listener(this.getIssues());
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit() {
    const snapshot = this.getIssues();
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }
}

function getReporterStore() {
  const globalRecord = globalThis as typeof globalThis & {
    [REPORTER_KEY]?: PreviewRuntimeReporterStore;
  };

  if (!globalRecord[REPORTER_KEY]) {
    globalRecord[REPORTER_KEY] = new PreviewRuntimeReporterStore();
  }

  return globalRecord[REPORTER_KEY];
}

export function getPreviewRuntimeReporter(): PreviewRuntimeReporter {
  return getReporterStore();
}

export function getPreviewRuntimeIssues() {
  return getReporterStore().getIssues();
}

export function clearPreviewRuntimeIssues() {
  getReporterStore().clear();
}

export function subscribePreviewRuntimeIssues(listener: PreviewRuntimeIssueListener) {
  return getReporterStore().subscribe(listener);
}

export function setPreviewRuntimeIssueContext(context: PreviewRuntimeIssueContext | null) {
  getReporterStore().setContext(context);
}

export function normalizePreviewRuntimeError(context: PreviewRuntimeIssueContext, error: unknown): PreviewRuntimeIssue {
  const reporterContext = getReporterStore().getContext();
  const mergedContext = {
    ...normalizeContext(reporterContext),
    ...normalizeContext(context),
  };

  if (error instanceof PreviewRuntimeError) {
    return error.toIssue(mergedContext);
  }

  const kind = mergedContext.kind ?? "TransformExecutionError";
  return createRuntimeError(kind, {
    ...mergedContext,
    summary: mergedContext.summary ?? toErrorSummary(error),
    cause: error,
  }).toIssue();
}

export function publishPreviewRuntimeIssue(
  issueOrError: PreviewRuntimeIssue | PreviewRuntimeError | unknown,
  context: PreviewRuntimeIssueContext = {},
) {
  const issue =
    issueOrError instanceof PreviewRuntimeError
      ? issueOrError.toIssue({
          ...normalizeContext(getReporterStore().getContext()),
          ...normalizeContext(context),
        })
      : issueOrError && typeof issueOrError === "object" && "kind" in issueOrError && "phase" in issueOrError
        ? (issueOrError as PreviewRuntimeIssue)
        : normalizePreviewRuntimeError(context, issueOrError);

  getReporterStore().publish(issue);
  return issue;
}

/**
 * @deprecated use `publishPreviewRuntimeIssue(normalizePreviewRuntimeError(...))`
 */
export function reportPreviewRuntimeError(scope: string, error: unknown) {
  publishPreviewRuntimeIssue(error, {
    code: "RUNTIME_ERROR",
    details: scope,
    kind: "TransformExecutionError",
    phase: "runtime",
    summary: `${scope}: ${toErrorSummary(error)}`,
  });
}
