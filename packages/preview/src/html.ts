/**
 * The HTML side of `loomPreview()`: what makes the plugin usable on its own.
 *
 * A roblox-ts project has no `index.html` and no DOM mount point — it is a
 * source tree that ends in `createRoot(...)` against a `ScreenGui`. So the
 * plugin generates the page itself:
 *
 * - **serve** — a middleware answers `/` (and `/index.html`) with a generated
 *   document (`#loom-root` + a module script for the detected client entry),
 *   run through `transformIndexHtml` so Vite's own injections (HMR client, the
 *   globals script) still apply. Only when the project has no `index.html` of
 *   its own; in gallery mode the generated page wins outright.
 * - **build** — the same document is served as a *virtual* `<root>/index.html`
 *   and set as the Rollup input, so `vite build` emits a static site from a
 *   project with no HTML file at all.
 *
 * Under build the Roblox globals cannot ride in on an injected `<script src>`
 * (`transformIndexHtml` runs after bundling, so an injected src is never part
 * of the module graph). Instead the html's entry modules are collected — from
 * the generated document, or by reading the project's own `index.html` — and
 * `import "…/globals.ts"` is prepended to each. ESM evaluates imports depth
 * first in source order, so a *prepended* import runs before anything else the
 * entry pulls in.
 */
