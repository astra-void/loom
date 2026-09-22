// @vitest-environment node
/**
 * The export contract for `compat/react.ts`.
 *
 * The failure this exists to prevent was not a logic bug — it was a *missing
 * name*. `import React, { Component, ReactComponent } from "@rbxts/react"` died
 * in Rollup's export analysis (`"ReactComponent" is not exported by
 * …/react-shim.js`) because the hand-written shim listed the names loom's own
 * demos happened to use. A hand-written checklist here would reproduce exactly
 * that blind spot, so the expected surface is **derived from upstream**:
 *
 * 1. `@rbxts/react`'s own `src/index.d.ts` is parsed with the TypeScript
 *    compiler API and every value-space declaration in the exported `React`
 *    namespace is collected — classes, functions, consts, enums. Interfaces and
 *    type aliases are ignored, because a type is not a runtime export.
 * 2. Those names must all exist on the compatibility module. A bumped
 *    `@rbxts/react` that adds an export therefore fails this test until loom
 *    adapts it, which is the point.
 * 3. The React-Lua runtime exports more than the declaration file admits
 *    (`Event`, `Change`, `Tag`, and a tail of internals). That list is audited
 *    by hand from the sources named in {@link REACT_LUA_RUNTIME_EXPORTS}, and
 *    every entry is either implemented or carries a reason in
 *    {@link INTENTIONALLY_UNSUPPORTED}.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import * as BrowserReact from "react";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import * as compat from "./react.ts";

const require = createRequire(import.meta.url);
const UPSTREAM_ROOT = dirname(require.resolve("@rbxts/react/package.json"));
const UPSTREAM_DECLARATIONS = join(UPSTREAM_ROOT, "src/index.d.ts");

/**
 * Every value-space declaration inside `declare namespace React { … }`.
 *
 * The namespace is the package's whole public surface (`export = React`), and
 * TypeScript's own AST is the only honest way to tell a `const` from an
 * `interface` — `ReactComponent` and `ReactPortal` look identical in a grep.
 */
function upstreamValueExports(file: string, namespace = "React"): string[] {
	const source = ts.createSourceFile(
		file,
		readFileSync(file, "utf8"),
		ts.ScriptTarget.Latest,
		true,
	);
	const names = new Set<string>();

	const collect = (body: ts.ModuleBlock): void => {
		for (const statement of body.statements) {
			if (ts.isVariableStatement(statement)) {
				for (const declaration of statement.declarationList.declarations) {
					names.add(declaration.name.getText());
				}
			} else if (ts.isFunctionDeclaration(statement) && statement.name) {
				names.add(statement.name.text);
			} else if (ts.isClassDeclaration(statement) && statement.name) {
				names.add(statement.name.text);
			} else if (ts.isEnumDeclaration(statement)) {
				names.add(statement.name.text);
			}
		}
	};

	const walk = (node: ts.Node): void => {
		if (
			ts.isModuleDeclaration(node) &&
			node.name.getText() === namespace &&
			node.body &&
			ts.isModuleBlock(node.body)
		) {
			collect(node.body);
		}
		ts.forEachChild(node, walk);
	};
	walk(source);
	return [...names].sort();
}

/**
 * The React-Lua runtime's export table, audited by hand.
 *
 * Sources, at `@rbxts/react@17.3.7-ts.2`:
 * - `@rbxts-js/react/src/React.lua` — the returned table (React-Lua is a port
 *   of React 17, so there is no `startTransition`, `useId`,
 *   `useSyncExternalStore`, `createFactory` or `version` in it).
 * - `@rbxts/react/src/init.lua` — `table.clone(React)` plus `ReactComponent`
 *   and `ReactPureComponent`, and a `createElement` wrapper.
 *
 * The declaration file omits several of these, which is why the list is here:
 * `Event`, `Change` and `Tag` are documented as *props* upstream, but they are
 * real runtime values that roblox-ts code does reach through `React.Event`.
 */
const REACT_LUA_RUNTIME_EXPORTS: readonly string[] = [
	"Change",
	"Children",
	"Component",
	"Event",
	"Fragment",
	"None",
	"Profiler",
	"PureComponent",
	"ReactComponent",
	"ReactPureComponent",
	"StrictMode",
	"Suspense",
	"Tag",
	"__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED",
	"__subscribeToBinding",
	"cloneElement",
	"createBinding",
	"createContext",
	"createElement",
	"createMutableSource",
	"createRef",
	"forwardRef",
	"isValidElement",
	"joinBindings",
	"lazy",
	"memo",
	"unstable_DebugTracingMode",
	"unstable_LegacyHidden",
	"unstable_parseReactError",
	"useBinding",
	"useCallback",
	"useContext",
	"useDebugValue",
	"useEffect",
	"useImperativeHandle",
	"useLayoutEffect",
	"useMemo",
	"useMutableSource",
	"useReducer",
	"useRef",
	"useState",
];

/**
 * Upstream runtime values loom deliberately does not re-export, each with the
 * reason. Reviewed as a set: an entry added here is a decision, not a shortcut.
 */
