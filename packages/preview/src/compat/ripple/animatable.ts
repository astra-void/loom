/**
 * The animatable-value layer of loom's Ripple compatibility: what it means to
 * add, scale and interpolate a Roblox datatype.
 *
 * Ripple never animates a datatype directly. It *encodes* one into a flat list
 * of numeric components, runs the spring or tween math on those, and decodes a
 * fresh datatype back out — which is why a `UDim2` spring behaves like four
 * independent springs and never accidentally aliases the caller's value. This
 * is the same design, with Luau's 3-wide `vector` components flattened to plain
 * numbers (the math is component-wise, so the two are equivalent).
 *
 * Ported from `@rbxts/ripple`'s `utils/intermediate.luau`, `utils/interpolate.luau`
 * and `utils/merge.luau`.
 */
import {
	CFrame,
	Color3,
	Rect,
	UDim,
	UDim2,
	Vector2,
	Vector3,
} from "@loom-dev/runtime";
import { fromSRGB, toSRGB } from "./oklab.ts";

/** Scalar-ish animatable values. (Luau's native `vector` has no browser peer.) */
export type AnimatablePrimitive = number | Vector3;

/** The Roblox datatypes loom's Ripple compatibility can animate. */
export type AnimatableType =
	| AnimatablePrimitive
	| Vector2
	| CFrame
	| Color3
	| UDim
	| UDim2
	| Rect;

/** A record of numbers animates key-wise, like Ripple's table values. */
export type NumberRecord = Record<string, number>;

/** Anything a controller can hold. */
export type Animatable = AnimatableType | NumberRecord;

/** What `setGoal` accepts: whole datatypes, or a subset of a record's keys. */
export type PartialGoal<T extends Animatable> = T extends AnimatableType
	? T
	: Partial<T>;

/** Prefix every diagnostic so an unsupported value is traceable to loom. */
const PREFIX = "[loom] Ripple compatibility";

/** Read a component, treating a short list as zero-padded. */
function at(components: readonly number[], index: number): number {
	return components[index] ?? 0;
}

function isRecord(value: unknown): value is NumberRecord {
	return (
		typeof value === "object" &&
		value !== null &&
		Object.getPrototypeOf(value) === Object.prototype
	);
}

/** A datatype's name, for error messages. */
function typeNameOf(value: unknown): string {
	if (value === null) return "null";
	if (typeof value !== "object") return typeof value;
	return (value.constructor as { name?: string } | undefined)?.name ?? "object";
}

/** Roblox `UDim.Offset` is an integer, so every decoded offset rounds. */
function lerpOffset(from: number, to: number, alpha: number): number {
	return Math.round(from + (to - from) * alpha);
}

/**
 * How one shape of value converts to and from components. Record codecs are
 * per-value (they close over the key list captured when the controller was
 * created), which is why this is produced by {@link codecFor} rather than
 * looked up in a table.
 */
export interface Codec<T> {
	encode(value: T, into: number[]): void;
	decode(components: readonly number[]): T;
}

const numberCodec: Codec<number> = {
	encode(value, into) {
		into[0] = value;
	},
	decode: (components) => at(components, 0),
};

const vector2Codec: Codec<Vector2> = {
	encode(value, into) {
		into[0] = value.X;
		into[1] = value.Y;
	},
	decode: (c) => new Vector2(at(c, 0), at(c, 1)),
};

const vector3Codec: Codec<Vector3> = {
	encode(value, into) {
		into[0] = value.X;
		into[1] = value.Y;
		into[2] = value.Z;
	},
	decode: (c) => new Vector3(at(c, 0), at(c, 1), at(c, 2)),
};

// Colors travel through Oklab so a spring between two hues stays perceptually
// even, exactly as in Ripple. Decoding clamps at zero (the transform can
// overshoot below black) but not at one, matching upstream.
const color3Codec: Codec<Color3> = {
	encode(value, into) {
		const [l, a, b] = fromSRGB([value.R, value.G, value.B]);
		into[0] = l;
		into[1] = a;
		into[2] = b;
	},
	decode(c) {
		const [r, g, b] = toSRGB([at(c, 0), at(c, 1), at(c, 2)]);
		return new Color3(Math.max(r, 0), Math.max(g, 0), Math.max(b, 0));
	},
};

