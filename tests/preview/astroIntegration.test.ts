import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import loomPreview from "../../packages/preview/src/astro/index";
import type {
	PreviewPlugin,
	PreviewPluginOption,
} from "../../packages/preview/src/source/viteTypes";

const temporaryRoots: string[] = [];

afterEach(() => {
	for (const root of temporaryRoots.splice(0)) {
		fs.rmSync(root, { force: true, recursive: true });
	}
});

function createPreviewSourceRoot() {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "loom-preview-astro-"));
	temporaryRoots.push(root);
	const sourceRoot = path.join(root, "src", "previews");
	fs.mkdirSync(sourceRoot, { recursive: true });
	fs.writeFileSync(
		path.join(root, "package.json"),
		JSON.stringify({ name: "@fixtures/astro-docs" }, null, 2),
		"utf8",
	);
	fs.writeFileSync(
		path.join(sourceRoot, "Entry.tsx"),
		"export const Entry = () => null;\n",
		"utf8",
	);
	return { root, sourceRoot };
}

function flattenPluginOptions(plugins: PreviewPluginOption[] | undefined) {
	const pending = [...(plugins ?? [])] as unknown[];
	const flattened: PreviewPlugin[] = [];

	while (pending.length > 0) {
		const plugin = pending.shift();
		if (Array.isArray(plugin)) {
			pending.unshift(...plugin);
			continue;
		}

		if (plugin && typeof plugin === "object" && !("then" in plugin)) {
			flattened.push(plugin as PreviewPlugin);
		}
	}

	return flattened;
}

async function runConfigSetup(options: Parameters<typeof loomPreview>[0]) {
	const integration = loomPreview(options);
	let captured: { vite?: Record<string, unknown> } | undefined;
	await integration.hooks["astro:config:setup"]({
		updateConfig: (config) => {
			captured = config;
		},
	});
	return { integration, vite: captured?.vite };
}

describe("loomPreview astro integration", () => {
	it("returns an Astro integration object", () => {
		const integration = loomPreview({ sourceRoot: "./src/previews" });
		expect(integration.name).toBe("@loom-dev/preview");
		expect(typeof integration.hooks["astro:config:setup"]).toBe("function");
	});

	it("injects the preview vite plugin, wasm handling, and island prebundle", async () => {
		const { root, sourceRoot } = createPreviewSourceRoot();
		const { vite } = await runConfigSetup({ cwd: root, sourceRoot });

		expect(vite).toBeDefined();
		const config = vite as {
			assetsInclude?: unknown;
			optimizeDeps?: { exclude?: string[]; include?: string[] };
			plugins?: PreviewPluginOption[];
		};

		expect(config.assetsInclude).toEqual(["**/*.wasm"]);
		expect(config.optimizeDeps?.exclude).toContain("@loom-dev/layout-engine");
		expect(config.optimizeDeps?.include).toContain(
			"@loom-dev/preview/astro/react",
		);

		const plugins = flattenPluginOptions(config.plugins);
		expect(
			plugins.some((plugin) => plugin.name === "loom-preview-source-first"),
		).toBe(true);
	});

	it("merges additional optimizeDeps excludes", async () => {
		const { root, sourceRoot } = createPreviewSourceRoot();
		const { vite } = await runConfigSetup({
			cwd: root,
			sourceRoot,
			additionalOptimizeDepsExclude: ["@fixtures/custom"],
		});

		const config = vite as { optimizeDeps?: { exclude?: string[] } };
		expect(config.optimizeDeps?.exclude).toContain("@fixtures/custom");
	});
});