const INTENTIONALLY_UNSUPPORTED: Readonly<Record<string, string>> = {
	__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED:
		"React's private internals. Not re-exported by name — but the default " +
		"export spreads the pinned React, so `React.__SECRET_INTERNALS_…` is the " +
		"browser React one, which is the only value that could be correct here.",
	__subscribeToBinding:
		"React-Lua's own comment calls it accidentally exposed ('These aren't " +
		"supposed to be exposed, but they're needed by the renderer'). Loom's " +
		"renderer subscribes through the Binding object itself, so there is " +
		"nothing for a public alias to point at.",
	createMutableSource:
		"The React 17 mutable-source experiment, removed from React 18 — there " +
		"is no browser implementation to forward to. Paired with useMutableSource.",
	useMutableSource:
		"Same experiment as createMutableSource, and removed from React 18 for " +
		"the same reason.",
	unstable_DebugTracingMode:
		"A React 17 experimental element type, absent from React 18. Exposing a " +
		"stand-in would make a tree render differently under loom than in Roblox.",
	unstable_LegacyHidden:
		"Likewise a React 17 experimental element type with no React 18 " +
		"counterpart.",
	unstable_parseReactError:
		"Parses React-Lua's stringified errors for ScriptContext reporting. " +
		"Browser React throws real Error objects, so there is nothing to parse " +
		"and any implementation would be a lie about the error's provenance.",
};

describe("the upstream value-space surface", () => {
	const declared = upstreamValueExports(UPSTREAM_DECLARATIONS);

	it("parses a plausible surface out of upstream's own declarations", () => {
		// A guard on the parser, not on loom: if a future @rbxts/react restructures
		// its declarations and the walk finds nothing, every other assertion below
		// would pass vacuously.
		expect(declared.length).toBeGreaterThan(25);
		expect(declared).toContain("ReactComponent");
		expect(declared).toContain("Component");
		expect(declared).toContain("useState");
	});

	it("declares no interface or type alias as a runtime value", () => {
		// The classifier's own contract: `ReactPortal`, `Binding` and `ReactNode`
		// are type-only upstream and must not be demanded of the runtime module.
		for (const typeOnly of ["ReactPortal", "Binding", "ReactNode", "FC"]) {
			expect(declared).not.toContain(typeOnly);
		}
	});

	it("is exported in full by the compatibility module", () => {
		const missing = declared.filter((name) => !(name in compat));
		expect(missing).toEqual([]);
	});

	it("is exported in full by the default export", () => {
		const missing = declared.filter((name) => !(name in compat.default));
		expect(missing).toEqual([]);
	});
});

describe("the React-Lua runtime surface", () => {
	it("is either implemented or excluded with a reason", () => {
		const unaccounted = REACT_LUA_RUNTIME_EXPORTS.filter(
			(name) => !(name in compat) && !(name in INTENTIONALLY_UNSUPPORTED),
		);
		expect(unaccounted).toEqual([]);
	});

	it("covers everything the declaration file declares", () => {
		// The hand-audited list is a superset of the derived one; a gap means the
		// audit is stale.
		const declared = upstreamValueExports(UPSTREAM_DECLARATIONS);
		const audited = new Set(REACT_LUA_RUNTIME_EXPORTS);
		expect(declared.filter((name) => !audited.has(name))).toEqual([]);
	});

	it("gives every exclusion a non-trivial reason", () => {
		for (const [name, reason] of Object.entries(INTENTIONALLY_UNSUPPORTED)) {
			expect(reason.length, `reason for ${name}`).toBeGreaterThan(40);
		}
	});

	it("excludes nothing it actually implements", () => {
		const contradictions = Object.keys(INTENTIONALLY_UNSUPPORTED).filter(
			(name) => name in compat,
		);
		expect(contradictions).toEqual([]);
	});
});

describe("the @rbxts/react-roblox surface", () => {
	const declared = upstreamValueExports(
		join(
			dirname(require.resolve("@rbxts/react-roblox/package.json")),
			"src/index.d.ts",
		),
		"ReactRoblox",
	);

	/**
	 * `RootOptions` and `Root` are interfaces; everything else upstream declares
	 * is a value, and the preview client answers for all of it.
	 */
	it("matches what the preview client exports", async () => {
		const client = await import("../client.ts");
		expect(declared).toEqual([
			"act",
			"createBlockingRoot",
			"createLegacyRoot",
			"createPortal",
			"createRoot",
			"version",
		]);
		expect(declared.filter((name) => !(name in client))).toEqual([]);
	});

	/**
	 * Upstream is `export = ReactRoblox`, so `import ReactRoblox from
	 * "@rbxts/react-roblox"` is how roblox-ts code mounts — a named-exports-only
	 * module fails at load with "does not provide an export named 'default'",
	 * before a line of the app runs.
	 */
	it("answers the default import with the same values as the named exports", async () => {
		const client = (await import("../client.ts")) as unknown as Record<
			string,
			unknown
		>;
		const namespace = client.default as Record<string, unknown>;
		expect(namespace).toBeTypeOf("object");
		expect(declared.filter((name) => !(name in namespace))).toEqual([]);
		for (const name of declared)
			expect(namespace[name], name).toBe(client[name]);
	});

	it("exposes the three root constructors as callables", async () => {
		// `createBlockingRoot` / `createLegacyRoot` are React 17 scheduling
		// flavours loom maps onto the one root it has; they must still be
		// functions, not re-exported types.
		const client = (await import("../client.ts")) as unknown as Record<
			string,
			unknown
		>;
		for (const name of ["createRoot", "createBlockingRoot", "createLegacyRoot"])
			expect(typeof client[name], name).toBe("function");
	});
});

