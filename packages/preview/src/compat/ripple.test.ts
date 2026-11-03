/**
 * The Ripple compatibility runtime: controllers, datatypes, easing, and the
 * one frame connection behind all of them.
 *
 * Everything here steps controllers by hand (`controller.step(dt)`), which is
 * the same code path the Heartbeat listener runs — so the assertions are about
 * the animation itself, not about timers. The scheduler's own connection
 * lifecycle is checked separately, against the runtime's real Heartbeat.
 */
import {
	CFrame,
	Color3,
	getService,
	heartbeat,
	Rect,
	UDim,
	UDim2,
	Vector2,
	Vector3,
} from "@loom-dev/runtime";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	config,
	createMotion,
	createSpring,
	createTween,
	easing,
	motionScheduler,
	springScheduler,
	tweenScheduler,
} from "./ripple.ts";

/** Advance a controller by `frames` 60fps steps. */
function run(
	controller: { step(dt: number): unknown; idle(): boolean },
	frames: number,
	dt = 1 / 60,
): void {
	for (let i = 0; i < frames; i++) controller.step(dt);
}

afterEach(() => {
	springScheduler.clear();
	tweenScheduler.clear();
	motionScheduler.clear();
});

describe("createSpring", () => {
	it("starts at its initial position, idle and at its goal", () => {
		const spring = createSpring(5);
		expect(spring.getPosition()).toBe(5);
		expect(spring.getGoal()).toBe(5);
		expect(spring.getVelocity()).toBe(0);
		expect(spring.idle()).toBe(true);
	});

	it("moves toward a new goal and settles exactly on it", () => {
		const spring = createSpring(0);
		spring.setGoal(100);
		expect(spring.idle()).toBe(false);

		spring.step(1 / 60);
		const first = spring.getPosition() as number;
		expect(first).toBeGreaterThan(0);
		expect(first).toBeLessThan(100);

		run(spring, 600);
		expect(spring.idle()).toBe(true);
		// Landing *on* the goal, not merely within the rest threshold.
		expect(spring.getPosition()).toBe(100);
		expect(spring.getVelocity()).toBe(0);
	});

	it("animates back to the original goal", () => {
		const spring = createSpring(0);
		spring.setGoal(20);
		run(spring, 600);
		expect(spring.getPosition()).toBe(20);

		spring.setGoal(0);
		expect(spring.idle()).toBe(false);
		spring.step(1 / 60);
		expect(spring.getPosition() as number).toBeLessThan(20);
		run(spring, 600);
		expect(spring.getPosition()).toBe(0);
	});

	it("reports progress through onChange and finishes with onComplete", () => {
		const spring = createSpring(0);
		const changes: number[] = [];
		const completes: number[] = [];
		spring.onChange((value) => changes.push(value));
		spring.onComplete((value) => completes.push(value));

		spring.setGoal(10);
		run(spring, 600);

		expect(changes.length).toBeGreaterThan(1);
		expect(completes).toEqual([10]);
		// The last change carries the settled value, before completion fires.
		expect(changes.at(-1)).toBe(10);
	});

	it("stops calling back after unsubscribe", () => {
		const spring = createSpring(0);
		const onChange = vi.fn();
		const unsubscribe = spring.onChange(onChange);
		spring.setGoal(1);
		spring.step(1 / 60);
		const seen = onChange.mock.calls.length;
		expect(seen).toBeGreaterThan(0);

		unsubscribe();
		spring.step(1 / 60);
		expect(onChange).toHaveBeenCalledTimes(seen);
	});

	it("ignores a goal it is already at", () => {
		const spring = createSpring(3);
		spring.setGoal(3);
		expect(spring.idle()).toBe(true);
		// Datatypes compare by value, as in Roblox — a fresh but equal UDim2 is
		// not a new goal, so a component rebuilding one per render never restarts.
		const sized = createSpring(UDim2.fromOffset(4, 4));
		sized.setGoal(UDim2.fromOffset(4, 4));
		expect(sized.idle()).toBe(true);
		sized.setGoal(UDim2.fromOffset(5, 4));
		expect(sized.idle()).toBe(false);
	});

	it("takes a config preset without mutating it", () => {
		const before = { ...config.stiff };
		const spring = createSpring(0, config.stiff);
		spring.setGoal(1, config.wobbly);
		spring.configure(config.gentle);
		expect(config.stiff).toEqual(before);
		expect(Object.isFrozen(config.stiff)).toBe(true);
	});

	it("settles faster with a stiffer preset", () => {
		const framesToSettle = (preset: typeof config.stiff): number => {
			const spring = createSpring(0, preset);
			spring.setGoal(100);
			let frames = 0;
			while (!spring.idle() && frames < 2000) {
				spring.step(1 / 60);
				frames += 1;
			}
			return frames;
		};
		expect(framesToSettle(config.stiff)).toBeLessThan(
			framesToSettle(config.molasses),
		);
	});

	it("accepts dampingRatio/frequency instead of tension/friction", () => {
		const underdamped = createSpring(0, { dampingRatio: 0.4, frequency: 4 });
		underdamped.setGoal(100);
		let overshot = false;
		for (let i = 0; i < 600 && !underdamped.idle(); i++) {
			underdamped.step(1 / 60);
			if ((underdamped.getPosition() as number) > 100) overshot = true;
		}
		// An underdamped spring must actually oscillate past its goal.
		expect(overshot).toBe(true);
		expect(underdamped.getPosition()).toBe(100);
	});

	it("stays overdamped without overshooting", () => {
		const spring = createSpring(0, { dampingRatio: 2, frequency: 3 });
		spring.setGoal(50);
		for (let i = 0; i < 600 && !spring.idle(); i++) {
			spring.step(1 / 60);
			expect(spring.getPosition() as number).toBeLessThanOrEqual(50);
		}
		expect(spring.getPosition()).toBe(50);
	});

	it("moves under an impulse and stops under halt", () => {
		const spring = createSpring(0);
		spring.impulse(120);
		expect(spring.idle()).toBe(false);
		expect(spring.getVelocity()).toBe(120);
		spring.step(1 / 60);
		expect(spring.getPosition() as number).toBeGreaterThan(0);

		spring.halt();
		expect(spring.getVelocity()).toBe(0);
	});

	it("jumps with setPosition and reports the jump", () => {
		const spring = createSpring(0);
		const onChange = vi.fn();
		spring.onChange(onChange);
		spring.setPosition(40);
		expect(spring.getPosition()).toBe(40);
		expect(onChange).toHaveBeenCalledWith(40, 0);
	});

	it("start/stop control scheduling without losing state", () => {
		const spring = createSpring(0);
		spring.setGoal(10);
		spring.start();
		expect(springScheduler.size).toBe(1);

		spring.stop();
		expect(springScheduler.size).toBe(0);
		// Stopping keeps the animation exactly where it was.
		expect(spring.getGoal()).toBe(10);
		expect(spring.idle()).toBe(false);

		spring.start();
		expect(springScheduler.size).toBe(1);
	});

	it("destroy stops it and drops its callbacks", () => {
		const spring = createSpring(0, { start: true });
		const onChange = vi.fn();
		spring.onChange(onChange);
		spring.setGoal(10);
		expect(springScheduler.size).toBe(1);

		spring.destroy();
		expect(springScheduler.size).toBe(0);
		spring.step(1 / 60);
		expect(onChange).not.toHaveBeenCalled();
	});
});

