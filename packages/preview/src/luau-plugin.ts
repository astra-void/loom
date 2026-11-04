/**
 * `luau-plugin.ts` — Luau projects in the preview.
 *
 * - `virtual:loom-luau-project`: the Rojo project (`./luau-project.ts`) as the
 *   tree `@loom-dev/luau` instantiates, every script's source inlined. Each
 *   source is a watched file, so an edit reloads the page.
 * - every `*.loom.luau` gallery target, compiled to the `preview` export the
 *   gallery shell mounts — with the project beside it, so its `require`s
 *   resolve.
 *
 * With `rbxts` (the preview's `runtime: "luau"`), the project is roblox-ts:
 * `./rbxts-compiler.ts` compiles it into memory, the Rojo tree is read through
 * the compiled `out/`, and an edit recompiles the file and its importers
 * before the page reloads. Compile errors go to Vite's error overlay.
 *
 * A Luau project's page loads `@loom-dev/luau/entry` (see `luauEntryUrl`),
 * which starts the client. The VM is reached through the project's own
 * dependency on `@loom-dev/luau`, the way a roblox-ts project depends on
 * `@rbxts/react`, so a TypeScript project never loads it.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, resolve } from "node:path";
import type { Plugin, ViteDevServer } from "vite";
import {
	generateLuauProjectModule,
	LUAU_TARGET_SUFFIX,
	nodeProjectFs,
	projectFiles,
	readLuauProject,
} from "./luau-project.ts";
import {
	type CompileResult,
	createRbxtsCompiler,
	type RbxtsCompiler,
} from "./rbxts-compiler.ts";
import { toViteFsUrl } from "./vite-fs-url.ts";

export const LUAU_PROJECT_ID = "virtual:loom-luau-project";

const RESOLVED_PROJECT = "\0loom-luau-project";

/**
 * The page script for a Luau project: `@loom-dev/luau/entry`, resolved from the
 * project the way its own imports are. A real module, not a generated one,
 * so it is an entry Vite's dependency scan can follow like any app's — a
 * virtual one it cannot.
 */
export function luauEntryUrl(root: string): string {
	try {
		return toViteFsUrl(
			createRequire(resolve(root, "package.json")).resolve(
				"@loom-dev/luau/entry",
			),
		);
	} catch {
		throw new Error(
			`loom: ${root} is a Luau project, but @loom-dev/luau is not installed there\n` +
				"      (add it as a dependency: it is the Luau VM the preview runs your scripts in)",
		);
	}
}

const LUAU_FILE = /\.(luau|lua)$/;

export interface LoomLuauOptions {
	/** The project is roblox-ts: compile it to Luau and run that. */
	rbxts?: boolean;
}

export function loomLuau(options: LoomLuauOptions = {}): Plugin {
	let root = process.cwd();
	let compiler: RbxtsCompiler | undefined;
	let devServer: ViteDevServer | undefined;

	function log(result: CompileResult, what: string): void {
		const logger = devServer?.config.logger;
		const summary = `loom: ${what} ${result.compiled} file${result.compiled === 1 ? "" : "s"} in ${Math.round(result.ms)}ms`;
		if (result.errors.length === 0) logger?.info(summary, { timestamp: true });
		else
			logger?.error(`${summary}, with errors:\n${result.errors.join("\n\n")}`, {
				timestamp: true,
			});
	}

	/** The compiler, built once on first use; throws the first build's errors. */
	function rbxts(): RbxtsCompiler | undefined {
		if (!options.rbxts) return undefined;
		if (compiler === undefined) {
			const created = createRbxtsCompiler(root);
			const result = created.build();
			log(result, "compiled");
			compiler = created;
			if (result.errors.length > 0) throw new Error(result.errors.join("\n\n"));
		}
		return compiler;
	}

	return {
		name: "loom-preview:luau",
		enforce: "pre",
		config: () => ({
			// The VM finds its .wasm next to its own glue (`import.meta.url`), which
			// the dep optimizer would move into its cache without the binary.
			optimizeDeps: { exclude: ["@loom-dev/luau"] },
		}),
		configResolved(config) {
			root = config.root;
		},
		resolveId(id, importer) {
			if (id === LUAU_PROJECT_ID) return RESOLVED_PROJECT;
			// The emscripten glue reaches for `node:module` behind a Node-only
			// check, so a browser never evaluates the import. Left to Vite, every
			// build warns that it stubbed it out.
			if (id === "node:module" && importer?.endsWith("luau-vm.mjs")) {
				return { id, external: true };
			}
		},
		load(id) {
			if (id === RESOLVED_PROJECT) {
				const fs = rbxts()?.fs ?? nodeProjectFs;
				const tree = readLuauProject(root, fs);
				// Compiled output lives in memory; its sources are watched instead.
				if (!options.rbxts)
					for (const file of tree ? projectFiles(tree) : [])
						this.addWatchFile(file);
				return generateLuauProjectModule(tree, fs);
			}
			const file = id.split("?")[0] ?? id;
			if (!file.endsWith(LUAU_TARGET_SUFFIX)) return;
			const name = basename(file).slice(0, -LUAU_TARGET_SUFFIX.length);
			return (
				`import { luauPreview } from "@loom-dev/luau";\n` +
				`import { project } from ${JSON.stringify(LUAU_PROJECT_ID)};\n` +
				`export const preview = luauPreview(${JSON.stringify(readFileSync(file, "utf8"))}, ` +
				`{ name: ${JSON.stringify(name)}, project });\n`
			);
		},
		configureServer(server) {
			devServer = server;
			// A script added, removed or edited changes the place, and a Luau VM has
			// no module graph to hot-swap into: rebuild the tree and start over.
			const changed = (file: string): void => {
				if (compiler?.owns(file)) {
					const result = compiler.update([file]);
					log(result, "recompiled");
					if (result.errors.length > 0) {
						// The page keeps running the last good output; say why it didn't change.
						server.ws.send({
							type: "error",
							err: {
								message: result.errors.join("\n\n"),
								stack: "",
								plugin: "loom-preview:luau",
							},
						});
						return;
					}
				} else if (
					!LUAU_FILE.test(file) &&
					!file.endsWith("default.project.json")
				)
					return;
				const project = server.moduleGraph.getModuleById(RESOLVED_PROJECT);
				if (project) server.moduleGraph.invalidateModule(project);
				for (const target of server.moduleGraph.getModulesByFile(file) ?? []) {
					server.moduleGraph.invalidateModule(target);
				}
				server.ws.send({ type: "full-reload" });
			};
			server.watcher.on("add", changed);
			server.watcher.on("unlink", changed);
			server.watcher.on("change", changed);
		},
	};
}
