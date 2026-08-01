/**
 * `@loom-dev/preview/vite` — the Vite plugin that makes a roblox-ts source tree
 * run in the browser: it aliases the `@rbxts/react` / `@rbxts/react-roblox` /
 * `@rbxts/services` (and `@rbxts/vide`) packages to the matching loom adapter,
 * plus the built-in compatibility adapters for packages that ship no browser
 * code at all (`./compat/aliases.ts`), rewrites roblox-ts
 * `import X = require(...)` statements to ESM, retries `.luau` package mains at
 * their TypeScript source, and injects the Roblox globals before the app entry. esbuild already transpiles the TSX, so no
 * separate roblox-ts compiler is needed for preview.
 *
 * The plugin is the whole product: dropped into a `vite.config.ts` it needs no
 * other setup, and no `index.html` either — it generates the page around the
 * detected client entry (or, with `targets`, the `*.loom.tsx` gallery). See
 * `./html.ts`. The `loom` CLI is the same plugin with `configFile: false`.
 *
 * The resolver, the import-equals transform, and the config-hook aliases apply
 * in **both** `serve` and `build`, so the same source tree that runs under the
 * dev server also bundles into a static site. Only the globals-injection
 * mechanism differs: under `serve` it is a `<script src>` pointing at a served
 * virtual module (`loom-preview:serve-globals`); under `build` the html plugin
 * prepends the globals import to the page's entry modules so `installGlobals()`
 * runs before any app/gallery code.
 */
import { readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { isAbsolute, resolve, sep } from "node:path";
import { type Plugin, searchForWorkspaceRoot } from "vite";
import { loomAssetProxy } from "./asset-proxy.ts";
import {
	builtInCompatibilityAliases,
	exactSpecifierPattern,
} from "./compat/aliases.ts";
import {
	unsupportedEntrypoint,
	unsupportedEntrypointError,
} from "./compat/entrypoints.ts";
import { normalizeTargetsPatterns, type TargetsInput } from "./gallery.ts";
import { loomGallery } from "./gallery-plugin.ts";
import { loomIndexHtml } from "./html.ts";
import {
	CLIENT_PATH,
	GLOBALS_PATH,
	LOOM_REPO_ROOT,
	REACT_COMPAT_PATH,
	SERVICES_PATH,
} from "./paths.ts";
import {
	describeLuauOnlyPackage,
	isLuauId,
	luauOnlyPackageError,
	type ResolverFs,
	resolveLuauFallback,
	resolvePackageSource,
} from "./resolver.ts";
import { rewriteImportEquals } from "./transform.ts";

// A virtual module that installs the Roblox globals. Injected as a real <script
// src> (not an inline bare import) so it resolves whether the index.html is a
// real file or served by the CLI's middleware.
const GLOBALS_ID = "virtual:loom-globals";
const GLOBALS_RESOLVED = `\0${GLOBALS_ID}`;
const GLOBALS_PATHNAME = `@id/__x00__${GLOBALS_ID}`;

/**
 * The served URL of the globals module. Tags injected by `transformIndexHtml`
 * bypass Vite's own URL rewriting, so the base has to be applied here — an
 * embedded gallery (`loom-dev/embed`) is mounted under a base like
 * `/loom-preview/`, and a root-absolute `/@id/...` would miss the mount and be
 * answered by the host app (a 404, and no Roblox globals).
 */
function globalsUrl(base: string): string {
	return `${base.endsWith("/") ? base : `${base}/`}${GLOBALS_PATHNAME}`;
}

// The browser-facing modules are aliased by absolute path (not bare specifier)
// so they resolve even when the previewed project's node_modules has no
// @loom-dev packages — e.g. `loom preview` pointed at a different workspace
// entirely. See `./paths.ts` for why they always point at TypeScript source.

// loom's internal packages are served as-is: `@loom-dev/layout` reaches its
// engine through `new URL("../pkg/….wasm", import.meta.url)`, which only
// survives unbundled, and the rest hold module state (the instance tree, the
// service singletons) that must exist exactly once across every importer.
//
// `@loom-dev/react` is the exception. It imports the CJS `react-reconciler`,
// and Vite serves an excluded dep's imports raw — fine in a workspace checkout,
// where the adapter resolves to TypeScript source outside node_modules and Vite
// discovers the dep while scanning, but fatal in a published install: the
// import comes from inside node_modules, nothing registers it, and the app dies
// on `does not provide an export named 'DefaultEventPriority'`. Pre-bundling
// the adapter folds the reconciler into its chunk; the other loom packages stay
// excluded, so they remain external to that chunk and keep their single
// instance.
const LOOM_EXCLUDED_PACKAGES = [
	"@loom-dev/preview",
	"@loom-dev/vide",
	"@loom-dev/runtime",
	"@loom-dev/renderer",
	"@loom-dev/scene",
	"@loom-dev/layout",
];

const nodeFs: ResolverFs = {
	isFile(path: string): boolean {
		try {
			return statSync(path).isFile();
		} catch {
			return false;
		}
	},
	readFile(path: string): string | undefined {
		try {
			return readFileSync(path, "utf8");
		} catch {
			return undefined;
		}
	},
};

// react (and its jsx runtimes) must come from loom's own dependency tree —
// version-matched to the loom react adapter's react-reconciler — not whatever
// react the previewed workspace hoists (lattice hoists react 19, whose renamed
// internals crash reconciler 0.29 at evaluation). Resolved to absolute paths
// here; both dev import analysis and the dep optimizer honor `resolve.alias`,
// so every consumer converges on this single copy.
const requireFromPreview = createRequire(import.meta.url);
const REACT_MAIN = requireFromPreview.resolve("react");
const REACT_JSX = requireFromPreview.resolve("react/jsx-runtime");
const REACT_JSX_DEV = requireFromPreview.resolve("react/jsx-dev-runtime");

/**
 * The react adapter, and the CJS `react-reconciler` living in *its* dependency
 * tree — resolved from here, because nothing else can find them.
 *
 * Every `optimizeDeps.include` entry (and every nested `a > b` form) is resolved
 * from the **previewed project's root**, which normally has no `@loom-dev`
 * packages at all. So the ids are aliased to absolute paths as well: the
 * optimizer honors `resolve.alias`, which is the same trick that pins react.
 *
 * Why the adapter must be pre-bundled at all: it imports the CJS reconciler,
 * and Vite serves an excluded dep's imports raw. In a workspace checkout that
 * is harmless — the adapter resolves to TypeScript source outside node_modules,
 * so Vite discovers the reconciler while scanning and pre-bundles it. In a
 * published install it is fatal: the import comes from inside node_modules,
 * nothing registers it, raw CJS has no named exports, and the preview dies on
 * `does not provide an export named 'DefaultEventPriority'`.
 *
 * Only done for an *installed* adapter. A workspace checkout resolves to source
 * outside node_modules, where pre-bundling would freeze loom's own packages
 * behind the optimizer and cost their HMR while developing loom itself.
 */
function resolveAdapter(): {
	adapter?: string;
	reconciler?: string;
	constants?: string;
} {
	try {
		const adapter = requireFromPreview.resolve("@loom-dev/react");
		if (!adapter.includes(`${sep}node_modules${sep}`)) return {};
		const fromAdapter = createRequire(adapter);
		return {
			adapter,
			reconciler: fromAdapter.resolve("react-reconciler"),
			constants: fromAdapter.resolve("react-reconciler/constants"),
		};
	} catch {
		return {};
	}
}
const ADAPTER = resolveAdapter();

/**
 * Absolute paths for the loom packages the adapter and the preview client pull
 * in. Needed for the same reason as everything else here: the previewed project
 * cannot resolve `@loom-dev/*`, and once the adapter is pre-bundled its chunk
 * lives under the *project's* `node_modules/.vite/deps`, from where a bare
 * `@loom-dev/runtime` resolves to nothing at all.
 *
 * Only for an installed adapter, matching {@link resolveAdapter}: a workspace
 * checkout resolves these through its own link chain.
 */
function resolveLoomPackages(): Array<{ find: RegExp; replacement: string }> {
	if (!ADAPTER.adapter) return [];
	const fromAdapter = createRequire(ADAPTER.adapter);
	const aliases: Array<{ find: RegExp; replacement: string }> = [];
	for (const id of LOOM_EXCLUDED_PACKAGES) {
		for (const from of [fromAdapter, requireFromPreview]) {
			try {
				aliases.push({
					find: new RegExp(`^${id.replace("/", "\\/")}$`),
					replacement: from.resolve(id),
				});
				break;
			} catch {
				// Not reachable from this package — try the next resolver, and
				// leave the id bare if neither can see it.
			}
		}
	}
	return aliases;
}
const LOOM_PACKAGE_ALIASES = resolveLoomPackages();

/**
 * Directories the dev server must be allowed to read, beyond the previewed
 * project itself. `LOOM_REPO_ROOT` covers a workspace checkout; an installed
 * loom is spread across the installing project's `node_modules` (under pnpm,
 * one store directory per package), and the layout package serves its wasm
 * binary straight out of its own `pkg/` — a `fs.allow` miss there surfaces as a
 * 403 the runtime reports as `TypeError: HTTP status code is not ok`. Allowing
 * the outermost `node_modules` that contains a resolved loom package covers the
 * whole store, which is what a project's own Vite allows anyway.
 */
function loomFsAllow(): string[] {
	const roots = new Set([LOOM_REPO_ROOT]);
	const marker = `${sep}node_modules${sep}`;
	for (const { replacement } of LOOM_PACKAGE_ALIASES) {
		const at = replacement.indexOf(marker);
		if (at >= 0) roots.add(replacement.slice(0, at + marker.length - 1));
	}
	return [...roots];
}
const LOOM_FS_ALLOW = loomFsAllow();

/**
 * Whether a `resolveId` call comes from the dep-optimizer scan.
 *
 * The scanner crawls the whole graph before the server is up and treats
 * anything it can't resolve as external — a good default, and the reason loom's
 * Luau-only diagnostic stays out of its way: throwing there would trade one
 * broken import for a dev server that refuses to start. The same import fails
 * with the diagnostic a moment later, when the module is actually transformed.
 */
function isScan(options: unknown): boolean {
	return (options as { scan?: boolean } | undefined)?.scan === true;
}

/** Bare npm specifiers only: not relative/absolute/virtual/builtin/url ids. */
function isBareSpecifier(source: string): boolean {
	if (source.startsWith(".") || source.startsWith("/")) return false;
	if (source.startsWith("\0")) return false;
	// Excludes `node:`, `virtual:`, `data:`, `http(s):` — scoped packages and
	// subpaths never contain `:`.
	if (source.includes(":")) return false;
	return true;
}

/**
 * A shim target as written in `shims`, turned into something Vite can resolve
 * from anywhere in the module graph.
 *
 * Relative targets are the interesting case: an alias `replacement` is
 * substituted verbatim into whatever module happened to import the specifier,
 * so a bare `./loom-shims/x.ts` would be resolved against *that* importer's
 * directory — a different one for every importer. Anchoring it to the project
 * root (the directory the shim path is written relative to, in the config file
 * that declares it) makes the redirect mean one fixed file.
 *
 * Anything else is left untouched, so a target may also be a package id
 * (`my-compat/ui-labs`) that Vite resolves normally.
 */
export function resolveShimTarget(target: string, projectRoot: string): string {
	if (isAbsolute(target)) return target;
	// `./x`, `../x` — and their Windows `.\x` spellings.
	if (/^\.\.?[/\\]/.test(target)) return resolve(projectRoot, target);
	return target;
}

/**
 * `shims` → `resolve.alias` entries, one per specifier, matching the package
 * *exactly*: `@rbxts/ui-labs` must not swallow `@rbxts/ui-labs/controls` (a
 * subpath the shim was never written to answer) or `@rbxts/ui-labs-extra` (an
 * unrelated package). A shim that wants to cover subpaths says so by listing
 * them.
 */
export function shimAliases(
	shims: Record<string, string>,
	projectRoot: string,
): Array<{ find: RegExp; replacement: string }> {
	return Object.entries(shims).map(([specifier, target]) => ({
		find: exactSpecifierPattern(specifier),
		replacement: resolveShimTarget(target, projectRoot),
	}));
}

// Entry detection is part of the plugin's contract — re-exported so a caller
// (the `loom` CLI) can pre-flight the same lookup and fail with a hint before
// booting a server that would only 500 on the first request.
export { ENTRY_CANDIDATES, findEntry } from "./html.ts";

export interface LoomPreviewOptions {
	/**
	 * The client entry, root-relative (`/src/main.client.tsx`) or relative to the
	 * project root. Auto-detected from the roblox-ts conventions
	 * (`src/main.client.tsx` and friends) when omitted — only needed for an entry
	 * that doesn't follow one.
	 */
	entry?: string;
	/**
	 * Gallery mode: a glob, a directory, a list of either, or `true` for the
	 * default `**\/*.loom.tsx`. Every match gets a sidebar entry with a lazy
	 * mount and per-target error containment — the same thing `loom preview
	 * --targets` serves. Set, no client entry is needed.
	 */
	targets?: TargetsInput;
	/** `<title>` of the generated page. */
	title?: string;
	/**
	 * Extra package redirects: `{ "<bare specifier>": "<module>" }`.
	 *
	 * The escape hatch for roblox-ts packages loom cannot run. A package whose
	 * `"main"` is Luau normally recovers through its own TypeScript source (see
	 * `./resolver.ts`), but a *declaration-only* package — Luau runtime plus a
	 * `.d.ts`, no `src/index.ts` — has nothing to fall back to, and the import
	 * fails. Point the specifier at a browser module that models whatever slice
	 * of the package the previewed code actually uses:
	 *
	 * ```ts
	 * loomPreview({ shims: { "@rbxts/example": "./loom-shims/example.ts" } })
	 * ```
	 *
	 * Not needed for the packages loom already adapts itself (`@rbxts/ui-labs` —
	 * see `./compat/aliases.ts`); those import with no configuration. Declaring
	 * one anyway *replaces* loom's adapter, which is the supported way to
	 * override it.
	 *
	 * Targets are absolute paths, paths relative to the project root, or bare
	 * package ids. Matching is exact — `@rbxts/ui-labs` leaves
	 * `@rbxts/ui-labs/controls` alone — and these entries are applied *before*
	 * every one of loom's own, built-in compatibility included.
	 */
	shims?: Record<string, string>;
	/**
	 * Set `false` to keep the plugin out of the HTML business entirely: no
	 * generated page, no entry detection, no Rollup input. Only the module
	 * plumbing (aliases, resolver, globals injection) stays.
	 */
	html?: boolean;
}

export function loomPreview(options: LoomPreviewOptions = {}): Plugin[] {
	// Per-source memo of the `.luau` fallback verdict. Workspace packages are
	// unique per specifier, so the importer doesn't need to be part of the key;
	// a `false` verdict just means "not Luau — let normal resolution handle it".
	const luauVerdicts = new Map<string, string | false>();

	// Rewrites `import X = require("m")` before vite:esbuild lowers it to a bare
	// `require()` call (which would throw in the browser). Applies to any
	// TypeScript outside node_modules — previewed workspace sources typically
	// resolve through symlinks to real paths outside node_modules. Runs in both
	// serve and build: esbuild lowers import-equals the same way in either mode,
	// so the rewrite is equally required when Rollup bundles the tree.
	const importEquals: Plugin = {
		name: "loom-preview:import-equals",
		enforce: "pre",
		transform(code, id) {
			const file = id.split("?")[0] ?? id;
			if (!/\.tsx?$/.test(file)) return;
			if (file.includes("/node_modules/")) return;
			const rewritten = rewriteImportEquals(code);
			if (rewritten === undefined) return;
			return { code: rewritten, map: null };
		},
	};

	const main: Plugin = {
		name: "loom-preview",
		// No `apply`: the resolver + config aliases are build-safe and must run
		// under Rollup so `loom build` bundles the same tree the dev server serves.
		// `pre` is load-bearing for resolveId: vite:resolve (a core plugin) runs
		// before user *normal* plugins, so a normal-phase hook would never see the
		// bare specifiers whose package "main" points at `.luau` output.
		enforce: "pre",
		async resolveId(source, importer, options) {
			if (!importer || !isBareSpecifier(source)) return;

			// A subpath of a package loom adapts, that loom does not adapt. The
			// `resolve.alias` entries are exact, so this would otherwise fall
			// through to real resolution and fail as a missing Luau entry —
			// mentioning neither loom nor what the compatibility layer covers.
			// Not during the optimizer scan, for the same reason the Luau-only
			// diagnostic isn't: a throw there refuses to start the dev server, and
			// the same import fails properly a moment later when it's transformed.
			if (!isScan(options) && unsupportedEntrypoint(source)) {
				throw unsupportedEntrypointError(source, importer);
			}

			const verdict = luauVerdicts.get(source);
			if (verdict !== undefined) {
				// `false` = known non-Luau: fall through to normal resolution.
				return verdict === false ? undefined : verdict;
			}

			// Redirect roblox-ts packages to their TS source up front — this works
			// whether or not the package was compiled (its `.luau` main may not
			// exist), so loom consumes a source-only workspace with no build step.
			// `@rbxts/*` is excluded: those are Luau-main too but must go through the
			// `resolve.alias` entries (react/react-roblox/services → loom adapters),
			// not to their own source.
			if (!source.startsWith("@rbxts/")) {
				const sourceTs = resolvePackageSource(source, importer, nodeFs);
				if (sourceTs !== undefined) {
					luauVerdicts.set(source, sourceTs);
					return sourceTs;
				}
			}

			// Otherwise resolve normally. `this.resolve` can throw when a package's
			// `"main"` points at a missing file — the usual shape of a
			// declaration-only Luau package, whose `"main": "src/init.lua"` doesn't
			// even exist (what ships is `init.luau`). The error is kept as the
			// `cause` of loom's own diagnostic below.
			let resolved: Awaited<ReturnType<typeof this.resolve>> = null;
			let failure: unknown;
			try {
				resolved = await this.resolve(source, importer, {
					...options,
					skipSelf: true,
				});
			} catch (error) {
				failure = error;
				resolved = null;
			}
			if (!resolved || resolved.external) {
				// Unresolvable *and* Luau-only: name that, instead of leaving Vite to
				// report a missing entry file without saying why a browser can't have
				// it. Every other failure keeps its own error.
				if (!resolved && !isScan(options)) {
					const luauOnly = describeLuauOnlyPackage(source, importer, nodeFs);
					if (luauOnly) throw luauOnlyPackageError(luauOnly, importer, failure);
				}
				return resolved ?? undefined;
			}
			if (isLuauId(resolved.id)) {
				// A resolved `.luau` main (compiled roblox-ts package): retry source.
				const fallback = resolveLuauFallback(resolved.id, nodeFs);
				if (fallback !== undefined) {
					luauVerdicts.set(source, fallback);
					return fallback;
				}
				// None to retry. Handing the id back would put Luau in front of
				// Rollup's JavaScript parser.
				if (!isScan(options))
					throw luauOnlyPackageError(
						{ name: source, main: resolved.id },
						importer,
					);
			}
			luauVerdicts.set(source, false);
			return resolved;
		},
		// Self-sufficient config so dropping loomPreview() into a project is truly
		// zero-config (no manual esbuild.jsx / optimizeDeps needed). Deep-merged
		// with — and overridable by — the user's config. `optimizeDeps` and
		// `server.fs` are dev-only (Vite ignores them under `build`); the
		// `resolve.alias` + `esbuild.jsx` entries drive both modes.
		config(userConfig) {
			const projectRoot = userConfig.root
				? resolve(userConfig.root)
				: process.cwd();
			return {
				// Automatic JSX runtime: roblox-ts source never imports React, so the
				// classic transform would throw "React is not defined".
				esbuild: { jsx: "automatic" },
				optimizeDeps: {
					// react resolves through the `resolve.alias` entries below (the
					// optimizer honors them), so the bare ids land on loom's own copy.
					// react-reconciler cannot: see {@link resolveReconciler}.
					include: [
						"react",
						"react/jsx-runtime",
						"react/jsx-dev-runtime",
						...(ADAPTER.adapter ? ["@loom-dev/react"] : []),
						...(ADAPTER.reconciler ? ["react-reconciler"] : []),
						...(ADAPTER.constants ? ["react-reconciler/constants"] : []),
					],
					exclude: ADAPTER.adapter
						? LOOM_EXCLUDED_PACKAGES
						: [...LOOM_EXCLUDED_PACKAGES, "@loom-dev/react"],
				},
				resolve: {
					// One react instance is enforced by the absolute-path react aliases
					// below (the aliased @rbxts/react and the reconciler's react must be
					// the same react or hooks dispatch breaks) — `dedupe` would instead
					// re-anchor react at the *project* root, which may hoist a
					// different major.
					alias: [
						// User shims first: first match wins in Vite's alias plugin, so
						// this is what lets a project redirect a package loom cannot run
						// — and, deliberately, override any of loom's own entries below,
						// built-in compatibility included.
						...shimAliases(options.shims ?? {}, projectRoot),
						// Then loom's built-in adapters for known browser-hostile
						// packages (`@rbxts/ui-labs` → the non-story UI Labs
						// `Environment`), so those import with no configuration at all.
						// See `./compat/aliases.ts`.
						...builtInCompatibilityAliases(),
						// More specific first: react-roblox -> the preview client.
						// Absolute paths so the previewed project's node_modules
						// doesn't need @loom-dev packages. Exact, not `(\/.*)?`: an
						// unadapted subpath must reach the diagnostic in
						// `./compat/entrypoints.ts`, not silently land on `createRoot`.
						{ find: /^@rbxts\/react-roblox$/, replacement: CLIENT_PATH },
						// @rbxts/services -> the preview's service singletons.
						{ find: /^@rbxts\/services$/, replacement: SERVICES_PATH },
						// @rbxts/react (+ jsx runtimes) and bare react -> loom's react.
						{ find: /^@rbxts\/react\/jsx-runtime$/, replacement: REACT_JSX },
						{
							find: /^@rbxts\/react\/jsx-dev-runtime$/,
							replacement: REACT_JSX_DEV,
						},
						// @rbxts/react -> the compatibility facade: loom's one react
						// instance forwarded by identity, plus the Roblox-only surface
						// (ReactComponent, Event/Change/Tag, None) and bindings.
						{ find: /^@rbxts\/react$/, replacement: REACT_COMPAT_PATH },
						{ find: /^react\/jsx-runtime$/, replacement: REACT_JSX },
						{ find: /^react\/jsx-dev-runtime$/, replacement: REACT_JSX_DEV },
						{ find: /^react$/, replacement: REACT_MAIN },
						// The adapter and its CJS reconciler, same treatment as react:
						// one copy, at a path the optimizer can find from the previewed
						// project's root. See {@link resolveAdapter}.
						...(ADAPTER.constants
							? [
									{
										find: /^react-reconciler\/constants$/,
										replacement: ADAPTER.constants,
									},
								]
							: []),
						...(ADAPTER.reconciler
							? [
									{
										find: /^react-reconciler$/,
										replacement: ADAPTER.reconciler,
									},
								]
							: []),
						...(ADAPTER.adapter
							? [{ find: /^@loom-dev\/react$/, replacement: ADAPTER.adapter }]
							: []),
						// …and the packages both of them import: the pre-bundled
						// adapter's chunk sits in the project's own .vite/deps, where a
						// bare @loom-dev id resolves to nothing.
						...LOOM_PACKAGE_ALIASES,
						// @rbxts/vide -> the loom vide adapter (same Scene IR target).
						{ find: /^@rbxts\/vide$/, replacement: "@loom-dev/vide" },
					],
				},
				server: {
					fs: {
						// The previewed project may live in a different workspace than
						// loom itself (e.g. `loom preview ../lattice-ui/apps/x` run via
						// tsx from the loom repo) — the server must be allowed to serve
						// both trees. Merged additively with any user-supplied allow.
						allow: [...LOOM_FS_ALLOW, searchForWorkspaceRoot(projectRoot)],
					},
				},
			};
		},
	};

	// Serve-only globals injection. Under the dev server the Roblox datatype
	// globals are installed by a `<script src>` pointing at a served virtual
	// module (there is no build chunk for the `/@id/` URL). Under `build` this
	// plugin is inert — the CLI's generated HTML entry imports
	// `@loom-dev/preview/globals` directly as its first module instead.
	let base = "/";
	const serveGlobals: Plugin = {
		name: "loom-preview:serve-globals",
		apply: "serve",
		enforce: "pre",
		configResolved(config) {
			base = config.base;
		},
		resolveId(source) {
			if (source === GLOBALS_ID) return GLOBALS_RESOLVED;
		},
		load(id) {
			// Absolute-path import: the virtual module has no fs location, so a
			// bare "@loom-dev/preview/globals" would resolve from the (possibly
			// foreign) project root and fail.
			if (id === GLOBALS_RESOLVED)
				return `import ${JSON.stringify(GLOBALS_PATH)};`;
		},
		transformIndexHtml() {
			return [
				{
					tag: "script",
					attrs: { type: "module", src: globalsUrl(base) },
					injectTo: "head-prepend",
				},
			];
		},
	};

	const plugins: Plugin[] = [
		importEquals,
		main,
		serveGlobals,
		loomAssetProxy(),
	];

	// Gallery mode: the target import map (dev) + the generated gallery page.
	const patterns =
		options.targets !== undefined
			? normalizeTargetsPatterns(options.targets)
			: undefined;
	if (patterns) plugins.push(loomGallery(patterns));
	if (options.html !== false) {
		plugins.push(
			loomIndexHtml({
				entry: options.entry,
				title: options.title,
				...(patterns ? { patterns } : {}),
			}),
		);
	}
	return plugins;
}
