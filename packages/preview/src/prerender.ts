/**
 * Build-time prerender: the `rbxassetid://` values a bundle cannot spell out.
 *
 * `./asset-proxy.ts` bakes the ids it can *read* in the emitted output, which
 * only finds the ones written as `rbxassetid://<digits>`. Real component
 * libraries compose them — `` `rbxassetid://${iconId}` `` over an icon table —
 * and after bundling that is a prefix, a `+`, and a few hundred bare numbers
 * indistinguishable from every other number in the chunk. Nothing is left to
 * match, so a static build painted no icons at all.
 *
 * So the ids are collected the only way that is exact: by *running* the scenes.
 * Every gallery target is mounted in node — happy-dom for the DOM, the real
 * react adapter, the real runtime — and the live instance tree is walked for
 * `Image` properties. That answers with what the page will actually ask for,
 * however the string was built, and nothing more: a 700-icon set contributes
 * the dozen icons the scenes really use.
 *
 * What it does *not* see is what the initial render does not reach — an icon
 * behind a hover state, or one a later network response supplies. Those stay
 * unresolved, which is the same place they were before this existed.
 *
 * Deliberately layout-free: `mountSync` takes a stub `computeLayout`, so the
 * WASM engine never loads and the mount is never sized. Nothing paints — the
 * DOM session has nothing to lay out — and the React tree, which is all this
 * needs, is built either way.
 */
import Module, { createRequire } from "node:module";
import { dirname, join, sep } from "node:path";
import { pathToFileURL } from "node:url";
import type { InlineConfig, Plugin } from "vite";
import { findLoomTargets } from "./gallery.ts";

/** Absolute paths of the modules the prerender drives the mount with. */
const requireFromPreview = createRequire(import.meta.url);

/**
 * `react` and the reconciler are CommonJS, and the preview plugin aliases them
 * to absolute paths so every consumer converges on one copy (see `./vite.ts`).
 * Under Vite's SSR module runner an absolute path is *inlined* — evaluated as
 * ESM — and CJS dies there on `module is not defined`; a bare id would have
 * been externalized to node instead, but the alias has already replaced it.
 *
 * So the same files are handed to node the only way left: `createRequire`. The
 * shim below is what the SSR graph imports, and node's require cache is keyed by
 * path, so everything that goes through here shares one module object.
 *
 * What that does *not* settle is the reconciler's own `require("react")`, which
 * node resolves from the reconciler's directory and no Vite alias can reach:
 * see {@link pinReconcilerReact}.
 */
function cjsExternalPaths(): Set<string> {
	const paths = new Set<string>();
	for (const id of ["react", "react/jsx-runtime", "react/jsx-dev-runtime"]) {
		try {
			paths.add(requireFromPreview.resolve(id));
		} catch {
			// A react the preview cannot see is a react the plugin never aliased.
		}
	}
	try {
		const fromAdapter = createRequire(
			requireFromPreview.resolve("@loom-dev/react"),
		);
		for (const id of ["react-reconciler", "react-reconciler/constants"]) {
			paths.add(fromAdapter.resolve(id));
		}
	} catch {
		// Workspace checkout: the reconciler is never aliased, so it stays a bare
		// id and Vite externalizes it on its own.
	}
	return paths;
}

/** The react ids the reconciler may ask node for, mapped to loom's copies. */
function pinnedReact(): Map<string, string> {
	const pinned = new Map<string, string>();
	for (const id of ["react", "react/jsx-runtime", "react/jsx-dev-runtime"]) {
		try {
			pinned.set(id, requireFromPreview.resolve(id));
		} catch {
			// A react the preview cannot see is a react it cannot pin either.
		}
	}
	return pinned;
}

/** The reconciler's package directory, the only place the pin applies. */
function reconcilerDir(): string | undefined {
	try {
		const fromAdapter = createRequire(
			requireFromPreview.resolve("@loom-dev/react"),
		);
		return dirname(fromAdapter.resolve("react-reconciler")) + sep;
	} catch {
		return undefined;
	}
}