const udimCodec: Codec<UDim> = {
	encode(value, into) {
		into[0] = value.Scale;
		into[1] = value.Offset;
	},
	decode: (c) => new UDim(at(c, 0), Math.round(at(c, 1))),
};

const udim2Codec: Codec<UDim2> = {
	encode(value, into) {
		into[0] = value.X.Scale;
		into[1] = value.X.Offset;
		into[2] = value.Y.Scale;
		into[3] = value.Y.Offset;
	},
	decode: (c) =>
		UDim2.new(at(c, 0), Math.round(at(c, 1)), at(c, 2), Math.round(at(c, 3))),
};

// Ripple's encoding: the position and the three basis columns, each animated
// as its own vector. The basis drifts off orthonormal mid-spring, so decoding
// rebuilds through `fromMatrix` and orthonormalizes, exactly as upstream.
const cframeCodec: Codec<CFrame> = {
	encode(value, into) {
		const vectors = [
			value.Position,
			value.XVector,
			value.YVector,
			value.ZVector,
		];
		vectors.forEach((vector, index) => {
			into[index * 3] = vector.X;
			into[index * 3 + 1] = vector.Y;
			into[index * 3 + 2] = vector.Z;
		});
	},
	decode(c) {
		const vector = (index: number) =>
			new Vector3(at(c, index * 3), at(c, index * 3 + 1), at(c, index * 3 + 2));
		return CFrame.fromMatrix(
			vector(0),
			vector(1),
			vector(2),
			vector(3),
		).Orthonormalize();
	},
};

const rectCodec: Codec<Rect> = {
	encode(value, into) {
		into[0] = value.Min.X;
		into[1] = value.Min.Y;
		into[2] = value.Max.X;
		into[3] = value.Max.Y;
	},
	decode: (c) => Rect.new(at(c, 0), at(c, 1), at(c, 2), at(c, 3)),
};

/** Record codec over a fixed key list: keys absent from a goal never move. */
function recordCodec(keys: readonly string[]): Codec<NumberRecord> {
	return {
		encode(value, into) {
			keys.forEach((key, index) => {
				into[index] = value[key] ?? 0;
			});
		},
		decode(components) {
			const value: NumberRecord = {};
			keys.forEach((key, index) => {
				value[key] = at(components, index);
			});
			return value;
		},
	};
}

/**
 * The codec for a value's shape. Throws — loudly, and naming the datatype —
 * rather than animating something it would get wrong: a silently frozen or
 * corrupted value is far harder to diagnose than a thrown error.
 */
export function codecFor<T extends Animatable>(value: T): Codec<T> {
	if (typeof value === "number") return numberCodec as Codec<T>;
	if (value instanceof Vector2) return vector2Codec as Codec<T>;
	if (value instanceof Vector3) return vector3Codec as Codec<T>;
	if (value instanceof Color3) return color3Codec as Codec<T>;
	if (value instanceof UDim2) return udim2Codec as Codec<T>;
	if (value instanceof UDim) return udimCodec as Codec<T>;
	if (value instanceof Rect) return rectCodec as Codec<T>;
	if (value instanceof CFrame) return cframeCodec as Codec<T>;
	if (isRecord(value)) {
		for (const [key, entry] of Object.entries(value)) {
			if (typeof entry !== "number") {
				throw new Error(
					`${PREFIX} can only animate records of numbers — ` +
						`key "${key}" is a ${typeNameOf(entry)}`,
				);
			}
		}
		return recordCodec(Object.keys(value)) as Codec<T>;
	}
	throw new Error(`${PREFIX} cannot animate a ${typeNameOf(value)} value`);
}

/**
 * Roblox datatype equality is by value, not identity (`UDim2.new(0,4,0,4)`
 * equals another one). JS class instances are compared by reference, so this
 * restores the semantics Ripple's `~=` checks rely on — without it, a component
 * that calls `setGoal` with a freshly built `UDim2` each render would restart
 * its tween every time.
 */
