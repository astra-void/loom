// @vitest-environment node
/**
 * The dependency scan's starting points. A page loom generates has no `*.html`
 * on disk, which is where Vite's scan starts by default, so without explicit
 * entries every dependency turned up only as the page first imported it — a
 * re-optimize and a reload on every cold start, TypeScript and Luau alike.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { type InlineConfig, resolveConfig } from "vite";
import { afterEach, describe, expect, it } from "vitest";
import { GALLERY_SHELL_PATH, GLOBALS_PATH } from "./paths.ts";
import { type LoomPreviewOptions, loomPreview } from "./vite.ts";
import { fromViteFsUrl, toViteFsUrl } from "./vite-fs-url.ts";

let roots: string[] = [];
afterEach(() => {
	for (const root of roots) rmSync(root, { recursive: true, force: true });
	roots = [];
});

function project(files: Record<string, string>): string {
	const root = mkdtempSync(join(tmpdir(), "loom-scan-"));
	roots.push(root);
	for (const [path, contents] of Object.entries(files)) {
		mkdirSync(dirname(join(root, path)), { recursive: true });
		writeFileSync(join(root, path), contents);
	}
	return root;
}

async function serveConfig(
	root: string,
	options: LoomPreviewOptions = {},
	extra: InlineConfig = {},
) {
	return resolveConfig(
		{
			root,
			configFile: false,
			logLevel: "silent",
			plugins: [loomPreview(options)],
			...extra,
		},
		"serve",
	);
}

describe("the dependency scan's entries", () => {
	it("start from a detected TypeScript entry, beside the globals", async () => {
		const root = project({ "src/main.client.ts": "" });
		const config = await serveConfig(root);
		expect(config.optimizeDeps.entries).toEqual([
			GLOBALS_PATH,
			resolve(root, "src/main.client.ts"),
		]);
	});

	it("start from a configured entry", async () => {
		const root = project({ "src/boot.ts": "" });
		const config = await serveConfig(root, { entry: "./src/boot.ts" });
		expect(config.optimizeDeps.entries).toContain(resolve(root, "src/boot.ts"));
	});

	it("start from @loom-dev/luau/entry for a Luau project", async () => {
		const config = await serveConfig(
			resolve(process.cwd(), "apps/luau-example"),
		);
		expect(config.optimizeDeps.entries).toEqual([
			GLOBALS_PATH,
			expect.stringMatching(/[\\/]packages[\\/]luau[\\/]src[\\/]entry\.ts$/),
		]);
	});

	it("start from the gallery shell and every target in gallery mode", async () => {
		const root = project({ "src/A.loom.tsx": "", "src/B.loom.luau": "" });
		const config = await serveConfig(root, { targets: true });
		expect(config.optimizeDeps.entries).toEqual([
			GLOBALS_PATH,
			GALLERY_SHELL_PATH,
			resolve(root, "src/A.loom.tsx"),
			// Vite drops what its scanner cannot read; listing it is harmless.
			resolve(root, "src/B.loom.luau"),
		]);
	});

	it("are left to Vite when the project brings its own index.html", async () => {
		const root = project({
			"index.html": "<html></html>",
			"src/main.client.ts": "",
		});
		expect((await serveConfig(root)).optimizeDeps.entries).toBeUndefined();
	});

	it("keep the project's own choice", async () => {
		const root = project({ "src/main.client.ts": "" });
		const config = await serveConfig(
			root,
			{},
			{ optimizeDeps: { entries: ["src/only.ts"] } },
		);
		expect(config.optimizeDeps.entries).toEqual(["src/only.ts"]);
	});

	it("are not set when there is no entry to start from", async () => {
		const root = project({ "README.md": "" });
		expect((await serveConfig(root)).optimizeDeps.entries).toBeUndefined();
	});
});

describe("the reconciler", () => {
	it("is pre-bundled under both spellings, at one file", async () => {
		const config = await serveConfig(project({ "src/main.client.ts": "" }));
		const include = config.optimizeDeps.include ?? [];
		expect(include).toEqual(
			expect.arrayContaining([
				"react-reconciler",
				"react-reconciler/constants",
				"react-reconciler/constants.js",
			]),
		);
		const aliases = config.resolve.alias;
		const target = (id: string) =>
			aliases.find((a) => typeof a.find !== "string" && a.find.test(id))
				?.replacement;
		expect(target("react-reconciler/constants.js")).toBeDefined();
		expect(target("react-reconciler/constants.js")).toBe(
			target("react-reconciler/constants"),
		);
	});
});

describe("fromViteFsUrl", () => {
	it("inverts toViteFsUrl", () => {
		expect(fromViteFsUrl(toViteFsUrl("/proj/src/a.ts"))).toBe("/proj/src/a.ts");
		expect(fromViteFsUrl(toViteFsUrl("C:\\proj\\src\\a.ts"))).toBe(
			"C:/proj/src/a.ts",
		);
	});

	it("leaves other URLs alone", () => {
		expect(fromViteFsUrl("/src/main.client.ts")).toBeUndefined();
	});
});
