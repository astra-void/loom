import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { compile_tsx, transformPreviewSource } from "@lattice-ui/compiler";
import { describe, expect, it } from "vitest";
import { buildPreviewModules } from "../../../packages/preview/src/build";

describe("preview source transform", () => {
  it("rewrites supported imports, enums, host elements, and DOM-facing types", () => {
    const source = `
      import { React, Slot } from "@lattice-ui/core";
      import type { LayerInteractEvent } from "@lattice-ui/layer";
      import type ReactTypes from "@rbxts/react";

      type Props = {
        triggerRef: ReactTypes.MutableRefObject<GuiObject | undefined>;
        container?: BasePlayerGui;
        event?: LayerInteractEvent;
      };

      export function Example(props: Props) {
        const ref = React.useRef<TextLabel>();
        return (
          <textlabel
            Text="Preview"
            TextXAlignment={Enum.TextXAlignment.Left}
            ref={ref}
          >
            <uipadding PaddingLeft={new UDim(0, 10)} />
            <uiscale Scale={1.25} />
          </textlabel>
        );
      }
    `;

    const result = transformPreviewSource(source, {
      filePath: "/virtual/example.tsx",
      mode: "compatibility",
      runtimeModule: "@lattice-ui/preview-runtime",
      target: "rich-hosts",
    });

    expect(result.diagnostics).toHaveLength(0);
    expect(result.code).toContain('from "@lattice-ui/preview-runtime"');
    expect(result.code).toContain('from "react"');
    expect(result.code).toContain("MutableRefObject<HTMLElement | null | undefined>");
    expect(result.code).toContain("container?: HTMLElement | null");
    expect(result.code).toContain("<TextLabel");
    expect(result.code).toContain("<UIPadding");
    expect(result.code).toContain("<UIScale");
    expect(result.code).toContain('"left"');
  });

  it("keeps unresolved Enum access for the browser runtime mock", () => {
    const source = `
      export const inputMode = Enum.UserInputType.MouseButton1;
      export const host = <frame />;
    `;

    const result = transformPreviewSource(source, {
      filePath: "/virtual/enum-passthrough.tsx",
      mode: "compatibility",
      runtimeModule: "@lattice-ui/preview-runtime",
      target: "enum-passthrough",
    });

    expect(result.diagnostics).toHaveLength(0);
    expect(result.code).toContain('__previewGlobal("Enum").UserInputType.MouseButton1');
    expect(result.code).toContain("<Frame");
  });

  it("merges rewritten runtime imports without duplicate bindings", () => {
    const source = `
      import { React, Slot } from "@lattice-ui/core";
      import { FocusScope } from "@lattice-ui/focus";
      import type { LayerInteractEvent } from "@lattice-ui/layer";

      export function Example(props: { event?: LayerInteractEvent }) {
        return (
          <frame>
            <Slot>{props.event ? <textlabel Text="ready" /> : undefined}</Slot>
            <FocusScope active={true}>{React.createElement("div")}</FocusScope>
          </frame>
        );
      }
    `;

    const result = transformPreviewSource(source, {
      filePath: "/virtual/merged-imports.tsx",
      mode: "compatibility",
      runtimeModule: "@lattice-ui/preview-runtime",
      target: "merged-imports",
    });

    expect(result.diagnostics).toHaveLength(0);
    expect(result.code.match(/from "@lattice-ui\/preview-runtime"/g) ?? []).toHaveLength(1);
    expect(result.code).toContain("React");
    expect(result.code).toContain("Slot");
    expect(result.code).toContain("FocusScope");
    expect(result.code).toContain("LayerInteractEvent");
  });

  it("passes Roblox globals through to the runtime fallback and still reports unsupported host elements", () => {
    const source = `
      export const value = game.GetService("Players");
      export const tween = new TweenInfo(0.1);
      export const host = <viewportframe />;
    `;

    const result = transformPreviewSource(source, {
      filePath: "/virtual/bad.tsx",
      mode: "compatibility",
      runtimeModule: "@lattice-ui/preview-runtime",
      target: "broken",
    });

    expect(result.diagnostics.map((item) => item.code)).toEqual(["UNSUPPORTED_HOST_ELEMENT"]);
    expect(result.outcome.kind).toBe("compatibility");
    expect(result.code).toContain('__previewGlobal("game")');
    expect(result.code).toContain('__previewGlobal("TweenInfo")');
  });

  it("parses decorated Flamework classes without failing preview discovery", () => {
    const source = `
      import { Controller } from "@flamework/core";

      @Controller()
      export class AimController {}

      export function Example() {
        return <frame />;
      }
    `;

    const result = transformPreviewSource(source, {
      filePath: "/virtual/decorated-controller.tsx",
      mode: "compatibility",
      runtimeModule: "@lattice-ui/preview-runtime",
      target: "decorators",
    });

    expect(result.diagnostics).toHaveLength(0);
    expect(() => compile_tsx(result.code ?? "")).not.toThrow();
  });
});