describe("spring datatypes", () => {
	it("animates a UDim2 per component and lands on the goal", () => {
		const spring = createSpring(UDim2.fromOffset(0, 0));
		spring.setGoal(UDim2.new(1, 200, 0.5, 50));
		run(spring, 900);
		const value = spring.getPosition();
		expect(value.X.Scale).toBeCloseTo(1);
		expect(value.X.Offset).toBe(200);
		expect(value.Y.Scale).toBeCloseTo(0.5);
		expect(value.Y.Offset).toBe(50);
	});

	it("rounds UDim offsets while mid-flight, as Roblox does", () => {
		const spring = createSpring(UDim2.fromOffset(0, 0));
		spring.setGoal(UDim2.fromOffset(100, 100));
		spring.step(1 / 60);
		const value = spring.getPosition();
		expect(Number.isInteger(value.X.Offset)).toBe(true);
		expect(Number.isInteger(value.Y.Offset)).toBe(true);
	});

	it("animates Vector2, Vector3, UDim and Rect", () => {
		const vector2 = createSpring(Vector2.new(0, 0));
		vector2.setGoal(Vector2.new(10, 20));
		run(vector2, 900);
		expect(vector2.getPosition().X).toBeCloseTo(10);
		expect(vector2.getPosition().Y).toBeCloseTo(20);

		const vector3 = createSpring(Vector3.new(0, 0, 0));
		vector3.setGoal(Vector3.new(1, 2, 3));
		run(vector3, 900);
		expect(vector3.getPosition().Z).toBeCloseTo(3);

		const udim = createSpring(new UDim(0, 0));
		udim.setGoal(new UDim(1, 8));
		run(udim, 900);
		expect(udim.getPosition().Scale).toBeCloseTo(1);
		expect(udim.getPosition().Offset).toBe(8);

		const rect = createSpring(Rect.new(0, 0, 0, 0));
		rect.setGoal(Rect.new(1, 2, 3, 4));
		run(rect, 900);
		expect(rect.getPosition().Max.Y).toBeCloseTo(4);
	});

	it("animates Color3 through Oklab and ends on the exact color", () => {
		const target = Color3.fromRGB(255, 0, 0);
		const spring = createSpring(Color3.fromRGB(0, 0, 255));
		spring.setGoal(target);
		spring.step(1 / 60);
		const mid = spring.getPosition();
		// Perceptual interpolation: the midpoint is not a naive channel lerp, so
		// green picks up some light instead of staying at zero.
		expect(mid.G).toBeGreaterThan(0);

		run(spring, 900);
		expect(spring.getPosition().R).toBeCloseTo(target.R, 5);
		expect(spring.getPosition().G).toBeCloseTo(target.G, 5);
		expect(spring.getPosition().B).toBeCloseTo(target.B, 5);
	});

	it("animates a record of numbers and accepts a partial goal", () => {
		const spring = createSpring({ x: 0, y: 0 });
		spring.setGoal({ x: 10 });
		run(spring, 900);
		expect(spring.getPosition().x).toBeCloseTo(10);
		// The key the partial goal left out never moved.
		expect(spring.getPosition().y).toBe(0);
	});

	it("springs a CFrame's position and rotation onto the goal", () => {
		const goal = CFrame.new(10, 0, 0).mul(CFrame.Angles(0, Math.PI / 2, 0));
		const spring = createSpring(CFrame.new(0, 0, 0));
		spring.setGoal(goal);
		run(spring, 30);
		const mid = spring.getPosition();
		// Mid-flight the basis is still a rotation: Ripple orthonormalizes it.
		expect(mid.XVector.Magnitude).toBeCloseTo(1, 9);
		expect(mid.XVector.Dot(mid.YVector)).toBeCloseTo(0, 9);
		expect(mid.X).toBeGreaterThan(0);
		expect(mid.X).toBeLessThan(10);
		run(spring, 900);
		expect(spring.idle()).toBe(true);
		expect(spring.getPosition().FuzzyEq(goal)).toBe(true);
	});

	it("refuses a datatype it cannot animate, by name", () => {
		expect(() => createSpring("nope" as never)).toThrow(
			/cannot animate a string value/,
		);
		expect(() => createSpring({ label: "nope" } as never)).toThrow(
			/records of numbers/,
		);
	});
});

