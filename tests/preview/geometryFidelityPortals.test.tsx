// @vitest-environment jsdom

import {
	Frame,
	LayoutProvider,
	PortalProvider,
	Portal,
	ScreenGui,
	UDim2,
} from "@loom-dev/preview-runtime";
import { render, waitFor } from "@testing-library/react";
import React from "react";
import { describe, expect, it, vi } from "vitest";

describe("geometry fidelity portals", () => {
	it("resolves portal anchor AbsolutePosition in the same coordinate space as the viewport", async () => {
		const anchorRef = React.createRef<any>();
		const portalContentRef = React.createRef<any>();

		const layoutProviderSpy = vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
			if (this.hasAttribute("data-preview-layout-provider")) {
				return { bottom: 400, height: 400, left: 100, right: 700, toJSON: () => ({}), top: 100, width: 600, x: 100, y: 100 } as DOMRect;
			}
			return { bottom: 0, height: 0, left: 0, right: 0, toJSON: () => ({}), top: 0, width: 0, x: 0, y: 0 } as DOMRect;
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
									}
								}}
								Size={UDim2.fromOffset(200, 200)} 
							/>
						</Portal>
					</ScreenGui>
				</PortalProvider>
			</LayoutProvider>
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

		
		const domElement = portalContentRef.current.querySelector ? portalContentRef.current : portalContentRef.current.parentElement;
		
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
});
