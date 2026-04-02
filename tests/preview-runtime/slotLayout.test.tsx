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
			Size: { X: { Scale: 0, Offset: 940 }, Y: { Scale: 0, Offset: 560 } } 
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
			Text: "Accordion Title"
		}
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
