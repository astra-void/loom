import {
	serializeUDim,
	serializeUDim2,
	serializeVector2,
} from "../internal/robloxValues";
import { subscribeToFrames } from "./frameScheduler";
import { Color3, UDim, UDim2, Vector2 } from "./helpers";

const ACTIVE_TWEENS_KEY = Symbol.for("loom-dev.preview-runtime.activeTweens");
const TWEEN_EPSILON = 1e-6;

type TweenDirection = "forward" | "reverse";

type ActiveTweenRegistry = WeakMap<object, Map<string, PreviewTweenControllerImpl>>;

type InterpolatedPropertyPlan =
	| {
			endValue: unknown;
			interpolate(alpha: number): unknown;
			kind: "interpolate";
			startValue: unknown;
	  }
	| {
			endValue: unknown;
			kind: "snap";
			startValue: unknown;
	  };

export type PreviewTweenInfoLike = {
	readonly DelayTime: number;
	readonly EasingDirection: unknown;
	readonly EasingStyle: unknown;
	readonly RepeatCount: number;
	readonly Reverses: boolean;
	readonly Time: number;
};

export type PreviewTweenPlaybackStates = {
	readonly Begin: unknown;
	readonly Cancelled: unknown;
	readonly Completed: unknown;
	readonly Delayed: unknown;
	readonly Paused: unknown;
	readonly Playing: unknown;
};

export type PreviewTweenController = {
	readonly playbackState: unknown;
	cancel(): void;
	destroy(): void;
	pause(): void;
	play(): void;
};

type PreviewTweenControllerOptions = {
	goal: Record<string, unknown>;
	instance: unknown;
	onCompleted(playbackState: unknown): void;
	playbackStates: PreviewTweenPlaybackStates;
	tweenInfo: PreviewTweenInfoLike;
};

type GlobalTweenRegistry = typeof globalThis & {
	[ACTIVE_TWEENS_KEY]?: ActiveTweenRegistry;
};

function getActiveTweenRegistry() {
	const globalRecord = globalThis as GlobalTweenRegistry;
	if (!globalRecord[ACTIVE_TWEENS_KEY]) {
		globalRecord[ACTIVE_TWEENS_KEY] = new WeakMap();
	}

	return globalRecord[ACTIVE_TWEENS_KEY];
}

function isObjectLike(value: unknown): value is object {
	return (
		(typeof value === "object" && value !== null) || typeof value === "function"
	);
}

function clamp01(value: number) {
	return Math.max(0, Math.min(1, value));
}

function toFiniteNumber(value: unknown, fallback = 0) {
	const numeric = Number(value);
	return Number.isFinite(numeric) ? numeric : fallback;
}

function toEnumName(value: unknown) {
	const label = String(value);
	const segments = label.split(".");
	return segments[segments.length - 1] ?? label;
}

function easeLinear(value: number) {
	return value;
}

function easeSine(value: number) {
	return 1 - Math.cos((value * Math.PI) / 2);
}

function easePower(value: number, exponent: number) {
	return value ** exponent;
}

function easeBack(value: number) {
	const overshoot = 1.70158;
	return value * value * ((overshoot + 1) * value - overshoot);
}

function easeCircular(value: number) {
	return 1 - Math.sqrt(1 - value * value);
}

function easeExponential(value: number) {
	if (value === 0) {
		return 0;
	}

	return 2 ** (10 * value - 10);
}

function easeElastic(value: number) {
	if (value === 0 || value === 1) {
		return value;
	}

	const c4 = (2 * Math.PI) / 3;
	return -(2 ** (10 * value - 10)) * Math.sin((value * 10 - 10.75) * c4);
}

function easeBounceOut(value: number) {
	const n1 = 7.5625;
	const d1 = 2.75;

	if (value < 1 / d1) {
		return n1 * value * value;
	}

	if (value < 2 / d1) {
		const next = value - 1.5 / d1;
		return n1 * next * next + 0.75;
	}

	if (value < 2.5 / d1) {
		const next = value - 2.25 / d1;
		return n1 * next * next + 0.9375;
	}

	const next = value - 2.625 / d1;
	return n1 * next * next + 0.984375;
}

