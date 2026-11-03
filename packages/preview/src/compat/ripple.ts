/**
 * `@rbxts/ripple` — loom's browser runtime for Ripple.
 *
 * Ripple ships a Luau runtime (`"main": "src/init.luau"`) and a `.d.ts`; there
 * is no JavaScript in the package at all. Left alone, Vite resolves the Luau
 * entry, the dev server hands the browser a file starting `local Ripple =
 * require(...)`, and `vite build` dies inside Rollup's JS parser. So the Vite
 * plugin aliases the package here instead — an exact-match redirect installed
 * before normal package resolution, in serve *and* build, so the dev server and
 * the static gallery run the same code.
 *
 * This is a port, not a stub: the spring integrator, the easing curves, the
 * Oklab color interpolation and the completion thresholds all follow the
 * published Luau source, so a component animates in loom the way it does in
 * Roblox. What is *not* supported fails loudly — see `./ripple/animatable.ts`.
 *
 * Supported values: `number`, `Vector2`, `Vector3`, `Color3`, `UDim`, `UDim2`,
 * `Rect`, `CFrame`, and records of numbers.
 */
export type {
	Animatable,
	AnimatablePrimitive,
	AnimatableType,
	NumberRecord,
	PartialGoal,
} from "./ripple/animatable.ts";
export { config, type Easing, easing } from "./ripple/easing.ts";
export {
	createMotion,
	type Motion,
	type MotionOptions,
	motionScheduler,
} from "./ripple/motion.ts";
export {
	createSpring,
	type Spring,
	type SpringOptions,
	springScheduler,
} from "./ripple/spring.ts";
export {
	createTween,
	type Tween,
	type TweenOptions,
	tweenScheduler,
} from "./ripple/tween.ts";
