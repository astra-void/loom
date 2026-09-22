/**
 * `@rbxts/react/jsx-dev-runtime` for the preview — the development twin of
 * `./jsx-runtime.ts`, with the same callback-ref mapping (see `./refs.ts`).
 */
import * as runtime from "react/jsx-dev-runtime";
import { withLuauRef } from "./refs.ts";

type JsxDev = (
	type: unknown,
	props: unknown,
	key: unknown,
	isStaticChildren: boolean,
	source?: unknown,
	self?: unknown,
) => unknown;

export const Fragment = runtime.Fragment;

export const jsxDEV: JsxDev = (type, props, key, isStatic, source, self) =>
	(runtime.jsxDEV as JsxDev)(
		type,
		withLuauRef(props),
		key,
		isStatic,
		source,
		self,
	);
