/**
 * `luau.ts` — the Luau global environment roblox-ts output expects.
 *
 * `typeIs`/`typeOf`, `pcall` (array-tuple `[ok, ...results]`), `pairs`/`ipairs`
 * generators, `math`/`string`/`os` libraries, an inert `coroutine`, the `task`
 * scheduler (with cancelable `task.delay`), and the guarded prototype patches
 * roblox-ts macro methods compile to (`Array.prototype.size()`, `.remove()`,
 * `String.prototype.size()`). `installGlobals` in `index.ts` wires all of this
 * onto `globalThis` before preview app code runs.
 */
import {
	CFrame,
	Color3,
	ColorSequence,
	ColorSequenceKeypoint,
	Rect,
	TweenInfo,
	UDim,
	UDim2,
	Vector2,
	Vector3,
} from "./datatypes";
import { EnumItem } from "./enums";
import { isLoomInstance } from "./instance";

// --- type reflection ---------------------------------------------------------

/** Luau `typeof()` — recognizes loom datatypes, enum items, and instances. */
export function typeOf(value: unknown): string {
	if (value === undefined || value === null) return "nil";
	if (isLoomInstance(value)) return "Instance";
	if (value instanceof UDim) return "UDim";
	if (value instanceof UDim2) return "UDim2";
	if (value instanceof Vector2) return "Vector2";
	if (value instanceof Vector3) return "Vector3";
	if (value instanceof Color3) return "Color3";
	if (value instanceof ColorSequence) return "ColorSequence";
	if (value instanceof ColorSequenceKeypoint) return "ColorSequenceKeypoint";
	if (value instanceof Rect) return "Rect";
	if (value instanceof CFrame) return "CFrame";
	if (value instanceof TweenInfo) return "TweenInfo";
	if (value instanceof EnumItem) return "EnumItem";
	const t = typeof value;
	if (t === "object") return "table";
	return t; // "string" | "number" | "boolean" | "function" | …
}

/** roblox-ts `typeIs(value, "Vector2")` type guard. */
export function typeIs(value: unknown, typeName: string): boolean {
	return typeOf(value) === typeName;
}

// --- error handling ----------------------------------------------------------

/**
 * Luau `pcall` as roblox-ts emits it: returns the `[ok, ...results]` array
 * tuple. Thrown `Error`s surface as their message (Luau errors are strings).
 */
export function pcall<A extends unknown[], R>(
	fn: (...args: A) => R,
	...args: A
): [true, R] | [false, unknown] {
	try {
		return [true, fn(...args)];
	} catch (err) {
		return [false, err instanceof Error ? err.message : err];
	}
}

/** Luau `xpcall` — like `pcall`, but failures run through `handler` first. */
export function xpcall<A extends unknown[], R, H>(
	fn: (...args: A) => R,
	handler: (err: unknown) => H,
	...args: A
): [true, R] | [false, H] {
	try {
		return [true, fn(...args)];
	} catch (err) {
		return [false, handler(err instanceof Error ? err.message : err)];
	}
}

/** Luau `error(message)` — throws the value (`level` is accepted, unused). */
export function error(message?: unknown, _level?: number): never {
	throw message;
}

/** Luau `warn` → `console.warn`. */
export function warn(...args: unknown[]): void {
	console.warn(...args);
}

/** Luau `print` → `console.log`. */
export function print(...args: unknown[]): void {
	console.log(...args);
}

/** Luau `tostring` — `nil` for nullish, `Enum.X.Y` for enum items. */
export function tostring(value: unknown): string {
	if (value === undefined || value === null) return "nil";
	return String(value);
}

/** Luau `tonumber` — `undefined` (nil) when the value isn't numeric. */
export function tonumber(value: unknown, base?: number): number | undefined {
	if (base !== undefined) {
		if (typeof value !== "string") return undefined;
		const parsed = Number.parseInt(value.trim(), base);
		return Number.isNaN(parsed) ? undefined : parsed;
	}
	if (typeof value === "number") return value;
	if (typeof value === "string") {
		const trimmed = value.trim();
		if (trimmed === "") return undefined;
		const parsed = Number(trimmed);
		return Number.isNaN(parsed) ? undefined : parsed;
	}
	return undefined;
}

// --- iteration ---------------------------------------------------------------

/**
 * Luau `pairs` as roblox-ts uses it: `for (const [k, v] of pairs(obj))`.
 * Maps iterate entries, arrays iterate 1-based indices, plain objects iterate
 * own string keys. `undefined` values are skipped (they are Luau `nil`).
 */
