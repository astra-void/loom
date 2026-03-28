import { describe, expect, it } from "vitest";
import {
	createNonMockableSpecifiers,
	createReactShimSpecifierMap,
	isInternalPreviewPackageName,
	resolvePreviewAliasConfig,
} from "../../packages/preview/src/source/aliasConfig";

describe("preview alias config", () => {
	it("keeps defaults and appends custom aliases", () => {
		const config = resolvePreviewAliasConfig({
			reactAliases: ["@my/react"],
			reactRobloxAliases: ["@my/react-roblox"],
			runtimeAliases: ["@my/runtime"],
		});

		expect(config.runtimeAliases).toEqual(["@my/runtime"]);
		expect(config.reactAliases).toEqual(
			expect.arrayContaining(["@rbxts/react", "@my/react"]),
		);
		expect(config.reactRobloxAliases).toEqual(
			expect.arrayContaining(["@rbxts/react-roblox", "@my/react-roblox"]),
		);
	});

	it("creates shim entries for custom react aliases", () => {
		const shimEntries = createReactShimSpecifierMap({
			mode: "browser",
			reactAliases: ["@my/react"],
			reactRobloxAliases: ["@my/react-roblox"],
			resolveReactRobloxShimEntry: (mode) => `${mode}:react-roblox`,
			resolveReactShimEntry: (fileName, mode) => `${mode}:${fileName}`,
		});

		expect(shimEntries.get("@rbxts/react")).toBe("browser:react.js");
		expect(shimEntries.get("@my/react")).toBe("browser:react.js");
		expect(shimEntries.get("@my/react-roblox")).toBe("browser:react-roblox");
	});

	it("treats internal preview package names as exact matches", () => {
		expect(isInternalPreviewPackageName("@loom-dev/preview")).toBe(true);
		expect(isInternalPreviewPackageName("@loom-dev/preview-extra")).toBe(false);
	});

	it("extends non-mockable specifiers with custom react aliases", () => {
		const nonMockableSpecifiers = createNonMockableSpecifiers({
			reactAliases: ["@my/react"],
			reactRobloxAliases: ["@my/react-roblox"],
		});

		expect(nonMockableSpecifiers.has("react-dom")).toBe(true);
		expect(nonMockableSpecifiers.has("@my/react")).toBe(true);
		expect(nonMockableSpecifiers.has("@my/react-roblox")).toBe(true);
	});
});
