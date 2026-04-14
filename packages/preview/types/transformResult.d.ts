import type { NormalizedTransformPreviewSourceResult, PreviewTransformDiagnostic, PreviewTransformMode, PreviewTransformOutcome } from "./transformTypes";
type UnsupportedPatternError = {
    code: string;
    column: number;
    file: string;
    line: number;
    message: string;
    symbol?: string;
    target: string;
};
type TransformPreviewSourceResultInput = {
    code?: string | null;
    diagnostics?: PreviewTransformDiagnostic[];
    errors?: UnsupportedPatternError[];
    outcome?: PreviewTransformOutcome;
};
export declare function normalizeTransformPreviewSourceResult(result: TransformPreviewSourceResultInput, mode: PreviewTransformMode): NormalizedTransformPreviewSourceResult;
export {};