export function pairs<K, V>(value: ReadonlyMap<K, V>): IterableIterator<[K, V]>;
export function pairs<V>(value: readonly V[]): IterableIterator<[number, V]>;
export function pairs<T extends object>(
	value: T,
): IterableIterator<[string, T[keyof T]]>;
export function* pairs(value: object): IterableIterator<[unknown, unknown]> {
	if (value instanceof Map) {
		yield* value.entries();
		return;
	}
	if (Array.isArray(value)) {
		for (let i = 0; i < value.length; i++) {
			if (value[i] !== undefined) yield [i + 1, value[i]];
		}
		return;
	}
	for (const key of Object.keys(value)) {
		const v = (value as Record<string, unknown>)[key];
		if (v !== undefined) yield [key, v];
	}
}

/**
 * Luau `next(t, key?)` — the raw table iterator. roblox-ts code uses the no-key
 * form as an emptiness probe (`next(t)[0] !== undefined`); the keyed form
 * returns the pair after `key` in iteration order. Exhaustion yields
 * `[undefined]`.
 */
export function next(
	value: object,
	key?: unknown,
): [unknown, unknown] | [undefined] {
	const entries: [unknown, unknown][] = [
		...pairs(value as Record<string, unknown>),
	];
	if (key === undefined) {
		const first = entries[0];
		return first ?? [undefined];
	}
	const index = entries.findIndex(([k]) => k === key);
	const following = index === -1 ? undefined : entries[index + 1];
	return following ?? [undefined];
}

/** Luau `ipairs` — 1-based indices, stops at the first `nil` hole. */
export function* ipairs<V>(value: readonly V[]): IterableIterator<[number, V]> {
	for (let i = 0; i < value.length; i++) {
		const v = value[i];
		if (v === undefined) return;
		yield [i + 1, v];
	}
}

// --- math --------------------------------------------------------------------

/** The Luau `math` library (browser subset). */
export const math = {
	abs: Math.abs,
	floor: Math.floor,
	ceil: Math.ceil,
	sqrt: Math.sqrt,
	max: Math.max,
	min: Math.min,
	pow: Math.pow,
	exp: Math.exp,
	log: Math.log,
	sin: Math.sin,
	cos: Math.cos,
	tan: Math.tan,
	sign: Math.sign,
	huge: Number.POSITIVE_INFINITY,
	pi: Math.PI,
	clamp(value: number, min: number, max: number): number {
		return Math.min(Math.max(value, min), max);
	},
	/** Luau rounds halves away from zero (`Math.round` rounds toward +∞). */
	round(value: number): number {
		return value >= 0 ? Math.floor(value + 0.5) : Math.ceil(value - 0.5);
	},
	fmod(a: number, b: number): number {
		return a % b;
	},
	deg(radians: number): number {
		return (radians * 180) / Math.PI;
	},
	rad(degrees: number): number {
		return (degrees * Math.PI) / 180;
	},
	/** Deterministic stub — previews don't need Perlin noise. */
	noise(): number {
		return 0;
	},
	random(m?: number, n?: number): number {
		if (m === undefined) return Math.random();
		if (n === undefined) return Math.floor(Math.random() * m) + 1;
		return Math.floor(Math.random() * (n - m + 1)) + m;
	},
};

// --- string ------------------------------------------------------------------

function escapeRegExpChar(c: string): string {
	return /[.*+?^${}()|[\]\\/]/.test(c) ? `\\${c}` : c;
}

function escapeRegExpSetChar(c: string): string {
	return /[\\\]^[-]/.test(c) ? `\\${c}` : c;
}

function luaClass(c: string, inSet: boolean): string | undefined {
	switch (c) {
		case "a":
			return inSet ? "A-Za-z" : "[A-Za-z]";
		case "d":
			return inSet ? "0-9" : "[0-9]";
		case "l":
			return inSet ? "a-z" : "[a-z]";
		case "u":
			return inSet ? "A-Z" : "[A-Z]";
		case "w":
			return inSet ? "A-Za-z0-9" : "[A-Za-z0-9]";
		case "s":
			return inSet ? "\\s" : "[\\s]";
		default:
			return undefined;
	}
}

/**
 * Convert the supported Lua pattern subset (literals, `%w`-style classes,
 * bracket sets, `.`, `+*-?` quantifiers, edge anchors) to a RegExp. Returns
 * `undefined` for anything richer — callers fall back to literal matching.
 */
