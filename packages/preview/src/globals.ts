/**
 * `@loom-dev/preview/globals` — installs the Roblox datatypes as globals the way
 * roblox-ts code expects (`UDim2.new` etc. without an import), and declares their
 * ambient types. The Vite plugin injects this before the app entry so a real
 * roblox-ts source tree runs unmodified.
 */
import { setImageResolver } from "@loom-dev/renderer";
import type * as runtime from "@loom-dev/runtime";
import { installGlobals } from "@loom-dev/runtime";

installGlobals();

/**
 * Point `rbxassetid://<id>` at the dev server's asset route (see
 * `./asset-proxy.ts`), which redirects to the CDN image. Synchronous: the
 * server does the lookup, the browser only follows a redirect. Anything that is
 * not an asset id is left alone — the renderer already loads plain URLs.
 */
setImageResolver((image) => {
	const id = /^rbxassetid:\/\/(\d+)$/.exec(image)?.[1];
	if (id === undefined) return undefined;
	// Widened rather than relying on `vite/client`: this module is typechecked by
	// the previewed app's tsconfig too, which need not pull Vite's types in.
	const meta = import.meta as ImportMeta & { env?: { BASE_URL?: string } };
	const base = meta.env?.BASE_URL ?? "/";
	return `${base.endsWith("/") ? base : `${base}/`}__loom/asset/${id}`;
});

// Diagnostic: if nothing mounts into #loom-root shortly after load, the entry
// likely doesn't self-mount (e.g. it only exports a component). Warn rather than
// leaving a silently blank preview.
if (typeof document !== "undefined") {
	setTimeout(() => {
		const root = document.getElementById("loom-root");
		if (root && root.childElementCount === 0) {
			console.warn(
				"[loom] nothing mounted into #loom-root after 2s — does your entry " +
					"call createRoot().render(<App />) at the top level?",
			);
		}
	}, 2000);
}

declare global {
	const UDim: typeof runtime.UDim;
	const UDim2: typeof runtime.UDim2;
	const Vector2: typeof runtime.Vector2;
	const Vector3: typeof runtime.Vector3;
	const Color3: typeof runtime.Color3;
	const ColorSequence: typeof runtime.ColorSequence;
	const ColorSequenceKeypoint: typeof runtime.ColorSequenceKeypoint;
	const Rect: typeof runtime.Rect;
	const CFrame: typeof runtime.CFrame;
	const TweenInfo: typeof runtime.TweenInfo;
	const Font: typeof runtime.Font;
	const Enum: typeof runtime.Enum;
	const game: runtime.DataModel;
	const Instance: typeof runtime.Instance;
	// Luau environment (`string` shadows the TS builtin *type* name, which is
	// fine — this declares a global *value*). `print` is deliberately absent:
	// lib.dom already declares `function print(): void` and a redeclaration is
	// a compile error; the runtime still overwrites the value at install time.
	const task: typeof runtime.task;
	const tick: typeof runtime.tick;
	const math: typeof runtime.math;
	const string: typeof runtime.string;
	const os: typeof runtime.os;
	const coroutine: typeof runtime.coroutine;
	const typeIs: typeof runtime.typeIs;
	const typeOf: typeof runtime.typeOf;
	const pcall: typeof runtime.pcall;
	const xpcall: typeof runtime.xpcall;
	const pairs: typeof runtime.pairs;
	const ipairs: typeof runtime.ipairs;
	const tostring: typeof runtime.tostring;
	const tonumber: typeof runtime.tonumber;
	const error: typeof runtime.error;
	const warn: typeof runtime.warn;
	const assert: typeof runtime.assert;
}
