/**
 * `tween.ts` — `TweenService` and the `Tween` instance.
 *
 * Roblox's own property animator, which UI libraries reach for constantly
 * (hover/press transitions, sliding panels). `TweenService:Create` snapshots the
 * instance's current values when the tween is *played* and interpolates them
 * toward the goal table on the scheduler's frame signal, so tweened writes go
 * through the same dirty→flush path as any other property write.
 *
 * Interpolation covers the datatypes Roblox lets you tween on a GUI (numbers,
 * `Color3`, `UDim`, `UDim2`, `Vector2`); anything else snaps at the end of the
 * tween rather than erroring, which keeps a preview alive where the real engine
 * would have rejected the goal at creation time.
 */
import { Color3, TweenInfo, UDim, UDim2, Vector2 } from "./datatypes";
import { Enum, EnumItem, enumName } from "./enums";
import { registerService } from "./game";
import {
	createInstance,
	getEventSignal,
	type LoomInstance,
	registerClassMethods,
	setRawProperty,
} from "./instance";
import { renderStepped } from "./scheduler";
import type { LoomConnection } from "./signal";

// --- easing ------------------------------------------------------------------

/** `EasingStyle` as an "In" curve; Out/InOut are derived from it. */
const EASE_IN: Record<string, (t: number) => number> = {
	Linear: (t) => t,
	Quad: (t) => t * t,
	Cubic: (t) => t ** 3,
	Quart: (t) => t ** 4,
	Quint: (t) => t ** 5,
	Sine: (t) => 1 - Math.cos((t * Math.PI) / 2),
	Exponential: (t) => (t === 0 ? 0 : 2 ** (10 * (t - 1))),
	Circular: (t) => 1 - Math.sqrt(1 - t * t),
	Back: (t) => t * t * (2.70158 * t - 1.70158),
	Elastic: (t) =>
		t === 0 || t === 1
			? t
			: -(2 ** (10 * (t - 1))) * Math.sin(((t - 1.075) * (2 * Math.PI)) / 0.3),
	Bounce: (t) => 1 - bounceOut(1 - t),
};

function bounceOut(t: number): number {
	const n = 7.5625;
	const d = 2.75;
	if (t < 1 / d) return n * t * t;
	if (t < 2 / d) {
		const u = t - 1.5 / d;
		return n * u * u + 0.75;
	}
	if (t < 2.5 / d) {
		const u = t - 2.25 / d;
		return n * u * u + 0.9375;
	}
	const u = t - 2.625 / d;
	return n * u * u + 0.984375;
}

/**
 * `TweenService:GetValue(alpha, style, direction)` — the eased fraction, also
 * used internally to drive every tween.
 */
export function tweenAlpha(
	alpha: number,
	style: string,
	direction: string,
): number {
	const t = Math.min(Math.max(alpha, 0), 1);
	// Roblox's default style, and the fallback for one this build doesn't know.
	const ease = EASE_IN[style] ?? ((x: number) => x * x);
	if (direction === "In") return ease(t);
	if (direction === "InOut") {
		return t < 0.5 ? ease(t * 2) / 2 : 1 - ease((1 - t) * 2) / 2;
	}
	// "Out" — Roblox's default direction.
	return 1 - ease(1 - t);
}

// --- interpolation -----------------------------------------------------------

const lerpNumber = (a: number, b: number, t: number): number => a + (b - a) * t;

const lerpUDim = (a: UDim, b: UDim, t: number): UDim =>
	new UDim(lerpNumber(a.Scale, b.Scale, t), lerpNumber(a.Offset, b.Offset, t));

/**
 * Interpolate one goal value. Returns `to` unchanged for pairs it cannot blend,
 * so an unsupported goal type simply snaps once the tween lands there.
 */
