import type {
	PreviewBuildDiagnostic,
	PreviewDiagnostic,
	PreviewDiagnosticsSummary,
	PreviewTransformDiagnostic,
} from "../types";

function isPreviewDiagnostic(
	value: PreviewBuildDiagnostic,
): value is PreviewDiagnostic {
	return "phase" in value;
}

export function createDiagnosticsSummary(
	diagnostics: PreviewBuildDiagnostic[],
): PreviewDiagnosticsSummary {
	const byPhase = {
		discovery: 0,
		layout: 0,
		runtime: 0,
		transform: 0,
	} satisfies Record<PreviewDiagnostic["phase"], number>;

	for (const diagnostic of diagnostics) {
		if (isPreviewDiagnostic(diagnostic)) {
			byPhase[diagnostic.phase] += 1;
			continue;
		}

		byPhase.transform += 1;
	}

	return {
		byPhase,
		hasBlocking: diagnostics.some(
			(diagnostic) =>
				diagnostic.blocking === true || diagnostic.severity === "error",
		),
		total: diagnostics.length,
	};
}

function getDiagnosticKey(diagnostic: PreviewBuildDiagnostic) {
	if ("phase" in diagnostic) {
		return JSON.stringify([
			"engine",
			diagnostic.phase,
			diagnostic.entryId,
			diagnostic.file,
			diagnostic.code,
			diagnostic.summary,
			diagnostic.severity,
			diagnostic.target,
			diagnostic.blocking ?? "",
			diagnostic.symbol ?? "",
			diagnostic.details ?? "",
			diagnostic.codeFrame ?? "",
			diagnostic.importChain?.join(">") ?? "",
		]);
	}

	return JSON.stringify([
		"transform",
		diagnostic.file,
		diagnostic.code,
		diagnostic.line,
		diagnostic.column,
		diagnostic.summary,
		diagnostic.severity,
		diagnostic.blocking,
		diagnostic.symbol ?? "",
		diagnostic.details ?? "",
		diagnostic.target,
	]);
}

export function pushUniqueDiagnostics(
	accumulator: Map<string, PreviewBuildDiagnostic>,
	diagnostics: PreviewBuildDiagnostic[],
) {
	for (const diagnostic of diagnostics) {
		accumulator.set(getDiagnosticKey(diagnostic), diagnostic);
	}
}

export function collectBlockingTransformDiagnostics(
	diagnostics: PreviewBuildDiagnostic[],
) {
	return diagnostics.filter(
		(diagnostic): diagnostic is PreviewTransformDiagnostic =>
			!isPreviewDiagnostic(diagnostic),
	);
}