export function sameValue(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (a instanceof Vector2 && b instanceof Vector2) {
		return a.X === b.X && a.Y === b.Y;
	}
	if (a instanceof Vector3 && b instanceof Vector3) {
		return a.X === b.X && a.Y === b.Y && a.Z === b.Z;
	}
	if (a instanceof Color3 && b instanceof Color3) {
		return a.R === b.R && a.G === b.G && a.B === b.B;
	}
	if (a instanceof UDim && b instanceof UDim) {
		return a.Scale === b.Scale && a.Offset === b.Offset;
	}
	if (a instanceof UDim2 && b instanceof UDim2) {
		return sameValue(a.X, b.X) && sameValue(a.Y, b.Y);
	}
	if (a instanceof Rect && b instanceof Rect) {
		return sameValue(a.Min, b.Min) && sameValue(a.Max, b.Max);
	}
	if (a instanceof CFrame && b instanceof CFrame) {
		const bc = b.GetComponents();
		return a.GetComponents().every((value, index) => value === bc[index]);
	}
	if (isRecord(a) && isRecord(b)) {
		const keys = Object.keys(a);
		if (keys.length !== Object.keys(b).length) return false;
		return keys.every((key) => a[key] === b[key]);
	}
	return false;
}

/**
 * Overlay `source` onto `target`, returning `target` itself when nothing
 * differs — the identity check callers use to skip a no-op update.
 */
export function merge(
	target: NumberRecord,
	source: Partial<NumberRecord>,
): NumberRecord {
	let result = target;
	for (const [key, value] of Object.entries(source)) {
		if (value === undefined || target[key] === value) continue;
		if (result === target) result = { ...target };
		result[key] = value;
	}
	return result;
}

/** Apply a partial goal to a whole value (records merge; datatypes replace). */
export function applyPartial<T extends Animatable>(
	current: T,
	next: PartialGoal<T>,
): T {
	if (isRecord(current) && isRecord(next)) {
		return merge(current, next) as T;
	}
	return next as T;
}

// --- the intermediate ---------------------------------------------------------

/**
 * A value plus its component form. The decoded value is cached and only
 * recomputed once the components have actually moved (`dirty`), so a spring at
 * rest allocates nothing per frame.
 */
export interface Intermediate<T extends Animatable> {
	components: number[];
	value: T;
	dirty: boolean;
	readonly codec: Codec<T>;
}

export function createIntermediate<T extends Animatable>(
	value: T,
): Intermediate<T> {
	const codec = codecFor(value);
	const components: number[] = [];
	codec.encode(value, components);
	return { components, value, dirty: false, codec };
}

export function copyIntermediate<T extends Animatable>(
	source: Intermediate<T>,
): Intermediate<T> {
	return {
		components: [...source.components],
		value: source.value,
		dirty: source.dirty,
		codec: source.codec,
	};
}

/** Zero every component in place (velocity reset). */
export function zeroIntermediate<T extends Animatable>(
	intermediate: Intermediate<T>,
): Intermediate<T> {
	intermediate.components = intermediate.components.map(() => 0);
	intermediate.dirty = true;
	return intermediate;
}

/** Decode the components and refresh the cached value. */
export function recomputeValue<T extends Animatable>(
	intermediate: Intermediate<T>,
): T {
	intermediate.value = intermediate.codec.decode(intermediate.components);
	intermediate.dirty = false;
	return intermediate.value;
}

/** The current value, decoding first only if the components moved. */
export function getValue<T extends Animatable>(
	intermediate: Intermediate<T>,
): T {
	return intermediate.dirty ? recomputeValue(intermediate) : intermediate.value;
}

/** Set the value (partial records merge). Returns whether anything changed. */
export function setValue<T extends Animatable>(
	intermediate: Intermediate<T>,
	value: PartialGoal<T>,
): boolean {
	const current = getValue(intermediate);
	const next = applyPartial(current, value);
	if (sameValue(next, current)) return false;
	intermediate.codec.encode(next, intermediate.components);
	intermediate.value = next;
	intermediate.dirty = false;
	return true;
}