import { existsSync, readFileSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { normalizePath, type Plugin } from "vite";
import {
	DARK_BACKDROP,
	GALLERY_BOOT_SCRIPT,
	GALLERY_BOOT_STYLE,
} from "./gallery/boot.ts";
import {
	findLoomTargets,
	generateBuildEntryModule,
	generateBuildTargetsModule,
} from "./gallery.ts";
import { GALLERY_SHELL_URL } from "./gallery-plugin.ts";
import { luauEntryUrl } from "./luau-plugin.ts";
import { readLuauProject } from "./luau-project.ts";
import { GALLERY_SHELL_PATH, GLOBALS_PATH } from "./paths.ts";

/** roblox-ts client-entry conventions, in priority order. */
export const ENTRY_CANDIDATES = [
	"src/main.client.tsx",
	"src/main.client.ts",
	"src/client/main.client.tsx",
	"src/client/main.client.ts",
	"src/main.tsx",
	"src/main.ts",
	"src/index.tsx",
	"src/client.tsx",
];

/**
 * The project's client entry as a root-relative URL (`/src/main.client.tsx`).
 * Without a TypeScript one, a Luau project (a Rojo `default.project.json`, or
 * Luau scripts in the `rojo init` layout) gets `@loom-dev/luau/entry`, which
 * runs its LocalScripts. Undefined when there is neither.
 */
export function findEntry(root: string): string | undefined {
	for (const candidate of ENTRY_CANDIDATES) {
		if (existsSync(resolve(root, candidate))) return `/${candidate}`;
	}
	if (readLuauProject(root) !== undefined) return luauEntryUrl(root);
	return undefined;
}

/** The generated single-entry page: a full-viewport `#loom-root` + the entry. */
export function generateIndexHtml(entryUrl: string, title: string): string {
	return `<!doctype html>
<html lang="en">
	<head>
		<meta charset="UTF-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
		<title>${title}</title>
		<style>
			html, body { margin: 0; height: 100%; background: ${DARK_BACKDROP}; overscroll-behavior: none; }
			/* dvh where supported: on mobile 100vh is the toolbars-retracted height,
			   so a 100vh stage hangs below the visible screen. */
			#loom-root { position: relative; width: 100%; height: 100vh; height: 100dvh; overflow: hidden; }
		</style>
	</head>
	<body>
		<div id="loom-root"></div>
		<script type="module" src=${JSON.stringify(entryUrl)}></script>
	</body>
</html>
`;
}

/** The generated gallery page: sidebar + stage, driven by the shared shell. */
export function generateGalleryHtml(entryUrl: string, title: string): string {
	return `<!doctype html>
<html lang="en">
	<head>
		<meta charset="UTF-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
		<title>${title}</title>
		<style>
			${GALLERY_BOOT_STYLE}
		</style>
		<!-- The backdrop is settled from the URL here, before the first paint;
		     see gallery/boot.ts. -->
		<script>
			${GALLERY_BOOT_SCRIPT}
		</script>
	</head>
	<body>
		<aside id="loom-gallery-sidebar"></aside>
		<main id="loom-gallery-stage">
			<div id="loom-root"></div>
		</main>
		<script type="module" src=${JSON.stringify(entryUrl)}></script>
	</body>
</html>
`;
}

/**
 * The `src` of every `<script type="module">` in an HTML document, as written.
 * A regex rather than a parser: the only consumer is the build-time globals
 * prepend, and a missed exotic tag costs a runtime error the user already gets
 * today, not a silent wrong bundle.
 */
export function extractModuleScriptSrcs(html: string): string[] {
	const srcs: string[] = [];
	const tag = /<script\b[^>]*>/gi;
	for (const [raw] of html.matchAll(tag)) {
		if (!/\btype\s*=\s*["']?module\b/i.test(raw)) continue;
		const src = /\bsrc\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(raw);
		const value = src?.[2] ?? src?.[3] ?? src?.[4];
		if (value) srcs.push(value);
	}
	return srcs;
}

/** Resolve an html `src` (root-absolute, relative, or fs path) to a real file. */
function resolveScriptSrc(root: string, src: string): string | undefined {
	if (/^[a-z]+:\/\//i.test(src) || src.startsWith("//")) return undefined;
	const path = src.startsWith("/")
		? resolve(root, `.${src}`)
		: resolve(root, src);
	return existsSync(path) ? normalizePath(path) : undefined;
}

/** A posix, always-`./`-prefixed specifier for `to` as imported from `fromDir`. */
function relSpecifier(fromDir: string, to: string): string {
	let rel = relative(fromDir, to).split(sep).join("/");
	if (!rel.startsWith(".")) rel = `./${rel}`;
	return rel;
}

export interface LoomHtmlOptions {
	/**
	 * Client entry, root-relative (`/src/main.client.tsx`) or a path relative to
	 * the project root. Auto-detected from {@link ENTRY_CANDIDATES} when omitted.
	 */
	entry?: string;
	/** `<title>` of the generated page. */
	title?: string;
	/** Gallery discovery globs; set = gallery mode (no client entry needed). */
	patterns?: string[];
}

/**
 * The generated-HTML plugin. In gallery mode the generated page always wins
 * (the project's own `index.html`, if any, is not what `--targets` asked for);
 * in entry mode it only fills in for a project that has no `index.html`.
 */
export function loomIndexHtml(options: LoomHtmlOptions = {}): Plugin {
	const gallery = options.patterns !== undefined;
	const title = options.title ?? (gallery ? "loom gallery" : "loom preview");

	let root = process.cwd();
	let base = "/";
	let command: "serve" | "build" = "serve";
	// Virtual ids, placed *inside* the project root so relative specifiers in
	// the generated modules resolve against it, and so Vite treats the html as a
	// normal root-level entry.
	let htmlId = "";
	let galleryEntryId = "";
	let galleryTargetsId = "";
	/** Entry modules that must `import` the globals first (build only). */
	const globalsEntries = new Set<string>();
	/** Whether this plugin owns the page (no project index.html, or gallery). */
	let owned = false;

	/** The document, resolved lazily: entry detection needs the final root. */
	function html(): string {
		if (gallery) {
			// Dev loads the shell straight off disk through `/@fs/` (it pulls the
			// target map from `virtual:loom-targets`); the build has no such URL
			// space, so it goes through a generated entry module instead.
			return generateGalleryHtml(
				command === "build"
					? `/${relative(root, galleryEntryId).split(sep).join("/")}`
					: GALLERY_SHELL_URL,
				title,
			);
		}
		const configured = options.entry;
		const entry = configured
			? configured.startsWith("/")
				? configured
				: `/${configured.replace(/^\.\//, "")}`
			: findEntry(root);
		if (!entry) {
			throw new Error(
				`loom: no index.html and no client entry found in ${root}\n` +
					`      looked for: ${ENTRY_CANDIDATES.join(", ")}, or a Luau project (default.project.json / src/*.client.luau)\n` +
					`      (pass { entry } to loomPreview(), or { targets } to browse *.loom.tsx and *.loom.luau as a gallery)`,
			);
		}
		return generateIndexHtml(entry, title);
	}

	return {
		name: "loom-preview:index-html",
		// `pre` so the virtual html/entry ids are resolved before vite:resolve
		// tries (and fails) to find them on disk.
		enforce: "pre",
		config(userConfig, env) {
			const projectRoot = userConfig.root
				? resolve(userConfig.root)
				: process.cwd();
			const hasIndexHtml = existsSync(resolve(projectRoot, "index.html"));
			if (env.command !== "build" || (hasIndexHtml && !gallery)) return;
			// Nothing to build from otherwise: hand Rollup the virtual document.
			// An explicit `build.rollupOptions.input` is left alone — the user
			// picked their own entry.
			if (userConfig.build?.rollupOptions?.input !== undefined) return;
			return {
				build: {
					rollupOptions: {
						input: normalizePath(resolve(projectRoot, "index.html")),
					},
				},
			};
		},
		configResolved(config) {
			root = config.root;
			base = config.base;
			command = config.command;
			htmlId = normalizePath(resolve(root, "index.html"));
			galleryEntryId = normalizePath(resolve(root, "__loom-gallery-entry.ts"));
			galleryTargetsId = normalizePath(
				resolve(root, "__loom-gallery-targets.ts"),
			);
			owned = gallery || !existsSync(resolve(root, "index.html"));
		},
		buildStart() {
			if (command !== "build") return;
			globalsEntries.clear();
			if (gallery) return; // the generated gallery entry imports globals itself
			// Collect the html's entry modules so the globals import can be
			// prepended to them: the generated document's script, or the project's
			// own index.html when it brought one.
			const document = owned
				? html()
				: readFileSync(resolve(root, "index.html"), "utf8");
			for (const src of extractModuleScriptSrcs(document)) {
				const path = resolveScriptSrc(root, src);
				if (path) globalsEntries.add(path);
			}
		},
		resolveId(id) {
			if (command !== "build" || !owned) return;
			// The virtual ids arrive in three shapes: an absolute path (the Rollup
			// input), a root-relative id (`index.html`, how Vite normalizes that
			// input), and a root-relative URL (`/__loom-gallery-entry.ts`, how
			// vite:build-html asks for the generated page's script). On posix the
			// last two are indistinguishable from a real path, so match either
			// reading rather than guessing.
			const asIs = normalizePath(id);
			const asRootRelative = normalizePath(
				resolve(root, `./${id.replace(/^\//, "")}`),
			);
			const is = (target: string): boolean =>
				asIs === target || asRootRelative === target;
			if (is(htmlId) && !existsSync(htmlId)) return htmlId;
			if (!gallery) return;
			if (is(galleryEntryId)) return galleryEntryId;
			if (is(galleryTargetsId)) return galleryTargetsId;
		},
		load(id) {
			if (command !== "build" || !owned) return;
			const normalized = normalizePath(id);
			if (normalized === htmlId) return html();
			if (!gallery) return;
			if (normalized === galleryEntryId) {
				// Globals first: roblox-ts modules touch `game`/`UDim2` at module
				// top level, so nothing else may evaluate before installGlobals().
				return generateBuildEntryModule({
					globalsSpecifier: relSpecifier(root, GLOBALS_PATH),
					targetsSpecifier: relSpecifier(root, galleryTargetsId),
					shellSpecifier: relSpecifier(root, GALLERY_SHELL_PATH),
				});
			}
			if (normalized === galleryTargetsId) {
				const relPaths = findLoomTargets(root, options.patterns ?? []);
				if (relPaths.length === 0)
					this.warn(
						`no targets matched under ${root} — the gallery will be empty`,
					);
				// Relative specifiers (not absolute paths): a leading `/` means
				// root-relative to Vite, which would mangle a real fs path.
				return generateBuildTargetsModule(
					relPaths.map((rel) => ({
						key: rel,
						specifier: relSpecifier(root, resolve(root, ...rel.split("/"))),
					})),
				);
			}
		},
		transform(code, id) {
			if (command !== "build") return;
			const file = normalizePath(id.split("?")[0] ?? id);
			if (!globalsEntries.has(file)) return;
			return {
				code: `import ${JSON.stringify(GLOBALS_PATH)};\n${code}`,
				map: null,
			};
		},
		configureServer(server) {
			if (!owned) return;
			const serve = (): void => {
				server.middlewares.use(async (req, res, next) => {
					const path = (req.url ?? "/").split("?")[0] ?? "/";
					// `/loom-preview/index.html` → `/index.html`; `/` stays `/`. The
					// middleware sees the URL before Vite strips the configured base,
					// and an embedded gallery is mounted under one.
					const url = path.startsWith(base)
						? `/${path.slice(base.length)}`
						: path;
					if (url !== "/" && url !== "/index.html") return next();
					try {
						const out = await server.transformIndexHtml(
							url,
							html(),
							req.originalUrl,
						);
						res.statusCode = 200;
						res.setHeader("Content-Type", "text/html");
						res.end(out);
					} catch (err) {
						next(err);
					}
				});
			};
			// Gallery mode registers ahead of Vite's own middlewares so the
			// generated page wins; entry mode only runs when the project has no
			// index.html, and defers so anything else can still answer first.
			if (gallery) serve();
			else return serve;
		},
	};
}