/**
 * Answer the CJS reconciler's `require("react")` with loom's pinned react, for
 * as long as the prerender runs. Returns the undo.
 *
 * Everything else converges on one react through `resolve.alias` (see
 * `./vite.ts`), but the reconciler is handed to *node* by
 * {@link cjsInteropPlugin}, and node resolves its `require("react")` from the
 * reconciler's own directory — where no Vite alias reaches. In a workspace that
 * lands on the same react regardless. In an installed app it need not: hoist
 * `@loom-dev/react` next to a host's react 19 while loom's own 18 stays nested
 * under `loom-dev`, and the reconciler gets the host's copy — then reconciler
 * 0.29 dies reading react 18's since-renamed internals, `Cannot read properties
 * of undefined (reading 'ReactCurrentBatchConfig')`, at evaluation, before a
 * single scene mounts.
 *
 * The adapter's peer range says react 18 only, which is what should keep an
 * installer from placing it there at all. This does not trust that: a range is
 * advice, `--legacy-peer-deps` ignores it, and an already-installed tree keeps
 * whatever layout it was given.
 *
 * Patching node's resolver is process-wide, so the redirect is narrowed to
 * requests whose *parent* is inside the reconciler: a host framework building
 * its own React 19 pages in this same process resolves exactly as it did.
 */
function pinReconcilerReact(): () => void {
	const dir = reconcilerDir();
	const pinned = pinnedReact();
	if (dir === undefined || pinned.size === 0) return () => undefined;
	return pinResolutionUnder(dir, pinned);
}

/**
 * Redirect `request` → file for requires made from under `dir`, and hand back
 * the undo. Split out of {@link pinReconcilerReact} so a test can aim it at a
 * fixture instead of at whatever react this checkout happens to resolve.
 */
export function pinResolutionUnder(
	dir: string,
	pinned: ReadonlyMap<string, string>,
): () => void {
	const loader = Module as unknown as {
		_resolveFilename: (
			this: unknown,
			request: string,
			parent: { filename?: string | null } | undefined,
			...rest: unknown[]
		) => string;
	};
	const original = loader._resolveFilename;
	loader._resolveFilename = function patched(request, parent, ...rest) {
		const target = pinned.get(request);
		if (target !== undefined && parent?.filename?.startsWith(dir) === true) {
			return target;
		}
		return original.call(this, request, parent, ...rest);
	};
	return () => {
		loader._resolveFilename = original;
	};
}

const CJS_PREFIX = "\0loom-prerender-cjs:";

/** Hands the aliased CJS copies to node instead of the SSR ESM evaluator. */
function cjsInteropPlugin(paths: ReadonlySet<string>): Plugin {
	return {
		name: "loom-prerender:cjs-interop",
		enforce: "pre",
		resolveId(source) {
			return paths.has(source) ? `${CJS_PREFIX}${source}` : undefined;
		},
		load(id) {
			if (!id.startsWith(CJS_PREFIX)) return undefined;
			const file = id.slice(CJS_PREFIX.length);
			// Required here as well as in the shim: the export names have to be
			// known statically for the SSR graph to bind them, and the two requires
			// share node's cache, so this costs one module load, not two.
			const exported = requireFromPreview(file) as Record<string, unknown>;
			const names = Object.keys(exported).filter((name) =>
				/^[A-Za-z_$][\w$]*$/.test(name),
			);
			const href = JSON.stringify(pathToFileURL(file).href);
			const path = JSON.stringify(file);
			return [
				'import { createRequire } from "node:module";',
				`const mod = createRequire(${href})(${path});`,
				"export default mod;",
				names.length > 0 ? `export const { ${names.join(", ")} } = mod;` : "",
			].join("\n");
		},
	};
}

