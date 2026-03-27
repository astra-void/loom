import { describe, expect, it } from "vitest";
import { normalizePreviewAnalysisError } from "../../packages/preview-engine/src/previewGraphWasm";

describe("normalizePreviewAnalysisError", () => {
	it("wraps string errors in Error instances", () => {
		const normalized = normalizePreviewAnalysisError(
			"Recovered parse errors in prop-types.d.ts",
			"preview-analysis failed",
		);

		expect(normalized).toBeInstanceOf(Error);
		expect(normalized.message).toContain(
			"Recovered parse errors in prop-types.d.ts",
		);
	});

	it("preserves existing Error instances", () => {
		const error = new Error("preview-analysis failed");

		expect(normalizePreviewAnalysisError(error, "unused fallback")).toBe(error);
	});
});
