// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import {
	createReactHarness,
	createTestContainer,
	findGuiObjectByName,
	findTextButtonByText,
	findTextLabelByText,
	getLocalPlayerGui,
	waitForEffects,
} from "../../apps/preview-harness/src/test-utils";

describe("preview harness test utils", () => {
	afterEach(() => {
		document.body.replaceChildren();
	});

	it("returns the shared PlayerGui and appends test containers into it", () => {
		const playerGui = getLocalPlayerGui();
		const container = createTestContainer("HarnessRoot");

		expect(container.parentElement).toBe(playerGui);
		expect(container.getAttribute("data-preview-test-container")).toBe(
			"HarnessRoot",
		);

		container.remove();
	});

	it("renders React trees into the harness container", async () => {
		const harness = createReactHarness("HarnessRoot");

		try {
			harness.render(
				<div>
					<span data-preview-host="textlabel">Label Text</span>
					<button data-preview-host="textbutton" type="button">
						Button Text
					</button>
				</div>,
			);

			await waitForEffects();

			expect(findTextLabelByText(harness.container, "Label Text")).toBeTruthy();
			expect(
				findTextButtonByText(harness.container, "Button Text"),
			).toBeTruthy();
		} finally {
			harness.cleanup();
		}
	});

	it("finds gui objects by preview node id", () => {
		const playerGui = getLocalPlayerGui();
		const node = document.createElement("div");
		node.setAttribute("data-preview-node-id", "node-alpha");
		playerGui.appendChild(node);

		try {
			expect(findGuiObjectByName(playerGui, "node-alpha")).toBe(node);
		} finally {
			node.remove();
		}
	});
});