function easeBounce(value: number) {
	return 1 - easeBounceOut(1 - value);
}

function resolveEaseIn(style: unknown) {
	switch (toEnumName(style)) {
		case "Back":
			return easeBack;
		case "Bounce":
			return easeBounce;
		case "Circular":
			return easeCircular;
		case "Cubic":
			return (value: number) => easePower(value, 3);
		case "Elastic":
			return easeElastic;
		case "Exponential":
			return easeExponential;
		case "Linear":
			return easeLinear;
		case "Quart":
			return (value: number) => easePower(value, 4);
		case "Quint":
			return (value: number) => easePower(value, 5);
		case "Sine":
			return easeSine;
		case "Quad":
		default:
			return (value: number) => easePower(value, 2);
	}
}

function applyEasingDirection(
	progress: number,
	easingStyle: unknown,
	easingDirection: unknown,
) {
	const normalized = clamp01(progress);
	const easeIn = resolveEaseIn(easingStyle);

	switch (toEnumName(easingDirection)) {
		case "In":
			return easeIn(normalized);
		case "InOut":
			if (normalized < 0.5) {
				return easeIn(normalized * 2) / 2;
			}
			return 1 - easeIn((1 - normalized) * 2) / 2;
		case "Out":
		default:
			return 1 - easeIn(1 - normalized);
	}
}

function isColor3Like(value: unknown): value is {
	B: number;
	G: number;
	R: number;
} {
	if (!value || typeof value !== "object") {
		return false;
	}

	const record = value as { B?: unknown; G?: unknown; R?: unknown };
	return (
		typeof record.R === "number" &&
		typeof record.G === "number" &&
		typeof record.B === "number"
	);
}

function isUDimLike(value: unknown) {
	if (value instanceof UDim) {
		return true;
	}

	if (Array.isArray(value)) {
		return value.length >= 2 && !Array.isArray(value[0]) && !Array.isArray(value[1]);
	}

	if (!value || typeof value !== "object") {
		return false;
	}

	const record = value as {
		Offset?: unknown;
		Scale?: unknown;
		offset?: unknown;
		scale?: unknown;
	};
	return (
		record.Offset !== undefined ||
		record.offset !== undefined ||
		record.Scale !== undefined ||
		record.scale !== undefined
	);
}

function isUDim2Like(value: unknown) {
	if (value instanceof UDim2) {
		return true;
	}

	if (Array.isArray(value)) {
		if (value.length >= 4) {
			return true;
		}

		return value.length >= 2 && isUDimLike(value[0]) && isUDimLike(value[1]);
	}

	if (!value || typeof value !== "object") {
		return false;
	}

	const record = value as {
		X?: unknown;
		Y?: unknown;
		x?: unknown;
		y?: unknown;
	};
	const nextX = record.X ?? record.x;
	const nextY = record.Y ?? record.y;
	return isUDimLike(nextX) && isUDimLike(nextY);
}

function isVector2Like(value: unknown) {
	if (value instanceof Vector2) {
		return true;
	}

	if (Array.isArray(value)) {
		return value.length >= 2;
	}

	if (!value || typeof value !== "object") {
		return false;
	}

	const record = value as { X?: unknown; Y?: unknown; x?: unknown; y?: unknown };
	return (
		typeof (record.X ?? record.x) === "number" &&
		typeof (record.Y ?? record.y) === "number"
	);
}

