/**
 * `@loom-dev/preview/globals` — installs the Roblox datatypes as globals the way
 * roblox-ts code expects (`UDim2.new` etc. without an import), and declares their
 * ambient types. The Vite plugin injects this before the app entry so a real
 * roblox-ts source tree runs unmodified.
 */
// The engine's own typefaces, for every family that may be redistributed.
// Without them each Roblox family falls through to `system-ui` — SF Pro on
// macOS, Segoe UI on Windows, Roboto on Linux — and since `AutomaticSize` and
// `TextWrapped` are driven by *measuring* the face, the same scene lays out
// differently on each machine. Showing what the engine will is the preview's
// whole job, so it loads them rather than leaving it to whoever embeds it.
//
// Here rather than in `./client.ts` because that is the react adapter's entry:
// this module is injected ahead of the app entry whichever frontend it uses, so
// a vide preview gets the same faces.
import "@loom-dev/renderer/fonts";
import { setImageResolver } from "@loom-dev/renderer";
import type * as runtime from "@loom-dev/runtime";
import { installGlobals } from "@loom-dev/runtime";

installGlobals();

/**
 * The build's baked asset manifest (`id` → emitted file), fetched at most once.
 * Absent — a build with no asset ids, or one made with `assets: false` — leaves
 * every id unresolved, which is what it was before the bake existed.
 *
 * The name is spelled out rather than imported from `./asset-proxy.ts`: that
 * module is the server half, and this one is bundled into the page.
 */
let bakedAssets: Promise<Record<string, string> | undefined> | undefined;
function manifest(base: string): Promise<Record<string, string> | undefined> {
	bakedAssets ??= fetch(`${base}__loom/assets.json`)
		.then((response) =>
			response.ok
				? (response.json() as Promise<Record<string, string>>)
				: undefined,
		)
		.catch(() => undefined);
	return bakedAssets;
}

/**
 * Resolve `rbxassetid://<id>` to something the browser can load.
 *
 * Under the **dev server**, the asset route (see `./asset-proxy.ts`), which
 * redirects to the CDN image — synchronous, because the server does the lookup
 * and the browser only follows a redirect. In a **static build** there is no
 * server, so the answer comes from the manifest the build baked, one lookup for
 * the whole page. Anything that is not an asset id is left alone — the renderer
 * already loads plain URLs.
 */
setImageResolver((image) => {
	const id = /^rbxassetid:\/\/(\d+)$/.exec(image)?.[1];
	if (id === undefined) return undefined;
	// `import.meta.env` is spelled out here, on purpose. Vite populates it by
	// *prepending an assignment* (`import.meta.env = {BASE_URL: …}`) to modules
	// whose transformed code mentions it by name — so binding `import.meta` to a
	// variable first hides the mention, the assignment never lands, and the read
	// runs against the browser's own `import.meta`, which has no `env` at all.
	// The base then silently fell back to "/" under every mount that has one (the
	// Next integration, the Astro embed) and the asset route 404'd.
	//
	// The cast is inline for the same reason, and widened rather than taken from
	// `vite/client`: this module is typechecked by the previewed app's tsconfig
	// too, which need not have Vite's types.
	const env = (
		import.meta as ImportMeta & { env?: { BASE_URL?: string; PROD?: boolean } }
	).env;
	const raw = env?.BASE_URL ?? "/";
	const base = raw.endsWith("/") ? raw : `${raw}/`;
	if (env?.PROD !== true) return `${base}__loom/asset/${id}`;
	return manifest(base).then((baked) => {
		const file = baked?.[id];
		return file === undefined ? undefined : `${base}${file}`;
	});
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
	const NumberSequence: typeof runtime.NumberSequence;
	const NumberSequenceKeypoint: typeof runtime.NumberSequenceKeypoint;
	const Rect: typeof runtime.Rect;
	const CFrame: typeof runtime.CFrame;
	const TweenInfo: typeof runtime.TweenInfo;
	const Font: typeof runtime.Font;
	const Random: typeof runtime.Random;
	const DateTime: typeof runtime.DateTime;
	const Enum: typeof runtime.Enum;
	// `Promise` is deliberately absent: lib.es5 already declares
	// `var Promise: PromiseConstructor` and a redeclaration is a compile error.
	// Unlike `print` below, the runtime does not overwrite the value either —
	// the page global stays the browser's. It has to: React, the Vite client and
	// loom's own prerender all reach for it, and the two Promises disagree where
	// it counts (`allSettled` resolves to `{status, value}` records in JS and to
	// `Promise.Status` in Roblox, and Roblox's `all` rejects a non-promise
	// entry), so whichever API owned the global, the other half of the page
	// would be wrong. App code gets the roblox-ts Promise as a module-scope
	// binding instead: the `loom-preview:roblox-promise` plugin in `./vite.ts`
	// appends `import { RobloxPromise as Promise } from "<runtime>"` to each
	// previewed module that mentions the name, which shadows the global for that
	// file alone. Its *types* come from `@rbxts/compiler-types` in the app's own
	// tsconfig.
	const game: runtime.DataModel;
	/** Roblox's bare alias for `game.Workspace`. */
	const workspace: runtime.LoomInstance;
	const Instance: typeof runtime.Instance;
	// Luau environment (`string` shadows the TS builtin *type* name, which is
	// fine — this declares a global *value*). `print` is deliberately absent:
	// lib.dom already declares `function print(): void` and a redeclaration is
	// a compile error; the runtime still overwrites the value at install time.
	const task: typeof runtime.task;
	const tick: typeof runtime.tick;
	const math: typeof runtime.math;
	const string: typeof runtime.string;
	const table: typeof runtime.table;
	const os: typeof runtime.os;
	const bit32: typeof runtime.bit32;
	const utf8: typeof runtime.utf8;
	const buffer: typeof runtime.buffer;
	const debug: typeof runtime.debug;
	const coroutine: typeof runtime.coroutine;
	const select: typeof runtime.select;
	const unpack: typeof runtime.unpack;
	const rawget: typeof runtime.rawget;
	const rawset: typeof runtime.rawset;
	const rawequal: typeof runtime.rawequal;
	const rawlen: typeof runtime.rawlen;
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
