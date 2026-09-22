import { describe, expect, it } from "vitest";
import { rewriteImportEquals, rewriteLuauMacros } from "./transform.ts";

describe("rewriteImportEquals", () => {
	it("rewrites a double-quoted import-equals", () => {
		expect(rewriteImportEquals('import React = require("@rbxts/react");')).toBe(
			'import * as React from "@rbxts/react";',
		);
	});

	it("rewrites a single-quoted import-equals", () => {
		expect(rewriteImportEquals("import React = require('@rbxts/react');")).toBe(
			"import * as React from '@rbxts/react';",
		);
	});

	it("rewrites without a trailing semicolon", () => {
		expect(rewriteImportEquals('import R = require("m")')).toBe(
			'import * as R from "m";',
		);
	});

	it("rewrites multiple occurrences and preserves the rest of the file", () => {
		const input = [
			'import React = require("@rbxts/react");',
			'import ReactRoblox = require("@rbxts/react-roblox");',
			"",
			"export default React;",
			"export const roblox = ReactRoblox;",
		].join("\n");
		expect(rewriteImportEquals(input)).toBe(
			[
				'import * as React from "@rbxts/react";',
				'import * as ReactRoblox from "@rbxts/react-roblox";',
				"",
				"export default React;",
				"export const roblox = ReactRoblox;",
			].join("\n"),
		);
	});

	it("preserves indentation and tolerates loose spacing", () => {
		expect(rewriteImportEquals('\timport R  =  require ( "m" ) ;')).toBe(
			'\timport * as R from "m";',
		);
	});

	it("leaves `const x = require(...)` untouched", () => {
		const input = 'const x = require("m");';
		expect(rewriteImportEquals(input)).toBeUndefined();
	});

	it("leaves line comments untouched", () => {
		const input = '// import React = require("@rbxts/react");';
		expect(rewriteImportEquals(input)).toBeUndefined();
	});

	it("only rewrites the real statement when a comment mentions one too", () => {
		const input = [
			'// import Old = require("old");',
			'import React = require("@rbxts/react");',
		].join("\n");
		expect(rewriteImportEquals(input)).toBe(
			[
				'// import Old = require("old");',
				'import * as React from "@rbxts/react";',
			].join("\n"),
		);
	});

	it("returns undefined when there is nothing to rewrite", () => {
		expect(
			rewriteImportEquals('import { a } from "b";\nexport const c = a;'),
		).toBeUndefined();
	});

	it("is idempotent", () => {
		const once = rewriteImportEquals('import React = require("@rbxts/react");');
		expect(once).toBeDefined();
		expect(rewriteImportEquals(once as string)).toBeUndefined();
	});
});

describe("rewriteLuauMacros", () => {
	const SIZE = 'Symbol.for("loom.size")';
	const GET = 'Symbol.for("loom.get")';

	it("rewrites a size() call to the symbol-keyed macro", () => {
		expect(rewriteLuauMacros("if (entries.size() === 0) {}")).toBe(
			`if (entries[${SIZE}]() === 0) {}`,
		);
	});

	it("keeps the optional link on an optional call", () => {
		// `x?.[k]()` is the optional form; `x.[k]()` is not valid JavaScript at all.
		expect(rewriteLuauMacros("const n = map?.size();")).toBe(
			`const n = map?.[${SIZE}]();`,
		);
	});

	it("rewrites isEmpty() to its own key", () => {
		expect(rewriteLuauMacros("return list.isEmpty();")).toBe(
			'return list[Symbol.for("loom.isEmpty")]();',
		);
	});

	it("never has to split the receiver expression", () => {
		// Only the `.size()` suffix is replaced, so an arbitrarily nested receiver
		// comes through untouched — the reason this needs no parser.
		expect(rewriteLuauMacros("entries.current.get(key.name)!.size()")).toBe(
			`entries.current[${GET}](key.name)![${SIZE}]()`,
		);
	});

	it("rewrites every occurrence on a line", () => {
		expect(rewriteLuauMacros("a.size() + b.size()")).toBe(
			`a[${SIZE}]() + b[${SIZE}]()`,
		);
	});

	it("leaves a size call with arguments alone", () => {
		// roblox-ts' macro takes none, so `size(x)` is somebody else's method.
		expect(rewriteLuauMacros("grid.size(2)")).toBeUndefined();
	});

	it("returns undefined when the file calls neither macro", () => {
		expect(rewriteLuauMacros("const size = map.size;")).toBeUndefined();
		expect(rewriteLuauMacros("export const x = 1;")).toBeUndefined();
	});

	it("is idempotent", () => {
		const once = rewriteLuauMacros("m.size()") as string;
		expect(rewriteLuauMacros(once)).toBeUndefined();
	});

	it("rewrites the Map methods, keeping their arguments", () => {
		expect(
			rewriteLuauMacros("props.get(k); m.set(k, v); m?.has(k); m.delete(k);"),
		).toBe(
			'props[Symbol.for("loom.get")](k); m[Symbol.for("loom.set")](k, v); ' +
				'm?.[Symbol.for("loom.has")](k); m[Symbol.for("loom.delete")](k);',
		);
	});

	it("rewrites a string's match to the Luau one", () => {
		expect(rewriteLuauMacros("text.match(pattern)[0]")).toBe(
			'text[Symbol.for("loom.match")](pattern)[0]',
		);
	});

	it("leaves a method that merely starts with a Map name alone", () => {
		expect(
			rewriteLuauMacros("tween.setGoal(1); x.getValue();"),
		).toBeUndefined();
	});
});