describe("buildPreviewModules", () => {
  it("writes generated sources for arbitrary targets", async () => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "lattice-preview-"));

    const result = await buildPreviewModules({
      targets: [
        {
          name: "rich-hosts",
          sourceRoot: path.resolve(__dirname, "fixtures/rich-hosts/src"),
        },
      ],
      outDir,
    });

    expect(result.writtenFiles.some((filePath) => filePath.endsWith(path.join("rich-hosts", "index.tsx")))).toBe(true);
    const generatedIndex = path.join(outDir, "rich-hosts/index.tsx");
    expect(fs.existsSync(generatedIndex)).toBe(true);
    expect(fs.readFileSync(generatedIndex, "utf8")).toContain("Generated by @lattice-ui/preview");
  });

  it("defaults buildPreviewModules to strict-fidelity and blocks unsupported hosts", async () => {
    const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lattice-preview-strict-default-"));
    const sourceRoot = path.join(fixtureRoot, "src");
    const outDir = path.join(fixtureRoot, "generated");

    fs.mkdirSync(sourceRoot, { recursive: true });
    fs.writeFileSync(
      path.join(sourceRoot, "index.tsx"),
      "export function Broken() { return <viewportframe />; }\n",
      "utf8",
    );

    await expect(
      buildPreviewModules({
        targets: [
          {
            name: "strict-default",
            sourceRoot,
          },
        ],
        outDir,
      }),
    ).rejects.toMatchObject({
      name: "PreviewBuildError",
    });
  });

  it("maps deprecated failOnUnsupported=false to compatibility mode", async () => {
    const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lattice-preview-compat-build-"));
    const sourceRoot = path.join(fixtureRoot, "src");
    const outDir = path.join(fixtureRoot, "generated");

    fs.mkdirSync(sourceRoot, { recursive: true });
    fs.writeFileSync(
      path.join(sourceRoot, "index.tsx"),
      "export function Broken() { return <viewportframe />; }\n",
      "utf8",
    );

    const result = await buildPreviewModules({
      failOnUnsupported: false,
      targets: [
        {
          name: "compat-build",
          sourceRoot,
        },
      ],
      outDir,
    });

    expect(result.writtenFiles.some((filePath) => filePath.endsWith(path.join("compat-build", "index.tsx")))).toBe(
      true,
    );
  });

  it("continues to reject design-time module builds from the wrapper", async () => {
    const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lattice-preview-design-time-build-"));
    const sourceRoot = path.join(fixtureRoot, "src");
    const outDir = path.join(fixtureRoot, "generated");

    fs.mkdirSync(sourceRoot, { recursive: true });
    fs.writeFileSync(path.join(sourceRoot, "index.tsx"), "export function MetaOnly() { return <frame />; }\n", "utf8");

    await expect(
      buildPreviewModules({
        targets: [
          {
            name: "design-time-build",
            sourceRoot,
          },
        ],
        outDir,
        transformMode: "design-time",
      }),
    ).rejects.toThrow(/does not support design-time/i);
  });

  it("skips declaration files when generating preview modules", async () => {
    const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lattice-preview-declarations-"));
    const sourceRoot = path.join(fixtureRoot, "src");
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "lattice-preview-out-"));

    fs.mkdirSync(sourceRoot, { recursive: true });
    fs.writeFileSync(
      path.join(sourceRoot, "index.tsx"),
      'export function DeclarationSafe() { return <frame Text="ready" />; }\n',
      "utf8",
    );
    fs.writeFileSync(
      path.join(sourceRoot, "ambient.d.ts"),
      'declare module "virtual:fixture" { export const value: string; }\n',
      "utf8",
    );

    const result = await buildPreviewModules({
      targets: [
        {
          name: "ambient-safe",
          sourceRoot,
        },
      ],
      outDir,
    });

    expect(result.writtenFiles.some((filePath) => filePath.endsWith(path.join("ambient-safe", "index.tsx")))).toBe(
      true,
    );
    expect(result.writtenFiles.some((filePath) => filePath.endsWith(".d.ts"))).toBe(false);
  });

  it("rejects unsafe target names and overlapping output directories", async () => {
    const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lattice-preview-unsafe-"));
    const sourceRoot = path.join(fixtureRoot, "src");

    fs.mkdirSync(sourceRoot, { recursive: true });
    fs.writeFileSync(
      path.join(sourceRoot, "index.tsx"),
      "export function UnsafeFixture() { return <frame />; }\n",
      "utf8",
    );

    await expect(
      buildPreviewModules({
        targets: [
          {
            name: "../escape",
            sourceRoot,
          },
        ],
        outDir: path.join(fixtureRoot, "generated"),
      }),
    ).rejects.toThrow(/safe path segment/i);

    await expect(
      buildPreviewModules({
        targets: [
          {
            name: "unsafe",
            sourceRoot,
          },
        ],
        outDir: sourceRoot,
      }),
    ).rejects.toThrow(/overlaps the source tree/i);
  });

  it("skips unchanged files and removes stale manifest-owned outputs incrementally", async () => {
    const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lattice-preview-incremental-"));
    const sourceRoot = path.join(fixtureRoot, "src");
    const outDir = path.join(fixtureRoot, "generated");

    fs.mkdirSync(sourceRoot, { recursive: true });
    fs.writeFileSync(
      path.join(sourceRoot, "index.tsx"),
      "export function RootFixture() { return <frame />; }\n",
      "utf8",
    );
    fs.writeFileSync(
      path.join(sourceRoot, "Extra.tsx"),
      "export function ExtraFixture() { return <frame />; }\n",
      "utf8",
    );

    const initialResult = await buildPreviewModules({
      targets: [
        {
          name: "incremental",
          sourceRoot,
        },
      ],
      outDir,
    });

    const generatedExtra = path.join(outDir, "incremental/Extra.tsx");
    const generatedIndex = path.join(outDir, "incremental/index.tsx");
    expect(initialResult.writtenFiles).toEqual(expect.arrayContaining([generatedExtra, generatedIndex]));
    expect(fs.existsSync(path.join(outDir, ".lattice-preview-manifest.json"))).toBe(true);

    const secondResult = await buildPreviewModules({
      targets: [
        {
          name: "incremental",
          sourceRoot,
        },
      ],
      outDir,
    });
    expect(secondResult.writtenFiles).toEqual([]);

    fs.writeFileSync(
      path.join(sourceRoot, "index.tsx"),
      'export function RootFixture() { return <textlabel Text="updated" />; }\n',
      "utf8",
    );
    const thirdResult = await buildPreviewModules({
      targets: [
        {
          name: "incremental",
          sourceRoot,
        },
      ],
      outDir,
    });
    expect(thirdResult.writtenFiles).toEqual([generatedIndex]);

    fs.rmSync(path.join(sourceRoot, "Extra.tsx"));
    await buildPreviewModules({
      targets: [
        {
          name: "incremental",
          sourceRoot,
        },
      ],
      outDir,
    });
    expect(fs.existsSync(generatedExtra)).toBe(false);
  });
});