describe("createTween", () => {
	it("slerps a CFrame the way Ripple's Lerp does", () => {
		const goal = CFrame.new(10, 0, 0).mul(CFrame.Angles(0, Math.PI / 2, 0));
		const tween = createTween(CFrame.new(0, 0, 0), {
			duration: 1,
			easing: "linear",
		});
		tween.setGoal(goal);
		run(tween, 30);
		expect(
			tween
				.getPosition()
				.FuzzyEq(CFrame.new(5, 0, 0).mul(CFrame.Angles(0, Math.PI / 4, 0))),
		).toBe(true);
		run(tween, 60);
		expect(tween.getPosition().FuzzyEq(goal)).toBe(true);
	});

	it("walks from its position to the goal over the duration", () => {
		const tween = createTween(0, { duration: 1 });
		tween.setGoal(100);
		expect(tween.getFrom()).toBe(0);

		run(tween, 30);
		expect(tween.getPosition() as number).toBeCloseTo(50, 0);
		expect(tween.idle()).toBe(false);

		run(tween, 31);
		expect(tween.getPosition()).toBe(100);
		expect(tween.idle()).toBe(true);
	});

	it("applies the named easing", () => {
		const linear = createTween(0, { duration: 1, easing: "linear" });
		const quad = createTween(0, { duration: 1, easing: "quadIn" });
		linear.setGoal(100);
		quad.setGoal(100);
		run(linear, 15);
		run(quad, 15);
		// quadIn starts slower than linear.
		expect(quad.getPosition() as number).toBeLessThan(
			linear.getPosition() as number,
		);
	});

	it("restarts from the current position when the goal changes mid-flight", () => {
		const tween = createTween(0, { duration: 1 });
		tween.setGoal(100);
		run(tween, 30);
		const midway = tween.getPosition() as number;

		tween.setGoal(0);
		expect(tween.getFrom()).toBe(midway);
		expect(tween.idle()).toBe(false);
		run(tween, 61);
		expect(tween.getPosition()).toBe(0);
	});

	it("reverses across repeats", () => {
		const tween = createTween(0, {
			duration: 1,
			repeats: 2,
			reverses: true,
		});
		tween.setGoal(100);
		run(tween, 60);
		expect(tween.getPosition() as number).toBeCloseTo(100, 0);
		// Second pass runs backwards.
		run(tween, 30);
		expect(tween.getPosition() as number).toBeCloseTo(50, 0);
		run(tween, 31);
		expect(tween.idle()).toBe(true);
	});

	it("never completes with negative (infinite) repeats", () => {
		const tween = createTween(0, { duration: 0.5, repeats: -1 });
		tween.setGoal(10);
		run(tween, 600);
		expect(tween.idle()).toBe(false);
	});

	it("fires onComplete once, with the final value", () => {
		const tween = createTween(0, { duration: 0.25 });
		const onComplete = vi.fn();
		tween.onComplete(onComplete);
		tween.setGoal(7);
		run(tween, 60);
		expect(onComplete).toHaveBeenCalledTimes(1);
		expect(onComplete).toHaveBeenCalledWith(7);
	});

	it("tweens a UDim2", () => {
		const tween = createTween(UDim2.fromOffset(0, 0), { duration: 0.5 });
		tween.setGoal(UDim2.fromOffset(100, 40));
		run(tween, 60);
		expect(tween.getPosition().X.Offset).toBe(100);
		expect(tween.getPosition().Y.Offset).toBe(40);
	});

	it("destroy stops it and drops its callbacks", () => {
		const tween = createTween(0, { start: true, duration: 1 });
		const onChange = vi.fn();
		tween.onChange(onChange);
		tween.setGoal(1);
		expect(tweenScheduler.size).toBe(1);

		tween.destroy();
		expect(tweenScheduler.size).toBe(0);
		tween.step(1 / 60);
		expect(onChange).not.toHaveBeenCalled();
	});
});