function createPropertyPlan(
	startValue: unknown,
	endValue: unknown,
): InterpolatedPropertyPlan {
	if (typeof startValue === "number" && typeof endValue === "number") {
		return {
			endValue,
			interpolate(alpha) {
				return startValue + (endValue - startValue) * alpha;
			},
			kind: "interpolate",
			startValue,
		};
	}

	if (isColor3Like(startValue) && isColor3Like(endValue)) {
		return {
			endValue,
			interpolate(alpha) {
				return new Color3(
					startValue.R + (endValue.R - startValue.R) * alpha,
					startValue.G + (endValue.G - startValue.G) * alpha,
					startValue.B + (endValue.B - startValue.B) * alpha,
				);
			},
			kind: "interpolate",
			startValue,
		};
	}

	if (isUDim2Like(startValue) && isUDim2Like(endValue)) {
		const start = serializeUDim2(startValue);
		const end = serializeUDim2(endValue);
		if (start && end) {
			return {
				endValue,
				interpolate(alpha) {
					return new UDim2(
						start.X.Scale + (end.X.Scale - start.X.Scale) * alpha,
						start.X.Offset + (end.X.Offset - start.X.Offset) * alpha,
						start.Y.Scale + (end.Y.Scale - start.Y.Scale) * alpha,
						start.Y.Offset + (end.Y.Offset - start.Y.Offset) * alpha,
					);
				},
				kind: "interpolate",
				startValue,
			};
		}
	}

	if (isUDimLike(startValue) && isUDimLike(endValue)) {
		const start = serializeUDim(startValue);
		const end = serializeUDim(endValue);
		return {
			endValue,
			interpolate(alpha) {
				return new UDim(
					start.Scale + (end.Scale - start.Scale) * alpha,
					start.Offset + (end.Offset - start.Offset) * alpha,
				);
			},
			kind: "interpolate",
			startValue,
		};
	}

	if (isVector2Like(startValue) && isVector2Like(endValue)) {
		const start = serializeVector2(startValue);
		const end = serializeVector2(endValue);
		return {
			endValue,
			interpolate(alpha) {
				return new Vector2(
					start.X + (end.X - start.X) * alpha,
					start.Y + (end.Y - start.Y) * alpha,
				);
			},
			kind: "interpolate",
			startValue,
		};
	}

	return {
		endValue,
		kind: "snap",
		startValue,
	};
}

class PreviewTweenControllerImpl implements PreviewTweenController {
	private completedForwardPass = 0;
	private delayRemaining = 0;
	private destroyed = false;
	private frameUnsubscribe: (() => void) | undefined = undefined;
	private legDirection: TweenDirection = "forward";
	private legElapsed = 0;
	private plans = new Map<string, InterpolatedPropertyPlan>();
	private preparedRun = false;
	private readonly reservedProperties = new Set<string>();

	public constructor(private readonly options: PreviewTweenControllerOptions) {}

	public get playbackState() {
		return this.state;
	}

	private state = this.options.playbackStates.Begin;

	public cancel() {
		if (this.destroyed || this.isTerminal()) {
			return;
		}

		if (!this.preparedRun) {
			this.state = this.options.playbackStates.Cancelled;
			this.stopFrameLoop();
			return;
		}

		this.finishCancelled(true);
	}

	public destroy() {
		if (this.destroyed) {
			return;
		}

		this.destroyed = true;
		this.preparedRun = false;
		this.stopFrameLoop();
		this.releaseReservations();
		if (this.state !== this.options.playbackStates.Completed) {
			this.state = this.options.playbackStates.Cancelled;
		}
	}

	public pause() {
		if (this.destroyed || this.isTerminal()) {
			return;
		}

		if (!this.preparedRun) {
			this.state = this.options.playbackStates.Paused;
			return;
		}

		if (
			this.state !== this.options.playbackStates.Playing &&
			this.state !== this.options.playbackStates.Delayed
		) {
			return;
		}

		this.state = this.options.playbackStates.Paused;
		this.stopFrameLoop();
	}

	public play() {
		if (this.destroyed || this.state === this.options.playbackStates.Playing) {
			return;
		}

		if (this.state === this.options.playbackStates.Paused && this.preparedRun) {
			if (this.delayRemaining > TWEEN_EPSILON) {
				this.state = this.options.playbackStates.Delayed;
			} else if (this.getDuration() <= TWEEN_EPSILON) {
				this.finishFiniteZeroDurationRun();
				return;
			} else {
				this.state = this.options.playbackStates.Playing;
			}

			this.ensureFrameLoop();
			return;
		}

		this.prepareFreshRun();
	}

