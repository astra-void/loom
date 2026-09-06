import { describe, expect, it } from "vitest";
import { Color3, TweenInfo, UDim2 } from "./datatypes";
import { Enum } from "./enums";
import { game } from "./game";
import { createInstance, type LoomInstance } from "./instance";
import { renderStepped } from "./scheduler";
import { getActiveTweenCount, tweenAlpha } from "./tween";

/** The scheduler's frame signal is what drives tweens; step it by hand. */
function frame(dt: number): void {
	renderStepped.fire(dt);
}

const service = () => game.GetService("TweenService");

const linear = (time: number) =>
	new TweenInfo(time, Enum.EasingStyle.Linear, Enum.EasingDirection.In);

function create(
	target: LoomInstance,
	info: TweenInfo,
	goals: Record<string, unknown>,
): LoomInstance {
	return (
		service().Create as (
			t: LoomInstance,
			i: TweenInfo,
			g: Record<string, unknown>,
		) => LoomInstance
	)(target, info, goals);
}

describe("tweenAlpha", () => {
	it("is the identity for Linear and clamps outside 0..1", () => {
		expect(tweenAlpha(0.25, "Linear", "In")).toBe(0.25);
		expect(tweenAlpha(-1, "Linear", "Out")).toBe(0);
		expect(tweenAlpha(2, "Linear", "Out")).toBe(1);
	});

	it("mirrors In into Out", () => {
		expect(tweenAlpha(0.5, "Quad", "In")).toBeCloseTo(0.25);
		expect(tweenAlpha(0.5, "Quad", "Out")).toBeCloseTo(0.75);
		expect(tweenAlpha(0.25, "Quad", "InOut")).toBeCloseTo(0.125);
	});

	it("falls back to Quad for a style it doesn't know", () => {
		expect(tweenAlpha(0.5, "NotAStyle", "In")).toBeCloseTo(0.25);
	});
});

describe("TweenService", () => {
	it("interpolates numbers over the tween's Time", () => {
		const frameInstance = createInstance("Frame", "Fade");
		frameInstance.BackgroundTransparency = 0;
		const tween = create(frameInstance, linear(1), {
			BackgroundTransparency: 1,
		});

		(tween.Play as () => void)();
		frame(0.5);
		expect(frameInstance.BackgroundTransparency).toBeCloseTo(0.5);
		frame(0.5);
		expect(frameInstance.BackgroundTransparency).toBe(1);
	});

	it("interpolates Color3 and UDim2 goals", () => {
		const frameInstance = createInstance("Frame", "Slide");
		frameInstance.BackgroundColor3 = Color3.fromRGB(0, 0, 0);
		frameInstance.Position = UDim2.fromOffset(0, 0);
		const tween = create(frameInstance, linear(1), {
			BackgroundColor3: Color3.fromRGB(255, 0, 0),
			Position: UDim2.fromOffset(100, 50),
		});

		(tween.Play as () => void)();
		frame(0.5);
		expect((frameInstance.BackgroundColor3 as Color3).R).toBeCloseTo(0.5);
		expect((frameInstance.Position as UDim2).X.Offset).toBeCloseTo(50);
		expect((frameInstance.Position as UDim2).Y.Offset).toBeCloseTo(25);
	});

	it("samples the starting values at Play, not at Create", () => {
		const frameInstance = createInstance("Frame", "Late");
		frameInstance.BackgroundTransparency = 0;
		const tween = create(frameInstance, linear(1), {
			BackgroundTransparency: 1,
		});

		// Moved after the tween was created — Roblox animates from here.
		frameInstance.BackgroundTransparency = 0.5;
		(tween.Play as () => void)();
		frame(0.5);
		expect(frameInstance.BackgroundTransparency).toBeCloseTo(0.75);
	});

	it("waits out DelayTime before moving anything", () => {
		const frameInstance = createInstance("Frame", "Delayed");
		frameInstance.BackgroundTransparency = 0;
		const tween = create(
			frameInstance,
			new TweenInfo(
				1,
				Enum.EasingStyle.Linear,
				Enum.EasingDirection.In,
				0,
				false,
				0.5,
			),
			{ BackgroundTransparency: 1 },
		);

		(tween.Play as () => void)();
		frame(0.4);
		expect(frameInstance.BackgroundTransparency).toBe(0);
		frame(0.6);
		expect(frameInstance.BackgroundTransparency).toBeCloseTo(0.5);
	});

	it("fires Completed with the playback state and stops stepping", () => {
		const frameInstance = createInstance("Frame", "Done");
		frameInstance.BackgroundTransparency = 0;
		const tween = create(frameInstance, linear(1), {
			BackgroundTransparency: 1,
		});

		let completedWith: unknown;
		(
			tween.Completed as {
				Connect(fn: (state: unknown) => void): unknown;
			}
		).Connect((state) => {
			completedWith = state;
		});

		(tween.Play as () => void)();
		expect(tween.PlaybackState).toBe(Enum.PlaybackState.Playing);
		frame(1);
		expect(completedWith).toBe(Enum.PlaybackState.Completed);
		expect(tween.PlaybackState).toBe(Enum.PlaybackState.Completed);
		expect(getActiveTweenCount()).toBe(0);
	});

	it("Cancel stops mid-flight and leaves the property where it was", () => {
		const frameInstance = createInstance("Frame", "Cancelled");
		frameInstance.BackgroundTransparency = 0;
		const tween = create(frameInstance, linear(1), {
			BackgroundTransparency: 1,
		});

		(tween.Play as () => void)();
		frame(0.5);
		(tween.Cancel as () => void)();
		frame(0.5);
		expect(frameInstance.BackgroundTransparency).toBeCloseTo(0.5);
		expect(tween.PlaybackState).toBe(Enum.PlaybackState.Cancelled);
		expect(getActiveTweenCount()).toBe(0);
	});

	it("Reverses returns to the starting value", () => {
		const frameInstance = createInstance("Frame", "There and back");
		frameInstance.BackgroundTransparency = 0;
		const tween = create(
			frameInstance,
			new TweenInfo(
				1,
				Enum.EasingStyle.Linear,
				Enum.EasingDirection.In,
				0,
				true,
			),
			{ BackgroundTransparency: 1 },
		);

		(tween.Play as () => void)();
		frame(1);
		expect(frameInstance.BackgroundTransparency).toBeCloseTo(1);
		frame(0.5);
		expect(frameInstance.BackgroundTransparency).toBeCloseTo(0.5);
		frame(0.5);
		expect(frameInstance.BackgroundTransparency).toBeCloseTo(0);
	});

	it("snaps goal types it cannot interpolate", () => {
		const label = createInstance("TextLabel", "Snap");
		label.Text = "before";
		const tween = create(label, linear(1), { Text: "after" });

		(tween.Play as () => void)();
		frame(0.5);
		expect(label.Text).toBe("after");
	});
});

