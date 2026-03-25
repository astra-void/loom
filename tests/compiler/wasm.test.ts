// @vitest-environment node

import compiler, {
	compile_tsx,
	normalizeTransformPreviewSourceResult,
	transformPreviewSource,
} from "../../packages/compiler/wasm.mjs";
import { describe, expect, it } from "vitest";

describe("@loom-dev/compiler wasm entry", () => {
	it("exposes the wasm surface and compiles TSX", () => {
		expect(compiler).toEqual(
			expect.objectContaining({
				compile_tsx,
				normalizeTransformPreviewSourceResult,
				transformPreviewSource,
			}),
		);

		const emitted = compile_tsx(
			"export const App = () => <textlabel TextSize={12} />;",
		);

		expect(emitted).toContain('data-rbx="textlabel"');
		expect(emitted).toContain("style={__rbxStyle({");
	});

	it("normalizes transform diagnostics the same way as the shared wrapper", () => {
		expect(
			normalizeTransformPreviewSourceResult(
				{
					code: "export const value = gamee.GetService(\"Players\");",
					errors: [
						{
							code: "UNRESOLVED_FREE_IDENTIFIER",
							column: 22,
							file: "/virtual/normalized-result.tsx",
							line: 1,
							message:
								"Unresolved free identifier `gamee` will be rewritten to preview global access. Import or declare it explicitly to avoid preview drift.",
							symbol: "gamee",
							target: "normalized-result",
						},
					],
				},
				"compatibility",
			),
		).toEqual({
			code: "export const value = gamee.GetService(\"Players\");",
			diagnostics: [
				expect.objectContaining({
					blocking: false,
					code: "UNRESOLVED_FREE_IDENTIFIER",
					severity: "warning",
					symbol: "gamee",
				}),
			],
			outcome: {
				fidelity: "degraded",
				kind: "compatibility",
			},
		});
	});

	it("rewrites relative imports when the host provides a fileExists hook", () => {
		const result = transformPreviewSource(
			'import { helper } from "./helper"; export const value = helper;',
			{
				fileExists: (candidate) => candidate === "/virtual/project/src/helper.ts",
				filePath: "/virtual/project/src/app.ts",
				runtimeModule: "@loom-dev/preview-runtime",
				target: "wasm",
			},
		);

		expect(result.code).toContain('from "./helper.ts"');
		expect(result.diagnostics).toEqual([]);
		expect(result.outcome).toEqual({
			fidelity: "preserved",
			kind: "ready",
		});
	});

	it("emits browser mock diagnostics in mocked mode", () => {
		const result = transformPreviewSource(
			"export const value = game.GetService(\"Players\");",
			{
				filePath: "/virtual/mocked-global.tsx",
				mode: "mocked",
				runtimeModule: "@loom-dev/preview-runtime",
				target: "mocked-global",
			},
		);

		expect(result.code).toContain('__previewGlobal("game")');
		expect(result.outcome).toEqual({
			fidelity: "degraded",
			kind: "mocked",
		});
		expect(result.diagnostics).toEqual([
			expect.objectContaining({
				blocking: false,
				code: "RUNTIME_MOCK_GLOBAL",
				severity: "warning",
				symbol: "game",
			}),
		]);
	});
});
