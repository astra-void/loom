/**
 * `@rbxts/react/jsx-runtime` for the preview: browser React's automatic JSX
 * runtime, with a callback `ref` called with `undefined` where React passes
 * `null` — React-Lua's `nil` for a detached ref (see `./refs.ts`). Everything
 * else is React's own.
 *
 * The Vite plugin compiles previewed JSX against `@rbxts/react` as the import
 * source and aliases it here, so `<frame ref={(rbx) => …} />` gets the mapping
 * without the project changing a line. Bare `react/jsx-runtime` imports — the
 * project's dependencies — keep React's untouched runtime.
 */
import * as runtime from "react/jsx-runtime";
import { withLuauRef } from "./refs.ts";

type Jsx = (type: unknown, props: unknown, key?: unknown) => unknown;

export const Fragment = runtime.Fragment;

export const jsx: Jsx = (type, props, key) =>
	(runtime.jsx as Jsx)(type, withLuauRef(props), key);

export const jsxs: Jsx = (type, props, key) =>
	(runtime.jsxs as Jsx)(type, withLuauRef(props), key);