/** The DOM globals a mount reaches for, taken from one happy-dom window. */
const DOM_GLOBALS = [
	"window",
	"document",
	"navigator",
	"getComputedStyle",
	"requestAnimationFrame",
	"cancelAnimationFrame",
	"Node",
	"Element",
	"HTMLElement",
	"SVGElement",
	"Event",
	"CustomEvent",
	"MutationObserver",
	"ResizeObserver",
] as const;

/**
 * Publish a happy-dom window onto `globalThis` and hand back the undo. Assigned
 * through `defineProperty`: some of these (`navigator`) are getter-only on the
 * node global object and a plain assignment throws.
 */
function installDom(window: Record<string, unknown>): () => void {
	const saved = new Map<string, PropertyDescriptor | undefined>();
	for (const key of DOM_GLOBALS) {
		const value = window[key];
		if (value === undefined) continue;
		saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
		Object.defineProperty(globalThis, key, {
			configurable: true,
			writable: true,
			value,
		});
	}
	return () => {
		for (const [key, descriptor] of saved) {
			if (descriptor) Object.defineProperty(globalThis, key, descriptor);
			else delete (globalThis as Record<string, unknown>)[key];
		}
	};
}

/**
 * A `ComputeLayout` that answers every node with a zero rect. The real engine is
 * WASM and this pass has nothing to measure — the tree, not the picture, is what
 * gets read.
 */
function stubLayout(root: unknown): { rects: Record<string, unknown> } {
	const rects: Record<string, unknown> = {};
	const walk = (node: { id?: string; children?: unknown[] }): void => {
		rects[node.id ?? "?"] = { rect: { x: 0, y: 0, width: 0, height: 0 } };
		for (const child of node.children ?? []) {
			walk(child as { id?: string; children?: unknown[] });
		}
	};
	walk(root as { id?: string; children?: unknown[] });
	return { rects };
}

export interface PrerenderOptions {
	/** The previewed project root, as the build resolved it. */
	root: string;
	/** Target discovery patterns — the same list gallery mode was given. */
	patterns: string[];
	/** Package redirects, forwarded to the SSR plugin instance verbatim. */
	shims?: Record<string, string>;
	/** Where a target that will not render says so; never throws the build. */
	warn: (message: string) => void;
}

/**
 * Mount every discovered target and return the `Image` values their trees hold.
 *
 * Returns raw `Image` strings, not ids: what counts as an asset id is the
 * caller's rule (`./asset-proxy.ts` owns it), and a plain URL among them is
 * simply not an id.
 *
 * Never throws. A target that fails to import or render is warned about and
 * skipped — one broken scene must not cost the build the other scenes' icons.
 */