function luaPatternToRegExp(pattern: string): RegExp | undefined {
	let out = "";
	let i = 0;
	while (i < pattern.length) {
		const ch = pattern.charAt(i);
		if (ch === "%") {
			const next = pattern.charAt(i + 1);
			if (next === "") return undefined;
			if (/[a-z]/.test(next)) {
				const cls = luaClass(next, false);
				if (cls === undefined) return undefined; // %b, %f, … unsupported
				out += cls;
			} else if (/[A-Z]/.test(next)) {
				return undefined; // negated classes unsupported
			} else {
				out += escapeRegExpChar(next); // %-, %., %% → literal
			}
			i += 2;
		} else if (ch === "[") {
			let set = "[";
			i += 1;
			if (pattern.charAt(i) === "^") {
				set += "^";
				i += 1;
			}
			let closed = false;
			while (i < pattern.length) {
				const c = pattern.charAt(i);
				if (c === "]") {
					closed = true;
					i += 1;
					break;
				}
				if (c === "%") {
					const next = pattern.charAt(i + 1);
					if (next === "") return undefined;
					if (/[a-z]/.test(next)) {
						const cls = luaClass(next, true);
						if (cls === undefined) return undefined;
						set += cls;
					} else if (/[A-Z]/.test(next)) {
						return undefined;
					} else {
						set += escapeRegExpSetChar(next);
					}
					i += 2;
				} else {
					set += c === "\\" ? "\\\\" : c;
					i += 1;
				}
			}
			if (!closed) return undefined;
			out += `${set}]`;
		} else if (ch === "-") {
			out += "*?"; // Lua's lazy repetition
			i += 1;
		} else if (ch === "^") {
			if (i !== 0) return undefined;
			out += "^";
			i += 1;
		} else if (ch === "$" && i === pattern.length - 1) {
			out += "$";
			i += 1;
		} else if ("().*+?".includes(ch)) {
			out += ch; // same meaning in both dialects
			i += 1;
		} else {
			out += escapeRegExpChar(ch);
			i += 1;
		}
	}
	try {
		return new RegExp(out, "g");
	} catch {
		return undefined;
	}
}

