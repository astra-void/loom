import type {
	NormalizedTransformPreviewSourceResult,
	PreviewTransformDiagnostic,
	PreviewTransformMode,
	PreviewTransformOutcome,
} from "./transformTypes";

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

function createDefaultTransformOutcome(
	mode: PreviewTransformMode,
): PreviewTransformOutcome {
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

function toTransformDiagnostic(
	mode: PreviewTransformMode,
	error: UnsupportedPatternError,
): PreviewTransformDiagnostic {
	const blocking =
		mode === "strict-fidelity" ||
		(typeof error.code === "string" &&
			error.code.startsWith("UNSUPPORTED_COMMONJS_"));

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

	if (diagnostics.some((diagnostic) => diagnostic.blocking)) {
		return {
			fidelity: "degraded",
			kind: "blocked",
		};
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
	result: TransformPreviewSourceResultInput,
	mode: PreviewTransformMode,
): NormalizedTransformPreviewSourceResult {
	const diagnostics = Array.isArray(result.diagnostics)
		? result.diagnostics
		: Array.isArray(result.errors)
			? result.errors.map((error) => toTransformDiagnostic(mode, error))
			: [];
	const outcome = result.outcome ?? inferTransformOutcome(mode, diagnostics);

	return {
		code:
			outcome.kind === "blocked" || outcome.kind === "design-time"
				? undefined
				: typeof result.code === "string"
					? result.code
					: undefined,
		diagnostics,
		outcome,
	};
}
