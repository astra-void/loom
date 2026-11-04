#!/usr/bin/env node
/**
 * `loom` CLI — preview a roblox-ts UI project in the browser with zero config.
 *
 *   loom preview [dir] [--port <n>] [--host] [--targets [glob]] [--runtime luau]
 *   loom build [dir] --targets [glob] [--out <dir>] [--base <path>] [--no-assets]
 *
 * `preview` runs a Vite dev server with the loom plugin pre-applied, so no
 * vite.config is needed. Everything past that — the generated index.html, the
 * client-entry detection, gallery mode — belongs to `loomPreview()` itself
 * (`@loom-dev/preview/vite`), so a project that would rather keep its own
 * vite.config gets exactly the same thing from the plugin alone. esbuild
 * transpiles the TSX; HMR is built in.
 *
 * `--targets` switches to gallery mode: every `**\/*.loom.tsx` and
 * `**\/*.loom.luau` under the dir
 * (or the given glob/directory) is listed in a sidebar shell with lazy mounts
 * and per-target error containment. A minimal `<dir>/loom.config.ts` exporting
 * `{ targets?, port?, shims? }` is honored when the flags
 * are absent.
 *
 * `--runtime luau` compiles a roblox-ts project with its own roblox-ts and runs
 * the Luau in `@loom-dev/luau`'s VM instead of running the TypeScript as
 * JavaScript (see `LoomPreviewOptions.runtime`).
 *
 * `build` bundles that same gallery into a static, client-only site under
 * `--out` (default `dist-preview/`) so it can be hosted anywhere or embedded in
 * a docs site — see {@link runBuild}.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { LOOM_REPO_ROOT } from "@loom-dev/preview/gallery";
import {
	ENTRY_CANDIDATES,
	findEntry,
	loomPreview,
} from "@loom-dev/preview/vite";
import { createServer } from "vite";
import { runBuild } from "./build.ts";
import { findWorkspaceRoot, resolveGalleryOptions } from "./gallery.ts";

/**
 * Import `<root>/loom.config.ts` and return its default export, plus whether the
 * file existed at all. The TS is handled by Node's own type stripping (on by
 * default from Node 24, which `engines` already requires) or by tsx's loader
 * when the CLI runs from source. Import failures are downgraded to a warning —
 * a broken config never blocks plain preview mode.
 */
async function loadLoomConfig(
	root: string,
): Promise<{ present: boolean; config?: unknown }> {
	const configPath = resolve(root, "loom.config.ts");
	if (!existsSync(configPath)) return { present: false };
	try {
		const mod = (await import(pathToFileURL(configPath).href)) as {
			default?: unknown;
		};
		return { present: true, config: mod.default };
	} catch (err) {
		console.warn(`loom: failed to load ${configPath} — ignoring it\n  ${err}`);
		return { present: true };
	}
}

async function preview(
	dir: string,
	options: {
		port?: number;
		host: boolean | string;
		targets?: string | true;
		runtime?: "js" | "luau";
	},
): Promise<void> {
	const root = resolve(process.cwd(), dir);
	if (!existsSync(root)) {
		console.error(`loom: directory not found: ${root}`);
		process.exit(1);
	}

	const { present: configPresent, config } = await loadLoomConfig(root);
	const decision = resolveGalleryOptions({
		cliTargets: options.targets,
		cliPort: options.port,
		configPresent,
		config,
	});
	if (decision.hint) console.warn(decision.hint);

	// The plugin owns the page: gallery mode (the shell mounts targets itself) or
	// a generated index.html around the detected client entry. The CLI only
	// pre-flights the entry lookup so a project with neither fails with a hint
	// instead of a server that 500s on the first request.
	if (
		!decision.patterns &&
		options.runtime !== "luau" &&
		!existsSync(resolve(root, "index.html")) &&
		!findEntry(root)
	) {
		console.error(
			`loom: no index.html and no client entry found in ${root}\n` +
				`      looked for: ${ENTRY_CANDIDATES.join(", ")}\n` +
				`      (or pass --targets to browse *.loom.tsx and *.loom.luau files as a gallery)`,
		);
		process.exit(1);
	}
	const plugins = [
		loomPreview({
			targets: decision.patterns,
			...(decision.shims ? { shims: decision.shims } : {}),
			...(options.runtime ? { runtime: options.runtime } : {}),
		}),
	];

	// esbuild.jsx + optimizeDeps + the @rbxts aliases come from loomPreview().
	// fs.allow includes the loom repo itself: the gallery shell (and, for
	// projects outside this workspace, the linked @loom-dev sources) are served
	// from it via /@fs/ URLs.
	const workspaceRoot = findWorkspaceRoot(root);
	const fsAllow = [...new Set([root, workspaceRoot, LOOM_REPO_ROOT])].filter(
		(p): p is string => typeof p === "string",
	);
	const server = await createServer({
		root,
		configFile: false, // loom owns the config; ignore any project vite.config
		plugins,
		server: {
			port: decision.port,
			host: options.host,
			fs: { allow: fsAllow },
		},
	});
	await server.listen();
	console.log(decision.patterns ? "\n  loom gallery\n" : "\n  loom preview\n");
	server.printUrls();
}

