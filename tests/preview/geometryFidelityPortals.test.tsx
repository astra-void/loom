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
import { getLocalPlayerGui } from "../../apps/preview-harness/src/test-utils/playerGui";
import {
	installTestPreviewLayoutEngineLoader,
	resetTestPreviewLayoutEngineLoader,
} from "./testLayoutEngineLoader";

type PopperPlacementInput = {
	anchorHeight: number;
	anchorX: number;
	anchorY: number;
	contentHeight: number;
	contentWidth: number;
	offsetX: number;
	offsetY: number;
	viewportHeight: number;
	viewportWidth: number;
	withFlip: boolean;
};

type PreviewVector2 = {
	X: number;
	Y: number;
};

type PreviewGuiObjectLike = HTMLElement & {
	AbsolutePosition: PreviewVector2;
	AbsoluteSize: PreviewVector2;
	AbsoluteWindowSize: PreviewVector2;
};

function resolveBottomPlacement(input: PopperPlacementInput) {
	const maxX = Math.max(0, input.viewportWidth - input.contentWidth);
	const maxY = Math.max(0, input.viewportHeight - input.contentHeight);
	const preferredX = input.anchorX + input.offsetX;
	const preferredBottomY = input.anchorY + input.anchorHeight + input.offsetY;
	const shouldFlip =
		input.withFlip && preferredBottomY + input.contentHeight > input.viewportHeight;
	const preferredY = shouldFlip
		? input.anchorY - input.offsetY - input.contentHeight
		: preferredBottomY;

	return {
		x: Math.max(0, Math.min(maxX, preferredX)),
		y: Math.max(0, Math.min(maxY, preferredY)),
	};
}

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
									Activated: (obj: unknown) => {
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

	it("keeps popper-like portal placement in one coordinate space for popover and select paths", async () => {
		const playerGui = getLocalPlayerGui();
		const viewportHost = document.createElement("div");
		document.body.appendChild(viewportHost);

		vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
			function (this: HTMLElement) {
				if (this.hasAttribute("data-preview-layout-provider")) {
					return {
						bottom: 500,
						height: 360,
						left: 240,
						right: 880,
						toJSON: () => ({}),
						top: 140,
						width: 640,
						x: 240,
						y: 140,
					} as DOMRect;
				}

				if (this === viewportHost) {
					return {
						bottom: 500,
						height: 360,
						left: 240,
						right: 880,
						toJSON: () => ({}),
						top: 140,
						width: 640,
						x: 240,
						y: 140,
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
			},
		);

		type PopperSceneProps = {
			anchorId: string;
			anchorPosition: { x: number; y: number };
			contentRef: React.RefObject<PreviewGuiObjectLike | null>;
			contentSize: { height: number; width: number };
			sceneId: string;
			withFlip: boolean;
			wrapperRef: React.RefObject<PreviewGuiObjectLike | null>;
		};

		function PopperScene(props: PopperSceneProps) {
			const [anchor, setAnchor] = React.useState<PreviewGuiObjectLike | null>(
				null,
			);
			const [placement, setPlacement] = React.useState<{
				x: number;
				y: number;
			} | null>(null);

			React.useLayoutEffect(() => {
				if (!anchor) {
					return;
				}

				const nextPlacement = resolveBottomPlacement({
					anchorHeight: anchor.AbsoluteSize.Y,
					anchorX: anchor.AbsolutePosition.X,
					anchorY: anchor.AbsolutePosition.Y,
					contentHeight: props.contentSize.height,
					contentWidth: props.contentSize.width,
					offsetX: 0,
					offsetY: 8,
					viewportHeight: anchor.AbsoluteWindowSize.Y,
					viewportWidth: anchor.AbsoluteWindowSize.X,
					withFlip: props.withFlip,
				});

				setPlacement((previous) =>
					previous &&
					previous.x === nextPlacement.x &&
					previous.y === nextPlacement.y
						? previous
						: nextPlacement,
				);
			}, [anchor, props.contentSize.height, props.contentSize.width, props.withFlip]);

			return (
				<ScreenGui Id={props.sceneId}>
					<Frame
						Id={props.anchorId}
						ref={setAnchor}
						Position={UDim2.fromOffset(
							props.anchorPosition.x,
							props.anchorPosition.y,
						)}
						Size={UDim2.fromOffset(180, 36)}
					/>
					{placement ? (
						<Portal>
							<Frame
								Id={`${props.sceneId}-wrapper`}
								ref={props.wrapperRef}
								Position={UDim2.fromOffset(placement.x, placement.y)}
								Size={UDim2.fromOffset(
									props.contentSize.width,
									props.contentSize.height,
								)}
							>
								<Frame
									Id={`${props.sceneId}-content`}
									ref={props.contentRef}
									Position={UDim2.fromOffset(0, 0)}
									Size={UDim2.fromOffset(
										props.contentSize.width,
										props.contentSize.height,
									)}
								/>
							</Frame>
						</Portal>
					) : null}
				</ScreenGui>
			);
		}

		const popoverWrapperRef = React.createRef<PreviewGuiObjectLike>();
		const popoverContentRef = React.createRef<PreviewGuiObjectLike>();
		const selectWrapperRef = React.createRef<PreviewGuiObjectLike>();
		const selectContentRef = React.createRef<PreviewGuiObjectLike>();

		render(
			<LayoutProvider debounceMs={0} viewportHeight={360} viewportWidth={640}>
				<PortalProvider container={playerGui}>
					<PopperScene
						anchorId="popover-anchor"
						anchorPosition={{ x: 120, y: 80 }}
						contentRef={popoverContentRef}
						contentSize={{ height: 100, width: 220 }}
						sceneId="popover-scene"
						withFlip={false}
						wrapperRef={popoverWrapperRef}
					/>
					<PopperScene
						anchorId="select-anchor"
						anchorPosition={{ x: 420, y: 300 }}
						contentRef={selectContentRef}
						contentSize={{ height: 140, width: 220 }}
						sceneId="select-scene"
						withFlip={true}
						wrapperRef={selectWrapperRef}
					/>
				</PortalProvider>
			</LayoutProvider>,
			{ container: viewportHost },
		);

		await waitFor(() => {
			expect(popoverWrapperRef.current).toBeDefined();
			expect(popoverContentRef.current).toBeDefined();
			expect(selectWrapperRef.current).toBeDefined();
			expect(selectContentRef.current).toBeDefined();
		});

		await waitFor(() => {
			const popoverAnchor = document.querySelector(
				'[data-preview-node-id="popover-anchor"]',
			) as HTMLElement | null;
			const selectAnchor = document.querySelector(
				'[data-preview-node-id="select-anchor"]',
			) as HTMLElement | null;
			const popoverWrapper = document.querySelector(
				'[data-preview-node-id="popover-scene-wrapper"]',
			) as HTMLElement | null;
			const selectWrapper = document.querySelector(
				'[data-preview-node-id="select-scene-wrapper"]',
			) as HTMLElement | null;
			const layoutProvider = popoverAnchor?.closest(
				"[data-preview-layout-provider]",
			) as HTMLElement | null;
			const popoverWrapperHandle = popoverWrapperRef.current;
			const popoverContentHandle = popoverContentRef.current;
			const selectWrapperHandle = selectWrapperRef.current;
			const selectContentHandle = selectContentRef.current;

			expect(popoverAnchor).toBeTruthy();
			expect(selectAnchor).toBeTruthy();
			expect(popoverWrapper).toBeTruthy();
			expect(selectWrapper).toBeTruthy();
			expect(layoutProvider).toBeTruthy();
			expect(popoverWrapperHandle).toBeTruthy();
			expect(popoverContentHandle).toBeTruthy();
			expect(selectWrapperHandle).toBeTruthy();
			expect(selectContentHandle).toBeTruthy();

			if (
				!popoverAnchor ||
				!selectAnchor ||
				!layoutProvider ||
				!popoverWrapperHandle ||
				!popoverContentHandle ||
				!selectWrapperHandle ||
				!selectContentHandle
			) {
				throw new Error("Expected portal popper handles to be mounted.");
			}

			expect(playerGui.parentElement).toBe(layoutProvider);

			const popoverAnchorHandle = popoverAnchor as PreviewGuiObjectLike;
			const selectAnchorHandle = selectAnchor as PreviewGuiObjectLike;

			expect(popoverAnchorHandle.AbsolutePosition.X).toBe(120);
			expect(popoverAnchorHandle.AbsolutePosition.Y).toBe(80);
			expect(selectAnchorHandle.AbsolutePosition.X).toBe(420);
			expect(selectAnchorHandle.AbsolutePosition.Y).toBe(300);

			expect(popoverWrapperHandle.AbsolutePosition.X).toBe(120);
			expect(popoverWrapperHandle.AbsolutePosition.Y).toBe(124);
			expect(popoverContentHandle.AbsolutePosition.X).toBe(120);
			expect(popoverContentHandle.AbsolutePosition.Y).toBe(124);
			expect(popoverWrapperHandle.AbsoluteWindowSize.X).toBe(640);
			expect(popoverWrapperHandle.AbsoluteWindowSize.Y).toBe(360);

			expect(selectWrapperHandle.AbsolutePosition.X).toBe(420);
			expect(selectWrapperHandle.AbsolutePosition.Y).toBe(152);
			expect(selectContentHandle.AbsolutePosition.X).toBe(420);
			expect(selectContentHandle.AbsolutePosition.Y).toBe(152);
			expect(selectWrapperHandle.AbsoluteWindowSize.X).toBe(640);
			expect(selectWrapperHandle.AbsoluteWindowSize.Y).toBe(360);

			expect(popoverWrapperHandle.AbsolutePosition.Y).toBeGreaterThan(
				popoverAnchorHandle.AbsolutePosition.Y,
			);
			expect(selectWrapperHandle.AbsolutePosition.Y).toBeLessThan(
				selectAnchorHandle.AbsolutePosition.Y,
			);

			expect(popoverWrapperHandle.AbsolutePosition.X).not.toBe(0);
			expect(popoverWrapperHandle.AbsolutePosition.Y).not.toBe(0);
			expect(selectWrapperHandle.AbsolutePosition.X).not.toBe(0);
			expect(selectWrapperHandle.AbsolutePosition.Y).not.toBe(0);
		});
	});
});