function lerpValue(from: unknown, to: unknown, t: number): unknown {
	if (typeof from === "number" && typeof to === "number") {
		return lerpNumber(from, to, t);
	}
	if (from instanceof Color3 && to instanceof Color3) {
		return from.Lerp(to, t);
	}
	if (from instanceof UDim2 && to instanceof UDim2) {
		return new UDim2(lerpUDim(from.X, to.X, t), lerpUDim(from.Y, to.Y, t));
	}
	if (from instanceof UDim && to instanceof UDim) return lerpUDim(from, to, t);
	if (from instanceof Vector2 && to instanceof Vector2) {
		return Vector2.new(
			lerpNumber(from.X, to.X, t),
			lerpNumber(from.Y, to.Y, t),
		);
	}
	return to;
}

// --- the Tween instance ------------------------------------------------------

interface TweenState {
	target: LoomInstance;
	info: TweenInfo;
	goals: Record<string, unknown>;
	/** Captured on `Play()`, the way Roblox does — not at creation. */
	from: Record<string, unknown>;
	/** Seconds since `Play()`, including `DelayTime`. */
	elapsed: number;
	playing: boolean;
}

const states = new WeakMap<LoomInstance, TweenState>();
const active = new Set<LoomInstance>();
let frameConnection: LoomConnection | undefined;

function setPlaybackState(tween: LoomInstance, name: string): void {
	setRawProperty(
		tween,
		"PlaybackState",
		Enum.PlaybackState[
			name as keyof typeof Enum.PlaybackState
		] as EnumItem<"PlaybackState">,
	);
}

/** Total run time of one pass, and of the whole tween including repeats. */
function cycleSeconds(info: TweenInfo): number {
	return info.Time * (info.Reverses ? 2 : 1);
}

function apply(state: TweenState, alpha: number): void {
	for (const [key, goal] of Object.entries(state.goals)) {
		state.target[key] = lerpValue(state.from[key], goal, alpha);
	}
}

/**
 * Advance one tween. Returns false when it has finished (or was cancelled out
 * from under us) and should leave the active set.
 */
function step(tween: LoomInstance, dt: number): boolean {
	const state = states.get(tween);
	if (!state || !state.playing) return false;

	state.elapsed += dt;
	const local = state.elapsed - state.info.DelayTime;
	if (local < 0) return true; // still in DelayTime

	const cycle = cycleSeconds(state.info);
	const repeats = state.info.RepeatCount;
	// A negative RepeatCount loops forever, as in Roblox.
	const totalTime =
		repeats < 0 ? Number.POSITIVE_INFINITY : cycle * (repeats + 1);
	const done = local >= totalTime;
	const at = done ? totalTime : local;

	// Position inside the current pass, folded back on itself when Reverses.
	const intoCycle = cycle > 0 ? at % cycle || (done ? cycle : 0) : cycle;
	let fraction: number;
	if (state.info.Time <= 0) {
		fraction = 1;
	} else if (state.info.Reverses && intoCycle > state.info.Time) {
		fraction = (cycle - intoCycle) / state.info.Time;
	} else {
		fraction = Math.min(intoCycle / state.info.Time, 1);
	}

	apply(
		state,
		tweenAlpha(
			done && !state.info.Reverses ? 1 : fraction,
			state.info.EasingStyle.Name,
			state.info.EasingDirection.Name,
		),
	);

	if (!done) return true;

	// A reversing tween ends where it started; a one-way tween ends on the goal.
	if (state.info.Reverses) apply(state, 0);
	state.playing = false;
	setPlaybackState(tween, "Completed");
	getEventSignal(tween, "Completed").fire(Enum.PlaybackState.Completed);
	return false;
}

function ensureTicking(): void {
	if (frameConnection) return;
	frameConnection = renderStepped.Connect((dt: number) => {
		for (const tween of [...active]) {
			if (!step(tween, dt)) active.delete(tween);
		}
		if (active.size === 0) {
			frameConnection?.Disconnect();
			frameConnection = undefined;
		}
	});
}

