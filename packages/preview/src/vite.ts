/**
 * `@loom-dev/preview/vite` — the Vite plugin that makes a roblox-ts source tree
 * run in the browser: it aliases the `@rbxts/react` / `@rbxts/react-roblox` /
 * `@rbxts/services` (and `@rbxts/vide`) packages to the matching loom adapter,
 * plus the built-in compatibility adapters for packages that ship no browser
 * code at all (`./compat/aliases.ts`), honours the project's own tsconfig
 * `baseUrl`/`paths` so its non-relative imports resolve, rewrites the
 * roblox-ts-only source syntax
 * (`import X = require(...)`, the `.size()`/`.isEmpty()` macros — see
 * `./transform.ts`), retries `.luau` package mains at their TypeScript source, and injects the Roblox globals before the app entry. esbuild already transpiles the TSX, so no
 * separate roblox-ts compiler is needed for preview.
 *
 * The plugin is the whole product: dropped into a `vite.config.ts` it needs no
 * other setup, and no `index.html` either — it generates the page around the
 * detected client entry (or, with `targets`, the `*.loom.tsx` gallery). See
 * `./html.ts`. The `loom` CLI is the same plugin with `configFile: false`.
 *
 * The resolver, the source transforms, and the config-hook aliases apply
 * in **both** `serve` and `build`, so the same source tree that runs under the
 * dev server also bundles into a static site. Only the globals-injection
 * mechanism differs: under `serve` it is a `<script src>` pointing at a served
 * virtual module (`loom-preview:serve-globals`); under `build` the html plugin
 * prepends the globals import to the page's entry modules so `installGlobals()`
 * runs before any app/gallery code.
 */
import { readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import {
	type Alias,
	type Plugin,
	type ResolverFunction,
	searchForWorkspaceRoot,
} from "vite";
import { loomAssetBundle, loomAssetProxy } from "./asset-proxy.ts";
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
	PREVIEW_SRC,
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
import { rewriteImportEquals, rewriteLuauMacros } from "./transform.ts";

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
 * The directory that holds every loom package: `packages/` in a workspace
 * checkout, `node_modules/@loom-dev` once installed. `PREVIEW_SRC` is
 * `<that>/preview/src` either way, so two levels up names it without anyone
 * hardcoding a repo path — see `./paths.ts` for why that shape holds in both.
 *
 * It exists for the Roblox Promise injection below, which must never reach
 * loom's own code. "Outside node_modules" is the test everything else in this
 * file uses, and in an in-repo preview (`apps/example`, the gallery demo, the
 * playground) it is not enough: loom's own `packages/<name>/src` files resolve
 * to real paths outside node_modules too, so they read as previewed app source.
 */
const LOOM_PACKAGES_ROOT = resolve(PREVIEW_SRC, "../..");

/** Whether a resolved file belongs to loom itself rather than the app. */
function isLoomSource(file: string): boolean {
	return file.startsWith(`${LOOM_PACKAGES_ROOT}${sep}`);
}

/**
 * The runtime module the injected Promise import points at, as an absolute
 * path.
 *
 * A bare `@loom-dev/runtime` would be resolved from the *previewed project*,
 * which routinely has no loom packages at all — the same reason every
 * browser-facing module in this file is aliased by absolute path. The alias
 * table is consulted first so that app code and loom's own code land on one
 * copy of the runtime: where {@link LOOM_PACKAGE_ALIASES} has an entry it has
 * already decided which copy that is, and a second one would be a second
 * `Promise` class that nothing is `instanceof`.
 */
function resolveRuntimeModule(): string {
	const aliased = LOOM_PACKAGE_ALIASES.find(({ find }) =>
		find.test("@loom-dev/runtime"),
	);
	return (
		aliased?.replacement ?? requireFromPreview.resolve("@loom-dev/runtime")
	);
}

/**
 * The line appended to an app module that mentions `Promise`.
 *
 * roblox-ts apps mean evaera's Promise by the bare name — `Promise.delay`,
 * `Promise.retry`, `:andThen`, `:expect`, `:cancel` — and the browser's has
 * none of it, so an app that loads anything at all dies on
 * `andThen is not a function`. The obvious answer is to install it as
 * `globalThis.Promise`; that was tried, and it took 19 of this package's own
 * tests with it. The page global is shared with React, the Vite client and
 * loom's own prerender, and the two APIs genuinely disagree —
 * `Promise.allSettled` resolves to `Promise.Status` values in Roblox and to
 * `{ status, value }` records in JS, and Roblox's `Promise.all` rejects a list
 * with a non-promise in it. Whichever API owns the global, the other half of
 * the page is wrong.
 *
 * A module-scope binding has no such choice to make. The import shadows the
 * global inside one file and nowhere else: app code gets Roblox semantics,
 * React and Vite and loom keep the native one. `async`/`await` is untouched
 * either way — the spec resolves those through the %Promise% intrinsic, not
 * through whatever the name `Promise` currently refers to — so an `await` in
 * app source still awaits natively, and a Roblox promise still works under it
 * because `LoomPromise` is a thenable.
 */
const PROMISE_IMPORT = `import { RobloxPromise as Promise } from ${JSON.stringify(
	resolveRuntimeModule(),
)};`;

/**
 * A top-level `const`/`let`/`var`/`class`/`function` called `Promise`.
 *
 * Leading whitespace is allowed, so a declaration nested inside a function
 * reads as a hit too. That asymmetry is deliberate: over-detecting costs one
 * file its Roblox Promise, while under-detecting costs it the whole module —
 * a duplicate `import` alongside an existing declaration is a
 * `SyntaxError: Identifier 'Promise' has already been declared`, and nothing in
 * that file runs again.
 */
const PROMISE_DECLARATION_RE =
	/^[ \t]*(?:export[ \t]+)?(?:default[ \t]+)?(?:declare[ \t]+)?(?:(?:const|let|var|class)[ \t]+Promise\b|(?:async[ \t]+)?function[ \t]*\*?[ \t]*Promise\b)/m;

/** Every `import <clause> from "<specifier>"`, captured at the clause. */
const IMPORT_CLAUSE_RE =
	/^[ \t]*import\s+([\s\S]*?)\bfrom\s*(["'])[^"'\n]+\2/gm;

/**
 * A clause that binds the name `Promise`: `* as Promise`, `X as Promise`, a
 * default `Promise`, or `Promise` among the named bindings. `{ Promise as P }`
 * deliberately does not match — it binds `P`.
 */
const PROMISE_CLAUSE_RE = /\bas\s+Promise\b|(?:^|[{,]\s*)Promise\s*(?:,|\}|$)/;

/** Whether the module already binds `Promise` at its top level, by any route. */
function bindsPromise(code: string): boolean {
	if (PROMISE_DECLARATION_RE.test(code)) return true;
	IMPORT_CLAUSE_RE.lastIndex = 0;
	for (
		let match = IMPORT_CLAUSE_RE.exec(code);
		match !== null;
		match = IMPORT_CLAUSE_RE.exec(code)
	) {
		if (PROMISE_CLAUSE_RE.test(match[1] ?? "")) {
			// The regex is sticky across calls; leave it where the next one expects.
			IMPORT_CLAUSE_RE.lastIndex = 0;
			return true;
		}
	}
	return false;
}

/**
 * Give one app module the Roblox `Promise` as a module-scope binding. Returns
 * the rewritten source, or `undefined` when the file wants no injection — which
 * is the overwhelming majority of them.
 *
 * The import is **appended**, and that is the whole reason there is no source
 * map to produce. ES import declarations are hoisted: the binding exists for
 * the entire module however late the statement is written, so a trailing import
 * shadows `Promise` from line 1 while moving no line at all. A prepended one
 * would shift every line in the file and quietly point every stack trace and
 * breakpoint one line off, for no gain. The leading newline is not decoration —
 * a file whose last line is `// a comment` with no trailing newline would
 * otherwise swallow the import whole.
 *
 * It is also idempotent for free: the appended line *is* an import binding
 * `Promise`, so a second pass over the result declines it.
 */
export function injectRobloxPromise(code: string): string | undefined {
	// The cheap guard, and the one that runs on every file in the project: most
	// never say the word, and skipping them keeps both the rewrite and the
	// module-graph edge it would add off the vast majority of the tree. A
	// mention in a comment injects an unused import, which esbuild and Rollup
	// both drop again; that is the harmless direction.
	if (!code.includes("Promise")) return undefined;
	if (bindsPromise(code)) return undefined;
	return `${code}\n${PROMISE_IMPORT}\n`;
}

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

// tsconfig `baseUrl` and `paths`.
//
// roblox-ts projects import non-relatively as a matter of course — `import
// { Button } from "shared/ui/button"` — and the only thing that makes those
// resolve is the project's own `compilerOptions.baseUrl`/`paths`. roblox-ts's
// own template ships `"baseUrl": "src"`, so this is not an exotic setup: with
// the mapping unread the preview dies on the first such import, and a large
// class of real projects never starts at all.
//
// Vite has no tsconfig reader of its own (path mapping lives in the third-party
// `vite-tsconfig-paths`), and loom is meant to need no configuration, so the
// mapping is read here. The two halves are *not* the same mechanism, because
// they are not the same rule in TypeScript:
//
// - `paths` pre-empts. An explicit pattern beats node resolution outright, so
//   it becomes a `resolve.alias` entry — emitted below every alias loom needs
//   for itself, since Vite's alias plugin takes the first match and a project
//   that maps `@rbxts/*` at its own node_modules (many do) must still reach
//   loom's adapters, or the preview would load Luau declarations in place of a
//   browser React.
// - `baseUrl` fills in. Node resolution runs first and `baseUrl` answers only
//   for what it could not find, which is the opposite of what an alias does —
//   so it gets a normal-phase `resolveId` instead. See {@link tsconfigBaseUrl}
//   for what it cost to learn that.
//
// Neither is ever fatal. A mapping that matches nothing on disk falls through
// to ordinary module resolution instead of pinning the import to a file that
// isn't there, and a missing, unreadable or unparsable tsconfig simply yields
// nothing at all. Zero-config projects keep working exactly as before.

/** How far an `extends` chain is followed before loom gives up on it. */
const TSCONFIG_EXTENDS_LIMIT = 32;

/**
 * The ids Vite answers for itself, as a regex body. They are spelled like
 * ordinary scoped packages — `vite/dist/client/client.mjs` imports `@vite/env`
 * by that bare name — but nothing resolves them except Vite's own alias entry,
 * and that entry sits *below* the plugin's in the merged list (Vite puts the
 * user's aliases first so they can override its defaults).
 *
 * Which makes them the one thing a catch-all must never touch. Vite's alias
 * plugin takes the first `find` that matches and never reconsiders: an entry
 * above `@vite/env` that matches and then *declines* the id does not fall
 * through to Vite's own entry, it buries it. The dev client 500s on
 * `Failed to resolve import "@vite/env"`, `#loom-root` stays empty, and the
 * page never boots — from nothing but a project writing `"baseUrl": "."`.
 */
const VITE_INTERNAL_ID = String.raw`@(?:vite|id|fs)\/|@react-refresh(?:$|\/)`;

/** {@link VITE_INTERNAL_ID} against a whole specifier, served or bare. */
const VITE_INTERNAL_ID_RE = new RegExp(String.raw`^\/?(?:${VITE_INTERNAL_ID})`);

/** Whether Vite owns this id and no mapping of the project's may claim it. */
function isViteInternalId(source: string): boolean {
	return VITE_INTERNAL_ID_RE.test(source);
}

/**
 * A path mapping applies to *module specifiers* only — never to a relative or
 * absolute path, a Rollup virtual id (`\0…`), anything scheme-like (`node:`,
 * `virtual:`, `data:`), or one of Vite's own ids. Prepended to every generated
 * pattern, because a legal `"paths"` key of `"*"` would otherwise match the
 * entire module graph.
 */
const BARE_SPECIFIER_GUARD = String.raw`(?![./\\\0])(?!.*:)(?!${VITE_INTERNAL_ID})`;

/** Every regex metacharacter escaped, so the text matches itself. */
function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * `$` is the substitution marker in a `String.replace` replacement, and a
 * filesystem path is allowed to contain one — `$` must be doubled or a
 * directory called `$1` would silently eat the wildcard.
 */
function escapeReplacement(text: string): string {
	return text.replace(/\$/g, "$$$$");
}

/**
 * `tsconfig.json` as it is actually written: with `//` and block comments and
 * trailing commas, neither of which `JSON.parse` accepts. TypeScript's own
 * reader tolerates both, so a config loom refused to read would be one `tsc`
 * reads happily — and the preview would fail for a file the project considers
 * perfectly valid.
 *
 * One scan, tracking string state, because a `//` inside a string value (a
 * `paths` target may hold one) is data rather than a comment. Returns
 * `undefined` for anything that still isn't an object; the project's own `tsc`
 * is the right place to hear about a broken config.
 */
export function parseTsconfigJson(
	text: string,
): Record<string, unknown> | undefined {
	// A BOM is common in a Windows-authored tsconfig, and `JSON.parse` rejects it.
	const source = text.replace(/^\uFEFF/, "");
	let out = "";
	let inString = false;
	for (let i = 0; i < source.length; i++) {
		const char = source.charAt(i);
		if (inString) {
			out += char;
			// A backslash escapes whatever follows — including the quote, which is
			// what keeps `"a\""` from ending the string one character early.
			if (char === "\\") {
				out += source.charAt(i + 1);
				i++;
			} else if (char === '"') inString = false;
			continue;
		}
		if (char === '"') {
			inString = true;
			out += char;
			continue;
		}
		if (char === "/" && source.charAt(i + 1) === "/") {
			while (i < source.length && source.charAt(i) !== "\n") i++;
			out += "\n";
			continue;
		}
		if (char === "/" && source.charAt(i + 1) === "*") {
			i += 2;
			while (
				i < source.length &&
				!(source.charAt(i) === "*" && source.charAt(i + 1) === "/")
			)
				i++;
			i++;
			continue;
		}
		// A comma with nothing but whitespace between it and the closing brace is
		// a trailing comma. Safe to strip by looking backwards because this branch
		// only ever runs outside a string.
		if (char === "}" || char === "]") out = out.replace(/,\s*$/, "");
		out += char;
	}
	try {
		const parsed: unknown = JSON.parse(out);
		return typeof parsed === "object" &&
			parsed !== null &&
			!Array.isArray(parsed)
			? (parsed as Record<string, unknown>)
			: undefined;
	} catch {
		return undefined;
	}
}

/**
 * The slice of `compilerOptions` that decides how a non-relative import
 * resolves, flattened across an `extends` chain.
 *
 * Both directories are stored already resolved, because TypeScript anchors a
 * relative path to the config file that *wrote* it: an inherited
 * `"baseUrl": "src"` means the base config's `src`, not the extending one's.
 * `pathsBase` is that same rule for `paths`, which since TypeScript 4.1 may be
 * written with no `baseUrl` at all and then resolves against its own config's
 * directory.
 */
interface TsconfigPaths {
	baseUrl?: string;
	paths?: Record<string, readonly string[]>;
	pathsBase?: string;
}

/** `extends` is a string, or (TypeScript 5.0+) a list, later entries winning. */
function tsconfigExtendsTargets(value: unknown): string[] {
	if (typeof value === "string") return [value];
	if (Array.isArray(value))
		return value.filter((entry): entry is string => typeof entry === "string");
	return [];
}

/**
 * The file an `extends` names. Relative and absolute specifiers accept the path
 * as written, with `.json` appended, or as a directory holding a
 * `tsconfig.json` — all three are what TypeScript tries. A bare specifier is a
 * package (`@tsconfig/node20`), resolved from the extending config's directory.
 *
 * `undefined` when nothing is there: an unresolvable `extends` costs the
 * project its mapping, so the caller warns rather than throwing.
 */
function resolveTsconfigExtends(
	specifier: string,
	fromDir: string,
): string | undefined {
	const candidates: string[] = [];
	if (isAbsolute(specifier) || /^\.\.?([/\\]|$)/.test(specifier)) {
		const target = resolve(fromDir, specifier);
		candidates.push(target, `${target}.json`, join(target, "tsconfig.json"));
	} else {
		const requireFromConfig = createRequire(join(fromDir, "tsconfig.json"));
		for (const id of [specifier, `${specifier}/tsconfig.json`]) {
			try {
				candidates.push(requireFromConfig.resolve(id));
			} catch {
				// Not installed, or not exported under that subpath — try the next.
			}
		}
	}
	return candidates.find((candidate) => nodeFs.isFile(candidate));
}

/** `paths` reduced to the string→string[] shape, with junk entries dropped. */
function normalizeTsconfigPaths(
	value: unknown,
): Record<string, string[]> | undefined {
	if (typeof value !== "object" || value === null || Array.isArray(value))
		return undefined;
	const paths: Record<string, string[]> = {};
	for (const [pattern, targets] of Object.entries(
		value as Record<string, unknown>,
	)) {
		if (!Array.isArray(targets)) continue;
		const strings = targets.filter(
			(target): target is string => typeof target === "string",
		);
		if (strings.length > 0) paths[pattern] = strings;
	}
	return paths;
}

/**
 * Read one tsconfig and everything it extends. Bases are read first so the
 * extending file overrides them, and `paths` is replaced wholesale rather than
 * merged — TypeScript inherits each compiler option as a unit, so a project
 * that declares `paths` does not silently keep its base's patterns too.
 */
function readTsconfigPaths(
	file: string,
	warn: (message: string) => void,
	seen: Set<string>,
): TsconfigPaths {
	if (seen.has(file) || seen.size >= TSCONFIG_EXTENDS_LIMIT) return {};
	seen.add(file);
	const raw = nodeFs.readFile?.(file);
	if (raw === undefined) return {};
	const json = parseTsconfigJson(raw);
	if (json === undefined) {
		warn(`could not parse ${file}; its baseUrl/paths are ignored`);
		return {};
	}
	const dir = dirname(file);
	let options: TsconfigPaths = {};
	for (const specifier of tsconfigExtendsTargets(json.extends)) {
		const base = resolveTsconfigExtends(specifier, dir);
		if (base === undefined) {
			warn(`${file} extends "${specifier}", which could not be found`);
			continue;
		}
		options = { ...options, ...readTsconfigPaths(base, warn, seen) };
	}
	const compilerOptions =
		typeof json.compilerOptions === "object" && json.compilerOptions !== null
			? (json.compilerOptions as Record<string, unknown>)
			: {};
	if (typeof compilerOptions.baseUrl === "string")
		options.baseUrl = resolve(dir, compilerOptions.baseUrl);
	const paths = normalizeTsconfigPaths(compilerOptions.paths);
	if (paths !== undefined) {
		options.paths = paths;
		options.pathsBase = dir;
	}
	return options;
}

/**
 * TypeScript's matching order, made explicit: an exact pattern beats every
 * wildcard, and among wildcards the longest prefix wins. Vite's alias plugin
 * takes the *first* entry that matches, so this order is the rule — without it
 * `"shared/*"` could answer for `"shared/ui/*"`.
 */
function sortedPathPatterns(
	paths: Record<string, readonly string[]>,
): Array<[string, readonly string[]]> {
	return Object.entries(paths).sort(([a], [b]) => {
		const starA = a.indexOf("*");
		const starB = b.indexOf("*");
		if ((starA === -1) !== (starB === -1)) return starA === -1 ? -1 : 1;
		return starB - starA;
	});
}

/** One `paths` target, split around the `*` the wildcard is spliced into. */
interface PathTarget {
	/** The text before the `*` — the whole target when it has none. */
	prefix: string;
	/** The text after it. */
	suffix: string;
	/** Whether the matched wildcard is substituted into this target at all. */
	wildcard: boolean;
}

/**
 * A target resolved against the `paths` base directory. `substitute` is false
 * for an exact (starless) pattern, where TypeScript uses the target verbatim
 * and a `*` in it stays a literal asterisk. More than one `*` is invalid in
 * TypeScript too, and the target is dropped.
 */
function resolvePathTarget(
	target: string,
	base: string,
	substitute: boolean,
): PathTarget | undefined {
	const resolved = resolve(base, target);
	const star = resolved.indexOf("*");
	if (star !== resolved.lastIndexOf("*")) return undefined;
	if (!substitute || star === -1)
		return { prefix: resolved, suffix: "", wildcard: false };
	return {
		prefix: resolved.slice(0, star),
		suffix: resolved.slice(star + 1),
		wildcard: true,
	};
}

/**
 * The resolver behind every `paths` alias.
 *
 * An alias on its own cannot express either half of what a `paths` pattern
 * means: TypeScript tries each target in order and takes the first that exists,
 * and an import the mapping cannot satisfy falls back to ordinary module
 * resolution. Vite's default alias resolver does the opposite — it hands back
 * the rewritten id even when nothing is there, which import analysis reports as
 * `Failed to resolve import`. Returning `null` instead lets the plugin chain
 * carry on with the original specifier, so a pattern that matches nothing on
 * disk costs the import nothing.
 *
 * Falling through is not the same as never having matched, mind: Vite's alias
 * plugin stops at the first entry whose `find` matches and does not reconsider
 * the rest. Which is why a pattern must not match ids it has no business
 * claiming in the first place — see {@link BARE_SPECIFIER_GUARD}.
 */
function tsconfigResolver(
	candidatesOf: (updatedId: string) => string[],
): ResolverFunction {
	return async function (updatedId, importer, options) {
		// Path mapping applies to an *import*. An id Rollup was handed directly —
		// a build input, the generated html entry — has no importer and is left
		// alone.
		if (importer === undefined) return null;
		for (const candidate of candidatesOf(updatedId)) {
			const resolved = await this.resolve(candidate, importer, {
				...options,
				skipSelf: true,
			});
			if (resolved) return resolved;
		}
		return null;
	};
}

/**
 * One `paths` entry as a Vite alias.
 *
 * `replacement` carries the *first* target, so the entry reads like every other
 * alias in this file and anything inspecting `resolve.alias` sees a real path;
 * the remaining targets are tried by the resolver, which recovers the matched
 * wildcard from the substituted id. (When the first target has no `*` there is
 * no wildcard to recover, so later starred targets are skipped — a mapping
 * shaped that way collapses every import onto one file and has no second
 * meaning to preserve.)
 */
function pathsAlias(
	pattern: string,
	targets: readonly string[],
	base: string,
	warn: (message: string) => void,
): Alias | undefined {
	const star = pattern.indexOf("*");
	if (star !== pattern.lastIndexOf("*")) {
		warn(`paths pattern "${pattern}" has more than one "*"; it is ignored`);
		return undefined;
	}
	const resolved = targets
		.map((target) => resolvePathTarget(target, base, star !== -1))
		.filter((target): target is PathTarget => target !== undefined);
	const [first, ...rest] = resolved;
	if (first === undefined) {
		warn(`paths pattern "${pattern}" has no usable target; it is ignored`);
		return undefined;
	}
	const find =
		star === -1
			? new RegExp(`^${BARE_SPECIFIER_GUARD}${escapeRegExp(pattern)}$`)
			: new RegExp(
					`^${BARE_SPECIFIER_GUARD}${escapeRegExp(pattern.slice(0, star))}(.*)${escapeRegExp(pattern.slice(star + 1))}$`,
				);
	return {
		find,
		replacement: first.wildcard
			? `${escapeReplacement(first.prefix)}$1${escapeReplacement(first.suffix)}`
			: escapeReplacement(first.prefix),
		customResolver: tsconfigResolver((updatedId) => {
			const wildcard = first.wildcard
				? updatedId.slice(
						first.prefix.length,
						updatedId.length - first.suffix.length,
					)
				: undefined;
			const candidates = [updatedId];
			for (const target of rest) {
				if (!target.wildcard) candidates.push(target.prefix);
				else if (wildcard !== undefined)
					candidates.push(target.prefix + wildcard + target.suffix);
			}
			return candidates;
		}),
	};
}

/**
 * The project's tsconfig `paths` as `resolve.alias` entries, in the order Vite
 * must try them. Empty — and silent — when the project has no `tsconfig.json`
 * and no `paths`, which is the zero-config case the plugin is built around.
 *
 * `paths` only. An explicit pattern is the half of TypeScript's path mapping
 * that genuinely *pre-empts* node resolution, so an alias models it faithfully;
 * `baseUrl` is a fallback and gets {@link tsconfigBaseUrl} instead.
 *
 * `warn` receives the cases where a project meant to configure something and
 * loom could not use it (an unparsable config, an `extends` that points at
 * nothing, a pattern with two wildcards): silently dropping a project's path
 * mapping is exactly the failure this function exists to prevent.
 */
export function tsconfigAliases(
	projectRoot: string,
	warn: (message: string) => void = () => {},
): Alias[] {
	const file = join(projectRoot, "tsconfig.json");
	if (!nodeFs.isFile(file)) return [];
	const options = readTsconfigPaths(file, warn, new Set());
	const aliases: Alias[] = [];
	// `paths` values are relative to `baseUrl` when there is one, and otherwise
	// (TypeScript 4.1+) to the config file that declared them.
	const base = options.baseUrl ?? options.pathsBase;
	if (options.paths !== undefined && base !== undefined) {
		for (const [pattern, targets] of sortedPathPatterns(options.paths)) {
			const alias = pathsAlias(pattern, targets, base, warn);
			if (alias !== undefined) aliases.push(alias);
		}
	}
	return aliases;
}

/**
 * The project's `baseUrl`, resolved to an absolute directory — `undefined` when
 * the tsconfig (or its `extends` chain) never declares one.
 *
 * Deliberately *not* an alias, and that is the whole point of it being its own
 * function. In TypeScript `baseUrl` is a **fallback**: ordinary node resolution
 * runs first and `baseUrl` only fills in for what it could not find. A
 * `resolve.alias` entry means the exact opposite — it pre-empts every resolver
 * there is — so `"baseUrl": "."`, one of the most ordinary lines a tsconfig can
 * carry, became a catch-all that claimed the entire module graph, Vite's own
 * `@vite/env` included, and answered for it with `<root>/@vite/env`, which is
 * nothing. See {@link VITE_INTERNAL_ID} for why declining the id afterwards did
 * not save it, and the `loom-preview:tsconfig-baseurl` plugin for where the
 * lookup lives now.
 */
export function tsconfigBaseUrl(
	projectRoot: string,
	warn: (message: string) => void = () => {},
): string | undefined {
	const file = join(projectRoot, "tsconfig.json");
	if (!nodeFs.isFile(file)) return undefined;
	return readTsconfigPaths(file, warn, new Set()).baseUrl;
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
	/**
	 * Set `false` to stop a **build** downloading the `rbxassetid://` images its
	 * bundle mentions (see `./asset-proxy.ts`). They are baked into the output by
	 * default, since a static page has no dev server to resolve ids for it; turn
	 * it off for a build that must not reach the network, or one whose images
	 * come from somewhere else entirely. The dev-server route is unaffected.
	 */
	assets?: boolean;
}

export function loomPreview(options: LoomPreviewOptions = {}): Plugin[] {
	// Per-source memo of the `.luau` fallback verdict. Workspace packages are
	// unique per specifier, so the importer doesn't need to be part of the key;
	// a `false` verdict just means "not Luau — let normal resolution handle it".
	const luauVerdicts = new Map<string, string | false>();

	// Complaints from reading the project's tsconfig. Collected in `config()`,
	// which has no logger, and reported in `configResolved`, which does — a
	// project that meant to declare a path mapping loom could not use has to hear
	// about it, or its imports simply fail later with no hint why.
	const tsconfigWarnings: string[] = [];

	// The project's tsconfig `baseUrl`, read in `config()` and applied by the
	// fallback resolver below. `undefined` until then, and for every project
	// that never declares one.
	let tsconfigBase: string | undefined;

	// The roblox-ts source rewrites (see `./transform.ts`): `import X =
	// require("m")` before vite:esbuild lowers it to a bare `require()` call
	// (which would throw in the browser), and the `.size()`/`.isEmpty()` macros.
	//
	// Applies to any TypeScript outside node_modules — previewed workspace
	// sources typically resolve through symlinks to real paths outside
	// node_modules. Confining it there is what makes the macro rewrite safe: it
	// is the previewed project that writes roblox-ts, and its dependencies,
	// React and loom's own packages are all left alone. Runs in both serve and
	// build, since esbuild and Rollup need the same source either way.
	const rbxtsSyntax: Plugin = {
		name: "loom-preview:rbxts-syntax",
		enforce: "pre",
		transform(code, id) {
			const file = id.split("?")[0] ?? id;
			if (!/\.tsx?$/.test(file)) return;
			if (file.includes("/node_modules/")) return;
			const withImports = rewriteImportEquals(code) ?? code;
			const rewritten = rewriteLuauMacros(withImports) ?? withImports;
			if (rewritten === code) return;
			return { code: rewritten, map: null };
		},
	};

	// The Roblox `Promise`, as a module-scope binding in each app module that
	// mentions the name. See {@link PROMISE_IMPORT} for why it cannot be the
	// page global instead, and {@link injectRobloxPromise} for why the import is
	// appended rather than prepended.
	//
	// Same scoping as the syntax rewrite above — previewed TypeScript, outside
	// node_modules, in serve and build alike — with one addition it cannot do
	// without: loom's own sources are excluded explicitly. In an in-repo preview
	// they resolve to real paths outside node_modules and would otherwise read
	// as app source, and injecting there would have the runtime import a
	// shadowed `Promise` from itself. Placed after the rewrite so that an
	// `import Promise = require("…")` has already become the ESM import
	// {@link bindsPromise} knows how to see.
	const robloxPromise: Plugin = {
		name: "loom-preview:roblox-promise",
		enforce: "pre",
		transform(code, id) {
			const file = id.split("?")[0] ?? id;
			if (!/\.tsx?$/.test(file)) return;
			if (file.includes("/node_modules/")) return;
			if (isLoomSource(file)) return;
			const injected = injectRobloxPromise(code);
			if (injected === undefined) return;
			// `map: null` is the honest answer, not a shrug: the transform appends
			// and so moves nothing, which is exactly the case Rollup reads a null
			// map as — every existing mapping still holds.
			return { code: injected, map: null };
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
			// Vite may resolve a config more than once per process; start clean so
			// the same complaint isn't logged twice.
			tsconfigWarnings.length = 0;
			// Silent on purpose: `tsconfigAliases` below reads the very same config
			// and collects the warnings, so a `warn` here would double every one.
			tsconfigBase = tsconfigBaseUrl(projectRoot);
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
						// Last of all: the previewed project's own tsconfig
						// `baseUrl`/`paths`, so `import { Button } from
						// "shared/ui/button"` resolves the way `tsc` resolves it. Below
						// everything above on purpose — a project that maps `@rbxts/*` at
						// its own node_modules must still reach loom's adapters. See
						// {@link tsconfigAliases}.
						...tsconfigAliases(projectRoot, (message) => {
							tsconfigWarnings.push(message);
						}),
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
		configResolved(config) {
			for (const message of tsconfigWarnings)
				config.logger.warn(`[loom] ${message}`);
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

	// tsconfig `baseUrl`, as the resolution *fallback* TypeScript defines it to
	// be: node resolution first, and this only for what it could not find. That
	// ordering is the entire fix — as an alias the same lookup pre-empted
	// everything, and a project with `"baseUrl": "."` could not boot at all.
	//
	// No `enforce`, and that is load-bearing: a normal-phase `resolveId` runs
	// *after* `vite:resolve`, so this hook is reached only for a specifier
	// nothing else could answer. `pre` would put the catch-all back in a new
	// shape. Ids Vite owns are skipped outright — they never reach real
	// resolution, so "nothing else answered" says nothing about them.
	const tsconfigBaseUrlLookup: Plugin = {
		name: "loom-preview:tsconfig-baseurl",
		async resolveId(source, importer, options) {
			if (tsconfigBase === undefined || !importer) return;
			if (!isBareSpecifier(source) || isViteInternalId(source)) return;
			// Through `this.resolve`, not a bare path: `baseUrl` names a directory,
			// and it is the resolver that supplies the extension and the `/index`
			// — and that reports "nothing there" as a null, which is what makes a
			// miss fall through instead of pinning the import to a file that
			// doesn't exist.
			const resolved = await this.resolve(
				join(tsconfigBase, source),
				importer,
				{
					...options,
					skipSelf: true,
				},
			);
			return resolved ?? undefined;
		},
	};

	const plugins: Plugin[] = [
		rbxtsSyntax,
		robloxPromise,
		main,
		tsconfigBaseUrlLookup,
		serveGlobals,
		loomAssetProxy(),
	];

	// Gallery mode: the target import map (dev) + the generated gallery page.
	const patterns =
		options.targets !== undefined
			? normalizeTargetsPatterns(options.targets)
			: undefined;

	if (options.assets !== false) {
		plugins.push(
			loomAssetBundle(
				// Only gallery mode has targets to mount. A single-entry build keeps
				// the literal scan alone: its entry *self-mounts* on import, which
				// under node would run the real WASM layout rather than the stub the
				// prerender leans on to stay cheap.
				patterns
					? {
							discover: async (root, warn) => {
								const { prerenderImages } = await import("./prerender.ts");
								return prerenderImages({
									root,
									patterns,
									...(options.shims ? { shims: options.shims } : {}),
									warn,
								});
							},
						}
					: {},
			),
		);
	}
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