describe("createMotion", () => {
	it("springs by default and reports through onChange", () => {
		const motion = createMotion(0);
		const onChange = vi.fn();
		motion.onChange(onChange);
		motion.setGoal(50);
		run(motion, 600);
		expect(motion.getPosition()).toBe(50);
		expect(motion.idle()).toBe(true);
		expect(onChange).toHaveBeenCalled();
	});

	it("hands the position over when switching spring → tween", () => {
		const motion = createMotion(0);
		motion.spring(100);
		run(motion, 10);
		const midway = motion.getPosition() as number;
		expect(midway).toBeGreaterThan(0);

		motion.tween(0, { duration: 0.5 });
		// The tween picks up exactly where the spring left off — no jump.
		expect(motion.getPosition()).toBe(midway);
		run(motion, 60);
		expect(motion.getPosition()).toBe(0);
	});

	it("kills the spring velocity on the way into a tween", () => {
		const motion = createMotion(0);
		motion.spring(100);
		run(motion, 5);
		motion.tween(0, { duration: 0.5 });
		expect(motion.getVelocity()).toBe(0);
	});

	it("fires onComplete once the active controller settles", () => {
		const motion = createMotion(0);
		const onComplete = vi.fn();
		motion.onComplete(onComplete);
		motion.tween(10, { duration: 0.25 });
		run(motion, 60);
		expect(onComplete).toHaveBeenCalledTimes(1);
		expect(motion.idle()).toBe(true);
	});

	it("destroy stops it and both inner controllers", () => {
		const motion = createMotion(0, { start: true });
		motion.setGoal(10);
		expect(motionScheduler.size).toBe(1);
		motion.destroy();
		expect(motionScheduler.size).toBe(0);
		expect(springScheduler.size).toBe(0);
		expect(tweenScheduler.size).toBe(0);
	});
});

