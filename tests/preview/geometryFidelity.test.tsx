// @vitest-environment jsdom

import {
	Enum,
	Frame,
	game,
	LayoutProvider,
	ScreenGui,
	TweenInfo,
	UDim2,
} from "@loom-dev/preview-runtime";
import { render, waitFor } from "@testing-library/react";
import React from "react";
import { describe, expect, it } from "vitest";

describe("geometry fidelity", () => {
	it("observes derived AbsolutePosition changes synchronously during tweening", async () => {
		const ref = React.createRef<any>();
		const positions: any[] = [];

		const { unmount } = render(
			<LayoutProvider debounceMs={0} viewportHeight={240} viewportWidth={320}>
				<ScreenGui>
					<Frame ref={ref} Position={UDim2.fromOffset(10, 10)} />
				</ScreenGui>
			</LayoutProvider>,
		);

		await waitFor(() => {
			expect(ref.current).toBeDefined();
		});

		const signal = ref.current.GetPropertyChangedSignal("AbsolutePosition");
		signal.Connect(() => {
			positions.push(ref.current.AbsolutePosition);
		});

		const tweenInfo = new TweenInfo(
			1,
			Enum.EasingStyle.Linear,
			Enum.EasingDirection.InOut,
		);
		const tweenService = game.GetService("TweenService") as any;
		const tween = tweenService.Create(ref.current, tweenInfo, {
			Position: UDim2.fromOffset(50, 50),
		});

		tween.Play();

		await waitFor(() => {
			expect(positions.length).toBeGreaterThan(0);
		});

		expect(positions[positions.length - 1]).toEqual(
			expect.objectContaining({ X: expect.any(Number), Y: expect.any(Number) }),
		);
		unmount();
	});

	it("ensures ScreenGui AbsoluteWindowSize is non-zero and matches the effective preview viewport", async () => {
		const ref = React.createRef<any>();

		const { unmount } = render(
			<LayoutProvider debounceMs={0} viewportHeight={240} viewportWidth={320}>
				<ScreenGui ref={ref}>
					<Frame />
				</ScreenGui>
			</LayoutProvider>,
		);

		await waitFor(() => {
			expect(ref.current).toBeDefined();
			expect(ref.current.AbsoluteWindowSize).toEqual(
				expect.objectContaining({ X: 320, Y: 240 }),
			);
		});
		unmount();
	});
});