	private applyInterpolatedAlpha(alpha: number) {
		for (const [property, plan] of this.plans.entries()) {
			if (plan.kind !== "interpolate") {
				continue;
			}

			this.writeProperty(property, plan.interpolate(alpha));
		}
	}

	private applyTerminalState(alpha: number) {
		this.applyInterpolatedAlpha(alpha);

		for (const [property, plan] of this.plans.entries()) {
			if (plan.kind !== "snap") {
				continue;
			}

			this.writeProperty(property, alpha >= 0.5 ? plan.endValue : plan.startValue);
		}
	}

	private completeCurrentLeg() {
		if (this.legDirection === "forward") {
			this.applyInterpolatedAlpha(1);
			if (this.options.tweenInfo.Reverses) {
				this.legDirection = "reverse";
				this.legElapsed = 0;
				return;
			}

			if (this.shouldRepeat()) {
				this.completedForwardPass += 1;
				this.legElapsed = 0;
				this.applyInterpolatedAlpha(0);
				return;
			}

			this.finishCompleted(1);
			return;
		}

		this.applyInterpolatedAlpha(0);
		if (this.shouldRepeat()) {
			this.completedForwardPass += 1;
			this.legDirection = "forward";
			this.legElapsed = 0;
			return;
		}

		this.finishCompleted(0);
	}

	private ensureFrameLoop() {
		if (this.frameUnsubscribe || this.destroyed) {
			return;
		}

		this.frameUnsubscribe = subscribeToFrames(({ deltaTime }) => {
			this.advance(deltaTime);
		});
	}

	private finishCancelled(notify: boolean) {
		this.stopFrameLoop();
		this.releaseReservations();
		this.state = this.options.playbackStates.Cancelled;
		this.preparedRun = false;
		if (notify) {
			this.options.onCompleted(this.options.playbackStates.Cancelled);
		}
	}

	private finishCompleted(finalAlpha: number) {
		this.applyTerminalState(finalAlpha);
		this.stopFrameLoop();
		this.releaseReservations();
		this.state = this.options.playbackStates.Completed;
		this.preparedRun = false;
		this.options.onCompleted(this.options.playbackStates.Completed);
	}

	private finishFiniteZeroDurationRun() {
		if (this.options.tweenInfo.RepeatCount < 0) {
			this.applyTerminalState(1);
			this.state = this.options.playbackStates.Completed;
			this.preparedRun = false;
			this.releaseReservations();
			this.options.onCompleted(this.options.playbackStates.Completed);
			return;
		}

		const finalAlpha = this.options.tweenInfo.Reverses ? 0 : 1;
		this.finishCompleted(finalAlpha);
	}

	private getDuration() {
		return Math.max(0, toFiniteNumber(this.options.tweenInfo.Time, 0));
	}

	private isTerminal() {
		return (
			this.state === this.options.playbackStates.Cancelled ||
			this.state === this.options.playbackStates.Completed
		);
	}

	private prepareFreshRun() {
		this.stopFrameLoop();
		this.releaseReservations();
		this.reserveProperties();
		this.capturePropertyPlans();
		this.completedForwardPass = 0;
		this.delayRemaining = Math.max(
			0,
			toFiniteNumber(this.options.tweenInfo.DelayTime, 0),
		);
		this.legDirection = "forward";
		this.legElapsed = 0;
		this.preparedRun = true;

		if (this.delayRemaining > TWEEN_EPSILON) {
			this.state = this.options.playbackStates.Delayed;
			this.ensureFrameLoop();
			return;
		}

		if (this.getDuration() <= TWEEN_EPSILON) {
			this.finishFiniteZeroDurationRun();
			return;
		}

		this.state = this.options.playbackStates.Playing;
		this.ensureFrameLoop();
	}

	private capturePropertyPlans() {
		this.plans.clear();

		for (const [property, value] of Object.entries(this.options.goal)) {
			this.plans.set(property, createPropertyPlan(this.readProperty(property), value));
		}
	}