export async function prerenderImages(
	options: PrerenderOptions,
): Promise<Set<string>> {
	const images = new Set<string>();
	const targets = findLoomTargets(options.root, options.patterns);
	if (targets.length === 0) return images;

	const { Window } = await import("happy-dom");
	const { createServer } = await import("vite");

	const window = new Window({ url: "http://localhost/" });
	const restoreDom = installDom(window as unknown as Record<string, unknown>);
	const restoreReact = pinReconcilerReact();
	// Imported here, not at module scope: `./vite.ts` reaches this module through
	// a dynamic import, and a static edge back would be a cycle at load time.
	const { loomPreview } = await import("./vite.ts");
	const config: InlineConfig = {
		root: options.root,
		configFile: false,
		logLevel: "silent",
		appType: "custom",
		// A server that never listens: `ssrLoadModule` is the whole point of it,
		// and a build has no business opening a port (or an HMR socket).
		server: { middlewareMode: true, hmr: false, watch: null },
		plugins: [
			loomPreview({
				html: false,
				assets: false,
				...(options.shims ? { shims: options.shims } : {}),
			}),
			cjsInteropPlugin(cjsExternalPaths()),
		],
	};

	// The globals and node's patched resolver are restored whatever happens —
	// including a `createServer` that never returns one, which would otherwise
	// leave a react redirect installed over the rest of the host's build.
	try {
		const server = await createServer(config);
		try {
			// Absolute paths, so these land on the same module instances the plugin's
			// aliases point every previewed import at.
			const runtime = (await server.ssrLoadModule(
				requireFromPreview.resolve("@loom-dev/runtime"),
			)) as { installGlobals: () => void };
			// Before any target module evaluates: roblox-ts sources use `UDim2` and
			// friends at module scope, with no import to make them appear.
			runtime.installGlobals();
			const adapter = (await server.ssrLoadModule(
				requireFromPreview.resolve("@loom-dev/react"),
			)) as {
				mountSync: (
					element: unknown,
					mount: unknown,
					options: { computeLayout: typeof stubLayout },
				) => { world: { rootInstance: LiveInstance }; unmount: () => void };
			};
			const react = (await server.ssrLoadModule(
				requireFromPreview.resolve("react"),
			)) as ReactLike;

			for (const relPath of targets) {
				// A Luau target runs in a WASM VM this Node pass does not boot; its
				// `rbxassetid` images are left to the dev-server route.
				if (relPath.endsWith(".luau")) continue;
				try {
					const module = (await server.ssrLoadModule(
						join(options.root, relPath),
					)) as { preview?: { render?: unknown } };
					const render = module.preview?.render;
					if (typeof render !== "function") {
						// Not a prerender failure: the gallery shell reports this shape
						// error in the browser, where the user is looking.
						continue;
					}
					const mount = window.document.createElement("div");
					let failure: unknown;
					// As a component behind a boundary, exactly like the gallery shell
					// mounts it: a `render` that uses hooks renders here the way it will
					// there, and one that throws leaves a *mounted* world to dispose
					// rather than an orphan holding the runtime's PlayerGui.
					const mounted = adapter.mountSync(
						react.createElement(
							errorBoundary(react, (error) => {
								failure = error;
							}),
							null,
							react.createElement(render),
						),
						mount,
						{ computeLayout: stubLayout },
					);
					collectImages(mounted.world.rootInstance, images);
					mounted.unmount();
					if (failure !== undefined) throw failure;
				} catch (err: unknown) {
					const message = err instanceof Error ? err.message : String(err);
					options.warn(`could not prerender ${relPath}: ${message}`);
				}
			}
		} finally {
			await server.close();
		}
	} finally {
		restoreReact();
		restoreDom();
		// happy-dom keeps timers of its own (its `requestAnimationFrame` is one),
		// and a build that has finished should not be held open by them.
		await window.happyDOM?.close();
	}
	return images;
}

/** The slice of React the prerender drives the mount through. */
interface ReactLike {
	Component: new (
		props: unknown,
	) => {
		props: { children?: unknown };
		state: { failed?: boolean } | null;
	};
	createElement: (
		type: unknown,
		props?: unknown,
		...children: unknown[]
	) => unknown;
}

/**
 * The gallery shell's error boundary, minus the chrome: a scene that throws
 * partway still contributes the images its mounted part holds, and the world it
 * mounted into is a *live* one the caller can dispose. Reports the error rather
 * than swallowing it — the target is still warned about.
 */
function errorBoundary(react: ReactLike, onError: (error: unknown) => void) {
	return class Boundary extends react.Component {
		static getDerivedStateFromError(): { failed: boolean } {
			return { failed: true };
		}
		componentDidCatch(error: unknown): void {
			onError(error);
		}
		render(): unknown {
			return this.state?.failed === true ? null : this.props.children;
		}
	};
}

/** The slice of a live `LoomInstance` this walk needs. */
interface LiveInstance {
	Image?: unknown;
	GetDescendants(): LiveInstance[];
}

/**
 * Every `Image` in the mounted tree. `Image` alone, because it is the only
 * property the renderer ever turns into a picture — a `Texture` or a scroll-bar
 * image has no painted counterpart in the DOM mapping.
 */
function collectImages(root: LiveInstance, into: Set<string>): void {
	for (const instance of root.GetDescendants()) {
		const image = instance.Image;
		if (typeof image === "string" && image !== "") into.add(image);
	}
}
