import { describe, expect, it, vi } from "vitest";
import {
	normalizePreviewAnalysisError,
	resolvePreviewGraphModulePath,
} from "../../packages/preview-engine/src/previewGraphWasm";

describe("previewGraphWasm", () => {
	it("resolves the preview-analysis module through the package resolver", () => {
		const resolvedPath =
			"C:/workspace/packages/preview-analysis/pkg/preview_analysis.js";
		const resolver = vi.fn(() => resolvedPath);

		expect(resolvePreviewGraphModulePath(resolver)).toBe(resolvedPath);
		expect(resolver).toHaveBeenCalledOnce();
		expect(resolver).toHaveBeenCalledWith("@loom-dev/preview-analysis");
	});

	it("keeps resolver paths intact across Windows and POSIX separators", () => {
		const windowsResolver = vi.fn(
			() => "C:\\workspace\\packages\\preview-analysis\\pkg\\preview_analysis.js",
		);
		const posixResolver = vi.fn(
			() => "/workspace/packages/preview-analysis/pkg/preview_analysis.js",
		);

		expect(resolvePreviewGraphModulePath(windowsResolver)).toBe(
			"C:\\workspace\\packages\\preview-analysis\\pkg\\preview_analysis.js",
		);
		expect(resolvePreviewGraphModulePath(posixResolver)).toBe(
			"/workspace/packages/preview-analysis/pkg/preview_analysis.js",
		);
	});

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

			expect(normalizePreviewAnalysisError(error, "unused fallback")).toBe(
				error,
			);
		});
	});
});