/** The old-style methods come off the proxy untyped, like every class method. */
type GuiTweenMethod = (...args: unknown[]) => boolean;
const method = (inst: LoomInstance, name: string): GuiTweenMethod =>
	inst[name] as GuiTweenMethod;

const offsetX = (inst: LoomInstance): number =>
	(inst.Position as UDim2).X.Offset;

describe("GuiObject:TweenPosition / :TweenSize / :TweenSizeAndPosition", () => {
	it("moves Position over the given time and reports that it will play", () => {
		const panel = createInstance("Frame", "Panel");
		panel.Position = UDim2.fromOffset(0, 0);

		const willPlay = method(panel, "TweenPosition")(
			UDim2.fromOffset(100, 0),
			Enum.EasingDirection.In,
			Enum.EasingStyle.Linear,
			1,
			false,
		);
		expect(willPlay).toBe(true);

		frame(0.5);
		expect(offsetX(panel)).toBeCloseTo(50);
		frame(0.5);
		expect(offsetX(panel)).toBe(100);
		expect(getActiveTweenCount()).toBe(0);
	});

	it("tweens from wherever the object is, including the class default", () => {
		// A frame that never wrote `Position` reads `{0,0},{0,0}` rather than nil,
		// so the very first tween on a freshly mounted object interpolates instead
		// of snapping to the goal.
		const panel = createInstance("Frame", "Fresh");
		method(panel, "TweenPosition")(
			UDim2.fromOffset(40, 0),
			Enum.EasingDirection.In,
			Enum.EasingStyle.Linear,
			1,
		);
		frame(0.5);
		expect(offsetX(panel)).toBeCloseTo(20);
		frame(0.5);
	});

	it("refuses a second tween unless override is set", () => {
		const panel = createInstance("Frame", "Busy");
		panel.Position = UDim2.fromOffset(0, 0);
		const statuses: unknown[] = [];

		method(panel, "TweenPosition")(
			UDim2.fromOffset(100, 0),
			Enum.EasingDirection.In,
			Enum.EasingStyle.Linear,
			1,
			false,
			(status: unknown) => statuses.push(status),
		);
		frame(0.5);

		// Another tween is acting on the object and override is false: no-op.
		const second = method(panel, "TweenPosition")(
			UDim2.fromOffset(-100, 0),
			Enum.EasingDirection.In,
			Enum.EasingStyle.Linear,
			1,
			false,
		);
		expect(second).toBe(false);

		frame(0.5);
		expect(offsetX(panel)).toBe(100); // the first tween finished undisturbed
		expect(statuses).toEqual([Enum.PlaybackState.Completed]);

		// The slot is free again once it completed.
		expect(
			method(panel, "TweenPosition")(
				UDim2.fromOffset(0, 0),
				Enum.EasingDirection.In,
				Enum.EasingStyle.Linear,
				1,
				false,
			),
		).toBe(true);
		frame(1);
	});

	it("override cancels the running tween and tells its callback so", () => {
		const panel = createInstance("Frame", "Overridden");
		panel.Position = UDim2.fromOffset(0, 0);
		const statuses: unknown[] = [];

		method(panel, "TweenPosition")(
			UDim2.fromOffset(100, 0),
			Enum.EasingDirection.In,
			Enum.EasingStyle.Linear,
			1,
			false,
			(status: unknown) => statuses.push(status),
		);
		frame(0.5);
		expect(offsetX(panel)).toBeCloseTo(50);

		expect(
			method(panel, "TweenPosition")(
				UDim2.fromOffset(150, 0),
				Enum.EasingDirection.In,
				Enum.EasingStyle.Linear,
				1,
				true,
			),
		).toBe(true);
		// The interrupted callback hears about it — a fade-out that cleans up after
		// itself must not run its cleanup as though the fade had finished.
		expect(statuses).toEqual([Enum.PlaybackState.Cancelled]);

		// …and the new tween picks up from where the old one left the object.
		frame(0.5);
		expect(offsetX(panel)).toBeCloseTo(100);
		frame(0.5);
		expect(offsetX(panel)).toBe(150);
		expect(getActiveTweenCount()).toBe(0);
	});

	it("TweenSize and TweenSizeAndPosition move the right properties", () => {
		const panel = createInstance("Frame", "Grow");
		panel.Size = UDim2.fromOffset(0, 0);
		method(panel, "TweenSize")(
			UDim2.fromOffset(200, 100),
			Enum.EasingDirection.In,
			Enum.EasingStyle.Linear,
			1,
		);
		frame(1);
		expect((panel.Size as UDim2).X.Offset).toBe(200);
		expect(offsetX(panel)).toBe(0); // Position untouched

		// Size first, then position — the engine's own argument order.
		method(panel, "TweenSizeAndPosition")(
			UDim2.fromOffset(400, 100),
			UDim2.fromOffset(20, 0),
			Enum.EasingDirection.In,
			Enum.EasingStyle.Linear,
			1,
		);
		frame(0.5);
		expect((panel.Size as UDim2).X.Offset).toBeCloseTo(300);
		expect(offsetX(panel)).toBeCloseTo(10);
		frame(0.5);
		expect(getActiveTweenCount()).toBe(0);
	});

	it("defaults to a one-second Quad/Out tween, and takes the string spellings", () => {
		const quad = createInstance("Frame", "Default");
		quad.Position = UDim2.fromOffset(0, 0);
		method(quad, "TweenPosition")(UDim2.fromOffset(100, 0));
		frame(0.5);
		// Quad/Out at the halfway point, i.e. 1 - (1 - 0.5)^2 = 0.75.
		expect(offsetX(quad)).toBeCloseTo(75);
		frame(0.5);
		expect(offsetX(quad)).toBe(100);

		// Roblox takes the bare string wherever it takes the item; Linear at the
		// halfway point is 50, so a dropped string would show up as 75.
		const linearNamed = createInstance("Frame", "Named");
		linearNamed.Position = UDim2.fromOffset(0, 0);
		method(linearNamed, "TweenPosition")(
			UDim2.fromOffset(100, 0),
			"In",
			"Linear",
			1,
		);
		frame(0.5);
		expect(offsetX(linearNamed)).toBeCloseTo(50);
		frame(0.5);
	});

	it("is inherited by every GuiObject subclass", () => {
		const button = createInstance("TextButton", "Press");
		expect(button.TweenPosition).toBeTypeOf("function");
		expect(button.TweenSize).toBeTypeOf("function");
		expect(button.TweenSizeAndPosition).toBeTypeOf("function");
		// Not a GuiObject: the methods belong to the 2D tree, not to everything.
		expect(createInstance("Folder").TweenPosition).toBeUndefined();
	});
});
