import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
	createUnresolvedPackageMockResolvePlugin,
	createUnresolvedPackageMockTransformPlugin,
	UNRESOLVED_MOCK_MODULE_ID,
} from "../../packages/preview/src/source/robloxPackageMockPlugin";
import { getHookHandler } from "./hookTestUtils";

describe("unresolved package mock plugin", () => {
	it("rewrites unresolved, non-browser, or virtual-mock bare imports to the shared mock module", async () => {
		const plugin = createUnresolvedPackageMockTransformPlugin();
		const source = `
      import { Dependency } from "@missing/vendor";
      import MissingDefault from "not-real-package";
      import * as MissingNamespace from "also-missing";
      import MissingModule = require("legacy-missing");
      import { LuaBound } from "resolved-lua-package";
      import { TweenService } from "resolved-virtual-package";
      export { Dependency as ReDependency } from "@missing/vendor";
      const required = require("legacy-missing");
      const lazy = import("not-real-package");
    `;

		const transform = getHookHandler(plugin.transform);
		const result = await transform?.call(
			{
				async resolve(specifier: string) {
					if (specifier === "react") {
						return { id: "/virtual/react.js" };
					}

					if (specifier === "resolved-lua-package") {
						return { id: "/virtual/init.lua?import" };
					}

					if (specifier === "resolved-virtual-package") {
						return { id: "\0virtual:loom-preview-unresolved-env" };
					}

					return null;
				},
			} as never,
			source,
			"/virtual/mana-bar.ts",
		);
		const code = typeof result === "string" ? result : (result?.code ?? "");

		expect(code).toContain(`from "${UNRESOLVED_MOCK_MODULE_ID}"`);
		expect(code).toContain(
			"const Dependency = __loomUnresolvedEnvMock.Dependency;",
		);
		expect(code).toContain("const MissingDefault = __loomUnresolvedEnvMock;");
		expect(code).toContain("const MissingNamespace = __loomUnresolvedEnvMock;");
		expect(code).toContain("const MissingModule = __loomUnresolvedModuleMock;");
		expect(code).toContain(
			"const LuaBound = __loomUnresolvedEnvMock.LuaBound;",
		);
		expect(code).toContain(
			"const TweenService = __loomUnresolvedEnvMock.TweenService;",
		);
		expect(code).toContain(
			"export const ReDependency = __loomUnresolvedEnvMock.Dependency;",
		);
		expect(code).toContain("const required = __loomUnresolvedModuleMock;");
		expect(code).toContain(
			"const lazy = Promise.resolve(__loomUnresolvedModuleMock);",
		);
	});

	it("rewrites fixture-driven unresolved package trees to the shared mock module", async () => {
		const plugin = createUnresolvedPackageMockTransformPlugin();
		const source = fs.readFileSync(
			path.resolve(__dirname, "fixtures/mock-runtime-tree/src/index.tsx"),
			"utf8",
		);
		const transform = getHookHandler(plugin.transform);
		const result = await transform?.call(
			{
				async resolve() {
					return null;
				},
			} as never,
			source,
			"/virtual/mock-runtime-tree.tsx",
		);
		const code = typeof result === "string" ? result : (result?.code ?? "");

		expect(code).toContain(`from "${UNRESOLVED_MOCK_MODULE_ID}"`);
		expect(code).toContain(
			"const MissingLabel = __loomUnresolvedEnvMock.MissingLabel;",
		);
		expect(code).toContain("export { MissingLabel };");
	});

	it("resolves bare packages with non-browser module entries to the virtual mock", async () => {
		const plugin = createUnresolvedPackageMockResolvePlugin(
			"/virtual/mock-env.ts",
		);
		const resolveId = getHookHandler(plugin.resolveId);
		const resolved = await resolveId?.call(
			{
				async resolve() {
					return { id: "/virtual/init.lua?import" };
				},
			} as never,
			"resolved-lua-package",
			"/virtual/ManaBar.tsx",
			{ attributes: {}, isEntry: false },
		);

		expect(resolved).toBe("\0virtual:loom-preview-unresolved-env");
	});

	it("resolves unresolved bare packages to a single virtual module", async () => {
		const plugin = createUnresolvedPackageMockResolvePlugin(
			"/virtual/mock-env.ts",
		);
		const resolveId = getHookHandler(plugin.resolveId);
		const resolved = await resolveId?.call(
			{
				async resolve() {
					return null;
				},
			} as never,
			"@missing/vendor",
			"/virtual/ManaBar.tsx",
			{ attributes: {}, isEntry: false },
		);
		const load = getHookHandler(plugin.load);
		const resolvedId =
			typeof resolved === "string"
				? resolved
				: resolved
					? resolved.id
					: undefined;
		const loaded = resolvedId
			? await load?.call({} as never, resolvedId)
			: undefined;
		const code = typeof loaded === "string" ? loaded : (loaded?.code ?? "");

		expect(resolvedId).toBe("\0virtual:loom-preview-unresolved-env");
		expect(code).toContain(
			'import mock, { robloxModuleMock } from "/virtual/mock-env.ts";',
		);
	});
});
