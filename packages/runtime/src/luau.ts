/**
 * `luau.ts` — the Luau global environment roblox-ts output expects.
 *
 * `typeIs`/`typeOf`, `pcall` (array-tuple `[ok, ...results]`), `pairs`/`ipairs`
 * generators, `select` and the `raw*` accessors, the `math`/`string`/`table`/
 * `os`/`bit32`/`utf8`/`buffer`/`debug` libraries (Luau's 1-based positions and
 * all), a generator-backed `coroutine`, the `task` scheduler (with cancelable
 * `task.delay`), and the guarded prototype patches roblox-ts macro methods
 * compile to (`Array.prototype.size()`, `.remove()`, `String.prototype.size()`).
 * `installGlobals` in `index.ts` wires all of this onto `globalThis` before
 * preview app code runs.
 *
 * What is deliberately absent is `setmetatable`/`getmetatable`/`newproxy`:
 * loom runs the author's TypeScript, whose classes are JS classes, and there is
 * no faithful way to give a plain JS object a metatable's `__index`/`__newindex`
 * behaviour without proxying every table in the program.
 */
import {
	CFrame,
	Color3,
	ColorSequence,
	ColorSequenceKeypoint,
	DateTime,
	Random,
	Rect,
	TweenInfo,
	UDim,
	UDim2,
	Vector2,
	Vector3,
} from "./datatypes";
import { EnumItem, RobloxEnum } from "./enums";
import { isLoomInstance } from "./instance";
import { LoomSignal } from "./signal";

// --- type reflection ---------------------------------------------------------

/**
 * Whether `value` has the `RBXScriptConnection` shape.
 *
 * Signals are recognized with `instanceof LoomSignal`, but their connections
 * cannot be: `LoomSignal.Connect` hands back an object literal closing over its
 * listener (see `signal.ts`), so there is no constructor to test against and a
 * structural check is the only honest one available. The pair of members is
 * specific enough in practice — Roblox userdata is not otherwise distinguishable
 * either, and an app object carrying both a `Disconnect` method and a
 * `Connected` boolean *is* connection-shaped by every test a caller can apply.
 */
function isConnectionShaped(value: object): boolean {
	const candidate = value as { Disconnect?: unknown; Connected?: unknown };
	return (
		typeof candidate.Disconnect === "function" &&
		typeof candidate.Connected === "boolean"
	);
}

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
	if (value instanceof Random) return "Random";
	if (value instanceof DateTime) return "DateTime";
	if (value instanceof EnumItem) return "EnumItem";
	// `typeof(Enum.KeyCode)` is "Enum" in Roblox — the namespace object is its
	// own datatype, distinct from the items it holds.
	if (value instanceof RobloxEnum) return "Enum";
	if (value instanceof LoomSignal) return "RBXScriptSignal";
	// Declared further down the file; a class in TDZ is fine to name here,
	// because `typeOf` only ever runs after the module has finished evaluating.
	if (value instanceof LuauBuffer) return "buffer";
	if (value instanceof LuauThread) return "thread";
	const t = typeof value;
	if (t === "object") {
		return isConnectionShaped(value as object)
			? "RBXScriptConnection"
			: "table";
	}
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

/**
 * The seeded stream `math.randomseed` switches `math.random` over to, or
 * `undefined` while it still runs off `Math.random`.
 *
 * `Math.random` cannot be seeded, and a `randomseed` that quietly did nothing
 * would leave code that seeds *for reproducibility* — a shuffle in a test, a
 * demo that wants the same layout every load — silently unreproducible. So
 * seeding installs a small deterministic generator (mulberry32) instead. The
 * numbers are loom's own, not the engine's: same seed, same sequence, here.
 */
let randomState: number | undefined;

