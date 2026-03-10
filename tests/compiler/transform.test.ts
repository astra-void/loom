import { compile_tsx, transformPreviewSource } from "@lattice-ui/compiler";
import { describe, expect, it } from "vitest";

describe("@lattice-ui/compiler preview transform", () => {
  it("returns preview transform results with rewritten runtime imports and DOM-facing types", () => {
    const source = `
      import { React, Slot } from "@lattice-ui/core";
      import type ReactTypes from "@rbxts/react";

      type Props = {
        triggerRef: ReactTypes.MutableRefObject<GuiObject | undefined>;
      };

      export function Example(props: Props) {
        const ref = React.useRef<TextLabel>();
        return <textlabel ref={ref}>{props.triggerRef.current}</textlabel>;
      }
    `;

    const result = transformPreviewSource(source, {
      filePath: "/virtual/compiler-transform.tsx",
      mode: "compatibility",
      runtimeModule: "@lattice-ui/preview-runtime",
      target: "compiler-transform",
    });

    expect(result.diagnostics).toHaveLength(0);
    expect(result.outcome).toEqual({
      fidelity: "preserved",
      kind: "ready",
    });
    expect(result.code).toContain('from "@lattice-ui/preview-runtime"');
    expect(result.code).toContain('from "react"');
    expect(result.code).toContain("MutableRefObject<HTMLElement | null | undefined>");
    expect(result.code).toContain("<TextLabel");
  });

  it("keeps unsupported-host diagnostics as non-blocking warnings in compatibility mode", () => {
    const transformed = transformPreviewSource(`export const host = <viewportframe BackgroundTransparency={1} />;`, {
      filePath: "/virtual/fallback.tsx",
      mode: "compatibility",
      runtimeModule: "@lattice-ui/preview-runtime",
      target: "fallback",
    });

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

    const compiled = compile_tsx(transformed.code ?? "");
    expect(compiled).toContain('data-rbx="viewportframe"');
    expect(compiled).toContain("__rbxStyle");
    expect(compiled).toContain("BackgroundTransparency: 1");
  });

  it("blocks unsupported-host fallback in strict-fidelity mode", () => {
    const transformed = transformPreviewSource(`export const host = <viewportframe BackgroundTransparency={1} />;`, {
      filePath: "/virtual/strict-fallback.tsx",
      mode: "strict-fidelity",
      runtimeModule: "@lattice-ui/preview-runtime",
      target: "strict-fallback",
    });

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
    const transformed = transformPreviewSource(`export const value = game.GetService("Players");`, {
      filePath: "/virtual/mocked-global.tsx",
      mode: "mocked",
      runtimeModule: "@lattice-ui/preview-runtime",
      target: "mocked-global",
    });

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

  it("returns metadata-only outcomes in design-time mode", () => {
    const transformed = transformPreviewSource(`export const host = <frame />;`, {
      filePath: "/virtual/design-time.tsx",
      mode: "design-time",
      runtimeModule: "@lattice-ui/preview-runtime",
      target: "design-time",
    });

    expect(transformed.code).toBeNull();
    expect(transformed.outcome).toEqual({
      fidelity: "metadata-only",
      kind: "design-time",
    });
    expect(transformed.diagnostics).toHaveLength(0);
  });
});
