import type {
	PreviewLayoutDebugNode,
	PreviewLayoutDebugPayload,
} from "@loom-dev/preview-runtime";
import type { ParityNode, ParitySnapshot } from "./types";

export interface NormalizeOptions {
	scene?: string;
	capturedAt?: string;
}

function normalizeNode(node: PreviewLayoutDebugNode): ParityNode {
	const rect = node.rect ?? { x: 0, y: 0, width: 0, height: 0 };
	return {
		name: node.debugLabel ?? node.id,
		className: node.nodeType,
		absolutePosition: { x: rect.x, y: rect.y },
		absoluteSize: { x: rect.width, y: rect.height },
		zIndex: node.zIndex,
		children: node.children.map(normalizeNode),
	};
}

/**
 * Convert a Loom `PreviewLayoutDebugPayload` (from `createPreviewHeadlessSession`
 * or `loom snapshot`) into a {@link ParitySnapshot}. This carries geometry +
 * structure only; the debug payload does not include visual properties, so use
 * {@link mergeVisualProps} or the in-browser capture for colours/text.
 */
export function normalizeLoomDebugPayload(
	payload: PreviewLayoutDebugPayload,
	options: NormalizeOptions = {},
): ParitySnapshot {
	return {
		source: "loom",
		viewport: { x: payload.viewport.width, y: payload.viewport.height },
		scene: options.scene,
		capturedAt: options.capturedAt,
		roots: payload.roots.map(normalizeNode),
	};
}
