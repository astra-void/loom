// @vitest-environment jsdom

import {
	Frame,
	LayoutProvider,
	Portal,
	PortalProvider,
	ScreenGui,
	UDim2,
} from "@loom-dev/preview-runtime";
import { render, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getLocalPlayerGui } from "../../apps/preview-harness/src/test-utils";
import {
	installTestPreviewLayoutEngineLoader,
	resetTestPreviewLayoutEngineLoader,
} from "./testLayoutEngineLoader";

describe("geometry fidelity portals", () => {
	beforeEach(() => {
		installTestPreviewLayoutEngineLoader();
	});

	afterEach(() => {
		resetTestPreviewLayoutEngineLoader();
	});

	it("resolves portal anchor AbsolutePosition in the same coordinate space as the viewport", async () => {
		const anchorRef = React.createRef<any>();
		const portalContentRef = React.createRef<any>();

		const _layoutProviderSpy = vi
			.spyOn(Element.prototype, "getBoundingClientRect")
			.mockImplementation(function (this: HTMLElement) {
				if (this.hasAttribute("data-preview-layout-provider")) {
					return {
						bottom: 400,
						height: 400,
						left: 100,
						right: 700,
						toJSON: () => ({}),
						top: 100,
						width: 600,
						x: 100,
						y: 100,
					} as DOMRect;
				}
				return {
					bottom: 0,
					height: 0,
					left: 0,
					right: 0,
					toJSON: () => ({}),
					top: 0,
					width: 0,
					x: 0,
					y: 0,
				} as DOMRect;
			});

		const container = document.createElement("div");
		// Mock container bounds
		vi.spyOn(container, "getBoundingClientRect").mockReturnValue({
			bottom: 400,
			height: 400,
			left: 100, // Offset container
			right: 700,
			toJSON: () => ({}),
			top: 100, // Offset container
			width: 600,
			x: 100,
			y: 100,
		} as DOMRect);

		const { unmount } = render(
			<LayoutProvider debounceMs={0} viewportHeight={400} viewportWidth={600}>
				<PortalProvider container={container}>
					<ScreenGui>
						<Frame
							ref={anchorRef}
							Position={UDim2.fromOffset(50, 50)}
							Size={UDim2.fromOffset(100, 100)}
						/>
						<Portal>
							<Frame
								ref={portalContentRef}
								Position={UDim2.fromOffset(20, 20)}
								Event={{
									Activated: (obj) => {
										portalContentRef.current.eventObj = obj;
									},
								}}
								Size={UDim2.fromOffset(200, 200)}
							/>
						</Portal>
					</ScreenGui>
				</PortalProvider>
			</LayoutProvider>,
		);

		await waitFor(() => {
			expect(anchorRef.current).toBeDefined();
			expect(portalContentRef.current).toBeDefined();
		});

		// Inside ScreenGui, AbsolutePosition should match the local layout space
		// despite the container being offset by 100, 100 on screen.
		await waitFor(() => {
			expect(anchorRef.current.AbsolutePosition.X).toBe(50);
			expect(anchorRef.current.AbsolutePosition.Y).toBe(50);
			expect(portalContentRef.current.AbsolutePosition.X).toBe(20);
			expect(portalContentRef.current.AbsolutePosition.Y).toBe(20);
			expect(portalContentRef.current.AbsoluteWindowSize.X).toBe(600);
			expect(portalContentRef.current.AbsoluteWindowSize.Y).toBe(400);
		});

		const domElement = portalContentRef.current.querySelector
			? portalContentRef.current
			: portalContentRef.current.parentElement;

		// Mock DOM rect for the element inside the portal
		vi.spyOn(domElement, "getBoundingClientRect").mockReturnValue({
			bottom: 320,
			height: 200,
			left: 120,
			right: 320,
			toJSON: () => ({}),
			top: 120,
			width: 200,
			x: 120,
			y: 120,
		});

		domElement.click(); // Trigger Activated

		await waitFor(() => {
			expect(portalContentRef.current.eventObj).toBeDefined();
		});

		expect(portalContentRef.current.eventObj.AbsolutePosition.X).toBe(20);
		expect(portalContentRef.current.eventObj.AbsolutePosition.Y).toBe(20);
		expect(portalContentRef.current.eventObj.AbsoluteWindowSize.X).toBe(600);
		expect(portalContentRef.current.eventObj.AbsoluteWindowSize.Y).toBe(400);

		unmount();
	});

	it("uses the preview viewport for ScreenGui roots portaled into LocalPlayer.PlayerGui", async () => {
		const playerGui = getLocalPlayerGui();
		const portalScreenRef = React.createRef<any>();
		const viewportHost = document.createElement("div");
		document.body.appendChild(viewportHost);
		vi.spyOn(viewportHost, "getBoundingClientRect").mockReturnValue({
			bottom: 840,
			height: 840,
			left: 0,
			right: 912,
			toJSON: () => ({}),
			top: 0,
			width: 912,
			x: 0,
			y: 0,
		} as DOMRect);

		render(
			<LayoutProvider debounceMs={0} viewportHeight={840} viewportWidth={912}>
				<PortalProvider container={playerGui}>
					<ScreenGui Id="stage-screen">
						<Frame
							Id="source-panel"
							Position={UDim2.fromOffset(12, 108)}
							Size={UDim2.fromOffset(900, 220)}
						>
							<Portal>
								<ScreenGui Id="playergui-portal-screen" ref={portalScreenRef}>
									<Frame
										Id="playergui-portal-content"
										Position={UDim2.fromOffset(0, 0)}
										Size={UDim2.fromOffset(320, 128)}
									/>
								</ScreenGui>
							</Portal>
						</Frame>
					</ScreenGui>
				</PortalProvider>
			</LayoutProvider>,
			{ container: viewportHost },
		);

		await waitFor(() => {
			expect(portalScreenRef.current).toBeDefined();
		});

		await waitFor(() => {
			const portalScreenElement = document.querySelector(
				'[data-preview-node-id="playergui-portal-screen"]',
			) as HTMLElement | null;
			expect(portalScreenElement).toBeTruthy();
			expect(portalScreenRef.current.AbsoluteWindowSize.X).toBe(912);
			expect(portalScreenRef.current.AbsoluteWindowSize.Y).toBe(840);
			expect(
				portalScreenElement?.getAttribute("data-layout-parent-width"),
			).toBe("912");
			expect(
				portalScreenElement?.getAttribute("data-layout-parent-height"),
			).toBe("840");
			expect(portalScreenElement?.style.left).toBe("0px");
			expect(portalScreenElement?.style.top).toBe("0px");
			expect(portalScreenElement?.style.width).toBe("912px");
			expect(portalScreenElement?.style.height).toBe("840px");
		});
	});

	it("keeps portaled popover content aligned with its trigger under LocalPlayer.PlayerGui", async () => {
		const playerGui = getLocalPlayerGui();
		const contentRef = React.createRef<any>();
		const viewportHost = document.createElement("div");
		document.body.appendChild(viewportHost);
		vi.spyOn(viewportHost, "getBoundingClientRect").mockReturnValue({
			bottom: 840,
			height: 840,
			left: 0,
			right: 912,
			toJSON: () => ({}),
			top: 0,
			width: 912,
			x: 0,
			y: 0,
		} as DOMRect);

		function PopoverPortalRegression() {
			const [trigger, setTrigger] = React.useState<any>(null);
			const [anchor, setAnchor] = React.useState<{
				x: number;
				y: number;
			} | null>(null);

			React.useLayoutEffect(() => {
				if (!trigger) {
					return;
				}

				setAnchor({
					x: trigger.AbsolutePosition.X,
					y: trigger.AbsolutePosition.Y,
				});
			}, [trigger]);

			return (
				<PortalProvider container={playerGui}>
					<ScreenGui Id="popover-stage-screen">
						<Frame
							Id="popover-source-panel"
							Position={UDim2.fromOffset(12, 108)}
							Size={UDim2.fromOffset(900, 220)}
						>
							<Frame
								Id="popover-trigger"
								ref={setTrigger}
								Position={UDim2.fromOffset(40, 50)}
								Size={UDim2.fromOffset(320, 40)}
							/>
							{anchor ? (
								<Portal>
									<ScreenGui Id="popover-portal-screen">
										<Frame
											Id="popover-portal-content"
											ref={contentRef}
											Position={UDim2.fromOffset(anchor.x, anchor.y)}
											Size={UDim2.fromOffset(320, 128)}
										/>
									</ScreenGui>
								</Portal>
							) : null}
						</Frame>
					</ScreenGui>
				</PortalProvider>
			);
		}

		render(
			<LayoutProvider debounceMs={0} viewportHeight={840} viewportWidth={912}>
				<PopoverPortalRegression />
			</LayoutProvider>,
			{ container: viewportHost },
		);

		await waitFor(() => {
			const triggerElement = document.querySelector(
				'[data-preview-node-id="popover-trigger"]',
			) as HTMLElement | null;
			const portalScreenElement = document.querySelector(
				'[data-preview-node-id="popover-portal-screen"]',
			) as HTMLElement | null;
			expect(triggerElement).toBeTruthy();
			expect(contentRef.current).toBeDefined();
			expect(portalScreenElement).toBeTruthy();
		});

		await waitFor(() => {
			const triggerElement = document.querySelector(
				'[data-preview-node-id="popover-trigger"]',
			) as HTMLElement | null;
			const portalScreenElement = document.querySelector(
				'[data-preview-node-id="popover-portal-screen"]',
			) as HTMLElement | null;
			expect(contentRef.current.AbsolutePosition.X).toBe(52);
			expect(contentRef.current.AbsolutePosition.Y).toBe(158);
			expect(contentRef.current.AbsolutePosition.X).toBe(
				(triggerElement as any).AbsolutePosition.X,
			);
			expect(contentRef.current.AbsolutePosition.Y).toBe(
				(triggerElement as any).AbsolutePosition.Y,
			);
			expect(portalScreenElement?.style.left).toBe("0px");
			expect(portalScreenElement?.style.top).toBe("0px");
		});
	});
});
