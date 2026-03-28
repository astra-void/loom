export type PreviewTransformMode =
	| "strict-fidelity"
	| "compatibility"
	| "mocked"
	| "design-time";
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
	reactAliases?: string[] | undefined;
	reactRobloxAliases?: string[] | undefined;
	mode?: PreviewTransformMode;
	fileExists?: ((candidatePath: string) => boolean) | undefined;
	runtimeModule: string;
	runtimeAliases?: string[] | undefined;
	target: string;
}

export interface TransformPreviewSourceResult {
	code: string | null;
	errors: UnsupportedPatternError[];
	diagnostics: PreviewTransformDiagnostic[];
	outcome: PreviewTransformOutcome;
}

export interface NormalizedTransformPreviewSourceResult {
	code?: string;
	diagnostics: PreviewTransformDiagnostic[];
	outcome: PreviewTransformOutcome;
}

export function compile_tsx(code: string): string;

export function normalizeTransformPreviewSourceResult(
	result:
		| TransformPreviewSourceResult
		| {
				code?: string | null | undefined;
				diagnostics?: PreviewTransformDiagnostic[] | undefined;
				errors?: UnsupportedPatternError[] | undefined;
				outcome?: PreviewTransformOutcome | undefined;
		  },
	mode: PreviewTransformMode,
): NormalizedTransformPreviewSourceResult;

export function transformPreviewSource(
	code: string,
	options: TransformPreviewSourceOptions,
): TransformPreviewSourceResult;

declare const _default: {
	compile_tsx: typeof compile_tsx;
	normalizeTransformPreviewSourceResult: typeof normalizeTransformPreviewSourceResult;
	transformPreviewSource: typeof transformPreviewSource;
};

export default _default;
