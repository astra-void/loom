/**
 * `transform.ts` — the roblox-ts source pre-transforms, applied to the previewed
 * project's own `.ts`/`.tsx` before esbuild sees them. Pure string→string, so
 * both are unit-testable without a Vite server.
 *
 * 1. `import X = require("m")` → an ESM namespace import.
 * 2. `.size()` / `.isEmpty()`, the Map methods `.get()` / `.set()` /
 *    `.has()` / `.delete()`, and a string's `.match()` → the symbol-keyed
 *    methods the runtime installs.
 */

// Anchored to (indented) line starts so `const x = require(...)` and
// `// import X = require(...)` comments never match. The quote is captured and
// backreferenced so mixed quotes inside the specifier can't false-positive.
const IMPORT_EQUALS_RE =
	/^([ \t]*)import\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*require\s*\(\s*(["'])([^"'\n]+)\3\s*\)\s*;?/gm;

/**
 * Rewrite every `import X = require("m");` statement to
 * `import * as X from "m";`. Returns the rewritten code, or `undefined` when
 * the file contains no import-equals statements (so callers can skip the
 * transform entirely). Idempotent: the rewritten form no longer matches.
 */
export function rewriteImportEquals(code: string): string | undefined {
	// Fast path: the vast majority of files never mention `require`.
	if (!code.includes("require")) return undefined;
	IMPORT_EQUALS_RE.lastIndex = 0;
	if (!IMPORT_EQUALS_RE.test(code)) return undefined;
	IMPORT_EQUALS_RE.lastIndex = 0;
	return code.replace(
		IMPORT_EQUALS_RE,
		(_match, indent: string, ident: string, quote: string, specifier: string) =>
			`${indent}import * as ${ident} from ${quote}${specifier}${quote};`,
	);
}

// `?.size()` keeps its optional link; `.size()` becomes a computed access, so
// the `?` is captured and re-emitted rather than replaced blind (`x.[k]()` is
// not valid JavaScript).
const LUAU_MACRO_RE = /(\?)?\.(size|isEmpty)\(\)/g;

// The Map methods and `match` take arguments, so only the `.name(` head is
// replaced and the argument list is left exactly as written.
const LUAU_MAP_RE = /(\?)?\.(get|set|has|delete|match)\(/g;

/**
 * Rewrite the roblox-ts `.size()` / `.isEmpty()` macros to the symbol-keyed
 * methods `@loom-dev/runtime` installs on `Object.prototype`. Returns
 * `undefined` when the file calls neither, so callers can skip the rewrite.
 *
 * Why a source transform rather than a prototype patch: on `Array` and `String`
 * the runtime *can* add `size()` outright, because JS defines no such member.
 * On `Map` and `Set` it cannot — JS already has `size`, as a property, and one
 * name will not be both. A prototype patch is page-wide, so redefining it would
 * reach React's maps, Vite's, and loom's own scheduler (whose `dirty.size === 0`
 * drives the frame loop). Rewriting the *call site* puts roblox-ts semantics
 * exactly where roblox-ts code is and nowhere else.
 *
 * The receiver is never parsed — only the `.size()` suffix is replaced — so no
 * expression, however nested, can be mis-split. A `.size()` inside a string
 * literal would be rewritten too; that is the accepted cost of not parsing, and
 * the emitted call still resolves for any receiver that defines its own
 * `size()`, so a project's unrelated method keeps working either way.
 */
export function rewriteLuauMacros(code: string): string | undefined {
	const macros = code.includes(".size()") || code.includes(".isEmpty()");
	const maps = /\.(?:get|set|has|delete|match)\(/.test(code);
	// Fast path: most files call none of them.
	if (!macros && !maps) return undefined;
	let out = code;
	if (macros) {
		LUAU_MACRO_RE.lastIndex = 0;
		out = out.replace(
			LUAU_MACRO_RE,
			(_match, optional: string | undefined, name: string) =>
				`${optional ? "?." : ""}[Symbol.for("loom.${name}")]()`,
		);
	}
	if (maps) {
		// roblox-ts `Map`s are Luau tables, and code leans on that: a plain table
		// cast to `Map` and read with `.get(key)` compiles to `t[key]` there but
		// throws here. The runtime's symbol methods defer to a receiver's own
		// `get`/`set`/`has`/`delete`, so real `Map`s, `URLSearchParams` and user
		// classes are untouched, and only a method-less table falls back to
		// indexing. `.match(` rides along: on a string it is Luau's pattern
		// match, which JS's RegExp `match` is not.
		LUAU_MAP_RE.lastIndex = 0;
		out = out.replace(
			LUAU_MAP_RE,
			(_match, optional: string | undefined, name: string) =>
				`${optional ? "?." : ""}[Symbol.for("loom.${name}")](`,
		);
	}
	return out;
}