/** Add a value's components to this one's (impulse). */
export function addValue<T extends Animatable>(
	intermediate: Intermediate<T>,
	value: PartialGoal<T>,
): void {
	const delta: number[] = [];
	// The impulse is encoded on its own, not merged onto the current value: a
	// partial record contributes 0 for the keys it omits, so their components
	// stay put — the same as Ripple's sparse component write.
	intermediate.codec.encode(value as T, delta);
	intermediate.components = intermediate.components.map(
		(component, index) => component + at(delta, index),
	);
	intermediate.dirty = true;
}

/** Copy `source`'s components and value into `target`. */
export function assignIntermediate<T extends Animatable>(
	target: Intermediate<T>,
	source: Intermediate<T>,
): void {
	target.components = [...source.components];
	target.value = getValue(source);
	target.dirty = false;
}

// --- tween interpolation ------------------------------------------------------

/**
 * Interpolate two values of the same shape. Tweens work on values rather than
 * components (Ripple does the same), so datatypes are rebuilt through their own
 * constructors — never by mutating or aliasing an input.
 */
export function interpolate<T extends Animatable>(
	from: T,
	to: T,
	alpha: number,
): T {
	if (typeof from === "number" && typeof to === "number") {
		return (from + (to - from) * alpha) as T;
	}
	if (from instanceof Vector2 && to instanceof Vector2) {
		return new Vector2(
			from.X + (to.X - from.X) * alpha,
			from.Y + (to.Y - from.Y) * alpha,
		) as T;
	}
	if (from instanceof Vector3 && to instanceof Vector3) {
		return new Vector3(
			from.X + (to.X - from.X) * alpha,
			from.Y + (to.Y - from.Y) * alpha,
			from.Z + (to.Z - from.Z) * alpha,
		) as T;
	}
	if (from instanceof Color3 && to instanceof Color3) {
		const a = fromSRGB([from.R, from.G, from.B]);
		const b = fromSRGB([to.R, to.G, to.B]);
		const [r, g, bl] = toSRGB([
			a[0] + (b[0] - a[0]) * alpha,
			a[1] + (b[1] - a[1]) * alpha,
			a[2] + (b[2] - a[2]) * alpha,
		]);
		return new Color3(Math.max(r, 0), Math.max(g, 0), Math.max(bl, 0)) as T;
	}
	if (from instanceof UDim && to instanceof UDim) {
		return new UDim(
			from.Scale + (to.Scale - from.Scale) * alpha,
			lerpOffset(from.Offset, to.Offset, alpha),
		) as T;
	}
	if (from instanceof UDim2 && to instanceof UDim2) {
		return UDim2.new(
			from.X.Scale + (to.X.Scale - from.X.Scale) * alpha,
			lerpOffset(from.X.Offset, to.X.Offset, alpha),
			from.Y.Scale + (to.Y.Scale - from.Y.Scale) * alpha,
			lerpOffset(from.Y.Offset, to.Y.Offset, alpha),
		) as T;
	}
	if (from instanceof CFrame && to instanceof CFrame) {
		// Ripple tweens a CFrame through `from:Lerp(to, alpha)`: the rotation
		// slerps rather than moving component-wise.
		return from.Lerp(to, alpha) as T;
	}
	if (from instanceof Rect && to instanceof Rect) {
		return Rect.new(
			from.Min.X + (to.Min.X - from.Min.X) * alpha,
			from.Min.Y + (to.Min.Y - from.Min.Y) * alpha,
			from.Max.X + (to.Max.X - from.Max.X) * alpha,
			from.Max.Y + (to.Max.Y - from.Max.Y) * alpha,
		) as T;
	}
	if (isRecord(from) && isRecord(to)) {
		// Keys the source doesn't have can't be interpolated — Ripple skips them.
		let result: NumberRecord = from;
		for (const [key, target] of Object.entries(to)) {
			const start = from[key];
			if (start === undefined) continue;
			const value = start + (target - start) * alpha;
			if (result[key] === value) continue;
			if (result === from) result = { ...from };
			result[key] = value;
		}
		return result as T;
	}
	throw new Error(
		`${PREFIX} cannot interpolate ${typeNameOf(from)} with ${typeNameOf(to)}`,
	);
}
