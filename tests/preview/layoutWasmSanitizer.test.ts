// @vitest-environment node

import { describe, expect, it } from "vitest";
import type { PreviewLayoutNode } from "../../packages/preview-runtime/src/layout/model";
import { sanitizePreviewLayoutNodes } from "../../packages/preview-runtime/src/layout/wasm";

describe("preview runtime wasm layout sanitization", () => {
	it("deep clones shared nested objects before sending nodes to wasm", () => {
		const sharedAxis = { Offset: 0, Scale: 0 };
		const nodes = [
			{
				id: "screen",
				kind: "root",
				layout: {
					anchorPoint: { x: 0, y: 0 },
					position: {
						x: sharedAxis,
						y: sharedAxis,
					},
					positionMode: "absolute",
					size: {
						x: sharedAxis,
						y: sharedAxis,
					},
				},
				layoutModifiers: {
					padding: {
						bottom: sharedAxis,
						left: sharedAxis,
						right: sharedAxis,
						top: sharedAxis,
					},
				},
				nodeType: "ScreenGui",
			} as PreviewLayoutNode,
		];

		const sanitized = sanitizePreviewLayoutNodes(nodes);
		const node = sanitized[0];

		expect(node).toBeDefined();
		expect(node).not.toBe(nodes[0]);
		expect(node.layout.position.x).not.toBe(node.layout.position.y);
		expect(node.layout.size.x).not.toBe(node.layout.size.y);
		expect(node.layoutModifiers?.padding?.top).not.toBe(
			node.layoutModifiers?.padding?.bottom,
		);
		expect(node.layoutModifiers?.padding?.left).not.toBe(
			node.layoutModifiers?.padding?.right,
		);
	});
});
