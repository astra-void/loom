import { transformPreviewSource } from "@loom-dev/compiler";
import { previewRuntime } from "@loom-dev/preview-runtime";
import { describe, expect, it } from "vitest";
import entryPayloadSchema from "../../packages/preview-engine/schemas/entry-payload.schema.json";
import workspaceIndexSchema from "../../packages/preview-engine/schemas/workspace-index.schema.json";
import layoutDebugPayloadSchema from "../../packages/preview-runtime/schemas/layout-debug-payload.schema.json";
import {
	supportedIsaNames,
	supportedTypeRewriteNames,
} from "../../packages/preview-runtime/src/hosts/metadata";
import previewHostMetadata from "../../packages/preview-runtime/src/hosts/metadata.json";
import { layoutHostNodeType } from "../../packages/preview-runtime/src/hosts/types";
import { normalizePreviewLayoutResult } from "../../packages/preview-runtime/src/layout/model";

const previewHostRecords = previewHostMetadata.hosts;

type JsonSchemaNode = {
	$defs?: Record<string, JsonSchemaNode>;
	const?: string;
	enum?: string[];
	oneOf?: JsonSchemaNode[];
	properties?: Record<string, JsonSchemaNode>;
};

const entryPayloadSchemaNode = entryPayloadSchema as unknown as JsonSchemaNode;
const layoutDebugPayloadSchemaNode = layoutDebugPayloadSchema as JsonSchemaNode;
const workspaceIndexSchemaNode =
	workspaceIndexSchema as unknown as JsonSchemaNode;

function countMatches(source: string, pattern: RegExp) {
	return [...source.matchAll(pattern)].length;
}

describe("preview host metadata invariants", () => {
	it("keeps runtime exports and layout host maps aligned with shared metadata", () => {
		const metadataRuntimeNames = previewHostRecords
			.map((record) => record.runtimeName)
			.sort();
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
		expect(Object.keys(layoutHostNodeType).sort()).toEqual(
			metadataLayoutJsxNames,
		);
		expect(Object.values(layoutHostNodeType).sort()).toEqual(
			metadataLayoutRuntimeNames,
		);
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
			.map(
				(typeName, index) =>
					`type Ref${index} = ReactTypes.MutableRefObject<${typeName} | undefined>;`,
			)
			.join("\n");
		const isaChecks = supportedIsaNames
			.map(
				(typeName, index) => `  const check${index} = host.IsA("${typeName}");`,
			)
			.join("\n");

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
		expect(
			countMatches(
				result.code ?? "",
				/MutableRefObject<HTMLElement \| null \| undefined>/g,
			),
		).toBe(supportedTypeRewriteNames.length);
		expect(countMatches(result.code ?? "", /isPreviewElement\(host, "/g)).toBe(
			supportedIsaNames.length,
		);
	});

	it("accepts full-size-default layout debug payloads and ready warning schema fields", () => {
		const normalized = normalizePreviewLayoutResult(
			{
				debug: {
					dirtyNodeIds: ["viewport"],
					roots: [
						{
							children: [],
							hostPolicy: {
								degraded: true,
								fullSizeDefault: true,
								placeholderBehavior: "opaque",
							},
							id: "viewport",
							intrinsicSize: null,
							kind: "host",
							layoutSource: "full-size-default",
							nodeType: "ViewportFrame",
							parentConstraints: null,
							provenance: {
								detail: "computed by preview-runtime fallback solver",
								source: "fallback",
							},
							rect: {
								height: 480,
								width: 640,
								x: 0,
								y: 0,
							},
							sizeResolution: {
								hadExplicitSize: false,
								intrinsicSizeAvailable: false,
								reason: "full-size-default",
							},
						},
					],
					viewport: {
						height: 480,
						width: 640,
					},
				},
				dirtyNodeIds: ["viewport"],
				rects: {
					viewport: {
						height: 480,
						width: 640,
						x: 0,
						y: 0,
					},
				},
			},
			{ height: 480, width: 640 },
		);

		expect(normalized.debug.roots[0]?.layoutSource).toBe("full-size-default");
		expect(normalized.debug.roots[0]?.hostPolicy).toEqual({
			degraded: true,
			fullSizeDefault: true,
			placeholderBehavior: "opaque",
		});
		expect(normalized.debug.roots[0]?.sizeResolution).toEqual({
			hadExplicitSize: false,
			intrinsicSizeAvailable: false,
			reason: "full-size-default",
		});
		expect(
			layoutDebugPayloadSchemaNode.$defs?.debugNode?.properties?.layoutSource
				?.enum,
		).toContain("full-size-default");
		expect(
			layoutDebugPayloadSchemaNode.$defs?.debugNode?.properties,
		).toMatchObject({
			hostPolicy: expect.any(Object),
			sizeResolution: expect.any(Object),
		});
		const readyEntryStatusDetails =
			entryPayloadSchemaNode.$defs?.statusDetails?.oneOf?.find(
				(variant) => variant.properties?.kind?.const === "ready",
			);
		const readyWorkspaceStatusDetails =
			workspaceIndexSchemaNode.$defs?.statusDetails?.oneOf?.find(
				(variant) => variant.properties?.kind?.const === "ready",
			);

		expect(readyEntryStatusDetails?.properties).toMatchObject({
			degradedTargets: expect.any(Object),
			fidelity: expect.any(Object),
			warningCodes: expect.any(Object),
		});
		expect(readyWorkspaceStatusDetails?.properties).toMatchObject({
			degradedTargets: expect.any(Object),
			fidelity: expect.any(Object),
			warningCodes: expect.any(Object),
		});
	});
});