describe("easing", () => {
	it("publishes every documented curve, anchored at 0 and 1", () => {
		for (const [name, fn] of Object.entries(easing)) {
			expect(fn(0), name).toBeCloseTo(0, 5);
			expect(fn(1), name).toBeCloseTo(1, 5);
		}
	});

	it("matches the reference values for the common curves", () => {
		expect(easing.linear(0.25)).toBe(0.25);
		expect(easing.instant(0.5)).toBe(1);
		expect(easing.smoothstep(0.5)).toBe(0.5);
		expect(easing.quadIn(0.5)).toBe(0.25);
		expect(easing.quadOut(0.5)).toBe(0.75);
		expect(easing.cubicIn(0.5)).toBe(0.125);
		expect(easing.cubicOut(0.5)).toBeCloseTo(0.875);
		expect(easing.sineOut(0.5)).toBeCloseTo(Math.SQRT1_2);
		// `back*` deliberately overshoots outside 0..1.
		expect(easing.backIn(0.3)).toBeLessThan(0);
	});
});

describe("config", () => {
	it("publishes the documented presets", () => {
		expect(config.default).toEqual({ tension: 170, friction: 26 });
		expect(config.gentle).toEqual({ tension: 120, friction: 14 });
		expect(config.wobbly).toEqual({ tension: 180, friction: 12 });
		expect(config.stiff).toEqual({ tension: 210, friction: 20 });
		expect(config.slow).toEqual({ tension: 280, friction: 60 });
		expect(config.molasses).toEqual({ tension: 280, friction: 120 });
		expect(config.figmaGentle).toEqual({ tension: 100, friction: 15 });
		expect(config.figmaQuick).toEqual({ tension: 300, friction: 20 });
		expect(config.figmaBouncy).toEqual({ tension: 600, friction: 15 });
		expect(config.figmaSlow).toEqual({ tension: 80, friction: 20 });
	});
});

describe("the frame connection", () => {
	it("uses RunService.Heartbeat, one listener for every spring", () => {
		expect(springScheduler.connected).toBe(false);
		const first = createSpring(0, { start: true });
		const second = createSpring(0, { start: true });
		first.setGoal(1);
		second.setGoal(1);
		expect(springScheduler.size).toBe(2);
		expect(springScheduler.connected).toBe(true);

		// The scheduler's signal is exactly the one RunService hands out.
		expect(getService("RunService").Heartbeat).toBe(heartbeat);
	});

	it("releases the connection once every controller settles", () => {
		const spring = createSpring(0, { start: true });
		spring.setGoal(1);
		expect(springScheduler.connected).toBe(true);

		// Drive real frames through the runtime signal, as the page would.
		for (let i = 0; i < 600 && springScheduler.size > 0; i++) {
			heartbeat.fire(1 / 60);
		}
		expect(spring.idle()).toBe(true);
		expect(springScheduler.size).toBe(0);
		expect(springScheduler.connected).toBe(false);
	});

	it("stops scheduling a controller that never started", () => {
		const spring = createSpring(0);
		spring.setGoal(100);
		expect(springScheduler.size).toBe(0);
		expect(springScheduler.connected).toBe(false);
	});
});