function nextRandom(): number {
	if (randomState === undefined) return Math.random();
	randomState = (randomState + 0x6d2b79f5) | 0;
	let t = randomState;
	t = Math.imul(t ^ (t >>> 15), t | 1);
	t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
	return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

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
	sin: Math.sin,
	cos: Math.cos,
	tan: Math.tan,
	asin: Math.asin,
	acos: Math.acos,
	atan: Math.atan,
	atan2: Math.atan2,
	sinh: Math.sinh,
	cosh: Math.cosh,
	tanh: Math.tanh,
	log10: Math.log10,
	sign: Math.sign,
	huge: Number.POSITIVE_INFINITY,
	pi: Math.PI,
	/** `math.log(x)` is natural; `math.log(x, base)` is in that base. */
	log(x: number, base?: number): number {
		return base === undefined ? Math.log(x) : Math.log(x) / Math.log(base);
	},
	/** `math.ldexp(m, e)` — `m * 2^e`, the inverse of {@link math.frexp}. */
	ldexp(m: number, e: number): number {
		return m * 2 ** Math.trunc(e);
	},
	/**
	 * `math.frexp` — the `[mantissa, exponent]` tuple with
	 * `value === mantissa * 2^exponent` and `0.5 <= |mantissa| < 1`. Zero and
	 * the non-finite values come back unchanged, with exponent 0.
	 */
	frexp(value: number): [number, number] {
		if (value === 0 || !Number.isFinite(value)) return [value, 0];
		let exponent = Math.ceil(Math.log2(Math.abs(value)));
		let mantissa = value / 2 ** exponent;
		// log2 is a float, so nudge the pair until it really is in range.
		while (Math.abs(mantissa) >= 1) {
			mantissa /= 2;
			exponent += 1;
		}
		while (Math.abs(mantissa) < 0.5) {
			mantissa *= 2;
			exponent -= 1;
		}
		return [mantissa, exponent];
	},
	/** `math.modf` — the `[integral, fractional]` tuple, both signed like `x`. */
	modf(x: number): [number, number] {
		const integral = x >= 0 ? Math.floor(x) : Math.ceil(x);
		return [integral, Number.isFinite(x) ? x - integral : 0];
	},
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
		if (m === undefined) return nextRandom();
		if (n === undefined) return Math.floor(nextRandom() * m) + 1;
		return Math.floor(nextRandom() * (n - m + 1)) + m;
	},
	/** `math.randomseed` — makes {@link math.random} deterministic; see above. */
	randomseed(seed: number): void {
		randomState = Math.trunc(seed) | 0;
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

/**
 * The 0-based JS offset a 1-based Luau `init` argument names. Negative values
 * count back from the end, as they do in the engine.
 */
function searchStart(init: number, length: number): number {
	const at = Math.trunc(init);
	if (at < 0) return Math.max(length + at, 0);
	return Math.min(Math.max(at, 1) - 1, length);
}

/** The captures a match yields, or the whole match when the pattern has none. */
function captures(match: RegExpExecArray): string[] {
	if (match.length <= 1) return [match[0]];
	return match.slice(1).map((capture) => capture ?? "");
}

/**
 * A `string.gsub` replacement: the literal string (with `%1` back-references),
 * a table indexed by the first capture, or a function called with the captures.
 * All three are Lua, and roblox-ts code reaches for all three.
 */
export type GsubReplacement =
	| string
	| number
	| ReadonlyMap<string, unknown>
	| Record<string, unknown>
	| ((...matched: string[]) => unknown);

/** One replacement's worth of `%0`…`%9` / `%%` expansion in a string `repl`. */
function expandReferences(
	repl: string,
	match: string,
	groups: readonly (string | undefined)[],
): string {
	return repl.replace(/%([0-9%])/g, (_m, d: string) => {
		if (d === "%") return "%";
		if (d === "0") return match;
		// With no captures at all, `%1` names the whole match — Lua treats the
		// match itself as capture one in that case, and patterns written without
		// parentheses rely on it.
		if (d === "1" && groups.length === 0) return match;
		return groups[Number(d) - 1] ?? "";
	});
}

/**
 * The Lua `%[flags][width][.precision]conversion` grammar.
 *
 * Anything that does not match is left in the output verbatim (`%y` stays
 * `%y`), which is the forgiving direction: the engine raises "invalid
 * conversion", and a preview that renders a stray `%y` beats one that dies.
 */
const FORMAT_SPEC = /%([-+ #0]*)(\d*)(?:\.(\d*))?([diuoxXeEfFgGqsc*%])/g;

/** The `+`/space flags' prefix for a signed conversion. */
function signPrefix(negative: boolean, flags: string): string {
	if (negative) return "-";
	if (flags.includes("+")) return "+";
	if (flags.includes(" ")) return " ";
	return "";
}

/**
 * Lay a finished conversion out in `width`. `-` left-aligns; `0` pads with
 * zeros *between* the sign (or the `#` prefix) and the digits, never in front of
 * it, which is what makes `%+06.1f` of -1.5 read `-001.5` rather than `00-1.5`.
 */
function padTo(
	prefix: string,
	body: string,
	flags: string,
	width: number,
	zeroPad: boolean,
): string {
	const text = prefix + body;
	if (text.length >= width) return text;
	if (flags.includes("-")) return text.padEnd(width);
	if (zeroPad && flags.includes("0")) {
		return prefix + body.padStart(width - prefix.length, "0");
	}
	return text.padStart(width);
}

/**
 * The digits of an integer conversion, without a sign. `BigInt` rather than
 * `String(n)` because a double past 1e21 stringifies to exponent notation, and
 * `%d` must never print `1e+21`.
 */
function integerDigits(value: number): string {
	if (!Number.isFinite(value)) return Number.isNaN(value) ? "nan" : "inf";
	return BigInt(Math.abs(Math.trunc(value))).toString();
}

/**
 * The 32-bit unsigned view `%u`, `%o`, `%x` and `%X` format.
 *
 * Luau's `lua_Integer` is a 32-bit `int`, so `string.format("%x", -1)` is
 * `"ffffffff"` there and here; a value past 2^32 wraps in both.
 */
function unsignedView(value: number): number {
	return Math.trunc(Number(value)) >>> 0;
}

/** Trim `%g`'s trailing fraction zeros, leaving any exponent suffix intact. */
function trimTrailingZeros(text: string): string {
	const at = text.indexOf("e");
	const mantissa = at < 0 ? text : text.slice(0, at);
	const exponent = at < 0 ? "" : text.slice(at);
	if (!mantissa.includes(".")) return mantissa + exponent;
	return mantissa.replace(/0+$/, "").replace(/\.$/, "") + exponent;
}

/**
 * `%e`'s mantissa and exponent. JS writes `1e+5`; C (and therefore Lua) pads the
 * exponent to at least two digits, so the same number must read `1e+05`.
 */
function exponentialDigits(abs: number, precision: number): string {
	return abs
		.toExponential(precision)
		.replace(/e([+-])(\d)$/, (_m, sign: string, digit: string) => {
			return `e${sign}0${digit}`;
		});
}

/** `%g` — `%e` when the exponent runs away, `%f` otherwise, zeros trimmed. */
function generalDigits(
	abs: number,
	precision: number | undefined,
	flags: string,
): string {
	// C's rule: precision 0 means 1 significant digit, an absent one means 6.
	const significant = precision === undefined ? 6 : Math.max(precision, 1);
	// The exponent comes from the *rounded* value, not from `log10`, because the
	// choice between the two forms is made after rounding: 999999.5 at six
	// significant digits is 1e+06, and reading its exponent as 5 would print it
	// the long way as `1000000`.
	const exponent =
		abs === 0 ? 0 : Number(abs.toExponential(significant - 1).split("e")[1]);
	const text =
		exponent < -4 || exponent >= significant
			? exponentialDigits(abs, significant - 1)
			: abs.toFixed(Math.max(significant - 1 - exponent, 0));
	// `#` keeps the trailing zeros the way it does everywhere else in printf.
	return flags.includes("#") ? text : trimTrailingZeros(text);
}

/**
 * `%q` — the string, quoted so Lua can read it straight back. Faithful to the
 * engine's `addquoted`, including the detail that a newline is escaped as a
 * backslash followed by a *real* newline rather than by an `n`.
 */
function quoted(s: string): string {
	let out = '"';
	for (let i = 0; i < s.length; i++) {
		const c = s[i] as string;
		const code = s.charCodeAt(i);
		if (c === '"' || c === "\\" || c === "\n") {
			out += `\\${c}`;
		} else if (code < 0x20 || code === 0x7f) {
			// A digit right after a decimal escape would be swallowed into it, so
			// those get the full three-digit form.
			const next = s[i + 1];
			out +=
				next !== undefined && next >= "0" && next <= "9"
					? `\\${String(code).padStart(3, "0")}`
					: `\\${code}`;
		} else {
			out += c;
		}
	}
	return `${out}"`;
}

/** One `%…` conversion of {@link string.format}, already parsed. */
function formatOne(
	spec: string,
	flags: string,
	width: number,
	precision: number | undefined,
	arg: unknown,
): string {
	switch (spec) {
		case "d":
		case "i": {
			const value = Math.trunc(Number(arg));
			const digits = integerDigits(value);
			// `%.0d` of zero prints nothing at all — a real printf rule, and the one
			// place an explicit precision can shorten a number rather than pad it.
			const padded =
				precision === undefined
					? digits
					: precision === 0 && value === 0
						? ""
						: digits.padStart(precision, "0");
			return padTo(
				signPrefix(value < 0, flags),
				padded,
				flags,
				width,
				precision === undefined,
			);
		}
		case "u":
		case "o":
		case "x":
		case "X": {
			const value = unsignedView(arg as number);
			const base = spec === "u" ? 10 : spec === "o" ? 8 : 16;
			let digits = value.toString(base);
			if (spec === "X") digits = digits.toUpperCase();
			if (precision !== undefined) digits = digits.padStart(precision, "0");
			// `#` is printf's "alternate form": a leading 0 for octal, 0x/0X for hex,
			// and nothing at all for a zero value (there is no `0x0` in C either).
			let prefix = "";
			if (flags.includes("#") && value !== 0) {
				if (spec === "o") prefix = digits.startsWith("0") ? "" : "0";
				else if (spec === "x") prefix = "0x";
				else if (spec === "X") prefix = "0X";
			}
			return padTo(prefix, digits, flags, width, precision === undefined);
		}
		case "f":
		case "F":
		case "e":
		case "E":
		case "g":
		case "G": {
			const value = Number(arg);
			const upper = spec === "F" || spec === "E" || spec === "G";
			if (!Number.isFinite(value)) {
				const word = Number.isNaN(value) ? "nan" : "inf";
				return padTo(
					Number.isNaN(value) ? "" : signPrefix(value < 0, flags),
					upper ? word.toUpperCase() : word,
					flags,
					width,
					// Never zero-pad `inf`: `%08f` of infinity is `     inf` in C.
					false,
				);
			}
			const abs = Math.abs(value);
			let digits: string;
			if (spec === "f" || spec === "F") {
				digits = abs.toFixed(precision ?? 6);
			} else if (spec === "e" || spec === "E") {
				digits = exponentialDigits(abs, precision ?? 6);
			} else {
				digits = generalDigits(abs, precision, flags);
			}
			if (flags.includes("#") && !digits.includes(".")) digits += ".";
			if (upper) digits = digits.toUpperCase();
			// A negative zero is negative: printf writes `-0.00`, and so does Luau.
			const negative = value < 0 || Object.is(value, -0);
			return padTo(signPrefix(negative, flags), digits, flags, width, true);
		}
		case "c":
			return padTo(
				"",
				String.fromCharCode(Math.trunc(Number(arg))),
				flags,
				width,
				false,
			);
		case "q":
			return padTo("", quoted(tostring(arg)), flags, width, false);
		case "*":
			// Luau's own conversion: whatever the value is, `tostring` it.
			return padTo("", tostring(arg), flags, width, false);
		default: {
			// `%s`. A precision truncates the string, which is the one printf rule
			// people reach for when a name has to fit a fixed-width column.
			const text = tostring(arg);
			return padTo(
				"",
				precision === undefined ? text : text.slice(0, precision),
				flags,
				width,
				false,
			);
		}
	}
}

/**
 * The Luau `string` library (browser subset; indices are 1-based).
 *
 * Luau strings are byte strings and JS strings are sequences of UTF-16 code
 * units, so `len`, `byte` and the indices everything here takes count code
 * units, not bytes. The two agree exactly on ASCII, which is what UI source
 * measures and slices; beyond it, loom counts what the string it was handed
 * actually contains (see {@link utf8} for the code-point view).
 */
export const string = {
	lower(s: string): string {
		return s.toLowerCase();
	},
	upper(s: string): string {
		return s.toUpperCase();
	},
	/** `string.len` — see the note above on code units vs bytes. */
	len(s: string): number {
		return s.length;
	},
	/** `string.reverse` — by code point, so a surrogate pair survives it. */
	reverse(s: string): string {
		return Array.from(s).reverse().join("");
	},
	/** `string.char` — the characters for the given codes. */
	char(...codes: number[]): string {
		return String.fromCharCode(...codes);
	},
	/**
	 * `string.byte` — the codes of `s[i..j]` (`j` defaults to `i`, so the common
	 * call yields one). A tuple, so `const [b] = string.byte(s)` reads it.
	 */
	byte(s: string, i = 1, j: number = i): number[] {
		const len = s.length;
		const start = i < 0 ? Math.max(len + i + 1, 1) : Math.max(Math.trunc(i), 1);
		const end = j < 0 ? len + j + 1 : Math.min(Math.trunc(j), len);
		const codes: number[] = [];
		for (let k = start; k <= end; k++) codes.push(s.charCodeAt(k - 1));
		return codes;
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
		const from = searchStart(init, s.length);
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
	 * `string.gsub` — returns the `[result, count]` tuple Lua's multi-return is,
	 * where the count is every match seen, not just the ones that changed
	 * anything. Supports the same pattern subset as `find` and treats richer
	 * patterns as literal text.
	 *
	 * All three Lua replacement kinds work, because roblox-ts code uses all
	 * three:
	 *
	 * - a **string**, where `%0` is the whole match and `%1`…`%9` are its
	 *   captures (`%1` means the whole match when the pattern captured nothing),
	 *   and `%%` is a literal percent;
	 * - a **function**, called with the captures (or the whole match when there
	 *   are none) — whatever it returns is `tostring`ed, and a `false`/`nil`
	 *   return leaves the original text alone, which is how Lua spells "not this
	 *   one";
	 * - a **table** (a plain object or a `Map`), looked up by the first capture,
	 *   with the same false/nil rule.
	 */
	gsub(
		s: string,
		pattern: string,
		repl: GsubReplacement,
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
			// What Lua hands a function or a table: the captures, or the whole
			// match standing in for capture one when the pattern has none.
			const matched =
				groups.length === 0 ? [match] : groups.map((capture) => capture ?? "");
			let replacement: unknown;
			if (typeof repl === "function") {
				replacement = repl(...matched);
			} else if (typeof repl === "string" || typeof repl === "number") {
				return expandReferences(String(repl), match, groups);
			} else if (repl instanceof Map) {
				replacement = repl.get(matched[0] as string);
			} else {
				replacement = (repl as Record<string, unknown>)[matched[0] as string];
			}
			// Lua: "if the value returned is false or nil, the match is kept".
			if (replacement === undefined || replacement === null) return match;
			if (replacement === false) return match;
			return tostring(replacement);
		});
		return [result, count];
	},
	/**
	 * `string.match` — the pattern's captures, or the whole match when it has
	 * none, as the tuple roblox-ts reads (`const [word] = string.match(…)`). An
	 * unmatched call is the EMPTY tuple, for the reason spelled out on `find`.
	 */
	match(s: string, pattern: string, init = 1): string[] {
		const from = searchStart(init, s.length);
		const re = luaPatternToRegExp(pattern);
		if (re) {
			re.lastIndex = from;
			const found = re.exec(s);
			return found ? captures(found) : [];
		}
		return s.indexOf(pattern, from) >= 0 ? [pattern] : [];
	},
	/**
	 * `string.gmatch` — iterates every match, yielding its captures the way
	 * `match` returns them, so `for (const [k, v] of string.gmatch(s, …))` works.
	 */
	*gmatch(s: string, pattern: string): IterableIterator<string[]> {
		const re = luaPatternToRegExp(pattern) ?? escapeWholePattern(pattern);
		re.lastIndex = 0;
		let found = re.exec(s);
		while (found) {
			yield captures(found);
			// A zero-width match would otherwise spin on the same offset forever.
			if (found[0] === "") re.lastIndex += 1;
			found = re.exec(s);
		}
	},
	/**
	 * `string.format` — the whole printf grammar Lua exposes:
	 * `%[flags][width][.precision]conv`, with flags `-` `+` ` ` `#` `0` and the
	 * conversions `d i u o x X e E f F g G q s c %` plus Luau's own `%*`
	 * (`tostring` the argument, whatever it is).
	 *
	 * The flags are the reason this is not a three-case switch: `%02d` for a
	 * clock, `%-10s` for a column, `%5.1f` for a stat readout and `%+d` for a
	 * delta are the four things UI number formatting is actually made of, and a
	 * formatter that drops the width silently produces a plausible-looking wrong
	 * answer rather than an error anyone would notice.
	 *
	 * An unrecognized conversion is left in the output verbatim instead of
	 * raising the engine's "invalid conversion to format" — see
	 * {@link FORMAT_SPEC}.
	 *
	 * One honest divergence, in the last digit and only at an exact tie: the
	 * rounding comes from JS's `toFixed`/`toExponential`, which round halves away
	 * from zero, where C rounds them to even. `%.1f` of 0.25 is `0.3` here and
	 * `0.2` in the engine. Reimplementing decimal rounding to close a half-ULP
	 * gap would cost far more correctness than it bought.
	 */
	format(fmt: string, ...args: unknown[]): string {
		let argIndex = 0;
		return fmt.replace(
			FORMAT_SPEC,
			(
				_match,
				flags: string,
				widthText: string,
				precisionText: string | undefined,
				spec: string,
			) => {
				if (spec === "%") return "%";
				const arg = args[argIndex];
				argIndex += 1;
				const width = widthText === "" ? 0 : Number(widthText);
				// `%.f` is a precision of zero, not a missing one — the digits are
				// optional in the grammar and their absence means 0.
				const precision =
					precisionText === undefined
						? undefined
						: precisionText === ""
							? 0
							: Number(precisionText);
				return formatOne(spec, flags, width, precision, arg);
			},
		);
	},
};

// --- table -------------------------------------------------------------------

/** Luau positions are 1-based integers; clamp one into `[1, limit]`. */
function position(value: number, limit: number): number {
	return Math.min(Math.max(Math.trunc(value), 1), limit);
}

/**
 * `table.foreach` — `f(key, value)` over every pair, stopping at the first
 * non-`nil` return and handing it back. Declared out here, like {@link pairs},
 * because overloads are what give the callback real key and value types, and an
 * object literal method cannot carry them.
 */
function tableForeach<V, R>(
	list: readonly V[],
	callback: (key: number, value: V) => R,
): R | undefined;
function tableForeach<K, V, R>(
	map: ReadonlyMap<K, V>,
	callback: (key: K, value: V) => R,
): R | undefined;
function tableForeach<T extends object, R>(
	t: T,
	callback: (key: string, value: T[keyof T]) => R,
): R | undefined;
function tableForeach(
	t: object,
	callback: (key: never, value: never) => unknown,
): unknown {
	const visit = callback as (key: unknown, value: unknown) => unknown;
	for (const [key, value] of pairs(t as Record<string, unknown>)) {
		const result = visit(key, value);
		if (result !== undefined) return result;
	}
	return undefined;
}

/** `table.foreachi` — {@link tableForeach} over the array part only. */
function tableForeachi<V, R>(
	list: readonly V[],
	callback: (index: number, value: V) => R,
): R | undefined {
	for (const [index, value] of ipairs(list)) {
		const result = callback(index, value);
		if (result !== undefined) return result;
	}
	return undefined;
}

/**
 * The Luau `table` library (browser subset).
 *
 * **Positions are 1-based**, exactly as they are in Luau, because this library
 * is not a roblox-ts macro — the compiler passes the arguments straight through
 * to the engine, so the number a roblox-ts author writes is already a Luau
 * index. `string.find` above returns 1-based indices for the same reason. Note
 * the deliberate contrast with the array *methods* roblox-ts does compile as
 * macros (`arr.remove(i)`, patched onto `Array.prototype` below): those are
 * 0-based on the TS side, and `table.remove(arr, i)` is not.
 *
 * The tables themselves are ordinary JS values — an array, a `Map`, a `Set`, or
 * a plain object — so `#list` is `list.length` and a hole does not end it.
 *
 * Deviations from the engine, all in the forgiving direction (a preview should
 * render, not crash, over an off-by-one):
 *
 * - an out-of-range `insert` position clamps instead of erroring, and an
 *   out-of-range `remove` position returns `nil` without mutating;
 * - `concat` runs every element through {@link tostring} rather than erroring on
 *   a non-string, non-number one;
 * - `freeze` is `Object.freeze`, which stops writes to an array or an object but
 *   cannot stop `Map.set` / `Set.add`.
 */
export const table = {
	/** `table.insert(list, value)` / `table.insert(list, pos, value)`. */
	insert<T>(list: T[], ...rest: [value: T] | [pos: number, value: T]): void {
		if (rest.length === 1) {
			list.push(rest[0]);
			return;
		}
		const [pos, value] = rest;
		list.splice(position(pos, list.length + 1) - 1, 0, value);
	},
	/** `table.remove` — removes and returns `list[pos]` (default: the last). */
	remove<T>(list: T[], pos: number = list.length): T | undefined {
		const at = Math.trunc(pos);
		if (at < 1 || at > list.length) return undefined;
		return list.splice(at - 1, 1)[0];
	},
	/** `table.find` — the 1-based index of `needle`, or `nil` when absent. */
	find<T>(haystack: readonly T[], needle: T, init = 1): number | undefined {
		for (
			let i = position(init, haystack.length + 1) - 1;
			i < haystack.length;
			i++
		) {
			if (haystack[i] === needle) return i + 1;
		}
		return undefined;
	},
	/** `table.concat` — joins `list[i..j]` (inclusive) with `sep`. */
	concat(
		list: readonly unknown[],
		sep = "",
		i = 1,
		j: number = list.length,
	): string {
		const start = position(i, list.length + 1);
		const end = Math.min(Math.trunc(j), list.length);
		const parts: string[] = [];
		for (let k = start; k <= end; k++) parts.push(tostring(list[k - 1]));
		return parts.join(sep);
	},
	/**
	 * `table.sort` — in place, with Luau's *predicate* comparator: `comp(a, b)`
	 * is true when `a` must come before `b` (JS wants a number, hence the
	 * translation). The default order is `<`, as it is in Luau.
	 */
	sort<T>(list: T[], comp?: (a: T, b: T) => boolean): void {
		const before =
			comp ??
			((a: T, b: T) => (a as unknown as number) < (b as unknown as number));
		list.sort((a, b) => (before(a, b) ? -1 : before(b, a) ? 1 : 0));
	},
	/** `table.create` — an array of `count` copies of `value`. */
	create<T>(count: number, value?: T): T[] {
		return new Array<T>(Math.max(Math.trunc(count), 0)).fill(value as T);
	},
	/** `table.clear` — empties the table, keeping the same reference. */
	clear(value: object): void {
		if (Array.isArray(value)) {
			value.length = 0;
			return;
		}
		if (value instanceof Map || value instanceof Set) {
			value.clear();
			return;
		}
		for (const key of Object.keys(value)) {
			delete (value as Record<string, unknown>)[key];
		}
	},
	/** `table.clone` — a shallow copy of the same shape. */
	clone<T extends object>(value: T): T {
		if (Array.isArray(value)) return value.slice() as unknown as T;
		if (value instanceof Map) return new Map(value) as unknown as T;
		if (value instanceof Set) return new Set(value) as unknown as T;
		return Object.assign(
			Object.create(Object.getPrototypeOf(value) as object | null),
			value,
		) as T;
	},
	/** `table.freeze` — shallow, and returns the table it froze. */
	freeze<T extends object>(value: T): T {
		return Object.freeze(value);
	},
	/** `table.isfrozen`. */
	isfrozen(value: object): boolean {
		return Object.isFrozen(value);
	},
	/**
	 * `table.unpack` — `list[i..j]` as the array roblox-ts reads a `LuaTuple` as
	 * (`const [a, b] = table.unpack(list)`).
	 */
	unpack<T>(list: readonly T[], i = 1, j: number = list.length): T[] {
		const start = position(i, list.length + 1);
		const end = Math.min(Math.trunc(j), list.length);
		return list.slice(start - 1, Math.max(end, 0));
	},
	/** `table.pack` — the arguments as an array carrying their count as `n`. */
	pack<T>(...values: T[]): T[] & { n: number } {
		const packed = values as T[] & { n: number };
		packed.n = values.length;
		return packed;
	},
	/**
	 * `table.move` — copies `src[a..b]` into `dst` starting at `t` (in `src`
	 * itself when `dst` is omitted) and returns `dst`. Overlapping ranges are
	 * safe: the source range is read out before anything is written.
	 */
	move<T>(
		src: readonly T[],
		a: number,
		b: number,
		t: number,
		dst: T[] = src as T[],
	): T[] {
		const from = Math.trunc(a);
		const to = Math.trunc(b);
		if (to < from) return dst;
		const moved = src.slice(Math.max(from, 1) - 1, Math.max(to, 0));
		const at = Math.max(Math.trunc(t), 1);
		for (let k = 0; k < moved.length; k++) dst[at - 1 + k] = moved[k] as T;
		return dst;
	},

	// The Lua 5.1 leftovers Roblox still exposes. Deprecated there, and so
	// deprecated here — but old roblox-ts code does call them, and a preview that
	// throws `table.getn is not a function` teaches the author nothing.

	/** @deprecated `table.getn(list)` — `#list`. Use `list.size()`. */
	getn(list: readonly unknown[]): number {
		return list.length;
	},
	/**
	 * @deprecated `table.maxn(t)` — the largest positive index holding a value, or
	 * 0. Unlike `getn` it looks past holes, and it reads numeric keys off a `Map`
	 * or an object too.
	 */
	maxn(t: object): number {
		if (Array.isArray(t)) {
			for (let i = t.length - 1; i >= 0; i--) {
				if (t[i] !== undefined) return i + 1;
			}
			return 0;
		}
		let max = 0;
		for (const [key, value] of pairs(t as Record<string, unknown>)) {
			const index = typeof key === "number" ? key : Number(key);
			if (value !== undefined && Number.isFinite(index) && index > max) {
				max = index;
			}
		}
		return max;
	},
	/** @deprecated `table.foreach` — see {@link tableForeach}. */
	foreach: tableForeach,
	/** @deprecated `table.foreachi` — see {@link tableForeachi}. */
	foreachi: tableForeachi,
};

// --- raw access / varargs ----------------------------------------------------

/**
 * Luau `select` — `select("#", …)` counts the varargs, `select(n, …)` returns
 * them from the nth on (negative `n` counts back from the last), as the array
 * roblox-ts reads a `LuaTuple` as.
 */
export function select(index: "#", ...values: unknown[]): number;
export function select<T>(index: number, ...values: T[]): T[];
export function select<T>(index: number | "#", ...values: T[]): number | T[] {
	if (index === "#") return values.length;
	const at = Math.trunc(index);
	const start = at < 0 ? values.length + at : at - 1;
	return values.slice(Math.max(start, 0));
}

/**
 * Luau `unpack` — the deprecated global alias of {@link table.unpack}, still
 * exposed by the engine and still called by older code.
 *
 * @deprecated Use `table.unpack`.
 */
export function unpack<T>(list: readonly T[], i?: number, j?: number): T[] {
	return table.unpack(list, i, j);
}

/**
 * The `raw*` globals, which in Luau read and write a table without consulting
 * its metatable. Loom's tables are ordinary JS values with no metatables at all
 * (see the note on `setmetatable` in the README), so "raw" and "cooked" access
 * are the same thing here — these exist so code that spells the raw form still
 * runs, and they behave exactly like the plain access it is asking for.
 *
 * The key is taken as written. For a dictionary or a `Map` that is exact; on an
 * array, roblox-ts's own TS-side key (0-based) and the Luau one (1-based)
 * disagree, and loom follows the source it is actually running — the TS one.
 */
export function rawget<T extends object, K extends keyof T>(t: T, key: K): T[K];
export function rawget<K, V>(t: ReadonlyMap<K, V>, key: K): V | undefined;
export function rawget(t: object, key: unknown): unknown {
	if (t instanceof Map) return t.get(key);
	return (t as Record<string | number, unknown>)[key as string | number];
}

/** `rawset(t, key, value)` — the plain write; returns the table. */
export function rawset<T extends object, K extends keyof T>(
	t: T,
	key: K,
	value: T[K],
): T;
export function rawset<K, V>(t: Map<K, V>, key: K, value: V): Map<K, V>;
export function rawset(t: object, key: unknown, value: unknown): object {
	if (t instanceof Map) {
		t.set(key, value);
		return t;
	}
	(t as Record<string | number, unknown>)[key as string | number] = value;
	return t;
}

/** `rawequal(a, b)` — identity, with no `__eq` to consult. */
export function rawequal(a: unknown, b: unknown): boolean {
	return a === b;
}

/**
 * `rawlen(t)` — `#t` with no `__len` to consult: an array's length, a `Map`'s or
 * `Set`'s size, an object's own-key count, a string's length.
 */
export function rawlen(t: object | string): number {
	if (typeof t === "string") return t.length;
	if (Array.isArray(t)) return t.length;
	if (t instanceof Map || t instanceof Set) return t.size;
	return Object.keys(t).length;
}

// --- os ----------------------------------------------------------------------

/** The table `os.date("*t")` returns, and the one `os.time` accepts. */
export interface DateTable {
	year: number;
	month: number;
	day: number;
	hour?: number;
	min?: number;
	sec?: number;
	/** 1 = Sunday. Read from `os.date`; ignored by `os.time`. */
	wday?: number;
	/** Day of the year, 1-based. Read from `os.date`; ignored by `os.time`. */
	yday?: number;
	isdst?: boolean;
}

const WEEKDAYS = [
	"Sunday",
	"Monday",
	"Tuesday",
	"Wednesday",
	"Thursday",
	"Friday",
	"Saturday",
];
const MONTHS = [
	"January",
	"February",
	"March",
	"April",
	"May",
	"June",
	"July",
	"August",
	"September",
	"October",
	"November",
	"December",
];

function pad(value: number, width = 2): string {
	return String(Math.abs(value)).padStart(width, "0");
}

/** The `os.date` field readers, in local time or UTC. */
function dateParts(date: Date, utc: boolean) {
	return utc
		? {
				year: date.getUTCFullYear(),
				month: date.getUTCMonth() + 1,
				day: date.getUTCDate(),
				hour: date.getUTCHours(),
				min: date.getUTCMinutes(),
				sec: date.getUTCSeconds(),
				wday: date.getUTCDay() + 1,
			}
		: {
				year: date.getFullYear(),
				month: date.getMonth() + 1,
				day: date.getDate(),
				hour: date.getHours(),
				min: date.getMinutes(),
				sec: date.getSeconds(),
				wday: date.getDay() + 1,
			};
}

/** The Luau `os` library (browser subset). */
export const os = {
	/** CPU-ish time in seconds (monotonic time since page load). */
	clock(): number {
		return performance.now() / 1000;
	},
	/**
	 * `os.time()` — Unix time in whole seconds. Given a date table it converts
	 * that instead, reading the fields as **UTC** (as the engine does) and
	 * defaulting `hour` to 12, `min`/`sec` to 0, exactly like Lua.
	 */
	time(t?: DateTable): number {
		if (t === undefined) return Math.floor(Date.now() / 1000);
		return Math.floor(
			Date.UTC(
				t.year,
				t.month - 1,
				t.day,
				t.hour ?? 12,
				t.min ?? 0,
				t.sec ?? 0,
			) / 1000,
		);
	},
	/** `os.difftime(t2, t1)` — seconds between two `os.time` values. */
	difftime(t2: number, t1: number): number {
		return t2 - t1;
	},
	/**
	 * `os.date([format], [time])` — formats `time` (default: now).
	 *
	 * A leading `!` reads the clock as UTC instead of local time. `"*t"` (or
	 * `"!*t"`) returns a {@link DateTable} rather than a string; anything else is
	 * a strftime-style format over the specifiers Roblox code uses: `%a %A %b %B
	 * %c %d %H %I %j %m %M %p %S %x %X %y %Y %%`. An unknown specifier is left
	 * as written rather than guessed at.
	 */
	date(format = "%c", time?: number): string | DateTable {
		const utc = format.startsWith("!");
		const spec = utc ? format.slice(1) : format;
		const date = new Date((time ?? os.time()) * 1000);
		const parts = dateParts(date, utc);
		if (spec === "*t") {
			const startOfYear = utc
				? Date.UTC(parts.year, 0, 1)
				: new Date(parts.year, 0, 1).getTime();
			const dayMs = 86_400_000;
			return {
				...parts,
				yday: Math.floor((date.getTime() - startOfYear) / dayMs) + 1,
				isdst: false,
			};
		}
		const hour12 = parts.hour % 12 === 0 ? 12 : parts.hour % 12;
		const weekday = WEEKDAYS[parts.wday - 1] ?? "";
		const month = MONTHS[parts.month - 1] ?? "";
		const dateText = `${pad(parts.month)}/${pad(parts.day)}/${pad(parts.year % 100)}`;
		const timeText = `${pad(parts.hour)}:${pad(parts.min)}:${pad(parts.sec)}`;
		return spec.replace(/%(.)/g, (whole: string, key: string): string => {
			switch (key) {
				case "a":
					return weekday.slice(0, 3);
				case "A":
					return weekday;
				case "b":
					return month.slice(0, 3);
				case "B":
					return month;
				case "c":
					return `${weekday.slice(0, 3)} ${month.slice(0, 3)} ${pad(
						parts.day,
					)} ${timeText} ${parts.year}`;
				case "d":
					return pad(parts.day);
				case "H":
					return pad(parts.hour);
				case "I":
					return pad(hour12);
				case "j": {
					const startOfYear = utc
						? Date.UTC(parts.year, 0, 1)
						: new Date(parts.year, 0, 1).getTime();
					return pad(
						Math.floor((date.getTime() - startOfYear) / 86_400_000) + 1,
						3,
					);
				}
				case "m":
					return pad(parts.month);
				case "M":
					return pad(parts.min);
				case "p":
					return parts.hour < 12 ? "AM" : "PM";
				case "S":
					return pad(parts.sec);
				case "x":
					return dateText;
				case "X":
					return timeText;
				case "y":
					return pad(parts.year % 100);
				case "Y":
					return String(parts.year);
				case "%":
					return "%";
				default:
					return whole;
			}
		});
	},
};

// --- bit32 -------------------------------------------------------------------

/** Luau's shifts saturate past the word: 32 or more clears the value. */
function shiftOut(disp: number): boolean {
	return disp >= 32 || disp <= -32;
}

/**
 * The Luau `bit32` library — 32-bit unsigned arithmetic, so every result comes
 * back through `>>> 0` rather than as JS's signed `| 0`.
 *
 * The one place JS and Luau genuinely differ is displacement: JS masks a shift
 * count to 5 bits (`x << 32` is `x`), Luau clears the value instead. These
 * follow Luau.
 */
export const bit32 = {
	band(...values: number[]): number {
		return values.reduce((a, b) => a & b, -1) >>> 0;
	},
	bor(...values: number[]): number {
		return values.reduce((a, b) => a | b, 0) >>> 0;
	},
	bxor(...values: number[]): number {
		return values.reduce((a, b) => a ^ b, 0) >>> 0;
	},
	bnot(value: number): number {
		return ~value >>> 0;
	},
	btest(...values: number[]): boolean {
		return bit32.band(...values) !== 0;
	},
	lshift(value: number, disp: number): number {
		const by = Math.trunc(disp);
		if (shiftOut(by)) return 0;
		return by >= 0 ? (value << by) >>> 0 : value >>> -by;
	},
	rshift(value: number, disp: number): number {
		const by = Math.trunc(disp);
		if (shiftOut(by)) return 0;
		return by >= 0 ? value >>> by : (value << -by) >>> 0;
	},
	/** Arithmetic: the sign bit fills, so a negative value saturates to all-ones. */
	arshift(value: number, disp: number): number {
		const by = Math.trunc(disp);
		if (by >= 32) return (value | 0) < 0 ? 0xffffffff : 0;
		if (by <= -32) return 0;
		return by >= 0 ? (value >> by) >>> 0 : (value << -by) >>> 0;
	},
	lrotate(value: number, disp: number): number {
		const by = ((Math.trunc(disp) % 32) + 32) % 32;
		return ((value << by) | (value >>> (32 - by))) >>> 0;
	},
	rrotate(value: number, disp: number): number {
		return bit32.lrotate(value, -disp);
	},
	/** `bit32.extract(n, field, width)` — `width` bits starting at bit `field`. */
	extract(n: number, field: number, width = 1): number {
		if (width >= 32) return n >>> 0;
		return (n >>> field) & ((1 << width) - 1);
	},
	/** `bit32.replace(n, v, field, width)` — `v` written into that bit range. */
	replace(n: number, v: number, field: number, width = 1): number {
		if (width >= 32) return v >>> 0;
		const mask = ((1 << width) - 1) << field;
		return (((n & ~mask) | ((v << field) & mask)) >>> 0) as number;
	},
	/** Leading zero bits; 32 for zero. */
	countlz(value: number): number {
		return Math.clz32(value);
	},
	/** Trailing zero bits; 32 for zero. */
	countrz(value: number): number {
		const word = value >>> 0;
		if (word === 0) return 32;
		return 31 - Math.clz32(word & -word);
	},
	/** `bit32.byteswap` — the word with its four bytes reversed. */
	byteswap(value: number): number {
		const word = value >>> 0;
		return (
			(((word & 0xff) << 24) |
				((word & 0xff00) << 8) |
				((word >>> 8) & 0xff00) |
				((word >>> 24) & 0xff)) >>>
			0
		);
	},
};

// --- utf8 --------------------------------------------------------------------

/**
 * The Luau `utf8` library.
 *
 * One deliberate difference, the same one {@link string} carries: the engine's
 * offsets are **byte** offsets into a UTF-8 string, and loom's are offsets into
 * a JS string, which is UTF-16. `char`, `len`, `codepoint` and the normalizers
 * therefore agree with the engine exactly — they deal in code points — while
 * the positions `codes`, `offset` and `graphemes` hand back are code-unit
 * positions, the ones {@link string.sub} on the same string expects. ASCII, and
 * so most UI source, cannot tell the two apart.
 */
export const utf8 = {
	/** The engine's `utf8.charpattern`, verbatim, for code that passes it on. */
	charpattern: "[\0-\x7F\xC2-\xFD][\x80-\xBF]*",
	/** `utf8.char` — the string for those code points. */
	char(...codepoints: number[]): string {
		return String.fromCodePoint(...codepoints);
	},
	/** `utf8.codepoint` — the code points of `s[i..j]`, as a tuple. */
	codepoint(s: string, i = 1, j: number = i): number[] {
		const start = Math.max(Math.trunc(i), 1);
		const end = Math.min(Math.trunc(j), s.length);
		const points: number[] = [];
		for (let k = start; k <= end; k++) {
			const point = s.codePointAt(k - 1);
			if (point === undefined) continue;
			// A low surrogate is the tail of the pair before it, never its own.
			const code = s.charCodeAt(k - 1);
			if (code >= 0xdc00 && code <= 0xdfff) continue;
			points.push(point);
		}
		return points;
	},
	/** `utf8.len` — how many code points `s[i..j]` holds. */
	len(s: string, i = 1, j = -1): number {
		return Array.from(string.sub(s, i, j)).length;
	},
	/** `utf8.codes` — `for (const [position, codepoint] of utf8.codes(s))`. */
	*codes(s: string): IterableIterator<[number, number]> {
		let index = 0;
		while (index < s.length) {
			const point = s.codePointAt(index);
			if (point === undefined) return;
			yield [index + 1, point];
			index += point > 0xffff ? 2 : 1;
		}
	},
	/**
	 * `utf8.offset(s, n, i?)` — the position of the nth code point from `i`
	 * (negative `n` counts back), or `nil` when it falls outside the string.
	 */
	offset(s: string, n: number, i?: number): number | undefined {
		const positions = [...utf8.codes(s)].map(([position]) => position);
		positions.push(s.length + 1); // the one-past-the-end position Lua allows
		const from = i ?? (n >= 0 ? 1 : s.length + 1);
		const anchor = positions.indexOf(from);
		if (anchor === -1) return undefined;
		const target = n > 0 ? anchor + n - 1 : anchor + n;
		return positions[target];
	},
	/** `utf8.graphemes` — the `[start, end]` span of each grapheme. */
	*graphemes(s: string): IterableIterator<[number, number]> {
		for (const [position, point] of utf8.codes(s)) {
			yield [position, position + (point > 0xffff ? 1 : 0)];
		}
	},
	nfcnormalize(s: string): string {
		return s.normalize("NFC");
	},
	nfdnormalize(s: string): string {
		return s.normalize("NFD");
	},
};

// --- debug -------------------------------------------------------------------

/** Open `debug.profilebegin` labels, so `profileend` closes the innermost. */
const profileLabels: string[] = [];

/**
 * The Roblox `debug` library. The profiling calls are wired to the browser's
 * own performance timeline — `profilebegin`/`profileend` become a `measure` the
 * devtools Performance panel shows — so the instrumentation a Roblox author
 * already wrote keeps paying off here. The memory-category calls have no
 * browser counterpart and are honest no-ops.
 */
export const debug = {
	/** `debug.traceback` — the JS stack, which is the real one here. */
	traceback(message?: string, _level?: number): string {
		const stack = new Error(message ?? "").stack ?? "";
		return message === undefined ? stack : `${message}\n${stack}`;
	},
	profilebegin(label: string): void {
		profileLabels.push(label);
		performance.mark(`loom:${label}:begin`);
	},
	profileend(): void {
		const label = profileLabels.pop();
		if (label === undefined) return;
		try {
			performance.measure(label, `loom:${label}:begin`);
		} catch {
			// A mark cleared out from under us is not worth failing a render over.
		}
	},
	setmemorycategory(_category: string): void {},
	resetmemorycategory(): void {},
	/**
	 * `debug.info` — the engine reads its answers out of the Luau VM, which does
	 * not exist here, so this returns the empty tuple. Callers destructure it
	 * (`const [source] = debug.info(1, "s")`) and read nils, rather than
	 * crashing on a missing function.
	 */
	info(..._args: unknown[]): unknown[] {
		return [];
	},
};

// --- buffer ------------------------------------------------------------------

/**
 * A Luau `buffer`: a fixed-size block of bytes. Luau's is a distinct primitive
 * type, so this is a class rather than a bare `ArrayBuffer` — {@link typeOf}
 * recognizes it and answers `"buffer"`.
 */
export class LuauBuffer {
	readonly bytes: Uint8Array;
	readonly view: DataView;

	constructor(size: number) {
		this.bytes = new Uint8Array(Math.max(Math.trunc(size), 0));
		this.view = new DataView(this.bytes.buffer);
	}
}

function bufferBounds(b: LuauBuffer, offset: number, size: number): number {
	const at = Math.trunc(offset);
	if (at < 0 || at + size > b.bytes.length) {
		throw new Error("buffer access out of bounds");
	}
	return at;
}

/**
 * The Luau `buffer` library — little-endian, like the engine's, and bounds
 * checked (an out-of-range access throws, as it does there).
 *
 * Strings are bytes: `fromstring`/`tostring` and `readstring`/`writestring` map
 * each code unit to one byte (latin-1), which is the same choice
 * {@link string.char} and {@link string.byte} make.
 */
export const buffer = {
	create(size: number): LuauBuffer {
		return new LuauBuffer(size);
	},
	fromstring(s: string): LuauBuffer {
		const b = new LuauBuffer(s.length);
		for (let i = 0; i < s.length; i++) b.bytes[i] = s.charCodeAt(i) & 0xff;
		return b;
	},
	tostring(b: LuauBuffer): string {
		let out = "";
		for (const byte of b.bytes) out += String.fromCharCode(byte);
		return out;
	},
	len(b: LuauBuffer): number {
		return b.bytes.length;
	},
	readi8(b: LuauBuffer, offset: number): number {
		return b.view.getInt8(bufferBounds(b, offset, 1));
	},
	readu8(b: LuauBuffer, offset: number): number {
		return b.view.getUint8(bufferBounds(b, offset, 1));
	},
	readi16(b: LuauBuffer, offset: number): number {
		return b.view.getInt16(bufferBounds(b, offset, 2), true);
	},
	readu16(b: LuauBuffer, offset: number): number {
		return b.view.getUint16(bufferBounds(b, offset, 2), true);
	},
	readi32(b: LuauBuffer, offset: number): number {
		return b.view.getInt32(bufferBounds(b, offset, 4), true);
	},
	readu32(b: LuauBuffer, offset: number): number {
		return b.view.getUint32(bufferBounds(b, offset, 4), true);
	},
	readf32(b: LuauBuffer, offset: number): number {
		return b.view.getFloat32(bufferBounds(b, offset, 4), true);
	},
	readf64(b: LuauBuffer, offset: number): number {
		return b.view.getFloat64(bufferBounds(b, offset, 8), true);
	},
	writei8(b: LuauBuffer, offset: number, value: number): void {
		b.view.setInt8(bufferBounds(b, offset, 1), value);
	},
	writeu8(b: LuauBuffer, offset: number, value: number): void {
		b.view.setUint8(bufferBounds(b, offset, 1), value);
	},
	writei16(b: LuauBuffer, offset: number, value: number): void {
		b.view.setInt16(bufferBounds(b, offset, 2), value, true);
	},
	writeu16(b: LuauBuffer, offset: number, value: number): void {
		b.view.setUint16(bufferBounds(b, offset, 2), value, true);
	},
	writei32(b: LuauBuffer, offset: number, value: number): void {
		b.view.setInt32(bufferBounds(b, offset, 4), value, true);
	},
	writeu32(b: LuauBuffer, offset: number, value: number): void {
		b.view.setUint32(bufferBounds(b, offset, 4), value, true);
	},
	writef32(b: LuauBuffer, offset: number, value: number): void {
		b.view.setFloat32(bufferBounds(b, offset, 4), value, true);
	},
	writef64(b: LuauBuffer, offset: number, value: number): void {
		b.view.setFloat64(bufferBounds(b, offset, 8), value, true);
	},
	/** `buffer.readstring(b, offset, count)` — `count` bytes as a string. */
	readstring(b: LuauBuffer, offset: number, count: number): string {
		const at = bufferBounds(b, offset, Math.max(Math.trunc(count), 0));
		let out = "";
		for (let i = 0; i < count; i++) {
			out += String.fromCharCode(b.bytes[at + i] as number);
		}
		return out;
	},
	/** `buffer.writestring(b, offset, s, count?)` — `count` defaults to all of `s`. */
	writestring(b: LuauBuffer, offset: number, s: string, count?: number): void {
		const length = Math.min(count ?? s.length, s.length);
		const at = bufferBounds(b, offset, length);
		for (let i = 0; i < length; i++) b.bytes[at + i] = s.charCodeAt(i) & 0xff;
	},
	/** `buffer.copy(target, targetOffset, source, sourceOffset?, count?)`. */
	copy(
		target: LuauBuffer,
		targetOffset: number,
		source: LuauBuffer,
		sourceOffset = 0,
		count?: number,
	): void {
		const from = Math.trunc(sourceOffset);
		const length = count ?? source.bytes.length - from;
		bufferBounds(source, from, length);
		const to = bufferBounds(target, targetOffset, length);
		target.bytes.set(source.bytes.subarray(from, from + length), to);
	},
	/** `buffer.fill(b, offset, value, count?)`. */
	fill(b: LuauBuffer, offset: number, value: number, count?: number): void {
		const at = Math.trunc(offset);
		const length = count ?? b.bytes.length - at;
		bufferBounds(b, at, length);
		b.bytes.fill(value & 0xff, at, at + length);
	},
};

// --- coroutine ---------------------------------------------------------------

/** The four states Lua's `coroutine.status` reports. */
export type LuauThreadStatus = "suspended" | "running" | "normal" | "dead";

/**
 * A coroutine body. A **generator function** is the one that can actually
 * suspend; a plain function is accepted (roblox-ts emits plenty of them) and
 * simply runs start to finish on its first resume, because a JS frame with no
 * `yield` in it has no suspension point to stop at. The return is `unknown`
 * rather than a generator union so that both spellings pass without a cast —
 * {@link LuauThread.step} is what tells them apart, at run time.
 */
export type LuauThreadBody = (...args: never[]) => unknown;

/**
 * A Luau thread, backed by a JS generator.
 *
 * **The boundary, stated plainly.** Luau can suspend a coroutine from any depth
 * of the call stack: `coroutine.yield()` inside a function inside a function
 * unwinds back to whoever resumed it. JS generators can only suspend their own
 * frame, and only at a literal `yield` keyword — there is no way to pause an
 * arbitrary JS call stack from a browser page. So loom maps a coroutine onto a
 * generator, which gets the whole model right *except* for yielding across a
 * function boundary, and {@link coroutine.yield} throws a `loom:` error naming
 * that limit rather than quietly returning a value the caller never yielded.
 * Write the body as `function* () { … yield x; … }` and everything else here —
 * resume arguments, yielded values, status transitions, `wrap`, `close` — is the
 * real semantics.
 */
export class LuauThread {
	/** @internal The body, until the first resume calls it. */
	private readonly body: LuauThreadBody;
	/** @internal The generator the body returned, once it has been started. */
	private iterator: Iterator<unknown, unknown, unknown> | undefined;
	/** @internal */
	state: LuauThreadStatus = "suspended";

	constructor(body: LuauThreadBody) {
		this.body = body;
	}

	/** Lua's `coroutine.status(co)` for this thread. */
	get status(): LuauThreadStatus {
		return this.state;
	}

	/**
	 * @internal Advance the thread one step, starting it if it has not run yet.
	 *
	 * The first resume's arguments are the body's parameters; every later one
	 * supplies the value the paused `yield` expression evaluates to. A single
	 * argument arrives as itself and several arrive as an array, because a JS
	 * `yield` expression is one value and a Lua one is a tuple.
	 */
	step(args: unknown[]): IteratorResult<unknown, unknown> {
		if (this.iterator === undefined) {
			const started = (this.body as (...a: unknown[]) => unknown)(...args);
			const candidate = started as Iterator<unknown, unknown, unknown> | null;
			if (
				candidate !== null &&
				typeof candidate === "object" &&
				typeof candidate.next === "function"
			) {
				this.iterator = candidate;
			} else {
				// A plain function body: it already ran to completion, and there was
				// never a point at which it could have suspended.
				return { done: true, value: started };
			}
		}
		const resumed =
			args.length === 0 ? undefined : args.length === 1 ? args[0] : args;
		return this.iterator.next(resumed);
	}

	/**
	 * @internal Run the generator's `finally` blocks and mark the thread dead —
	 * the closest thing a generator has to Lua's to-be-closed variables.
	 */
	finish(): void {
		this.state = "dead";
		this.iterator?.return?.(undefined);
	}
}

/**
 * The resume stack: the innermost entry is the running thread, the ones beneath
 * it are `"normal"` (resumed something else and are waiting on it), and an empty
 * stack means the main thread — which is why `coroutine.running()` answers `nil`
 * there, exactly as Lua 5.1 and Luau do.
 */
const threadStack: LuauThread[] = [];

/**
 * The Luau `coroutine` library, over JS generators. See {@link LuauThread} for
 * the one thing this mapping cannot do, and why.
 *
 * `resume` and `close` return the array-tuples the rest of this module uses for
 * Lua multi-returns, so `const [ok, value] = coroutine.resume(co)` reads exactly
 * as it does in Luau — the same shape {@link pcall} hands back, and for the same
 * reason.
 */
export const coroutine = {
	/** `coroutine.create` — a suspended thread; the body does not run yet. */
	create(fn: LuauThreadBody): LuauThread {
		return new LuauThread(fn);
	},
	/**
	 * `coroutine.resume(co, ...)` — `[true, ...values]` when the thread yields or
	 * returns, `[false, message]` when it errors (the error dies with the thread
	 * instead of unwinding the resumer, as it does in Luau).
	 */
	resume(co: LuauThread, ...args: unknown[]): [boolean, ...unknown[]] {
		if (!(co instanceof LuauThread)) {
			return [false, "loom: coroutine.resume expects a thread"];
		}
		if (co.state === "dead") return [false, "cannot resume dead coroutine"];
		if (co.state !== "suspended") {
			return [false, "cannot resume non-suspended coroutine"];
		}
		const parent = threadStack[threadStack.length - 1];
		if (parent) parent.state = "normal";
		co.state = "running";
		threadStack.push(co);
		try {
			const step = co.step(args);
			co.state = step.done ? "dead" : "suspended";
			return step.value === undefined ? [true] : [true, step.value];
		} catch (err) {
			co.state = "dead";
			return [false, err instanceof Error ? err.message : err];
		} finally {
			threadStack.pop();
			if (parent) parent.state = "running";
		}
	},
	/**
	 * `coroutine.yield` — the one call this mapping cannot honour.
	 *
	 * Suspending here would mean pausing the JS stack between this frame and the
	 * generator's, which no browser can do. Throwing a `loom:` error that names
	 * the fix is the honest answer; returning `undefined` and continuing would
	 * silently run the rest of the body at the wrong time.
	 */
	yield(..._values: unknown[]): never {
		throw new Error(
			threadStack.length === 0
				? "loom: attempt to yield from outside a coroutine"
				: "loom: coroutine.yield() cannot suspend a JavaScript frame — write the coroutine body as a generator (`function* () { … }`) and use the `yield` keyword directly",
		);
	},
	/**
	 * `coroutine.isyieldable()` — true inside a thread, false on the main one.
	 * A generator body genuinely *can* yield, so this answers about the thread,
	 * not about the {@link coroutine.yield} shim above.
	 */
	isyieldable(): boolean {
		return threadStack.length > 0;
	},
	/** `coroutine.running()` — the running thread, or `nil` on the main one. */
	running(): LuauThread | undefined {
		return threadStack[threadStack.length - 1];
	},
	/**
	 * `coroutine.status(co)`. A non-thread reports `"dead"` rather than raising
	 * the engine's type error — a status check should never be the thing that
	 * takes a preview down.
	 */
	status(co?: unknown): LuauThreadStatus {
		return co instanceof LuauThread ? co.state : "dead";
	},
	/**
	 * `coroutine.wrap(fn)` — a function that resumes the thread and returns the
	 * yielded value directly, re-throwing the body's error instead of reporting
	 * it in a tuple. One thread per `wrap`, as in Luau.
	 */
	wrap(fn: LuauThreadBody): (...args: unknown[]) => unknown {
		const co = new LuauThread(fn);
		return (...args: unknown[]) => {
			const [ok, value] = coroutine.resume(co, ...args);
			if (!ok) throw value instanceof Error ? value : new Error(String(value));
			return value;
		};
	},
	/**
	 * `coroutine.close(co)` — kills a suspended or dead thread and returns
	 * `[true]`, or `[false, message]` when the thread is still on the stack.
	 * Closing runs the generator's `finally` blocks, which is what Lua's
	 * to-be-closed variables amount to here.
	 */
	close(co: LuauThread): [boolean, ...unknown[]] {
		if (!(co instanceof LuauThread)) {
			return [false, "loom: coroutine.close expects a thread"];
		}
		if (co.state === "running" || co.state === "normal") {
			return [false, `cannot close a ${co.state} coroutine`];
		}
		try {
			co.finish();
		} catch (err) {
			return [false, err instanceof Error ? err.message : err];
		}
		return [true];
	},
};

// --- task --------------------------------------------------------------------

/** The cancelable handle `task.delay` returns (accepted by `task.cancel`). */
export interface TaskDelayHandle {
	cancelled: boolean;
	readonly timeout: ReturnType<typeof setTimeout>;
}

/**
 * Report a thread that died, the way the engine does.
 *
 * `task.spawn`/`task.defer` run the body on its own thread, so an error there
 * never reaches the caller — Roblox prints it to the output window and carries
 * on. Swallowing it entirely would leave an app author staring at a callback
 * that "just stopped"; `console.error` is that output window.
 */
function reportThreadError(where: string, err: unknown): void {
	console.error(`loom: ${where} thread errored:`, err);
}

/**
 * The Roblox `task` scheduling library, mapped onto browser timers (the subset
 * UI code uses). `task.wait` returns a Promise so `await task.wait(n)` works; a
 * bare synchronous `task.wait()` cannot block in the browser. `task.delay`
 * returns a handle `task.cancel` can revoke.
 *
 * `spawn` and `defer` return the {@link LuauThread} they run the body on, so
 * `task.cancel(thread)` and `coroutine.status(thread)` work on the result the
 * way they do in the engine.
 */
export const task = {
	/**
	 * `task.spawn(fn, ...)` — runs the body **immediately**, synchronously, up to
	 * its first yield, and returns its thread.
	 *
	 * The synchronous start is the whole difference between `spawn` and `defer`
	 * and it is load-bearing: app code writes `task.spawn(() => state.ready =
	 * true)` and then reads `state.ready` on the next line. Deferring to a
	 * microtask (which is what this used to do) makes that read fail, so the same
	 * source behaves differently in the preview than in Studio.
	 *
	 * A thread may be passed instead of a function, as in the engine, in which
	 * case it is resumed rather than created.
	 */
	spawn(fn: LuauThreadBody | LuauThread, ...args: unknown[]): LuauThread {
		const thread = fn instanceof LuauThread ? fn : new LuauThread(fn);
		const [ok, value] = coroutine.resume(thread, ...args);
		if (!ok) reportThreadError("task.spawn", value);
		return thread;
	},
	/**
	 * `task.defer(fn, ...)` — the same, one resumption cycle later. A microtask
	 * is the browser's closest equivalent: it runs after the current call stack
	 * unwinds but before the next frame or timer, which is where the engine's
	 * deferred threads land too.
	 */
	defer(fn: LuauThreadBody | LuauThread, ...args: unknown[]): LuauThread {
		const thread = fn instanceof LuauThread ? fn : new LuauThread(fn);
		queueMicrotask(() => {
			// `task.cancel` may have killed it in the meantime.
			if (thread.status === "dead") return;
			const [ok, value] = coroutine.resume(thread, ...args);
			if (!ok) reportThreadError("task.defer", value);
		});
		return thread;
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
	/** `task.cancel` — revokes a pending `delay`, or kills a spawned thread. */
	cancel(handle: TaskDelayHandle | LuauThread | undefined): void {
		if (!handle) return;
		if (handle instanceof LuauThread) {
			handle.finish();
			return;
		}
		clearTimeout(handle.timeout);
		handle.cancelled = true;
	},
	/**
	 * `task.wait(duration?)` — resolves with the seconds that **actually**
	 * elapsed, which is what the engine returns and not the duration asked for.
	 * Timers overshoot (a backgrounded tab clamps them to once a second), and
	 * animation code that integrates the returned delta drifts badly if it is
	 * handed the nominal value instead of the real one.
	 *
	 * Still a Promise: `await task.wait(n)` is the browser's only way to resume
	 * later, since a bare synchronous `task.wait()` cannot block the one thread
	 * the page has.
	 */
	wait(seconds = 0): Promise<number> {
		const started = performance.now();
		return new Promise((resolve) =>
			setTimeout(
				() => resolve((performance.now() - started) / 1000),
				Math.max(0, seconds) * 1000,
			),
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
	name: string | symbol,
	value: (...args: never[]) => unknown,
	/**
	 * Replace an existing member instead of bailing out. Only for names JS
	 * already defines with semantics no loom caller could want (`sub`), or where
	 * the roblox-ts spelling and the JS one disagree about the arguments (`sort`).
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
 * The symbol keys the preview's macro transform rewrites `.size()` and
 * `.isEmpty()` to (see `@loom-dev/preview`'s `transform.ts`).
 *
 * `Map`/`Set` are why this indirection exists. roblox-ts declares `size()` as a
 * *method* on both; JS defines `size` as a *property*, and one name cannot be
 * both. Redefining `Map.prototype.size` would reach every `Map` in the page —
 * React's, Vite's, loom's own scheduler (`dirty.size === 0` drives the frame
 * loop) — so the roblox-ts spelling is instead resolved through a key nothing
 * but the transform emits, and only previewed source is ever transformed.
 *
 * `Symbol.for`, not `Symbol()`: the emitted code and this module reach the key
 * independently, and the registry is what makes them the same symbol.
 */
export const LUAU_SIZE = Symbol.for("loom.size");
export const LUAU_IS_EMPTY = Symbol.for("loom.isEmpty");

/** A comparator the patched `sort` accepts: Lua's predicate or JS's number. */
type SortComparator = (a: unknown, b: unknown) => unknown;

/** `Array.prototype.sort`, as this module has to talk about it. */
type ArraySort = ((comp?: SortComparator) => unknown[]) & {
	[NATIVE_SORT]?: (comp?: SortComparator) => unknown[];
};

/**
 * The brand the sort patch stamps itself with, carrying the untouched native
 * `Array.prototype.sort` it wrapped.
 *
 * Without it, a second `applyPrototypePatches()` — or a second copy of this
 * module in one page, which a preview bundling both an app and loom can easily
 * produce — would wrap the wrapper, and every `.sort()` in the page would grow
 * another frame and another comparator round-trip. `Symbol.for`, like the macro
 * keys above, so both copies reach the same brand.
 */
const NATIVE_SORT = Symbol.for("loom.nativeSort");

/**
 * Install the roblox-ts macro methods on `Array.prototype`/`String.prototype`
 * (`.size()`, `.isEmpty()`, `.remove(i)`, `.unorderedRemove(i)`, `.clear()`,
 * and the `.sort()` that takes Luau's boolean predicate),
 * plus the Luau string methods roblox-ts calls off a string receiver
 * (`.lower()`, `.upper()`, `.sub()`, `.rep()`, `.find()`, `.gsub()`,
 * `.format()`) — each one delegating to the {@link string} library, so the
 * 1-based indices and tuple returns documented there apply here too.
 * Array indices are 0-based, matching roblox-ts TS-side array semantics (and
 * the lattice vitest shim). Guarded and non-enumerable; safe to call
 * repeatedly.
 */
export function applyPrototypePatches(): void {
	// The macro keys, on `Object.prototype` so one definition answers for every
	// receiver: `Map`/`Set` expose `size` as a number, the patched `Array`/
	// `String` expose it as a method, and a user class that wrote its own
	// `size()` keeps it. Symbol-keyed and non-enumerable, so `Object.keys`,
	// `for…in`, spread and `JSON.stringify` never see them.
	definePatch(
		Object.prototype,
		LUAU_SIZE,
		function (this: Record<string, unknown>) {
			const own = this.size;
			return typeof own === "function" ? own.call(this) : own;
		},
	);
	definePatch(
		Object.prototype,
		LUAU_IS_EMPTY,
		function (this: Record<string, unknown>) {
			const own = this.isEmpty;
			if (typeof own === "function") return own.call(this);
			const size = this.size;
			return (typeof size === "function" ? size.call(this) : size) === 0;
		},
	);
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
	// `sort` is FORCED, like `sub` below, and for a subtler reason. roblox-ts
	// compiles `arr.sort(cb)` to Luau's `table.sort`, whose comparator is a
	// *predicate*: `true` means "a comes before b". JS wants a negative, zero or
	// positive number, and a boolean coerces to 1/0 — so `true` reads as "a after
	// b" and `false` as "equal", and a roblox-ts comparator run through the
	// native sort scrambles the array instead of ordering it, silently.
	//
	// The wrapper looks at what the comparator actually returned rather than
	// sniffing it up front (a probe call would run a user comparator on values it
	// was never asked about). A number goes straight through untouched, which is
	// what keeps React, Vite and loom's own layout code — all sharing this one
	// prototype — on exactly native behaviour; only a boolean pays for the second
	// `comp(b, a)` probe that turns a predicate into an ordering, the same
	// translation {@link table.sort} does.
	const installedSort = Array.prototype.sort as unknown as ArraySort;
	const nativeSort = installedSort[NATIVE_SORT] ?? installedSort;
	const luauSort = function (this: unknown[], comp?: SortComparator) {
		if (comp === undefined) return nativeSort.call(this);
		return nativeSort.call(this, (a: unknown, b: unknown) => {
			const decision = comp(a, b);
			if (typeof decision !== "boolean") return decision;
			return decision ? -1 : comp(b, a) ? 1 : 0;
		});
	} as ArraySort;
	luauSort[NATIVE_SORT] = nativeSort;
	definePatch(
		Array.prototype,
		"sort",
		luauSort as unknown as (...args: never[]) => unknown,
		true,
	);
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
			replacement: GsubReplacement,
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
	definePatch(String.prototype, "len", function (this: string) {
		return string.len(this);
	});
	definePatch(String.prototype, "reverse", function (this: string) {
		return string.reverse(this);
	});
	definePatch(
		String.prototype,
		"byte",
		function (this: string, i?: number, j?: number) {
			return string.byte(this, i, j);
		},
	);
	definePatch(
		String.prototype,
		"gmatch",
		function (this: string, pattern: string) {
			return string.gmatch(this, pattern);
		},
	);
	// `match` is deliberately NOT patched, unlike the rest of this list. JS
	// already defines `String.prototype.match`, with different semantics (a
	// RegExp, and `null` when it misses), and these patches land on the page's
	// one shared prototype — forcing it the way `sub` is forced would rewrite
	// `match` for React, Vite and every other library in the page, not just for
	// previewed source. `string.match(s, pattern)`, the form roblox-ts code
	// overwhelmingly writes for the Luau one, is unaffected.
}