const USAGE =
	"loom — Roblox UI preview\n\n" +
	"Usage:\n" +
	"  loom preview [dir] [--port <n>] [--host] [--targets [glob]] [--runtime luau]\n" +
	"  loom build [dir] --targets [glob] [--out <dir>] [--base <path>] [--no-assets]\n";

/**
 * Read `--targets`: a boolean (default globs `**\/*.loom.tsx` and `**\/*.loom.luau`) unless followed by
 * a glob or directory. Shared by `preview` and `build`.
 */
function parseTargetsFlag(args: string[]): string | true | undefined {
	const idx = args.indexOf("--targets");
	if (idx < 0) return undefined;
	const raw = args[idx + 1];
	return raw && !raw.startsWith("-") ? raw : true;
}

/** Read a `--flag <value>` string option, or undefined when absent. */
function parseStringFlag(args: string[], flag: string): string | undefined {
	const idx = args.indexOf(flag);
	if (idx < 0) return undefined;
	const raw = args[idx + 1];
	if (!raw || raw.startsWith("-")) {
		console.error(`loom: ${flag} requires a value`);
		process.exit(1);
	}
	return raw;
}

function runPreviewCommand(args: string[]): void {
	const dir = args[1] && !args[1].startsWith("-") ? args[1] : ".";

	// Left undefined when the flag is absent so loom.config.ts can fill it in.
	let port: number | undefined;
	const portIdx = args.indexOf("--port");
	if (portIdx >= 0) {
		const raw = args[portIdx + 1];
		if (!raw || !/^\d+$/.test(raw)) {
			console.error("loom: --port requires a numeric value");
			process.exit(1);
		}
		port = Number(raw);
	}

	// --host is a boolean (bind all interfaces) unless followed by an address.
	let host: boolean | string = false;
	const hostIdx = args.indexOf("--host");
	if (hostIdx >= 0) {
		const raw = args[hostIdx + 1];
		host = raw && !raw.startsWith("-") ? raw : true;
	}

	const runtime = parseStringFlag(args, "--runtime");
	if (runtime !== undefined && runtime !== "js" && runtime !== "luau") {
		console.error('loom: --runtime must be "js" or "luau"');
		process.exit(1);
	}

	preview(dir, { port, host, targets: parseTargetsFlag(args), runtime }).catch(
		(err) => {
			console.error(err);
			process.exit(1);
		},
	);
}

function runBuildCommand(args: string[]): void {
	const dir = args[1] && !args[1].startsWith("-") ? args[1] : ".";
	const targets = parseTargetsFlag(args);
	if (targets === undefined) {
		console.error(
			"loom: `build` requires --targets [glob] (the static gallery is target-driven)",
		);
		process.exit(1);
	}
	const out = parseStringFlag(args, "--out") ?? "dist-preview";
	const base = parseStringFlag(args, "--base");
	// `--no-assets` keeps the build off the network: the `rbxassetid://` images
	// the bundle mentions are normally downloaded into the output, since a static
	// gallery has no dev server to resolve ids for it later.
	const assets = !args.includes("--no-assets");

	runBuild({ dir, targets, out, base, assets })
		.then((outDir) => {
			console.log(`\n  loom build → ${outDir}\n`);
		})
		.catch((err) => {
			console.error(err);
			process.exit(1);
		});
}

function main(): void {
	const args = process.argv.slice(2);
	const cmd = args[0];
	if (cmd === "preview") runPreviewCommand(args);
	else if (cmd === "build") runBuildCommand(args);
	else console.log(USAGE);
}

main();
