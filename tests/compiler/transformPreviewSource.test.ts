import { describe, expect, it } from "vitest";
import { transformPreviewSource } from "@loom-dev/compiler/wasm";

describe("compiler wasm wrapper", () => {
	it("keeps compatibility transforms executable without duplicating diagnostics", () => {
		const result = transformPreviewSource("export const value = foo;", {
			filePath: "C:/virtual/example.ts",
			mode: "compatibility",
			runtimeModule: "@loom-dev/preview-runtime",
			target: "compatibility",
		});

		expect(result.code).toContain('__previewGlobal("foo")');
		expect(result.errors).toHaveLength(1);
		expect(result.diagnostics).toHaveLength(1);
		expect(result.diagnostics[0]).toMatchObject({
			blocking: false,
			code: "UNRESOLVED_FREE_IDENTIFIER",
			severity: "warning",
		});
		expect(result.outcome).toEqual({
			fidelity: "degraded",
			kind: "compatibility",
		});
	});
});
