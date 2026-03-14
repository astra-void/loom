export = compiler;
/** @type {CompilerModule} */
declare const compiler: CompilerModule;
declare namespace compiler {
    export { PreviewTransformMode, PreviewTransformSeverity, UnsupportedPatternError, PreviewTransformDiagnostic, PreviewTransformOutcome, TransformPreviewSourceOptions, TransformPreviewSourceResultInput, NormalizedTransformPreviewSourceResult, TransformPreviewSourceResult, NativeCompilerModule, CompilerModule };
}
type PreviewTransformMode = "strict-fidelity" | "compatibility" | "mocked" | "design-time";
type PreviewTransformSeverity = "error" | "info" | "warning";
type UnsupportedPatternError = {
    code: string;
    message: string;
    file: string;
    line: number;
    column: number;
    symbol?: string | undefined;
    target: string;
};
type PreviewTransformDiagnostic = {
    blocking: boolean;
    code: string;
    details?: string | undefined;
    file: string;
    line: number;
    column: number;
    severity: PreviewTransformSeverity;
    summary: string;
    symbol?: string | undefined;
    target: string;
};
type PreviewTransformOutcome = {
    fidelity: "preserved" | "degraded" | "metadata-only";
    kind: "ready" | "compatibility" | "mocked" | "blocked" | "design-time";
};
type TransformPreviewSourceOptions = {
    filePath: string;
    mode?: PreviewTransformMode | undefined;
    runtimeModule: string;
    target: string;
};
type TransformPreviewSourceResultInput = {
    code?: string | null | undefined;
    errors?: UnsupportedPatternError[] | undefined;
    diagnostics?: PreviewTransformDiagnostic[] | undefined;
    outcome?: PreviewTransformOutcome | undefined;
};
type NormalizedTransformPreviewSourceResult = {
    code?: string | undefined;
    diagnostics: PreviewTransformDiagnostic[];
    outcome: PreviewTransformOutcome;
};
type TransformPreviewSourceResult = {
    code: string | null;
    errors: UnsupportedPatternError[];
    diagnostics: PreviewTransformDiagnostic[];
    outcome: PreviewTransformOutcome;
};
type NativeCompilerModule = typeof import("./index.js");
type CompilerModule = Omit<NativeCompilerModule, "transformPreviewSource"> & {
    normalizeTransformPreviewSourceResult(result: TransformPreviewSourceResultInput, mode: PreviewTransformMode): NormalizedTransformPreviewSourceResult;
    transformPreviewSource(code: string, options: TransformPreviewSourceOptions): TransformPreviewSourceResult;
};
