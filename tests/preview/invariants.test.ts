import { transformPreviewSource } from "@loom-dev/compiler";
import { previewRuntime } from "@loom-dev/preview-runtime";
import { describe, expect, it } from "vitest";
import previewHostMetadata from "../../packages/preview-runtime/src/hosts/metadata.json";
import { supportedIsaNames, supportedTypeRewriteNames } from "../../packages/preview-runtime/src/hosts/metadata";
import { layoutHostNodeType } from "../../packages/preview-runtime/src/hosts/types";

const previewHostRecords = previewHostMetadata.hosts;

function countMatches(source: string, pattern: RegExp) {
  return [...source.matchAll(pattern)].length;
}

describe("preview host metadata invariants", () => {
  it("keeps runtime exports and layout host maps aligned with shared metadata", () => {
    const metadataRuntimeNames = previewHostRecords.map((record) => record.runtimeName).sort();
    const exportedRuntimeNames = Object.keys(previewRuntime.hosts).sort();
    const metadataLayoutJsxNames = previewHostRecords
      .filter((record) => record.participatesInLayout)
      .map((record) => record.jsxName)
      .sort();
    const metadataLayoutRuntimeNames = previewHostRecords
      .filter((record) => record.participatesInLayout)
      .map((record) => record.runtimeName)
      .sort();

    expect(exportedRuntimeNames).toEqual(metadataRuntimeNames);
    expect(Object.keys(layoutHostNodeType).sort()).toEqual(metadataLayoutJsxNames);
    expect(Object.values(layoutHostNodeType).sort()).toEqual(metadataLayoutRuntimeNames);
  });

  it("accepts the shared metadata host set without unsupported-host drift", () => {
    const nestedHosts = previewHostRecords
      .filter((record) => record.jsxName !== "frame")
      .map((record) => `      <${record.jsxName} />`)
      .join("\n");

    const result = transformPreviewSource(
      `
        import { React } from "@loom-dev/core";

        export function Example() {
          return (
            <frame>
${nestedHosts}
            </frame>
          );
        }
      `,
      {
        filePath: "/virtual/preview-host-invariants.tsx",
        mode: "compatibility",
        runtimeModule: "@loom-dev/preview-runtime",
        target: "preview-host-invariants",
      },
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("keeps metadata-derived type and IsA support aligned with compiler rewrites", () => {
    const typeAliases = supportedTypeRewriteNames
      .map((typeName, index) => `type Ref${index} = ReactTypes.MutableRefObject<${typeName} | undefined>;`)
      .join("\n");
    const isaChecks = supportedIsaNames.map((typeName, index) => `  const check${index} = host.IsA("${typeName}");`).join("\n");

    const result = transformPreviewSource(
      `
        import { React } from "@loom-dev/core";
        import type ReactTypes from "@rbxts/react";

        ${typeAliases}

        export function Example(host: Frame) {
${isaChecks}
          return <frame />;
        }
      `,
      {
        filePath: "/virtual/preview-type-invariants.tsx",
        mode: "compatibility",
        runtimeModule: "@loom-dev/preview-runtime",
        target: "preview-type-invariants",
      },
    );

    expect(result.diagnostics).toHaveLength(0);
    expect(countMatches(result.code ?? "", /MutableRefObject<HTMLElement \| null \| undefined>/g)).toBe(
      supportedTypeRewriteNames.length,
    );
    expect(countMatches(result.code ?? "", /isPreviewElement\(host, "/g)).toBe(supportedIsaNames.length);
  });
});