function escapeWholePattern(pattern: string): RegExp {
	return new RegExp(pattern.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&"), "g");
}

/** The Luau `string` library (browser subset; indices are 1-based). */
export const string = {
	lower(s: string): string {
		return s.toLowerCase();
	},
	upper(s: string): string {
		return s.toUpperCase();
	},
	/** `string.sub` — 1-based inclusive, negative indices count from the end. */
	sub(s: string, i = 1, j = -1): string {
		const len = s.length;
		const start = i < 0 ? Math.max(len + i + 1, 1) : Math.max(i, 1);
		const end = j < 0 ? len + j + 1 : Math.min(j, len);
		if (start > end) return "";
		return s.slice(start - 1, end);
	},
	rep(s: string, n: number, sep = ""): string {
		if (n <= 0) return "";
		return new Array<string>(Math.floor(n)).fill(s).join(sep);
	},
	split(s: string, sep = ","): string[] {
		return s.split(sep);
	},
	/**
	 * `string.find` — returns the 1-based `[start, end]` tuple, or an EMPTY tuple
	 * when there is no match. Non-plain calls try the pattern subset, then fall
	 * back to a literal find.
	 *
	 * The empty tuple (not `undefined`) is what keeps roblox-ts callers working:
	 * `string.find` is a `LuaTuple`, so the idiomatic read is
	 * `const [start] = string.find(...)`. Destructuring `undefined` throws
	 * "undefined is not iterable" in JS, whereas Luau happily destructures a nil
	 * multi-return into nils — an empty array reproduces that, and matches
	 * roblox-ts's other semantics too (an undestructured multi-return is a table,
	 * i.e. always truthy).
	 */
	find(
		s: string,
		pattern: string,
		init = 1,
		plain = false,
	): [number, number] | [] {
		const from = Math.max(0, init - 1);
		if (!plain) {
			const re = luaPatternToRegExp(pattern);
			if (re) {
				re.lastIndex = from;
				const match = re.exec(s);
				return match ? [match.index + 1, match.index + match[0].length] : [];
			}
		}
		const index = s.indexOf(pattern, from);
		return index >= 0 ? [index + 1, index + pattern.length] : [];
	},
	/**
	 * `string.gsub` — returns the `[result, count]` tuple. Supports the same
	 * pattern subset as `find` and treats richer patterns as literal text.
	 * `%0`/`%1`… in the replacement reference the match and its captures.
	 */
	gsub(
		s: string,
		pattern: string,
		repl: string,
		maxCount?: number,
	): [string, number] {
		const limit = maxCount ?? Number.POSITIVE_INFINITY;
		const re = luaPatternToRegExp(pattern) ?? escapeWholePattern(pattern);
		let count = 0;
		const result = s.replace(re, (...args) => {
			const match = args[0] as string;
			if (count >= limit) return match;
			count += 1;
			const groups = args.slice(1, -2) as (string | undefined)[];
			return repl.replace(/%([0-9%])/g, (_m, d: string) => {
				if (d === "%") return "%";
				if (d === "0") return match;
				return groups[Number(d) - 1] ?? "";
			});
		});
		return [result, count];
	},
	/** `string.format` — supports `%d %s %f %x %X %%` and `%.Nf`. */
	format(fmt: string, ...args: unknown[]): string {
		let argIndex = 0;
		return fmt.replace(
			/%(?:(%)|(?:\.(\d+))?([dsfxX]))/g,
			(match, pct: string | undefined, prec: string | undefined, spec) => {
				if (pct) return "%";
				const arg = args[argIndex];
				argIndex += 1;
				switch (spec) {
					case "d":
						return String(Math.trunc(Number(arg)));
					case "s":
						return tostring(arg);
					case "f":
						return Number(arg).toFixed(prec !== undefined ? Number(prec) : 6);
					case "x":
						return (Math.trunc(Number(arg)) >>> 0).toString(16);
					case "X":
						return (Math.trunc(Number(arg)) >>> 0).toString(16).toUpperCase();
					default:
						return match;
				}
			},
		);
	},
};

// --- os / coroutine ----------------------------------------------------------

/** The Luau `os` library (browser subset). */
export const os = {
	/** CPU-ish time in seconds (monotonic time since page load). */
	clock(): number {
		return performance.now() / 1000;
	},
	/** Unix time in whole seconds. */
	time(): number {
		return Math.floor(Date.now() / 1000);
	},
};

/**
 * An inert `coroutine` library — enough for feature-detection code paths.
 * There are no real Luau threads in the browser; `running` is always `nil`.
 */
export const coroutine = {
	running(): undefined {
		return undefined;
	},
	status(_co?: unknown): string {
		return "suspended";
	},
	create<A extends unknown[], R>(fn: (...args: A) => R): { fn: typeof fn } {
		return { fn };
	},
	wrap<A extends unknown[], R>(fn: (...args: A) => R): typeof fn {
		return fn;
	},
};

// --- task --------------------------------------------------------------------

/** The cancelable handle `task.delay` returns (accepted by `task.cancel`). */
export interface TaskDelayHandle {
	cancelled: boolean;
	readonly timeout: ReturnType<typeof setTimeout>;
}

/**
 * The Roblox `task` scheduling library, mapped onto browser timers (the subset
 * UI code uses). `task.wait` returns a Promise so `await task.wait(n)` works; a
 * bare synchronous `task.wait()` cannot block in the browser. `task.delay`
 * returns a handle `task.cancel` can revoke.
 */
export const task = {
	spawn<A extends unknown[]>(fn: (...args: A) => void, ...args: A): void {
		queueMicrotask(() => fn(...args));
	},
	defer<A extends unknown[]>(fn: (...args: A) => void, ...args: A): void {
		queueMicrotask(() => fn(...args));
	},
	delay<A extends unknown[]>(
		seconds: number,
		fn: (...args: A) => void,
		...args: A
	): TaskDelayHandle {
		const handle: TaskDelayHandle = {
			cancelled: false,
			timeout: setTimeout(() => {
				if (!handle.cancelled) fn(...args);
			}, Math.max(0, seconds) * 1000),
		};
		return handle;
	},
	cancel(handle: TaskDelayHandle | undefined): void {
		if (!handle) return;
		clearTimeout(handle.timeout);
		handle.cancelled = true;
	},
	wait(seconds = 0): Promise<number> {
		return new Promise((resolve) =>
			setTimeout(() => resolve(seconds), Math.max(0, seconds) * 1000),
		);
	},
};

/** Roblox `tick()` — seconds (here, monotonic time since page load). */
export function tick(): number {
	return performance.now() / 1000;
}

/**
 * Luau `assert` — returns the value when truthy, otherwise throws.
 *
 * Returning the value (rather than being a TS `asserts` predicate) is the
 * deliberate choice: `const cfg = assert(maybeCfg, "no cfg")` is the idiom this
 * shim exists to reproduce, and an assertion function must return `void`, so
 * the two are mutually exclusive. Callers who want narrowing can `if (!x) …`.
 *
 * Truthiness is JS truthiness, not Luau's — `assert(0)` throws here and does
 * not in Luau. Loom runs the caller's own TS, whose `if` statements already use
 * JS rules, so matching them keeps one mental model rather than two.
 */
export function assert<T>(
	condition: T,
	message = "assertion failed!",
): NonNullable<T> {
	if (!condition) {
		throw new Error(message);
	}
	return condition as NonNullable<T>;
}

// --- prototype patches -------------------------------------------------------

function definePatch(
	proto: object,
	name: string,
	value: (...args: never[]) => unknown,
	/**
	 * Replace an existing member instead of bailing out. Only for names JS
	 * already defines with semantics no loom caller could want (see `sub`).
	 */
	force = false,
): void {
	if (!force && name in proto) return; // guarded: never clobber by accident
	Object.defineProperty(proto, name, {
		value,
		configurable: true,
		writable: true,
		enumerable: false,
	});
}

/**
 * Install the roblox-ts macro methods on `Array.prototype`/`String.prototype`
 * (`.size()`, `.isEmpty()`, `.remove(i)`, `.unorderedRemove(i)`, `.clear()`),
 * plus the Luau string methods roblox-ts calls off a string receiver
 * (`.lower()`, `.upper()`, `.sub()`, `.rep()`, `.find()`, `.gsub()`,
 * `.format()`) — each one delegating to the {@link string} library, so the
 * 1-based indices and tuple returns documented there apply here too.
 * Array indices are 0-based, matching roblox-ts TS-side array semantics (and
 * the lattice vitest shim). Guarded and non-enumerable; safe to call
 * repeatedly.
 */
export function applyPrototypePatches(): void {
	definePatch(Array.prototype, "size", function (this: unknown[]) {
		return this.length;
	});
	definePatch(Array.prototype, "isEmpty", function (this: unknown[]) {
		return this.length === 0;
	});
	definePatch(
		Array.prototype,
		"remove",
		function (this: unknown[], index: number) {
			return this.splice(index, 1)[0];
		},
	);
	definePatch(
		Array.prototype,
		"unorderedRemove",
		function (this: unknown[], index: number) {
			if (index < 0 || index >= this.length) return undefined;
			const removed = this[index];
			const last = this.pop();
			if (index < this.length) this[index] = last;
			return removed;
		},
	);
	definePatch(Array.prototype, "clear", function (this: unknown[]) {
		this.length = 0;
	});
	definePatch(String.prototype, "size", function (this: string) {
		return this.length;
	});
	definePatch(String.prototype, "lower", function (this: string) {
		return string.lower(this);
	});
	definePatch(String.prototype, "upper", function (this: string) {
		return string.upper(this);
	});
	// `String.prototype.sub` already exists: it is the Annex B HTML wrapper that
	// returns `<sub>…</sub>`. Nothing in a loom scene wants that, and leaving the
	// guard in place would silently hand Luau callers markup, so this one name is
	// forced. There is deliberately no `split` patch — JS already defines it, and
	// `string.split` is implemented *with* it, so patching would recurse forever.
	// Native `split(sep)` matches Luau for a string separator anyway.
	definePatch(
		String.prototype,
		"sub",
		function (this: string, i?: number, j?: number) {
			return string.sub(this, i, j);
		},
		true,
	);
	definePatch(
		String.prototype,
		"rep",
		function (this: string, n: number, separator?: string) {
			return string.rep(this, n, separator);
		},
	);
	definePatch(
		String.prototype,
		"find",
		function (this: string, pattern: string, init?: number, plain?: boolean) {
			return string.find(this, pattern, init, plain);
		},
	);
	definePatch(
		String.prototype,
		"gsub",
		function (
			this: string,
			pattern: string,
			replacement: string,
			maxCount?: number,
		) {
			return string.gsub(this, pattern, replacement, maxCount);
		},
	);
	definePatch(
		String.prototype,
		"format",
		function (this: string, ...args: unknown[]) {
			return string.format(this, ...args);
		},
	);
}