describe("React identity", () => {
	it("forwards standard React by reference, not by wrapper", () => {
		// The architectural constraint, asserted: one React instance, and the
		// facade hands out its values untouched. A wrapper here would break
		// `instanceof`, element-type comparison and hook dispatch in ways that
		// only show up at runtime.
		expect(compat.Component).toBe(BrowserReact.Component);
		expect(compat.PureComponent).toBe(BrowserReact.PureComponent);
		expect(compat.useState).toBe(BrowserReact.useState);
		expect(compat.useEffect).toBe(BrowserReact.useEffect);
		expect(compat.useMemo).toBe(BrowserReact.useMemo);
		expect(compat.createContext).toBe(BrowserReact.createContext);
		expect(compat.forwardRef).toBe(BrowserReact.forwardRef);
		expect(compat.memo).toBe(BrowserReact.memo);
		expect(compat.Fragment).toBe(BrowserReact.Fragment);
		expect(compat.version).toBe(BrowserReact.version);
		// The deliberate exceptions, each for a React-Lua semantic roblox-ts code
		// relies on — see their suites below.
		expect(compat.Children).not.toBe(BrowserReact.Children);
		expect(compat.cloneElement).not.toBe(BrowserReact.cloneElement);
		expect(compat.createElement).not.toBe(BrowserReact.createElement);
		expect(compat.useRef).not.toBe(BrowserReact.useRef);
		expect(compat.createRef).not.toBe(BrowserReact.createRef);
	});
});

describe("Children indices", () => {
	// React-Lua's `mapChildren` starts its counter at 1 and passes it to the
	// callback — its own source marks the line a ROBLOX DEVIATION — so roblox-ts
	// code is written against 1-based indices, and code recovering a 0-based
	// position writes `index - 1`. Browser React's 0-based index shifts every
	// such result by one: a `<Select>` keyed on it selects its neighbour.
	const three = [
		BrowserReact.createElement("frame", { key: "a" }),
		BrowserReact.createElement("frame", { key: "b" }),
		BrowserReact.createElement("frame", { key: "c" }),
	];

	it("counts from 1 in map, where browser React counts from 0", () => {
		const seen: number[] = [];
		compat.Children.map(three, (child, index) => {
			seen.push(index);
			return child;
		});
		expect(seen).toEqual([1, 2, 3]);

		const browser: number[] = [];
		BrowserReact.Children.map(three, (child, index) => {
			browser.push(index);
			return child;
		});
		expect(browser).toEqual([0, 1, 2]);
	});

	it("counts from 1 in forEach too", () => {
		const seen: number[] = [];
		compat.Children.forEach(three, (_child, index) => {
			seen.push(index);
		});
		expect(seen).toEqual([1, 2, 3]);
	});

	it("still returns what React returned, in order", () => {
		const mapped = compat.Children.map(three, (child) => child);
		expect(mapped).toHaveLength(3);
		expect(compat.Children.count(three)).toBe(3);
		expect(compat.Children.toArray(three)).toHaveLength(3);
	});

	it("reaches the namespace form as the same 1-based implementation", () => {
		// `React.Children.map` and a destructured `Children.map` must not disagree
		// inside one file.
		expect(compat.default.Children).toBe(compat.Children);
	});

	it("agrees between the default export and the named exports", () => {
		const named = compat as unknown as Record<string, unknown>;
		const fallback = compat.default as unknown as Record<string, unknown>;
		for (const name of Object.keys(named)) {
			if (name === "default") continue;
			// Type-only exports have no runtime presence; everything else must match.
			if (!(name in fallback)) continue;
			expect(fallback[name], name).toBe(named[name]);
		}
		// …and specifically for the values the report's import list touches.
		for (const name of [
			"Component",
			"PureComponent",
			"ReactComponent",
			"ReactPureComponent",
			"createContext",
			"createElement",
			"createRef",
			"forwardRef",
			"memo",
			"useEffect",
			"useMemo",
			"useRef",
			"useState",
			"Event",
			"Change",
			"Tag",
			"None",
			"createBinding",
			"useBinding",
			"joinBindings",
		]) {
			expect(fallback[name], name).toBe(named[name]);
			expect(fallback[name], name).toBeDefined();
		}
	});
});