registerClassMethods("Tween", {
	Play: (self: LoomInstance) => {
		const state = states.get(self);
		if (!state || state.playing) return undefined;
		// Roblox samples the starting values when playback begins, so a tween
		// created early and played later animates from wherever the instance is.
		state.from = {};
		for (const key of Object.keys(state.goals)) {
			state.from[key] = state.target[key];
		}
		state.elapsed = 0;
		state.playing = true;
		setPlaybackState(self, "Playing");
		active.add(self);
		ensureTicking();
		return undefined;
	},
	Pause: (self: LoomInstance) => {
		const state = states.get(self);
		if (!state?.playing) return undefined;
		state.playing = false;
		active.delete(self);
		setPlaybackState(self, "Paused");
		return undefined;
	},
	/** Stops without reverting: Roblox leaves the properties mid-flight. */
	Cancel: (self: LoomInstance) => {
		const state = states.get(self);
		if (!state) return undefined;
		state.playing = false;
		state.elapsed = 0;
		active.delete(self);
		setPlaybackState(self, "Cancelled");
		return undefined;
	},
});

// --- TweenService ------------------------------------------------------------

/**
 * Build one `Tween` over `target`. Behind `TweenService:Create` and behind the
 * `GuiObject` tween methods both, so the two cannot drift into animating by
 * different rules.
 */
function createTween(
	target: LoomInstance,
	info: TweenInfo,
	goals: Record<string, unknown>,
): LoomInstance {
	const tween = createInstance("Tween", "Tween");
	setRawProperty(tween, "Instance", target);
	setRawProperty(tween, "TweenInfo", info);
	setPlaybackState(tween, "Begin");
	states.set(tween, {
		target,
		info: info ?? new TweenInfo(),
		goals: goals ?? {},
		from: {},
		elapsed: 0,
		playing: false,
	});
	return tween;
}

registerClassMethods("TweenService", {
	Create: (
		_self: LoomInstance,
		target: LoomInstance,
		info: TweenInfo,
		goals: Record<string, unknown>,
	) => createTween(target, info, goals),
	GetValue: (
		_self: LoomInstance,
		alpha: number,
		style: EnumItem<"EasingStyle">,
		direction: EnumItem<"EasingDirection">,
	) => tweenAlpha(alpha, style?.Name ?? "Quad", direction?.Name ?? "Out"),
});

registerService("TweenService", () =>
	createInstance("TweenService", "TweenService"),
);

// --- GuiObject:TweenPosition / :TweenSize / :TweenSizeAndPosition ------------

/**
 * The tween methods that predate `TweenService`, and that plenty of shipped
 * roblox-ts UI still calls: `frame:TweenPosition(goal, "Out", "Quad", 0.3,
 * true)`. They animate one object's `Position`/`Size` and — unlike a
 * `TweenService` tween, which is an instance you hold — the object owns at most
 * one of them at a time. That ownership is the whole contract: a second call
 * with `override = false` is refused (returns `false`) rather than fighting the
 * first for the same property.
 *
 * They are built on the machinery above rather than beside it, so an old-style
 * tween eases, repeats and steps by exactly the same code a `TweenService` one
 * does.
 */
interface GuiTween {
	readonly tween: LoomInstance;
	readonly callback?: TweenCallback;
}

/**
 * What the engine hands the callback is an `Enum.TweenStatus`
 * (`Completed`/`Canceled`), an enum `enums.ts` does not carry. The nearest true
 * thing loom has is the `Enum.PlaybackState` its own tweens already report, and
 * it says the same two words — so that is what arrives here, and a callback that
 * only compares `.Name` (which is how these are written) cannot tell.
 */
type TweenCallback = (status: EnumItem<"PlaybackState">) => void;

const guiTweens = new WeakMap<LoomInstance, GuiTween>();

/**
 * An `EnumItem` or the bare string spelling of one, which the engine takes
 * wherever it takes the item (`frame:TweenPosition(goal, "Out", "Quad")` is how
 * most of this code is written). Anything that is not an item of `namespace` —
 * a misspelling, or a name that happens to collide with one of the enum's own
 * methods — comes back `undefined` and lets the caller's default stand.
 */
