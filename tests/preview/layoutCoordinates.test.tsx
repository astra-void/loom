// @vitest-environment jsdom

import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
	ScreenGui,
	TextButton,
	TextLabel,
	UIScale,
} from "../../packages/preview-runtime/src";
import { LayoutProvider } from "../../packages/preview-runtime/src/layout/context";
import userEvent from "../testUserEvent";

describe("layout coordinate normalizations", () => {
	it("reports AbsolutePosition relative to the layout container instead of the window", async () => {
		const getBoundingClientRectSpy = vi
			.spyOn(HTMLElement.prototype, "getBoundingClientRect")
			.mockImplementation(function (this: HTMLElement) {
				if (this.hasAttribute("data-preview-layout-provider")) {
					return {
						left: 200,
						top: 150,
						width: 800,
						height: 600,
						right: 1000,
						bottom: 750,
						x: 200,
						y: 150,
						toJSON: () => ({}),
					} as DOMRect;
				}

				if (this.dataset.previewHost === "textbutton") {
					return {
						left: 250, // 200 + 50
						top: 200, // 150 + 50
						width: 100,
						height: 100,
						right: 350,
						bottom: 300,
						x: 250,
						y: 200,
						toJSON: () => ({}),
					} as DOMRect;
				}

				return {
					left: 0,
					top: 0,
					width: 0,
					height: 0,
					right: 0,
					bottom: 0,
					x: 0,
					y: 0,
					toJSON: () => ({}),
				} as DOMRect;
			});

		const user = userEvent.setup();
		const activated = vi.fn();

		render(
			<LayoutProvider debounceMs={0} viewportHeight={600} viewportWidth={800}>
				<ScreenGui Id="gui">
					<TextButton
						__previewReactEventActivated={activated}
						Text="Interop trigger"
					/>
				</ScreenGui>
			</LayoutProvider>,
		);

		const button = await screen.findByRole("button", {
			name: "Interop trigger",
		});
		await user.click(button);

		expect(activated).toHaveBeenCalledTimes(1);
		expect(activated).toHaveBeenLastCalledWith(
			expect.objectContaining({
				AbsolutePosition: { X: 50, Y: 50 }, // 250 - 200, 200 - 150
				AbsoluteSize: { X: 100, Y: 100 },
			}),
		);

		getBoundingClientRectSpy.mockRestore();
	});

	it("measures intrinsic size without being influenced by UIScale (CSS transform)", async () => {
		const offsetWidthSpy = vi
			.spyOn(HTMLElement.prototype, "offsetWidth", "get")
			.mockImplementation(function (this: HTMLElement) {
				if (this.dataset.previewHost === "textlabel") return 80;
				return 0;
			});

		const offsetHeightSpy = vi
			.spyOn(HTMLElement.prototype, "offsetHeight", "get")
			.mockImplementation(function (this: HTMLElement) {
				if (this.dataset.previewHost === "textlabel") return 40;
				return 0;
			});

		render(
			<LayoutProvider debounceMs={0} viewportHeight={600} viewportWidth={800}>
				<ScreenGui Id="gui">
					<UIScale Scale={2} />
					<TextLabel Id="label" Text="Scaled Label" AutomaticSize="XY" />
				</ScreenGui>
			</LayoutProvider>,
		);

		const label = await screen.findByText("Scaled Label");
		const parent = label.parentElement;

		// Ensure wait until layout computes
		await waitFor(() => {
			expect(parent?.dataset.layoutComputedWidth).toBe("80");
			expect(parent?.dataset.layoutComputedHeight).toBe("40");
		});

		offsetWidthSpy.mockRestore();
		offsetHeightSpy.mockRestore();
	});
});
