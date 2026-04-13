// @vitest-environment jsdom
import { expect, test } from "vitest";

import { LayoutController } from "../../packages/preview-runtime/src/layout/controller";
import { domPresentationAdapter } from "../../packages/preview-runtime/src/hosts/domAdapter";

test("slot layout resolves correctly when child host inherits parent identity", () => {
	const controller = new LayoutController();

	// Create nodes manually for the layout controller to prove the fallback geometry works
	// without needing to bootstrap Wasm in JSDOM, mimicking the output of a Slot
	// that successfully passes its merged props down to its child host.
	const rootNode = domPresentationAdapter.normalize({
		host: "screengui",
		nodeId: "preview-node-1",
		props: { Id: "preview-node-1" },
	});

	const frameNode = domPresentationAdapter.normalize({
		host: "frame",
		nodeId: "preview-node-2",
		parentId: "preview-node-1",
		props: {
			Id: "preview-node-2",
			ParentId: "preview-node-1",
			Size: { X: { Scale: 0, Offset: 940 }, Y: { Scale: 0, Offset: 560 } },
		},
	});

	// The Accordion passes its props down to the Slot which passes it to the TextLabel
	// resulting in a TextLabel node with the Accordion's Id and ParentId.
	const textLabelNode = domPresentationAdapter.normalize({
		host: "textlabel",
		nodeId: "preview-node-3",
		parentId: "preview-node-2",
		props: {
			Id: "preview-node-3",
			ParentId: "preview-node-2",
			Text: "Accordion Title",
		},
	});

	controller.upsertNode(rootNode);
	controller.upsertNode(frameNode);
	controller.upsertNode(textLabelNode);

	controller.setViewport({ width: 1000, height: 1000 });

	// We force the fallback layout compute (isReady: false) which uses the preview-runtime
	// fallback solver. This proves that ParentId propagation works.
	const result = controller.compute({ isReady: false });

	const rootRect = result.rects["preview-node-1"];
	const frameRect = result.rects["preview-node-2"];
	const textLabelRect = result.rects["preview-node-3"];

	expect(rootRect).toBeTruthy();
	expect(frameRect).toBeTruthy();
	expect(textLabelRect).toBeTruthy();

	expect(frameRect.width).toBe(940);
	expect(frameRect.height).toBe(560);

	// Check if textLabel resolves against the frame constraints (fallback layout)
	const debugNode = controller.getDebugNode("preview-node-3");
	expect(debugNode).toBeTruthy();

	// textLabel should not be a root
	expect(debugNode?.kind).toBe("host");
	expect(debugNode?.parentConstraints?.width).toBe(940);
	expect(debugNode?.parentConstraints?.height).toBe(560);
	expect(debugNode?.layoutSource).not.toBe("root-default");
});

test("rejects slot-style identity leakage when a child host reuses a parent id", () => {
	const controller = new LayoutController();

	const rootNode = domPresentationAdapter.normalize({
		host: "screengui",
		nodeId: "preview-node-1",
		props: { Id: "preview-node-1" },
	});
	const frameNode = domPresentationAdapter.normalize({
		host: "frame",
		nodeId: "preview-node-2",
		parentId: "preview-node-1",
		props: {
			Id: "preview-node-2",
			ParentId: "preview-node-1",
		},
	});
	const leakedTextLabelNode = domPresentationAdapter.normalize({
		host: "textlabel",
		nodeId: "preview-node-2",
		parentId: "preview-node-1",
		props: {
			Id: "preview-node-2",
			ParentId: "preview-node-1",
			Text: "Leaked id",
		},
	});

	controller.upsertNode(rootNode);
	controller.upsertNode(frameNode);

	expect(() => controller.upsertNode(leakedTextLabelNode)).toThrow(
		/Unexpected layout node identity collision/u,
	);
});

test("keeps suffix-overlap runtime ids distinct without alias collapse", () => {
	const controller = new LayoutController();

	const rootNode = domPresentationAdapter.normalize({
		host: "screengui",
		nodeId: "screengui:preview-node-2",
		props: { Id: "screengui:preview-node-2" },
	});
	const frameNode = domPresentationAdapter.normalize({
		host: "frame",
		nodeId: "frame:preview-node-9",
		parentId: "screengui:preview-node-2",
		props: {
			Id: "frame:preview-node-9",
			ParentId: "screengui:preview-node-2",
			Size: { X: { Scale: 0, Offset: 940 }, Y: { Scale: 0, Offset: 560 } },
		},
	});
	const textLabelNode = domPresentationAdapter.normalize({
		host: "textlabel",
		nodeId: "textlabel:preview-node-2",
		parentId: "frame:preview-node-9",
		props: {
			Id: "textlabel:preview-node-2",
			ParentId: "frame:preview-node-9",
			Size: { X: { Scale: 0, Offset: 180 }, Y: { Scale: 0, Offset: 48 } },
			Text: "Avatar Title",
		},
	});

	controller.upsertNode(rootNode);
	controller.upsertNode(frameNode);
	controller.upsertNode(textLabelNode);
	controller.setViewport({ width: 1000, height: 1000 });

	const result = controller.compute({ isReady: false });

	expect(result.rects["screengui:preview-node-2"]).toBeTruthy();
	expect(result.rects["textlabel:preview-node-2"]).toMatchObject({
		height: 48,
		width: 180,
	});

	const debugNode = controller.getDebugNode("textlabel:preview-node-2");
	expect(debugNode?.layoutSource).toBe("explicit-size");
	expect(debugNode?.parentConstraints?.width).toBe(940);

	// Ambiguous legacy aliases should not map to a random node.
	expect(controller.getDebugNode("preview-node-2")).toBeNull();
});