function pickEnumItem<E extends string>(
	namespace: object,
	value: unknown,
): EnumItem<E> | undefined {
	const name = enumName(value);
	if (name === undefined) return undefined;
	const item = (namespace as Record<string, unknown>)[name];
	return item instanceof EnumItem ? (item as EnumItem<E>) : undefined;
}

function stopGuiTween(target: LoomInstance, running: GuiTween): void {
	guiTweens.delete(target);
	(running.tween.Cancel as () => void)();
	// Roblox tells the interrupted callback it was interrupted — a fade-out that
	// cleans up after itself has to hear about being overridden, or it cleans up
	// the object the new tween is animating.
	running.callback?.(Enum.PlaybackState.Cancelled);
}

/**
 * The body of all three methods. Roblox's argument order is
 * `(…goals, easingDirection, easingStyle, time, override, callback)` — note that
 * direction comes *before* style here, the opposite of `TweenInfo.new`.
 */
function startGuiTween(
	self: LoomInstance,
	goals: Record<string, unknown>,
	easingDirection: unknown,
	easingStyle: unknown,
	time: number,
	override: boolean,
	callback?: TweenCallback,
): boolean {
	const running = guiTweens.get(self);
	if (running) {
		if (!override) return false;
		stopGuiTween(self, running);
	}
	const info = new TweenInfo(
		typeof time === "number" ? time : 1,
		pickEnumItem<"EasingStyle">(Enum.EasingStyle, easingStyle) ??
			Enum.EasingStyle.Quad,
		pickEnumItem<"EasingDirection">(Enum.EasingDirection, easingDirection) ??
			Enum.EasingDirection.Out,
	);
	const tween = createTween(self, info, goals);
	const entry: GuiTween = { tween, callback };
	guiTweens.set(self, entry);
	getEventSignal(tween, "Completed").Connect((status) => {
		// Only clear the slot if this tween still owns it: an override already
		// replaced the entry, and must not have it deleted out from under it.
		if (guiTweens.get(self) === entry) guiTweens.delete(self);
		callback?.(status as EnumItem<"PlaybackState">);
	});
	(tween.Play as () => void)();
	return true;
}

registerClassMethods("GuiObject", {
	TweenPosition: (
		self: LoomInstance,
		endPosition: UDim2,
		easingDirection?: EnumItem<"EasingDirection"> | string,
		easingStyle?: EnumItem<"EasingStyle"> | string,
		time = 1,
		override = false,
		callback?: TweenCallback,
	) =>
		startGuiTween(
			self,
			{ Position: endPosition },
			easingDirection,
			easingStyle,
			time,
			override,
			callback,
		),
	TweenSize: (
		self: LoomInstance,
		endSize: UDim2,
		easingDirection?: EnumItem<"EasingDirection"> | string,
		easingStyle?: EnumItem<"EasingStyle"> | string,
		time = 1,
		override = false,
		callback?: TweenCallback,
	) =>
		startGuiTween(
			self,
			{ Size: endSize },
			easingDirection,
			easingStyle,
			time,
			override,
			callback,
		),
	/** Size first, then position — the engine's own argument order. */
	TweenSizeAndPosition: (
		self: LoomInstance,
		endSize: UDim2,
		endPosition: UDim2,
		easingDirection?: EnumItem<"EasingDirection"> | string,
		easingStyle?: EnumItem<"EasingStyle"> | string,
		time = 1,
		override = false,
		callback?: TweenCallback,
	) =>
		startGuiTween(
			self,
			{ Size: endSize, Position: endPosition },
			easingDirection,
			easingStyle,
			time,
			override,
			callback,
		),
});

/** Test seam: how many tweens are currently being stepped. */
export function getActiveTweenCount(): number {
	return active.size;
}