	private readProperty(property: string) {
		if (!isObjectLike(this.options.instance)) {
			return undefined;
		}

		return Reflect.get(this.options.instance, property);
	}

	private releaseReservations() {
		if (!isObjectLike(this.options.instance)) {
			this.reservedProperties.clear();
			return;
		}

		const registry = getActiveTweenRegistry();
		const activeProperties = registry.get(this.options.instance);
		if (!activeProperties) {
			this.reservedProperties.clear();
			return;
		}

		for (const property of this.reservedProperties) {
			if (activeProperties.get(property) === this) {
				activeProperties.delete(property);
			}
		}

		if (activeProperties.size === 0) {
			registry.delete(this.options.instance);
		}

		this.reservedProperties.clear();
	}

	private reserveProperties() {
		if (!isObjectLike(this.options.instance)) {
			return;
		}

		const registry = getActiveTweenRegistry();
		let activeProperties = registry.get(this.options.instance);
		if (!activeProperties) {
			activeProperties = new Map();
			registry.set(this.options.instance, activeProperties);
		}

		for (const property of Object.keys(this.options.goal)) {
			const existing = activeProperties.get(property);
			if (existing && existing !== this) {
				existing.cancel();
			}

			activeProperties.set(property, this);
			this.reservedProperties.add(property);
		}
	}

	private shouldRepeat() {
		return (
			this.options.tweenInfo.RepeatCount < 0 ||
			this.completedForwardPass < this.options.tweenInfo.RepeatCount
		);
	}

	private stopFrameLoop() {
		if (!this.frameUnsubscribe) {
			return;
		}

		this.frameUnsubscribe();
		this.frameUnsubscribe = undefined;
	}

	private updatePlayingState(progress: number) {
		const eased = applyEasingDirection(
			progress,
			this.options.tweenInfo.EasingStyle,
			this.options.tweenInfo.EasingDirection,
		);
		const alpha = this.legDirection === "forward" ? eased : 1 - eased;
		this.applyInterpolatedAlpha(alpha);
	}

	private writeProperty(property: string, value: unknown) {
		if (!isObjectLike(this.options.instance)) {
			return;
		}

		Reflect.set(this.options.instance, property, value);
	}

	private advance(deltaTime: number) {
		if (this.destroyed || !this.preparedRun) {
			return;
		}

		let remaining = Math.max(0, deltaTime);

		if (this.state === this.options.playbackStates.Delayed) {
			if (this.delayRemaining > remaining + TWEEN_EPSILON) {
				this.delayRemaining -= remaining;
				return;
			}

			remaining = Math.max(0, remaining - this.delayRemaining);
			this.delayRemaining = 0;

			if (this.getDuration() <= TWEEN_EPSILON) {
				this.finishFiniteZeroDurationRun();
				return;
			}

			this.state = this.options.playbackStates.Playing;
			if (remaining <= TWEEN_EPSILON) {
				return;
			}
		}

		if (this.state !== this.options.playbackStates.Playing) {
			return;
		}

		const duration = this.getDuration();
		while (
			remaining >= 0 &&
			this.state === this.options.playbackStates.Playing &&
			!this.destroyed
		) {
			const timeLeft = Math.max(0, duration - this.legElapsed);
			const step = Math.min(remaining, timeLeft);
			this.legElapsed += step;
			remaining -= step;

			this.updatePlayingState(
				duration <= TWEEN_EPSILON ? 1 : clamp01(this.legElapsed / duration),
			);

			if (this.legElapsed + TWEEN_EPSILON < duration) {
				return;
			}

			this.completeCurrentLeg();
		}
	}
}

export function createPreviewTweenController(
	options: PreviewTweenControllerOptions,
): PreviewTweenController {
	return new PreviewTweenControllerImpl(options);
}

export function destroyTweensForTarget(target: unknown) {
	if (!isObjectLike(target)) {
		return;
	}

	const registry = getActiveTweenRegistry();
	const activeProperties = registry.get(target);
	if (!activeProperties) {
		return;
	}

	const controllers = new Set(activeProperties.values());
	for (const controller of controllers) {
		controller.destroy();
	}
}
