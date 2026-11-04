// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
	DEFAULT_PORT,
	DEFAULT_TARGETS_GLOBS,
	resolveGalleryOptions,
} from "./gallery.ts";

describe("resolveGalleryOptions", () => {
	it("stays out of gallery mode with no flag and no config", () => {
		const decision = resolveGalleryOptions({});
		expect(decision.patterns).toBeUndefined();
		expect(decision.port).toBe(DEFAULT_PORT);
		expect(decision.hint).toBeUndefined();
	});

	it("enables gallery mode from the bare CLI flag", () => {
		const decision = resolveGalleryOptions({ cliTargets: true });
		expect(decision.patterns).toEqual([...DEFAULT_TARGETS_GLOBS]);
	});

	it("uses config targets/port when CLI flags are absent", () => {
		const decision = resolveGalleryOptions({
			configPresent: true,
			config: { targets: "src/preview-targets", port: 4175 },
		});
		expect(decision.patterns).toEqual(
			DEFAULT_TARGETS_GLOBS.map((g) => `src/preview-targets/${g}`),
		);
		expect(decision.port).toBe(4175);
		expect(decision.hint).toBeUndefined();
	});

	it("accepts string[] config targets", () => {
		const decision = resolveGalleryOptions({
			configPresent: true,
			config: { targets: ["a", "b"] },
		});
		expect(decision.patterns).toEqual([
			...DEFAULT_TARGETS_GLOBS.map((g) => `a/${g}`),
			...DEFAULT_TARGETS_GLOBS.map((g) => `b/${g}`),
		]);
	});

	it("prefers CLI flags over config values", () => {
		const decision = resolveGalleryOptions({
			cliTargets: "elsewhere",
			cliPort: 5401,
			configPresent: true,
			config: { targets: "src/preview-targets", port: 4175 },
		});
		expect(decision.patterns).toEqual(
			DEFAULT_TARGETS_GLOBS.map((g) => `elsewhere/${g}`),
		);
		expect(decision.port).toBe(5401);
	});

	it("skips a config without a targets field, with a hint", () => {
		const decision = resolveGalleryOptions({
			configPresent: true,
			config: { projectName: "legacy", server: { port: 4175 } },
		});
		expect(decision.patterns).toBeUndefined();
		expect(decision.hint).toContain("no `targets` or `shims` field");
		// The skipped config is skipped whole — even a top-level port.
		const withPort = resolveGalleryOptions({
			configPresent: true,
			config: { port: 4175 },
		});
		expect(withPort.port).toBe(DEFAULT_PORT);
		expect(withPort.hint).toContain("no `targets` or `shims` field");
	});

	it("carries config shims through", () => {
		const shims = { "@rbxts/ui-labs": "./loom-shims/ui-labs.ts" };
		const decision = resolveGalleryOptions({
			configPresent: true,
			config: { targets: "src/targets", shims },
		});
		expect(decision.shims).toEqual(shims);
	});

	it("treats a shims-only config as usable (no gallery, no hint)", () => {
		// Plain preview mode — one client entry, no targets — still needs a way to
		// redirect a package loom can't run.
		const decision = resolveGalleryOptions({
			configPresent: true,
			config: { shims: { "@rbxts/ui-labs": "./shim.ts" }, port: 4175 },
		});
		expect(decision.patterns).toBeUndefined();
		expect(decision.hint).toBeUndefined();
		expect(decision.shims).toEqual({ "@rbxts/ui-labs": "./shim.ts" });
		expect(decision.port).toBe(4175);
	});

	it("ignores a malformed shims field", () => {
		for (const shims of [
			"@rbxts/ui-labs",
			["@rbxts/ui-labs"],
			{ "@rbxts/ui-labs": 1 },
			{ "@rbxts/ui-labs": "" },
			{},
			null,
		]) {
			const decision = resolveGalleryOptions({
				configPresent: true,
				config: { targets: "src/targets", shims },
			});
			expect(decision.shims).toBeUndefined();
		}
	});

	it("still honors the CLI flag when the config is legacy", () => {
		const decision = resolveGalleryOptions({
			cliTargets: true,
			configPresent: true,
			config: { projectName: "legacy" },
		});
		expect(decision.patterns).toEqual([...DEFAULT_TARGETS_GLOBS]);
		expect(decision.hint).toBeUndefined();
	});
});
