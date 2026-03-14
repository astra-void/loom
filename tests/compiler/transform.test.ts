import {
	normalizeTransformPreviewSourceResult,
	transformPreviewSource,
} from "@loom-dev/compiler";
import {
	__previewGlobal,
	setupRobloxEnvironment,
} from "@loom-dev/preview-runtime";
import { describe, expect, it } from "vitest";

describe("@loom-dev/compiler preview transform", () => {
	it("exports a shared transform result normalizer", () => {
		const normalized = normalizeTransformPreviewSourceResult(
			{
				code: `export const value = gamee.GetService("Players");`,
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
		);

		expect(normalized).toEqual({
			code: `export const value = gamee.GetService("Players");`,
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
	it("returns preview transform results with rewritten runtime imports and DOM-facing types", () => {
		const source = `
      import { React, Slot } from "@loom-dev/core";
      import type ReactTypes from "@rbxts/react";

      type Props = {
        buttonRef: ReactTypes.MutableRefObject<GuiButton | undefined>;
        triggerRef: ReactTypes.MutableRefObject<GuiObject | undefined>;
        labelRef: ReactTypes.MutableRefObject<GuiLabel | undefined>;
        layer?: LayerCollector;
        container?: BasePlayerGui;
        viewRef: ReactTypes.MutableRefObject<Instance | undefined>;
      };

      export function Example(props: Props) {
        const ref = React.useRef<GuiLabel>();
        const button = props.buttonRef.current;
        const label = props.labelRef.current;
        return (
          <textlabel ref={ref}>
            {props.triggerRef.current}
            {button && button.IsA("GuiButton") ? <frame /> : null}
            {label && label.IsA("GuiLabel") ? <frame /> : null}
            {props.layer && props.layer.IsA("LayerCollector") ? <frame /> : null}
            {props.container && props.container.IsA("BasePlayerGui") ? <frame /> : null}
          </textlabel>
        );
      }
    `;

		const result = transformPreviewSource(source, {
			filePath: "/virtual/compiler-transform.tsx",
			mode: "compatibility",
			runtimeModule: "@loom-dev/preview-runtime",
			target: "compiler-transform",
		});

		expect(result.diagnostics).toHaveLength(0);
		expect(result.outcome).toEqual({
			fidelity: "preserved",
			kind: "ready",
		});
		expect(result.code).toContain('from "@loom-dev/preview-runtime"');
		expect(result.code).toContain('from "react"');
		expect(result.code).toContain(
			"MutableRefObject<HTMLElement | null | undefined>",
		);
		expect(result.code).toContain('isPreviewElement(button, "GuiButton")');
		expect(result.code).toContain('isPreviewElement(label, "GuiLabel")');
		expect(result.code).toContain(
			'isPreviewElement(props.layer, "LayerCollector")',
		);
		expect(result.code).toContain(
			'isPreviewElement(props.container, "BasePlayerGui")',
		);
		expect(result.code).toContain("<TextLabel");
	});

	it("accepts the new preview-safe host batch across JSX, type, and IsA rewrites", () => {
		const source = `
      import { React } from "@loom-dev/core";
      import type ReactTypes from "@rbxts/react";

      type Props = {
        imageRef: ReactTypes.MutableRefObject<ImageButton | undefined>;
        surface?: SurfaceGui;
        video?: VideoFrame;
      };

      export function Example(props: Props) {
        const ref = React.useRef<ViewportFrame>();
        const host = ref.current;

        return (
          <surfacegui>
            <imagebutton Image="preview://button" ref={props.imageRef} />
            <canvasgroup />
            <viewportframe ref={ref} />
            <videoframe />
            <billboardgui />
            {host && host.IsA("ViewportFrame") ? <frame /> : null}
          </surfacegui>
        );
      }
    `;

		const result = transformPreviewSource(source, {
			filePath: "/virtual/new-host-batch.tsx",
			mode: "compatibility",
			runtimeModule: "@loom-dev/preview-runtime",
			target: "new-host-batch",
		});

		expect(result.diagnostics).toHaveLength(0);
		expect(result.outcome).toEqual({
			fidelity: "preserved",
			kind: "ready",
		});
		expect(result.code).toContain(
			"MutableRefObject<HTMLElement | null | undefined>",
		);
		expect(result.code).toContain("surface?: HTMLElement | null");
		expect(result.code).toContain("video?: HTMLElement | null");
		expect(result.code).toContain("<ImageButton");
		expect(result.code).toContain("<CanvasGroup");
		expect(result.code).toContain("<ViewportFrame");
		expect(result.code).toContain("<VideoFrame");
		expect(result.code).toContain("<SurfaceGui");
		expect(result.code).toContain("<BillboardGui");
		expect(result.code).toContain('isPreviewElement(host, "ViewportFrame")');
	});

	it("keeps unsupported-host diagnostics as non-blocking warnings in compatibility mode", () => {
		const transformed = transformPreviewSource(
			`export const host = <part BackgroundTransparency={1} />;`,
			{
				filePath: "/virtual/fallback.tsx",
				mode: "compatibility",
				runtimeModule: "@loom-dev/preview-runtime",
				target: "fallback",
			},
		);

		expect(transformed.diagnostics).toEqual([
			expect.objectContaining({
				blocking: false,
				code: "UNSUPPORTED_HOST_ELEMENT",
				severity: "warning",
			}),
		]);
		expect(transformed.outcome).toEqual({
			fidelity: "degraded",
			kind: "compatibility",
		});
		expect(transformed.code).toContain("<part");
	});

	it("blocks unsupported-host fallback in strict-fidelity mode", () => {
		const transformed = transformPreviewSource(
			`export const host = <part BackgroundTransparency={1} />;`,
			{
				filePath: "/virtual/strict-fallback.tsx",
				mode: "strict-fidelity",
				runtimeModule: "@loom-dev/preview-runtime",
				target: "strict-fallback",
			},
		);

		expect(transformed.code).toBeNull();
		expect(transformed.outcome).toEqual({
			fidelity: "degraded",
			kind: "blocked",
		});
		expect(transformed.diagnostics).toEqual([
			expect.objectContaining({
				blocking: true,
				code: "UNSUPPORTED_HOST_ELEMENT",
				severity: "error",
			}),
		]);
	});

	it("emits mock-backed diagnostics in mocked mode", () => {
		const transformed = transformPreviewSource(
			`export const value = game.GetService("Players");`,
			{
				filePath: "/virtual/mocked-global.tsx",
				mode: "mocked",
				runtimeModule: "@loom-dev/preview-runtime",
				target: "mocked-global",
			},
		);

		expect(transformed.outcome).toEqual({
			fidelity: "degraded",
			kind: "mocked",
		});
		expect(transformed.diagnostics).toEqual([
			expect.objectContaining({
				blocking: false,
				code: "RUNTIME_MOCK_GLOBAL",
				severity: "warning",
				symbol: "game",
			}),
		]);
		expect(transformed.code).toContain('__previewGlobal("game")');
	});

	it("silently rewrites known preview globals without unresolved diagnostics", () => {
		const transformed = transformPreviewSource(
			`
        export const service = game.GetService("Players");
        export const playback = Enum.PlaybackState.Completed;
        export const deferred = task.delay;
      `,
			{
				filePath: "/virtual/known-preview-globals.tsx",
				mode: "compatibility",
				runtimeModule: "@loom-dev/preview-runtime",
				target: "known-preview-globals",
			},
		);

		expect(transformed.diagnostics).toHaveLength(0);
		expect(transformed.code).toContain('__previewGlobal("game")');
		expect(transformed.code).toContain(
			'__previewGlobal("Enum").PlaybackState.Completed',
		);
		expect(transformed.code).toContain('__previewGlobal("task").delay');
	});

	it("emits unresolved free-identifier diagnostics for unknown globals", () => {
		const transformed = transformPreviewSource(
			`export const value = gamee.GetService("Players");`,
			{
				filePath: "/virtual/unresolved-global.tsx",
				mode: "compatibility",
				runtimeModule: "@loom-dev/preview-runtime",
				target: "unresolved-global",
			},
		);

		expect(transformed.outcome).toEqual({
			fidelity: "degraded",
			kind: "compatibility",
		});
		expect(transformed.diagnostics).toEqual([
			expect.objectContaining({
				blocking: false,
				code: "UNRESOLVED_FREE_IDENTIFIER",
				severity: "warning",
				symbol: "gamee",
			}),
		]);
		expect(transformed.code).toContain('__previewGlobal("gamee")');
	});

	it("blocks unresolved free identifiers in strict-fidelity mode", () => {
		const transformed = transformPreviewSource(
			`export const value = gamee.GetService("Players");`,
			{
				filePath: "/virtual/unresolved-global-strict.tsx",
				mode: "strict-fidelity",
				runtimeModule: "@loom-dev/preview-runtime",
				target: "unresolved-global-strict",
			},
		);

		expect(transformed.code).toBeNull();
		expect(transformed.outcome).toEqual({
			fidelity: "degraded",
			kind: "blocked",
		});
		expect(transformed.diagnostics).toEqual([
			expect.objectContaining({
				blocking: true,
				code: "UNRESOLVED_FREE_IDENTIFIER",
				severity: "error",
				symbol: "gamee",
			}),
		]);
	});

	it("suppresses duplicate mocked-global warnings when unresolved identifiers already surfaced", () => {
		const transformed = transformPreviewSource(
			`export const value = gamee.GetService("Players");`,
			{
				filePath: "/virtual/unresolved-global-mocked.tsx",
				mode: "mocked",
				runtimeModule: "@loom-dev/preview-runtime",
				target: "unresolved-global-mocked",
			},
		);

		expect(transformed.outcome).toEqual({
			fidelity: "degraded",
			kind: "mocked",
		});
		expect(transformed.diagnostics).toEqual([
			expect.objectContaining({
				blocking: false,
				code: "UNRESOLVED_FREE_IDENTIFIER",
				severity: "warning",
				symbol: "gamee",
			}),
		]);
	});

	it("rewrites expanded enum literal surfaces for preview-friendly comparisons", () => {
		const transformed = transformPreviewSource(
			`
        export const horizontal = Enum.HorizontalAlignment.Center;
        export const vertical = Enum.VerticalAlignment.Bottom;
        export const inputMode = Enum.UserInputType.MouseButton1;
        export const keyTab = Enum.KeyCode.Tab;
        export const keyLetter = Enum.KeyCode.Z;
        export const keyDigit = Enum.KeyCode.Nine;
        export const playback = Enum.PlaybackState.Completed;
      `,
			{
				filePath: "/virtual/enum-surface.tsx",
				mode: "compatibility",
				runtimeModule: "@loom-dev/preview-runtime",
				target: "enum-surface",
			},
		);

		expect(transformed.diagnostics).toHaveLength(0);
		expect(transformed.code).toContain('"center"');
		expect(transformed.code).toContain('"bottom"');
		expect(transformed.code).toContain('"MouseButton1"');
		expect(transformed.code).toContain('"Tab"');
		expect(transformed.code).toContain('"z"');
		expect(transformed.code).toContain('"9"');
		expect(transformed.code).toContain(
			'__previewGlobal("Enum").PlaybackState.Completed',
		);
	});

	it("returns metadata-only outcomes in design-time mode", () => {
		const transformed = transformPreviewSource(
			`export const host = <frame />;`,
			{
				filePath: "/virtual/design-time.tsx",
				mode: "design-time",
				runtimeModule: "@loom-dev/preview-runtime",
				target: "design-time",
			},
		);

		expect(transformed.code).toBeNull();
		expect(transformed.outcome).toEqual({
			fidelity: "metadata-only",
			kind: "design-time",
		});
		expect(transformed.diagnostics).toHaveLength(0);
	});

	it("keeps rewritten preview globals constructable inside `new` expressions", () => {
		setupRobloxEnvironment();

		const transformed = transformPreviewSource(
			`export const tween = new TweenInfo(0.1);`,
			{
				filePath: "/virtual/new-tween-info.tsx",
				mode: "compatibility",
				runtimeModule: "@loom-dev/preview-runtime",
				target: "new-tween-info",
			},
		);

		expect(transformed.diagnostics).toHaveLength(0);
		expect(transformed.code).toContain(
			'new (__previewGlobal("TweenInfo"))(0.1)',
		);

		if (transformed.code === null) {
			throw new Error("Expected transformed preview code for TweenInfo test.");
		}

		const expression = transformed.code.match(
			/new \(__previewGlobal\("TweenInfo"\)\)\(0\.1\)/,
		)?.[0];
		expect(expression).toBeDefined();

		const tweenInfo = Function(
			"__previewGlobal",
			`"use strict"; return ${expression ?? "undefined"};`,
		)(__previewGlobal) as { Time: number };

		expect(tweenInfo.Time).toBe(0.1);
	});
});
