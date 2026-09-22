/**
 * `compat/refs.ts` — React-Lua's `nil` for a detached ref, in browser React.
 *
 * React-Lua has no `null`. A ref React detaches — its instance unmounted, or
 * not mounted yet — goes back to `nil`, and roblox-ts code tests for that with
 * `ref.current !== undefined`, or `instance !== undefined` in a callback ref.
 * Browser React hands over `null` instead, which passes that test and is then
 * dereferenced (`null.AbsoluteSize`). Both ref kinds are mapped here, shared by
 * the `@rbxts/react` facade and its JSX runtimes.
 */

const LUAU_REF = Symbol.for("loom.luauRef");

/**
 * An object ref whose `current` reads `undefined` where browser React stores
 * `null`. It stays an ordinary `{ current }` to React, which only ever reads
 * and assigns `current`.
 */
export function luauRef<T>(ref: { current: T }): { current: T } {
	if (Object.hasOwn(ref, LUAU_REF)) return ref;
	let value = ref.current ?? (undefined as T);
	Object.defineProperty(ref, "current", {
		get: () => value,
		set: (next: T) => {
			value = next ?? (undefined as T);
		},
		enumerable: true,
		configurable: true,
	});
	Object.defineProperty(ref, LUAU_REF, { value: true });
	return ref;
}

type CallbackRef = (instance: unknown) => unknown;

/**
 * One wrapper per callback, so a stable callback stays a stable ref. React
 * detaches and re-attaches a ref whose identity changed between renders, and a
 * fresh wrapper every render would do that to every `useCallback` ref.
 */
const CALLBACK_REFS = new WeakMap<CallbackRef, CallbackRef>();

/** A callback ref that is called with `undefined` where React passes `null`. */
export function luauCallbackRef<T>(ref: T): T {
	if (typeof ref !== "function") return ref;
	const callback = ref as unknown as CallbackRef;
	let wrapped = CALLBACK_REFS.get(callback);
	if (!wrapped) {
		wrapped = (instance: unknown) => callback(instance ?? undefined);
		CALLBACK_REFS.set(callback, wrapped);
	}
	return wrapped as unknown as T;
}

/** `props` with a callback `ref` mapped (see {@link luauCallbackRef}). */
export function withLuauRef<P>(props: P): P {
	const ref = (props as { ref?: unknown } | null | undefined)?.ref;
	if (typeof ref !== "function") return props;
	return { ...props, ref: luauCallbackRef(ref) };
}
