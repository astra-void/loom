// @vitest-environment node
import {
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { type Alias, resolveConfig, type ViteDevServer } from "vite";
import { afterAll, describe, expect, it } from "vitest";
import {
	GLOBALS_PATH,
	REACT_COMPAT_PATH,
	REACT_RIPPLE_COMPAT_PATH,
	RIPPLE_COMPAT_PATH,
	SERVICES_PATH,
	UI_LABS_COMPAT_PATH,
} from "./paths.ts";
import {
	loomPreview,
	resolveShimTarget,
	shimAliases,
	tsconfigAliases,
	tsconfigBaseUrl,
} from "./vite.ts";

describe("resolveShimTarget", () => {
	it("anchors relative targets to the project root, not the importer", () => {
		expect(resolveShimTarget("./loom-shims/ui-labs.ts", "/proj")).toBe(
			resolve("/proj", "loom-shims/ui-labs.ts"),
		);
		expect(resolveShimTarget("../shared/ui-labs.ts", "/proj/app")).toBe(
			resolve("/proj/app", "../shared/ui-labs.ts"),
		);
	});

	it("passes absolute targets through unchanged", () => {
		const abs = resolve("/abs/ui-labs.ts");
		expect(resolveShimTarget(abs, "/proj")).toBe(abs);
	});

	it("leaves a bare package id alone for Vite to resolve", () => {
		expect(resolveShimTarget("my-compat/ui-labs", "/proj")).toBe(
			"my-compat/ui-labs",
		);
	});
});

/** Vite's own alias matching: first entry whose `find` matches wins. */
function applyAliases(
	aliases: readonly Alias[],
	id: string,
): string | undefined {
	for (const { find, replacement } of aliases) {
		if (find instanceof RegExp) {
			if (find.test(id)) return id.replace(find, replacement);
		} else if (id === find || id.startsWith(find)) {
			return id.replace(find, replacement);
		}
	}
	return undefined;
}

describe("shimAliases", () => {
	const aliases = shimAliases(
		{ "@rbxts/ui-labs": "./loom-shims/ui-labs.ts" },
		"/proj",
	);
	const shimPath = resolve("/proj", "loom-shims/ui-labs.ts");

	it("redirects the exact package root", () => {
		expect(applyAliases(aliases, "@rbxts/ui-labs")).toBe(shimPath);
	});

	it("leaves subpaths and prefix-lookalikes alone", () => {
		// A shim written for the package root has no business answering for
		// `/controls`; `-extra` is a different package outright.
		expect(applyAliases(aliases, "@rbxts/ui-labs/foo")).toBeUndefined();
		expect(applyAliases(aliases, "@rbxts/ui-labs/controls")).toBeUndefined();
		expect(applyAliases(aliases, "@rbxts/ui-labs-extra")).toBeUndefined();
	});

	it("escapes regex metacharacters in the specifier", () => {
		const dotted = shimAliases({ "pkg.name": "/shim.ts" }, "/proj");
		expect(applyAliases(dotted, "pkg.name")).toBe(resolve("/shim.ts"));
		// `.` must not match an arbitrary character.
		expect(applyAliases(dotted, "pkgXname")).toBeUndefined();
	});

	it("emits nothing without shims", () => {
		expect(shimAliases({}, "/proj")).toEqual([]);
	});
});

describe("the generated Vite config", () => {
	const root = mkdtempSync(join(tmpdir(), "loom-shims-config-"));
	afterAll(() => rmSync(root, { recursive: true, force: true }));

	const shimPath = resolve(root, "loom-shims/ui-labs.ts");
	const configFor = async (command: "serve" | "build"): Promise<Alias[]> => {
		const config = await resolveConfig(
			{
				root,
				configFile: false,
				logLevel: "silent",
				plugins: [
					loomPreview({
						html: false,
						shims: { "@rbxts/ui-labs": "./loom-shims/ui-labs.ts" },
					}),
				],
			},
			command,
		);
		return config.resolve.alias as Alias[];
	};

	it("carries the shim alias into both serve and build", async () => {
		for (const command of ["serve", "build"] as const) {
			const aliases = await configFor(command);
			expect(applyAliases(aliases, "@rbxts/ui-labs")).toBe(shimPath);
			expect(applyAliases(aliases, "@rbxts/ui-labs/foo")).toBeUndefined();
			expect(applyAliases(aliases, "@rbxts/ui-labs-extra")).toBeUndefined();
		}
	});

	it("keeps loom's own aliases intact alongside it", async () => {
		const aliases = await configFor("serve");
		expect(applyAliases(aliases, "@rbxts/services")).toBe(SERVICES_PATH);
	});

	it("orders shims above built-in compatibility above loom's core aliases", async () => {
		const aliases = await configFor("serve");
		const indexOf = (id: string): number =>
			aliases.findIndex(({ find }) => find instanceof RegExp && find.test(id));
		// The shim for @rbxts/ui-labs, loom's built-in @rbxts/ui-labs adapter, and
		// a core alias all exist — in that order, which is what makes the first
		// one win.
		const shim = indexOf("@rbxts/ui-labs");
		const builtIn = aliases.findIndex(
			({ find, replacement }) =>
				find instanceof RegExp &&
				find.test("@rbxts/ui-labs") &&
				replacement === UI_LABS_COMPAT_PATH,
		);
		expect(shim).toBeGreaterThanOrEqual(0);
		expect(builtIn).toBeGreaterThan(shim);
		expect(indexOf("@rbxts/services")).toBeGreaterThan(builtIn);
	});

	it("lets a shim override a built-in alias (shims are matched first)", async () => {
		const config = await resolveConfig(
			{
				root,
				configFile: false,
				logLevel: "silent",
				plugins: [
					loomPreview({
						html: false,
						shims: { "@rbxts/services": "./loom-shims/services.ts" },
					}),
				],
			},
			"serve",
		);
		expect(
			applyAliases(config.resolve.alias as Alias[], "@rbxts/services"),
		).toBe(resolve(root, "loom-shims/services.ts"));
	});
});

/**
 * The renderer has two public entrypoints and one piece of state behind them:
 * `@loom-dev/renderer/fonts` registers the open faces on import, and the
 * `@loom-dev/renderer` root is what the adapters measure and paint through.
 * Split those into two module instances and the faces land in a registry
 * nothing reads, while the world that does the measuring never hears that one
 * loaded — the shape #11 was first suspected of.
 *
 * The entrypoints are guarded here rather than only in the packed dev test,
 * because that one installs from the network: this catches a `package.json`
 * `exports` change (a second bundle for the subpath, a subpath pointed at a
 * different tree) without leaving the repo.
 */
describe("the renderer's two entrypoints", () => {
	const requireFromPreview = createRequire(import.meta.url);

	it("resolve into one package, so one module holds the registry", () => {
		const root = realpathSync(requireFromPreview.resolve("@loom-dev/renderer"));
		const fonts = realpathSync(
			requireFromPreview.resolve("@loom-dev/renderer/fonts"),
		);
		// Two entries, two files.
		expect(root).not.toBe(fonts);
		// Emitted side by side — `src/` in a checkout, `dist/` once published —
		// which is what lets the state they share sit in one relative module both
		// of them import. An entry moved to a tree of its own would bundle its own
		// copy of the registry instead.
		expect(dirname(fonts)).toBe(dirname(root));
	});

	it("are both kept out of the dependency optimizer", async () => {
		const projectRoot = mkdtempSync(join(tmpdir(), "loom-renderer-entries-"));
		try {
			const config = await resolveConfig(
				{
					root: projectRoot,
					configFile: false,
					logLevel: "silent",
					plugins: [loomPreview({ html: false })],
				},
				"serve",
			);
			const exclude = config.optimizeDeps.exclude ?? [];
			const include = config.optimizeDeps.include ?? [];

			// Vite matches `exclude` by package *and* subpath — `moduleListContains`
			// in the scanner, `exclude.includes(pkgId)` in the resolver — so one
			// root entry covers `@loom-dev/renderer/fonts` too. Asserted with the
			// same rule Vite applies, so this fails if the root entry is ever
			// dropped or narrowed to something the subpath no longer sits under.
			const covers = (id: string): boolean =>
				exclude.some((m) => m === id || id.startsWith(`${m}/`));
			expect(covers("@loom-dev/renderer")).toBe(true);
			expect(covers("@loom-dev/renderer/fonts")).toBe(true);

			// And nothing asks for the subpath to be pre-bundled, which would give
			// it a chunk of its own — with its own copy of the registry inside it.
			expect(include).not.toContain("@loom-dev/renderer");
			expect(include).not.toContain("@loom-dev/renderer/fonts");
		} finally {
			rmSync(projectRoot, { recursive: true, force: true });
		}
	});
});

/**
 * The reported regression, end to end: a scene that imports `Environment` from
 * a declaration-only Luau package (`@rbxts/ui-labs`) used to die at resolution
 * with `Failed to resolve entry for package`. With a shim declared it resolves,
 * transforms, and — because the shim reaches loom's services the same way app
 * code does — selects the *same* `UserInputService` singleton.
 */
describe("a shimmed declaration-only package", () => {
	// realpath: on macOS `tmpdir()` is a symlink, and Vite resolves module ids to
	// real paths — an unresolved root would put every fixture file outside
	// `server.fs.allow` and make the dev server refuse to read it.
	const root = realpathSync(mkdtempSync(join(tmpdir(), "loom-shims-e2e-")));
	afterAll(() => rmSync(root, { recursive: true, force: true }));

	const write = (rel: string, code: string): void => {
		const parts = rel.split("/");
		if (parts.length > 1)
			mkdirSync(join(root, ...parts.slice(0, -1)), { recursive: true });
		writeFileSync(join(root, ...parts), code);
	};

	// The shim a project writes for itself — the non-story UI Labs environment.
	write(
		"loom-shims/ui-labs.ts",
		`import { UserInputService } from "@rbxts/services";

export const Environment = {
	IsStory: () => false,
	InputListener: undefined,
	UserInput: UserInputService,
};
`,
	);
	// Verbatim from the bug report, plus assertions the test can read back.
	write(
		"src/input.ts",
		`import { UserInputService } from "@rbxts/services";
import { Environment } from "@rbxts/ui-labs";

export const CustomInputService = Environment.IsStory()
	? Environment.InputListener
	: UserInputService;

export const isStory = Environment.IsStory();
export const matchesLoomService = CustomInputService === UserInputService;
export const environmentUserInput = Environment.UserInput;
`,
	);
	// A second module reaching the singleton through the plain alias: proves the
	// shim did not hand back a copy.
	write(
		"src/probe.ts",
		`export { UserInputService } from "@rbxts/services";\n`,
	);

	it("resolves, transforms, and selects loom's UserInputService", async () => {
		const { createServer } = await import("vite");
		const server = await createServer({
			root,
			configFile: false,
			logLevel: "silent",
			server: { middlewareMode: true },
			plugins: [
				loomPreview({
					html: false,
					shims: { "@rbxts/ui-labs": "./loom-shims/ui-labs.ts" },
				}),
			],
		});
		try {
			// 1. The module resolves and transforms — no package-entry failure.
			const transformed = await server.transformRequest("/src/input.ts");
			expect(transformed?.code).toBeTruthy();

			// 2. It evaluates to loom's own service singleton.
			const mod = await server.ssrLoadModule("/src/input.ts");
			const probe = await server.ssrLoadModule("/src/probe.ts");
			expect(mod.isStory).toBe(false);
			expect(mod.matchesLoomService).toBe(true);
			expect(mod.CustomInputService).toBe(probe.UserInputService);
			expect(mod.environmentUserInput).toBe(probe.UserInputService);

			// 3. That service is loom's working input service, not a husk.
			const input = mod.CustomInputService as Record<string, unknown>;
			for (const signal of ["InputBegan", "InputChanged", "InputEnded"]) {
				expect(
					(input[signal] as { Connect?: unknown } | undefined)?.Connect,
				).toBeTypeOf("function");
			}
			expect(input.GetMouseLocation).toBeTypeOf("function");
		} finally {
			await server.close();
		}
	});

	it("still fails loudly for an unshimmed subpath of the same package", async () => {
		write(
			"src/subpath.ts",
			`export { Controls } from "@rbxts/ui-labs/controls";\n`,
		);
		const { createServer } = await import("vite");
		const server = await createServer({
			root,
			configFile: false,
			logLevel: "silent",
			server: { middlewareMode: true },
			plugins: [
				loomPreview({
					html: false,
					shims: { "@rbxts/ui-labs": "./loom-shims/ui-labs.ts" },
				}),
			],
		});
		try {
			// The shim covers the root only: an unsupported subpath must surface as
			// a resolution failure rather than silently reaching the root shim.
			await expect(server.transformRequest("/src/subpath.ts")).rejects.toThrow(
				/@rbxts\/ui-labs\/controls/,
			);
		} finally {
			await server.close();
		}
	});
});

/**
 * `@rbxts/ui-labs` with **no configuration at all**: the reported code, run
 * through loom's built-in compatibility adapter. The real package *is* installed
 * in the fixture, in its published shape — the alias answers first, so its Luau
 * is never resolved, never loaded, and never reported as a Luau-only failure.
 */
describe("built-in @rbxts/ui-labs compatibility", () => {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "loom-uilabs-")));
	afterAll(() => rmSync(root, { recursive: true, force: true }));

	const write = (rel: string, code: string): void => {
		const parts = rel.split("/");
		if (parts.length > 1)
			mkdirSync(join(root, ...parts.slice(0, -1)), { recursive: true });
		writeFileSync(join(root, ...parts), code);
	};

	// `@rbxts/ui-labs` as published (2.4.2): `"main"` names a `.lua` that isn't
	// there, the runtime that ships is `.luau`, and the TypeScript is
	// declarations only.
	write(
		"node_modules/@rbxts/ui-labs/package.json",
		JSON.stringify({ main: "src/init.lua", types: "src/index.d.ts" }),
	);
	write(
		"node_modules/@rbxts/ui-labs/src/init.luau",
		'local UserInputService = game:GetService("UserInputService")\nreturn {}\n',
	);
	write(
		"node_modules/@rbxts/ui-labs/src/index.d.ts",
		'export { Environment } from "./Environment";\n',
	);

	// Verbatim from the bug report, plus assertions the test can read back.
	write(
		"src/input.ts",
		`import { UserInputService } from "@rbxts/services";
import { Environment } from "@rbxts/ui-labs";

export const CustomInputService = Environment.IsStory()
	? Environment.InputListener
	: UserInputService;

export const isStory = Environment.IsStory();
export const matchesLoomService = CustomInputService === UserInputService;
export const environmentUserInput = Environment.UserInput;
export const inputListener = Environment.InputListener;
`,
	);
	// A second module reaching the singleton through the plain alias: proves the
	// adapter did not hand back a copy.
	write(
		"src/probe.ts",
		`export { UserInputService } from "@rbxts/services";\n`,
	);
	// The project's own replacement, for the override case.
	write(
		"custom-ui-labs.ts",
		`export const Environment = { IsStory: () => false, marker: "user shim" };\n`,
	);

	const serverWith = async (
		shims?: Record<string, string>,
	): Promise<ViteDevServer> => {
		const { createServer } = await import("vite");
		return createServer({
			root,
			configFile: false,
			logLevel: "silent",
			server: { middlewareMode: true },
			plugins: [loomPreview({ html: false, ...(shims ? { shims } : {}) })],
		});
	};

	it("resolves, transforms, and selects loom's UserInputService (dev)", async () => {
		const server = await serverWith();
		try {
			// 1. Resolution and transformation both succeed — no package-entry error.
			const transformed = await server.transformRequest("/src/input.ts");
			expect(transformed?.code).toBeTruthy();

			// 2. The reported expression picks loom's service.
			const mod = await server.ssrLoadModule("/src/input.ts");
			const probe = await server.ssrLoadModule("/src/probe.ts");
			expect(mod.isStory).toBe(false);
			expect(mod.inputListener).toBeUndefined();
			expect(mod.matchesLoomService).toBe(true);
			expect(mod.CustomInputService).toBe(probe.UserInputService);
			// 3. One singleton across modules, not a duplicate service.
			expect(mod.environmentUserInput).toBe(probe.UserInputService);

			// 4. It is loom's working input service.
			const input = mod.CustomInputService as Record<string, unknown>;
			for (const signal of ["InputBegan", "InputChanged", "InputEnded"]) {
				expect(
					(input[signal] as { Connect?: unknown } | undefined)?.Connect,
				).toBeTypeOf("function");
			}
			expect(input.GetMouseLocation).toBeTypeOf("function");

			// 5. The adapter is in the module graph; the installed package's Luau
			// and declarations are not, and nothing under node_modules/@rbxts is
			// either — the alias short-circuits resolution entirely.
			const ids = [...server.moduleGraph.idToModuleMap.keys()];
			expect(ids.filter((id) => /\.luau?($|\?)/.test(id))).toEqual([]);
			expect(ids.filter((id) => id.includes("node_modules/@rbxts"))).toEqual(
				[],
			);
			expect(ids).toContain(UI_LABS_COMPAT_PATH);
		} finally {
			await server.close();
		}
	});

	it("still lets a user shim override the built-in adapter (dev)", async () => {
		const server = await serverWith({
			"@rbxts/ui-labs": "./custom-ui-labs.ts",
		});
		try {
			const mod = await server.ssrLoadModule("/src/input.ts");
			const uiLabs = await server.ssrLoadModule("/custom-ui-labs.ts");
			expect((uiLabs.Environment as { marker: string }).marker).toBe(
				"user shim",
			);
			expect(mod.isStory).toBe(false);
			// The built-in adapter is not in the graph at all.
			const ids = [...server.moduleGraph.idToModuleMap.keys()];
			expect(ids).not.toContain(UI_LABS_COMPAT_PATH);
			expect(ids.some((id) => id.endsWith("custom-ui-labs.ts"))).toBe(true);
		} finally {
			await server.close();
		}
	});

	/** Rollup, not the dev server: the static `loom build` path. */
	const buildOnce = async (
		outDir: string,
		shims?: Record<string, string>,
	): Promise<string> => {
		const { build } = await import("vite");
		await build({
			root,
			configFile: false,
			logLevel: "silent",
			plugins: [loomPreview({ html: false, ...(shims ? { shims } : {}) })],
			build: {
				outDir,
				emptyOutDir: true,
				minify: false,
				rollupOptions: {
					input: join(root, "src/input.ts"),
					// An app build drops entry exports; the assertions below read them.
					preserveEntrySignatures: "strict",
					output: { entryFileNames: "bundle.js" },
				},
			},
		});
		return readFileSync(join(root, outDir, "bundle.js"), "utf8");
	};

	it("bundles with no unresolved import and no Luau (build)", async () => {
		const code = await buildOnce("dist-builtin");
		// Rollup succeeded, and nothing was left external.
		expect(code).not.toMatch(/from\s*["']@rbxts\/ui-labs["']/);
		expect(code).not.toMatch(/\.luau?["']/);
		// The adapter itself was inlined — its non-story marker says which
		// Environment the bundle carries.
		expect(code).toContain("__hotreload_env_global_injection__");
		// …reaching the service through loom's own singleton registry, once.
		expect(code.match(/getService\("UserInputService"\)/g)).toHaveLength(1);
	});

	it("evaluates to loom's singleton in the built bundle", async () => {
		await buildOnce("dist-eval");
		const mod = (await import(
			pathToFileURL(join(root, "dist-eval/bundle.js")).href
		)) as Record<string, unknown>;
		expect(mod.isStory).toBe(false);
		expect(mod.matchesLoomService).toBe(true);
		expect(mod.CustomInputService).toBe(mod.environmentUserInput);
		// Identity is what this proves. (The fixture bundles `@rbxts/services` and
		// nothing else, and `@loom-dev/runtime` declares `sideEffects: false`, so
		// its service *factories* are shaken out and `getService` hands back
		// warned stubs — a real gallery entry pulls the runtime in through the
		// injected globals and gets the implementations. The dev-server case above
		// asserts the working input surface.)
	});

	it("lets a user shim override the built-in adapter (build)", async () => {
		const code = await buildOnce("dist-override", {
			"@rbxts/ui-labs": "./custom-ui-labs.ts",
		});
		expect(code).toContain("user shim");
		expect(code).not.toContain("__hotreload_env_global_injection__");
	});
});

/**
 * The reported regression, end to end: `HttpService` and `Color3.fromHex`.
 *
 * Two failures from the same external project, neither of which a runtime unit
 * test can catch — both happened while the browser loaded the module graph:
 *
 *     SyntaxError: The requested module "@rbxts/services" does not provide an
 *     export named "HttpService"
 *     TypeError: Color3.fromHex is not a function
 *
 * The first is a *linking* error (the alias module exports an explicit list, and
 * the service was missing from it), and the second only appears once the globals
 * module has installed the runtime's datatypes. So this fixture goes through the
 * real Vite pipeline in both modes: the dev server transforms and evaluates the
 * reported code, and `vite build` bundles a gallery target that uses it —
 * the path where a missing export is a silent `undefined` rather than a throw.
 */
describe("HttpService and Color3.fromHex compatibility", () => {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "loom-http-color-")));
	afterAll(() => rmSync(root, { recursive: true, force: true }));

	const write = (rel: string, code: string): void => {
		const parts = rel.split("/");
		if (parts.length > 1)
			mkdirSync(join(root, ...parts.slice(0, -1)), { recursive: true });
		writeFileSync(join(root, ...parts), code);
	};

	/** RFC 9562 v4, unbraced — what `GenerateGUID(false)` must return. */
	const UUID_V4 =
		/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
	const SCENE_MARKER = "http-color-scene-marker";

	// Verbatim from the report: the service through `@rbxts/services`, the theme
	// through the `Color3` global.
	write(
		"src/theme.ts",
		`import { HttpService } from "@rbxts/services";

export const id = HttpService.GenerateGUID(false);
export const color = Color3.fromHex("#6366F1");
`,
	);
	// The entry a page gets: globals first (that is what `installGlobals` is
	// prepended for), then the app module. The identity probes reach `game`
	// through the service's own parent, so the fixture needs no loom import of
	// its own — exactly what an external project has available.
	write(
		"src/entry.ts",
		`import ${JSON.stringify(GLOBALS_PATH)};
import { HttpService } from "@rbxts/services";

export { color, id } from "./theme.ts";
export const service = HttpService;
export const fullName = HttpService.GetFullName();
export const className = HttpService.ClassName;
export const isGameSingleton =
	HttpService.Parent.GetService("HttpService") === HttpService;
export const braced = HttpService.GenerateGUID(true);
export const defaulted = HttpService.GenerateGUID();
`,
	);
	// The same code as a gallery target, so the static build follows it eagerly.
	write(
		"src/targets/HttpColorScene.loom.tsx",
		`import { HttpService } from "@rbxts/services";

const ACCENT = Color3.fromHex("#6366F1");
const ID = HttpService.GenerateGUID(false);

export const preview = {
	title: "${SCENE_MARKER}",
	render: () => (
		<frame
			Name={\`Card-\${ID}\`}
			Size={UDim2.fromOffset(240, 100)}
			BackgroundColor3={ACCENT}
		>
			<textlabel
				Size={UDim2.fromScale(1, 1)}
				BackgroundTransparency={1}
				Text={ID}
				TextColor3={Color3.fromHex("FFFFFF")}
			/>
		</frame>
	),
} as const;
`,
	);

	it("transforms and evaluates the reported code (dev)", async () => {
		const { createServer } = await import("vite");
		const server = await createServer({
			root,
			configFile: false,
			logLevel: "silent",
			server: { middlewareMode: true },
			// Everything below is transform + SSR evaluation, neither of which
			// touches a pre-bundled dependency. Skipping discovery keeps a cold
			// esbuild scan of react and the reconciler out of a test that would
			// never read the result.
			optimizeDeps: { noDiscovery: true, include: [] },
			plugins: [loomPreview({ html: false, targets: "src/targets" })],
		});
		try {
			// 1. Vite's development transformation succeeds — for the plain module
			//    and for the gallery target that uses the same two APIs.
			expect(
				(await server.transformRequest("/src/theme.ts"))?.code,
			).toBeTruthy();
			expect(
				(await server.transformRequest("/src/targets/HttpColorScene.loom.tsx"))
					?.code,
			).toBeTruthy();

			const mod = await server.ssrLoadModule("/src/entry.ts");

			// 2. A real GUID, in both brace forms.
			expect(mod.id).toMatch(UUID_V4);
			expect(mod.braced).toMatch(/^\{.+\}$/);
			expect((mod.braced as string).slice(1, -1)).toMatch(UUID_V4);
			expect(mod.defaulted).toMatch(/^\{.+\}$/);
			// A fresh value per call, not one cached at module scope.
			const service = mod.service as { GenerateGUID(b: boolean): string };
			expect(service.GenerateGUID(false)).not.toBe(service.GenerateGUID(false));

			// 3. The color converted through the runtime's own channel math.
			const color = mod.color as { R: number; G: number; B: number };
			expect(color.R).toBeCloseTo(99 / 255, 10);
			expect(color.G).toBeCloseTo(102 / 255, 10);
			expect(color.B).toBeCloseTo(241 / 255, 10);

			// 4. The export *is* the `game.GetService` singleton, and a real
			//    instance rather than a plain object.
			expect(mod.isGameSingleton).toBe(true);
			expect(mod.className).toBe("HttpService");
			expect(mod.fullName).toBe("HttpService");
		} finally {
			await server.close();
		}
	});

	it("builds the static gallery with no missing export and no bare import", async () => {
		const { build } = await import("vite");
		const logs: string[] = [];
		const result = await build({
			root,
			configFile: false,
			logLevel: "silent",
			plugins: [loomPreview({ targets: "src/targets" })],
			build: {
				outDir: "dist-gallery",
				emptyOutDir: true,
				minify: false,
				rollupOptions: {
					// A missing named export is a *warning* in Rollup, not an error:
					// the import silently becomes `undefined` and the page dies at
					// runtime. Capturing the log is what turns that back into a
					// failing test.
					onLog(_level: string, log: { message?: string }) {
						logs.push(log.message ?? "");
					},
				},
			},
		});

		// 5. `vite build` succeeded at all.
		expect(Array.isArray(result) || typeof result === "object").toBe(true);
		// 6. Rollup reported nothing about a missing `HttpService` export.
		expect(
			logs.filter((message) => /HttpService|MISSING_EXPORT/i.test(message)),
		).toEqual([]);

		const assets = join(root, "dist-gallery/assets");
		const bundles = readdirSync(assets)
			.filter((name) => name.endsWith(".js"))
			.map((name) => readFileSync(join(assets, name), "utf8"));
		expect(bundles.length).toBeGreaterThan(0);
		const all = bundles.join("\n");

		// 7. Nothing was left as an unresolved bare import.
		expect(all).not.toMatch(/from\s*["']@rbxts\/services["']/);
		// 8. The target shipped, reaching the service through loom's registry and
		//    the color through the runtime's own `fromHex`.
		expect(all).toContain(SCENE_MARKER);
		expect(all).toContain('getService("HttpService")');
		expect(all).toMatch(/fromHex/);
	});
});

/**
 * The generic case the built-in registry deliberately does *not* cover: a
 * package that ships Luau and nothing else. It must fail with loom's own
 * diagnostic — naming the package, the importer and `shims` — instead of
 * handing Luau to Rollup's JavaScript parser.
 */
describe("an unknown Luau-only package", () => {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "loom-luau-only-")));
	afterAll(() => rmSync(root, { recursive: true, force: true }));

	const write = (rel: string, code: string): void => {
		const parts = rel.split("/");
		if (parts.length > 1)
			mkdirSync(join(root, ...parts.slice(0, -1)), { recursive: true });
		writeFileSync(join(root, ...parts), code);
	};

	// The `@rbxts/ui-labs` shape: `"main"` names a `.lua` that isn't even there
	// (what ships is `.luau`), which is why Vite's own message is a bare
	// "Failed to resolve entry for package".
	write(
		"node_modules/@rbxts/example/package.json",
		JSON.stringify({ main: "src/init.lua", types: "src/index.d.ts" }),
	);
	write("node_modules/@rbxts/example/src/init.luau", "return {}\n");
	write(
		"node_modules/@rbxts/example/src/index.d.ts",
		"export const x: number;",
	);
	write("src/uses-example.ts", `export { x } from "@rbxts/example";\n`);

	// The other shape: the Luau main resolves, and handing it back would put
	// Luau in front of the JavaScript parser.
	write(
		"node_modules/@rbxts/compiled/package.json",
		JSON.stringify({ main: "out/init.luau" }),
	);
	write("node_modules/@rbxts/compiled/out/init.luau", "return {}\n");
	write("src/uses-compiled.ts", `export { y } from "@rbxts/compiled";\n`);

	// A package with real TypeScript source still uses that fallback, untouched.
	write(
		"node_modules/@rbxts/sourced/package.json",
		JSON.stringify({ main: "out/init.luau" }),
	);
	write("node_modules/@rbxts/sourced/out/init.luau", "return {}\n");
	write("node_modules/@rbxts/sourced/src/index.ts", "export const z = 7;\n");
	write("src/uses-sourced.ts", `export { z } from "@rbxts/sourced";\n`);

	// An ordinary missing JavaScript package keeps its own error.
	write("src/uses-missing.ts", `export { q } from "not-installed-anywhere";\n`);

	const withServer = async (
		fn: (server: ViteDevServer) => Promise<void>,
		shims?: Record<string, string>,
	): Promise<void> => {
		const { createServer } = await import("vite");
		const server = await createServer({
			root,
			configFile: false,
			logLevel: "silent",
			server: { middlewareMode: true },
			plugins: [loomPreview({ html: false, ...(shims ? { shims } : {}) })],
		});
		try {
			await fn(server);
		} finally {
			await server.close();
		}
	};

	const failureFor = async (
		server: ViteDevServer,
		url: string,
	): Promise<Error | undefined> =>
		server
			.transformRequest(url)
			.then(() => undefined)
			.catch((error: Error) => error);

	it("reports a loom diagnostic naming the package, importer and shims", async () => {
		await withServer(async (server) => {
			const error = await failureFor(server, "/src/uses-example.ts");
			expect(error?.message).toContain("[loom]");
			expect(error?.message).toContain('Package "@rbxts/example"');
			expect(error?.message).toContain("Lua/Luau");
			expect(error?.message).toContain("uses-example.ts");
			expect(error?.message).toContain("shims");
			// It does not claim loom can translate the package for you.
			expect(error?.message).not.toMatch(/automatic|translat/i);
			// The underlying resolution failure is preserved.
			expect(error?.cause).toBeDefined();
		});
	});

	it("reports it for a resolvable Luau main with no source either", async () => {
		await withServer(async (server) => {
			const error = await failureFor(server, "/src/uses-compiled.ts");
			expect(error?.message).toMatch(/\[loom\] Package "@rbxts\/compiled"/);
			expect(error?.message).toContain("init.luau");
		});
	});

	it("leaves a Luau-main package that has TypeScript source alone", async () => {
		await withServer(async (server) => {
			const mod = await server.ssrLoadModule("/src/uses-sourced.ts");
			expect(mod.z).toBe(7);
		});
	});

	it("does not intercept an ordinary missing package", async () => {
		await withServer(async (server) => {
			const error = await failureFor(server, "/src/uses-missing.ts");
			expect(error).toBeDefined();
			expect(error?.message).not.toContain("[loom]");
		});
	});

	it("stops complaining once a shim covers it", async () => {
		write("loom-shims/example.ts", "export const x = 3;\n");
		await withServer(
			async (server) => {
				const mod = await server.ssrLoadModule("/src/uses-example.ts");
				expect(mod.x).toBe(3);
			},
			{ "@rbxts/example": "./loom-shims/example.ts" },
		);
	});

	it("fails the static build with the same diagnostic", async () => {
		const { build } = await import("vite");
		await expect(
			build({
				root,
				configFile: false,
				logLevel: "silent",
				plugins: [loomPreview({ html: false })],
				build: {
					write: false,
					rollupOptions: { input: join(root, "src/uses-example.ts") },
				},
			}),
		).rejects.toThrow(/\[loom\] Package "@rbxts\/example"/);
	});
});

/**
 * The reported regression, end to end.
 *
 * `@rbxts/react-ripple` (and its `@rbxts/ripple` dependency) publish a Luau
 * runtime and a `.d.ts` — no browser-executable code at all. Left to normal
 * resolution, Vite finds `"main": "src/init.luau"`; development can look fine
 * because a gallery target is a *lazy* import that is only fetched when the
 * scene is opened, while `vite build` eagerly follows every target to code-split
 * it and hands the Luau to Rollup's JavaScript parser:
 *
 *     ../node_modules/@rbxts/react-ripple/src/init.luau (1:6):
 *     Expected ';', '}' or <eof>
 *
 * The fixture installs both packages in exactly that published shape, so the
 * built-in aliases have to beat real package resolution — not merely exist.
 */
describe("built-in Ripple compatibility", () => {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "loom-ripple-")));
	afterAll(() => rmSync(root, { recursive: true, force: true }));

	const write = (rel: string, code: string): void => {
		const parts = rel.split("/");
		if (parts.length > 1)
			mkdirSync(join(root, ...parts.slice(0, -1)), { recursive: true });
		writeFileSync(join(root, ...parts), code);
	};

	// The published package layout, verbatim: a Luau runtime entry, TypeScript
	// declarations, and nothing a browser could run.
	write(
		"node_modules/@rbxts/ripple/package.json",
		JSON.stringify({
			name: "@rbxts/ripple",
			main: "src/init.luau",
			types: "src/index.d.ts",
		}),
	);
	write(
		"node_modules/@rbxts/ripple/src/init.luau",
		'local config = require("@self/config")\nreturn { config = config }\n',
	);
	write(
		"node_modules/@rbxts/ripple/src/index.d.ts",
		"export function createSpring(value: number): never;\n",
	);
	write(
		"node_modules/@rbxts/react-ripple/package.json",
		JSON.stringify({
			name: "@rbxts/react-ripple",
			main: "src/init.luau",
			types: "src/index.d.ts",
			dependencies: { "@rbxts/ripple": "^0.10.1" },
		}),
	);
	// The exact first line from the reported RollupError.
	write(
		"node_modules/@rbxts/react-ripple/src/init.luau",
		"local Ripple = require(script.Parent.Ripple)\nlocal useMotion = require(script.useMotion)\n",
	);
	write(
		"node_modules/@rbxts/react-ripple/src/index.d.ts",
		"export function useSpring(value: number): never;\n",
	);

	// The scene from the report, as a gallery target.
	write(
		"src/targets/RippleScene.loom.tsx",
		`import { useSpring } from "@rbxts/react-ripple";

function RippleScene() {
	const [value, spring] = useSpring(0);

	return (
		<textbutton
			Size={value.map((offset) => UDim2.fromOffset(200 + offset, 50))}
			Event={{
				MouseEnter: () => spring.setGoal(20),
				MouseLeave: () => spring.setGoal(0),
			}}
		/>
	);
}

export const preview = {
	title: "Ripple",
	render: () => <RippleScene />,
} as const;
`,
	);
	// A plain module so the *aliased specifier* can be evaluated directly —
	// proving the redirect lands on a working runtime, not just on some file.
	// `@rbxts/ripple` rather than the React package: the hooks pull in React,
	// which is CJS and cannot be evaluated by Vite's SSR runner (in the browser
	// the dep optimizer converts it first). The React package's *resolution* is
	// covered by the target below and by the module-graph assertions.
	write(
		"src/uses-ripple.ts",
		`import { config, createSpring } from "@rbxts/ripple";

const spring = createSpring(0, config.stiff);
spring.setGoal(100);
for (let i = 0; i < 600; i++) spring.step(1 / 60);

export const settled = spring.getPosition();
export const preset = config.stiff;
`,
	);

	/** Every `.luau`/`.lua` id that made it into a module graph. */
	const luauIn = (ids: readonly string[]): string[] =>
		ids.filter((id) => /\.luau?($|\?)/.test(id));

	it("resolves both packages to loom's runtimes, and runs them (dev)", async () => {
		const { createServer } = await import("vite");
		const server = await createServer({
			root,
			configFile: false,
			logLevel: "silent",
			server: { middlewareMode: true },
			// A fresh tmp root has no `node_modules/.vite`, and forcing the
			// optimizer makes sure nothing here depends on a warm cache.
			optimizeDeps: { force: true },
			plugins: [loomPreview({ html: false, targets: "src/targets" })],
		});
		try {
			// 1. The target transforms — no Luau reaches the pipeline.
			const transformed = await server.transformRequest(
				"/src/targets/RippleScene.loom.tsx",
			);
			expect(transformed?.code).toBeTruthy();

			// 2. The aliased specifier evaluates to a working spring.
			const mod = await server.ssrLoadModule("/src/uses-ripple.ts");
			expect(mod.settled).toBe(100);
			expect(mod.preset).toEqual({ tension: 210, friction: 20 });

			// 3. Both packages resolved to loom's adapters, and no Luau is in the
			//    graph — the `.luau` mains were never consulted.
			const ids = [...server.moduleGraph.idToModuleMap.keys()];
			expect(luauIn(ids)).toEqual([]);
			expect(ids).toContain(REACT_RIPPLE_COMPAT_PATH);
			expect(ids).toContain(RIPPLE_COMPAT_PATH);
			expect(ids).not.toContain("@rbxts/ripple");
		} finally {
			await server.close();
		}
	});

	it("builds the static gallery with no Luau in the module graph", async () => {
		const { build } = await import("vite");
		const seen: string[] = [];
		const result = await build({
			root,
			configFile: false,
			logLevel: "silent",
			plugins: [
				loomPreview({ targets: "src/targets" }),
				{
					name: "loom-test:record-ids",
					// Every module Rollup actually loaded, which is the graph the
					// reported RollupError came out of.
					load(id: string) {
						seen.push(id);
						return null;
					},
				},
			],
			build: { outDir: "dist-gallery", emptyOutDir: true, minify: false },
		});

		// The build succeeded at all — this is the step that used to fail.
		expect(Array.isArray(result) || typeof result === "object").toBe(true);
		// 4. No `.luau`/`.lua` module from either Ripple package reached Rollup.
		expect(luauIn(seen)).toEqual([]);
		expect(seen).toContain(REACT_RIPPLE_COMPAT_PATH);
		expect(seen).toContain(RIPPLE_COMPAT_PATH);

		// …and nothing was left as an unresolved bare import in the output.
		const assets = join(root, "dist-gallery/assets");
		const bundles = readdirSync(assets)
			.filter((name) => name.endsWith(".js"))
			.map((name) => readFileSync(join(assets, name), "utf8"));
		expect(bundles.length).toBeGreaterThan(0);
		const all = bundles.join("\n");
		expect(all).not.toMatch(/from\s*["']@rbxts\/(react-)?ripple["']/);
		expect(all).not.toMatch(/\.luau?["']/);
		// The adapter really is what got bundled.
		expect(all).toContain("Ripple compatibility");
	});

	it("resolves dev and build to the very same modules", async () => {
		// Both halves above assert against the same two absolute paths; this
		// states the invariant they exist to protect.
		expect(REACT_RIPPLE_COMPAT_PATH).toMatch(/compat[/\\]react-ripple\.ts$/);
		expect(RIPPLE_COMPAT_PATH).toMatch(/compat[/\\]ripple\.ts$/);
	});
});

/**
 * tsconfig path mapping, as a unit over real fixture directories.
 *
 * roblox-ts projects import non-relatively — `import { Button } from
 * "shared/ui/button"` — and nothing but the project's own `baseUrl`/`paths`
 * says what that means. These assertions are the translation itself: which
 * specifiers each entry claims, where they land, and in what order Vite gets to
 * try them.
 */
describe("tsconfigAliases", () => {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "loom-tsconfig-")));
	afterAll(() => rmSync(root, { recursive: true, force: true }));

	/** A fixture project directory with the given files written into it. */
	const project = (name: string, files: Record<string, string>): string => {
		const dir = join(root, name);
		mkdirSync(dir, { recursive: true });
		for (const [rel, content] of Object.entries(files)) {
			const file = join(dir, rel);
			mkdirSync(dirname(file), { recursive: true });
			writeFileSync(file, content);
		}
		return dir;
	};

	it("emits nothing when the project has no tsconfig at all", () => {
		expect(tsconfigAliases(project("no-tsconfig", {}))).toEqual([]);
	});

	it("emits nothing when the tsconfig declares neither baseUrl nor paths", () => {
		const dir = project("no-mapping", {
			"tsconfig.json": JSON.stringify({
				compilerOptions: { strict: true, jsx: "react-jsx" },
			}),
		});
		expect(tsconfigAliases(dir)).toEqual([]);
	});

	it("reads baseUrl as a directory, and emits no alias for it", () => {
		const dir = project("base-url", {
			"tsconfig.json": JSON.stringify({ compilerOptions: { baseUrl: "src" } }),
		});
		expect(tsconfigBaseUrl(dir)).toBe(join(dir, "src"));
		// An alias pre-empts every resolver there is, and `baseUrl` is a fallback
		// — so it gets none. The lookup lives in a normal-phase `resolveId`, below
		// in "a project whose tsconfig sets baseUrl at its root".
		expect(tsconfigAliases(dir)).toEqual([]);
	});

	it("leaves relative, absolute, virtual, scheme and Vite's own ids alone", () => {
		const dir = project("paths-guard", {
			// `"*"` is a legal pattern, and the one shape of `paths` that is every
			// bit as greedy as the old `baseUrl` alias was.
			"tsconfig.json": JSON.stringify({
				compilerOptions: { paths: { "*": ["src/*"] } },
			}),
		});
		const aliases = tsconfigAliases(dir);
		expect(applyAliases(aliases, "shared/ui")).toBe(join(dir, "src/shared/ui"));
		// A catch-all that swallowed these would rewrite the entire module graph —
		// every relative import, the plugin's `virtual:loom-globals`, and (the one
		// that takes the page down outright) Vite's own client and env.
		for (const id of [
			"./sibling.ts",
			"../parent.ts",
			"/src/main.client.tsx",
			"\0virtual:loom-globals",
			"virtual:loom-targets",
			"node:fs",
			"data:text/javascript,0",
			"https://example.com/x.js",
			"@vite/env",
			"@vite/client",
			"/@vite/client",
			"@id/__x00__virtual:loom-globals",
			"@react-refresh",
		])
			expect(applyAliases(aliases, id)).toBeUndefined();
	});

	it("translates paths patterns, exact first and longest prefix next", () => {
		// No `baseUrl`: the patterns are the whole mapping, so what does *not*
		// match is as visible as what does.
		const dir = project("paths", {
			"tsconfig.json": JSON.stringify({
				compilerOptions: {
					paths: {
						"shared/*": ["src/shared/*"],
						"shared/ui/*": ["src/ui/*"],
						config: ["src/config.ts"],
					},
				},
			}),
		});
		const aliases = tsconfigAliases(dir);
		// The order *is* the rule: Vite's alias plugin takes the first match, so
		// `shared/*` sitting above `shared/ui/*` would swallow every UI import.
		expect(applyAliases(aliases, "config")).toBe(join(dir, "src/config.ts"));
		expect(applyAliases(aliases, "shared/ui/button")).toBe(
			join(dir, "src/ui/button"),
		);
		expect(applyAliases(aliases, "shared/math")).toBe(
			join(dir, "src/shared/math"),
		);
		// An exact pattern is exact: no subpaths, no prefix lookalikes.
		expect(applyAliases(aliases, "config/deep")).toBeUndefined();
		expect(applyAliases(aliases, "configuration")).toBeUndefined();
	});

	it("keeps a `*` literal in the target of an exact pattern", () => {
		const dir = project("exact-star", {
			"tsconfig.json": JSON.stringify({
				compilerOptions: { paths: { glob: ["src/*"] } },
			}),
		});
		// TypeScript substitutes nothing into a pattern that has no wildcard.
		expect(applyAliases(tsconfigAliases(dir), "glob")).toBe(join(dir, "src/*"));
	});

	it("anchors paths at baseUrl when both are declared", () => {
		const dir = project("paths-under-base", {
			"tsconfig.json": JSON.stringify({
				compilerOptions: { baseUrl: "src", paths: { "@app/*": ["app/*"] } },
			}),
		});
		expect(applyAliases(tsconfigAliases(dir), "@app/store")).toBe(
			join(dir, "src/app/store"),
		);
	});

	it("anchors paths at the config's own directory when baseUrl is absent", () => {
		const dir = project("paths-no-base", {
			"tsconfig.json": JSON.stringify({
				compilerOptions: { paths: { "@app/*": ["src/app/*"] } },
			}),
		});
		const aliases = tsconfigAliases(dir);
		// TypeScript 4.1+: `paths` with no `baseUrl` is legal and resolves against
		// the tsconfig. And with no baseUrl there is no catch-all — an unmapped
		// bare specifier is still a package.
		expect(aliases).toHaveLength(1);
		expect(applyAliases(aliases, "@app/store")).toBe(
			join(dir, "src/app/store"),
		);
		expect(applyAliases(aliases, "shared/ui")).toBeUndefined();
	});

	it("follows extends, anchoring the base's paths to the base's directory", () => {
		project("extends-base", {
			"tsconfig.base.json": JSON.stringify({
				compilerOptions: {
					baseUrl: ".",
					paths: { "shared/*": ["src/shared/*"] },
				},
			}),
		});
		const dir = project("extends-child", {
			"tsconfig.json": JSON.stringify({
				extends: "../extends-base/tsconfig.base.json",
			}),
		});
		// Inherited, and pointing at the *base's* tree — a relative path in a
		// tsconfig means the file that wrote it, not the file that extends it.
		expect(applyAliases(tsconfigAliases(dir), "shared/math")).toBe(
			join(root, "extends-base/src/shared/math"),
		);
	});

	it("lets the extending config override what it extends", () => {
		project("override-base", {
			"tsconfig.base.json": JSON.stringify({
				compilerOptions: {
					baseUrl: ".",
					paths: { "shared/*": ["base-only/*"] },
				},
			}),
		});
		const dir = project("override-child", {
			"tsconfig.json": JSON.stringify({
				extends: "../override-base/tsconfig.base.json",
				compilerOptions: {
					baseUrl: "src",
					paths: { "shared/*": ["child/*"] },
				},
			}),
		});
		const aliases = tsconfigAliases(dir);
		expect(applyAliases(aliases, "shared/math")).toBe(
			join(dir, "src/child/math"),
		);
		// `paths` is inherited as a unit, so the base's pattern is gone rather
		// than merged in underneath — one entry, not two.
		expect(aliases.filter(({ find }) => find instanceof RegExp)).toHaveLength(
			1,
		);
		expect(applyAliases(aliases, "unmapped/thing")).toBeUndefined();
		// The child's `baseUrl` wins over the base's the same way.
		expect(tsconfigBaseUrl(dir)).toBe(join(dir, "src"));
	});

	it("resolves an extends chain through a directory and a bare `.json`", () => {
		project("chain-root", {
			// Named without the extension, and extended as a directory below.
			"tsconfig.json": JSON.stringify({
				compilerOptions: { baseUrl: "lib" },
			}),
		});
		const dir = project("chain-child", {
			"tsconfig.json": JSON.stringify({ extends: "../chain-root" }),
		});
		expect(tsconfigBaseUrl(dir)).toBe(join(root, "chain-root/lib"));
	});

	it("survives a cyclic extends instead of recursing forever", () => {
		const dir = project("cycle-a", {
			"tsconfig.json": JSON.stringify({
				extends: "../cycle-b/tsconfig.json",
				compilerOptions: { baseUrl: "src" },
			}),
		});
		project("cycle-b", {
			"tsconfig.json": JSON.stringify({ extends: "../cycle-a/tsconfig.json" }),
		});
		expect(tsconfigBaseUrl(dir)).toBe(join(dir, "src"));
	});

	it("reads a tsconfig with comments and trailing commas", () => {
		const dir = project("jsonc", {
			"tsconfig.json": `{
	// roblox-ts writes these by hand, comments and all.
	"compilerOptions": {
		/* the project's own source root */
		"baseUrl": "src",
		"paths": {
			// a slash-slash inside a string is data, not a comment
			"shared/*": ["shared/*"],
			"weird//*": ["odd/*"],
		},
	},
}
`,
		});
		const aliases = tsconfigAliases(dir);
		expect(applyAliases(aliases, "shared/math")).toBe(
			join(dir, "src/shared/math"),
		);
		expect(applyAliases(aliases, "weird//thing")).toBe(
			join(dir, "src/odd/thing"),
		);
	});

	it("warns, and stays silent otherwise, when a tsconfig cannot be parsed", () => {
		const dir = project("broken", {
			"tsconfig.json": '{ "compilerOptions": { "baseUrl": "src" ',
		});
		const warnings: string[] = [];
		expect(tsconfigAliases(dir, (message) => warnings.push(message))).toEqual(
			[],
		);
		// Silently dropping a project's path mapping is the failure this warning
		// exists to prevent.
		expect(warnings).toHaveLength(1);
		expect(warnings[0]).toContain("tsconfig.json");
	});

	it("warns about an extends that points at nothing", () => {
		const dir = project("missing-extends", {
			"tsconfig.json": JSON.stringify({
				extends: "./nowhere.json",
				compilerOptions: { baseUrl: "src" },
			}),
		});
		const warnings: string[] = [];
		// The file's own mapping still works — only the missing base is lost.
		expect(tsconfigBaseUrl(dir, (message) => warnings.push(message))).toBe(
			join(dir, "src"),
		);
		expect(warnings).toHaveLength(1);
		expect(warnings[0]).toContain("nowhere.json");
	});

	it("drops a pattern with two wildcards, and says so", () => {
		const dir = project("two-stars", {
			"tsconfig.json": JSON.stringify({
				compilerOptions: {
					paths: { "a/*/b/*": ["src/*"], "ok/*": ["src/ok/*"] },
				},
			}),
		});
		const warnings: string[] = [];
		const aliases = tsconfigAliases(dir, (message) => warnings.push(message));
		// Invalid in TypeScript too — the rest of the mapping is unaffected.
		expect(aliases).toHaveLength(1);
		expect(applyAliases(aliases, "ok/thing")).toBe(join(dir, "src/ok/thing"));
		expect(warnings[0]).toContain('"a/*/b/*"');
	});
});

/**
 * The same mapping, through the real Vite pipeline.
 *
 * The unit tests above say which alias entries exist; only a running server can
 * say that an import written the roblox-ts way actually resolves, that a
 * mapping which matches nothing hands the specifier back to ordinary
 * resolution, and — the reason the entries are emitted last — that a project
 * mapping `@rbxts/*` at its own node_modules still reaches loom's adapters.
 */
describe("a project with tsconfig path mapping", () => {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "loom-tsconfig-e2e-")));
	afterAll(() => rmSync(root, { recursive: true, force: true }));

	const write = (rel: string, code: string): void => {
		const file = join(root, rel);
		mkdirSync(dirname(file), { recursive: true });
		writeFileSync(file, code);
	};

	// The roblox-ts template's own shape: `baseUrl: "src"`, plus the `@rbxts/*`
	// mapping such a project routinely carries, plus a `paths` pattern whose
	// first target does not exist.
	write(
		"tsconfig.json",
		`{
	// written the way roblox-ts writes it
	"compilerOptions": {
		"baseUrl": "src",
		"paths": {
			"@rbxts/*": ["../node_modules/@rbxts/*"],
			"lib/*": ["missing/*", "lib/*"],
		},
	},
}
`,
	);
	write("src/shared/ui/button.ts", `export const label = "shared button";\n`);
	write("src/lib/math.ts", "export const answer = 42;\n");
	// The project's own `@rbxts/react`, which the mapping above points at. If a
	// tsconfig could outrank loom's aliases, this is the module that would load.
	write(
		"node_modules/@rbxts/react/index.ts",
		`export const useState = "the project's own @rbxts/react";\n`,
	);
	write(
		"src/app.ts",
		`import { label } from "shared/ui/button";
import { answer } from "lib/math";
import { UserInputService } from "@rbxts/services";

export { answer, label };
export const hasInput = typeof UserInputService.GetMouseLocation === "function";
`,
	);
	write(
		"src/missing-package.ts",
		`export { q } from "not-installed-anywhere";\n`,
	);

	const withServer = async (
		fn: (server: ViteDevServer) => Promise<void>,
	): Promise<void> => {
		const { createServer } = await import("vite");
		const server = await createServer({
			root,
			configFile: false,
			logLevel: "silent",
			server: { middlewareMode: true },
			// Transform + SSR evaluation only; a cold esbuild scan of react and the
			// reconciler would be paid for nothing here.
			optimizeDeps: { noDiscovery: true, include: [] },
			plugins: [loomPreview({ html: false })],
		});
		try {
			await fn(server);
		} finally {
			await server.close();
		}
	};

	it("resolves baseUrl and paths imports, and evaluates them", async () => {
		await withServer(async (server) => {
			const mod = await server.ssrLoadModule("/src/app.ts");
			// baseUrl: `shared/ui/button` is `src/shared/ui/button.ts`.
			expect(mod.label).toBe("shared button");
			// paths: the first target (`missing/*`) is not there, so the second is
			// used — TypeScript tries them in order, and so does loom.
			expect(mod.answer).toBe(42);
			// …and `@rbxts/services` still reaches loom's own service singletons.
			expect(mod.hasInput).toBe(true);
		});
	});

	it("still sends @rbxts/react to loom's facade, not the project's mapping", async () => {
		const aliases = (
			await resolveConfig(
				{
					root,
					configFile: false,
					logLevel: "silent",
					plugins: [loomPreview({ html: false })],
				},
				"serve",
			)
		).resolve.alias as Alias[];
		// Loom's entry matches first, so the project's `@rbxts/*` never applies.
		expect(applyAliases(aliases, "@rbxts/react")).toBe(REACT_COMPAT_PATH);
		expect(applyAliases(aliases, "@rbxts/services")).toBe(SERVICES_PATH);
		// The mapping is present all the same — below loom's entries, where it
		// answers for the `@rbxts` packages loom does not adapt.
		const mapped = aliases.findIndex(
			({ find }) => find instanceof RegExp && find.test("@rbxts/anything"),
		);
		const loom = aliases.findIndex(
			({ find }) => find instanceof RegExp && find.test("@rbxts/react"),
		);
		expect(mapped).toBeGreaterThan(loom);

		await withServer(async (server) => {
			write("src/uses-react.ts", `export { Change } from "@rbxts/react";\n`);
			// Transform, not evaluate: the facade pulls in the CJS
			// react-reconciler, which Vite's SSR runner cannot execute (in the
			// browser the dep optimizer converts it first). Resolution is the claim
			// under test, and the rewritten import is where it shows.
			const transformed = await server.transformRequest("/src/uses-react.ts");
			expect(transformed?.code).toContain("compat/react.ts");
			expect(transformed?.code).not.toContain("node_modules/@rbxts/react");
			const ids = [...server.moduleGraph.idToModuleMap.keys()];
			expect(ids).toContain(REACT_COMPAT_PATH);
			expect(
				ids.filter((id) => id.includes("node_modules/@rbxts/react")),
			).toEqual([]);
		});
	});

	it("hands an unmapped package back to ordinary resolution", async () => {
		await withServer(async (server) => {
			// `baseUrl` makes every bare specifier a candidate, so the catch-all has
			// to fall through — otherwise this would fail as a missing file inside
			// `src/`, naming a path the project never wrote.
			const error = await server
				.transformRequest("/src/missing-package.ts")
				.then(() => undefined)
				.catch((failure: Error) => failure);
			expect(error?.message).toContain("not-installed-anywhere");
			expect(error?.message).not.toContain("src/not-installed-anywhere");
		});
	});

	it("bundles a gallery target that imports through baseUrl", async () => {
		// The default configuration: the html plugin on, targets discovered, the
		// page generated. `baseUrl` makes every bare specifier a candidate, so
		// this is where a catch-all that answered for the generated entry — or for
		// `index.html` itself — would take the build down.
		write(
			"src/targets/Scene.loom.tsx",
			`import { label } from "shared/ui/button";

export const preview = {
	title: "baseUrl scene",
	render: () => <textlabel Text={label} Size={UDim2.fromOffset(120, 40)} />,
} as const;
`,
		);
		const { build } = await import("vite");
		await build({
			root,
			configFile: false,
			logLevel: "silent",
			plugins: [loomPreview({ targets: "src/targets" })],
			build: { outDir: "dist-gallery", emptyOutDir: true, minify: false },
		});
		const assets = join(root, "dist-gallery/assets");
		const all = readdirSync(assets)
			.filter((name) => name.endsWith(".js"))
			.map((name) => readFileSync(join(assets, name), "utf8"))
			.join("\n");
		expect(all).toContain("shared button");
		expect(all).not.toMatch(/from\s*["']shared\/ui\/button["']/);
	});

	it("bundles the same tree with vite build", async () => {
		const { build } = await import("vite");
		await build({
			root,
			configFile: false,
			logLevel: "silent",
			plugins: [loomPreview({ html: false })],
			build: {
				outDir: "dist-tsconfig",
				emptyOutDir: true,
				minify: false,
				rollupOptions: {
					input: join(root, "src/app.ts"),
					preserveEntrySignatures: "strict",
					output: { entryFileNames: "bundle.js" },
				},
			},
		});
		const code = readFileSync(join(root, "dist-tsconfig/bundle.js"), "utf8");
		// Nothing left as an unresolved bare import: the mapping applies under
		// Rollup exactly as it does under the dev server.
		expect(code).not.toMatch(/from\s*["'](shared\/ui\/button|lib\/math)["']/);
		expect(code).toContain("shared button");
		expect(code).toContain("42");
	});
});

/**
 * The regression that took the gallery demo down. `"baseUrl": "."` is three
 * words a tsconfig writes without a thought; as a `resolve.alias` it became a
 * catch-all that claimed every bare specifier on the page — Vite's own
 * `@vite/env` included. `GET /@vite/client` answered 500 with
 * `Failed to resolve import "@vite/env"`, nothing mounted, `document.body` was
 * empty, and the project had done nothing wrong.
 *
 * `baseUrl` is a *fallback* in TypeScript: node resolution runs first and it
 * fills in only for what was not found. So the claims here are that a real
 * installed package still beats it, that what only it can find still resolves,
 * and that the ids Vite answers for itself were never its business.
 */
describe("a project whose tsconfig sets baseUrl at its root", () => {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "loom-baseurl-")));
	afterAll(() => rmSync(root, { recursive: true, force: true }));

	const write = (rel: string, code: string): void => {
		const file = join(root, rel);
		mkdirSync(dirname(file), { recursive: true });
		writeFileSync(file, code);
	};

	write("tsconfig.json", JSON.stringify({ compilerOptions: { baseUrl: "." } }));
	// A real installed package…
	write(
		"node_modules/real-package/package.json",
		JSON.stringify({
			name: "real-package",
			version: "1.0.0",
			type: "module",
			main: "index.js",
		}),
	);
	write(
		"node_modules/real-package/index.js",
		`export const from = "node_modules";\n`,
	);
	// …and a directory of the same name sitting under `baseUrl`. This is what
	// would load if the lookup pre-empted resolution the way an alias does.
	write("real-package/index.ts", `export const from = "baseUrl";\n`);
	// And something only `baseUrl` can find, so a "fix" that deleted the feature
	// outright fails here rather than passing quietly.
	write("only-under-base/index.ts", `export const only = "baseUrl";\n`);
	write(
		"src/app.ts",
		`export { from } from "real-package";
export { only } from "only-under-base";
`,
	);

	const withServer = async (
		fn: (server: ViteDevServer) => Promise<void>,
	): Promise<void> => {
		const { createServer } = await import("vite");
		const server = await createServer({
			root,
			configFile: false,
			logLevel: "silent",
			server: { middlewareMode: true },
			optimizeDeps: { noDiscovery: true, include: [] },
			plugins: [loomPreview({ html: false })],
		});
		try {
			await fn(server);
		} finally {
			await server.close();
		}
	};

	it("serves Vite's own client, whose first import is @vite/env", async () => {
		await withServer(async (server) => {
			// The exact request that 500'd. A throw here is the bug, and its
			// message names the import that could not be resolved.
			const client = await server.transformRequest("/@vite/client");
			expect(client?.code).toContain("import");
		});
	});

	it("keeps Vite's own alias entries reachable, not shadowed", async () => {
		const aliases = (
			await resolveConfig(
				{
					root,
					configFile: false,
					logLevel: "silent",
					plugins: [loomPreview({ html: false })],
				},
				"serve",
			)
		).resolve.alias as Alias[];
		// Vite's alias plugin takes the first `find` that matches and never
		// reconsiders: an entry above these that matched and then declined the id
		// would not fall through, it would bury them.
		expect(applyAliases(aliases, "@vite/env")).toContain(
			"vite/dist/client/env.mjs",
		);
		expect(applyAliases(aliases, "@vite/client")).toContain(
			"vite/dist/client/client.mjs",
		);
	});

	it("lets node_modules win, and still finds what only baseUrl can", async () => {
		await withServer(async (server) => {
			const app = await server.transformRequest("/src/app.ts");
			// The installed package, not the same-named directory under `baseUrl`
			// — the rewritten specifier is where the winner shows.
			expect(app?.code).toContain("/node_modules/real-package/index.js");
			expect(app?.code).not.toContain('"/real-package/index.ts"');
			// …and the fallback still does its job for what nothing else can find.
			expect(app?.code).toContain("/only-under-base/index.ts");
			const ids = [...server.moduleGraph.idToModuleMap.keys()];
			expect(ids).not.toContain(join(root, "real-package/index.ts"));
			expect(ids).toContain(join(root, "only-under-base/index.ts"));
		});
	});

	it("emits no alias entry for baseUrl at all", () => {
		expect(tsconfigAliases(root)).toEqual([]);
		expect(tsconfigBaseUrl(root)).toBe(root);
	});
});

/**
 * The zero-config regression: a project with no tsconfig at all must produce
 * precisely the alias list it did before path mapping existed. The plugin's
 * whole promise is that it works dropped in with no setup, and the `loom` CLI
 * runs it with `configFile: false` against whatever directory it was pointed at.
 */
describe("a project with no tsconfig", () => {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "loom-no-tsconfig-")));
	afterAll(() => rmSync(root, { recursive: true, force: true }));

	it("adds no alias entries and still resolves loom's own", async () => {
		const config = await resolveConfig(
			{
				root,
				configFile: false,
				logLevel: "silent",
				plugins: [loomPreview({ html: false })],
			},
			"serve",
		);
		const aliases = config.resolve.alias as Alias[];
		// Every entry loom emits is a plain find/replacement pair; the tsconfig
		// ones are the only entries that carry a custom resolver.
		expect(aliases.filter(({ customResolver }) => customResolver)).toEqual([]);
		expect(applyAliases(aliases, "@rbxts/services")).toBe(SERVICES_PATH);
		expect(applyAliases(aliases, "@rbxts/react")).toBe(REACT_COMPAT_PATH);
		// A bare package is left entirely alone — no catch-all without a baseUrl.
		expect(applyAliases(aliases, "some-package/deep")).toBeUndefined();
	});
});

/**
 * The Roblox `Promise`, as a module-scope binding.
 *
 * roblox-ts apps mean evaera's Promise by the bare name, and the browser's has
 * none of its surface — so the preview injects an aliased import into each app
 * module rather than overwriting `globalThis.Promise`, which the page shares
 * with React, the Vite client and loom's own code. Every claim below is one
 * half of that bargain: app source gets Roblox semantics, and nothing else
 * changes at all.
 */
describe("the Roblox Promise in previewed app code", () => {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "loom-promise-")));
	afterAll(() => rmSync(root, { recursive: true, force: true }));

	const write = (rel: string, code: string): void => {
		const file = join(root, rel);
		mkdirSync(dirname(file), { recursive: true });
		writeFileSync(file, code);
	};

	// The app: evaera's API by the bare name, exactly as roblox-ts writes it.
	write(
		"src/app.ts",
		`import { UserInputService } from "@rbxts/services";

export const seen: string[] = [];
export const hasDelay = typeof Promise.delay === "function";
export const hasInput = typeof UserInputService.GetMouseLocation === "function";

export const waited = Promise.delay(0.02).andThen((elapsed) => {
	seen.push(elapsed > 0 ? "waited" : "instant");
	return "roblox";
});

// The page global, read through \`globalThis\` so the injected binding cannot
// answer for it: the whole point is that these are two different things.
export const shadowsGlobal = (Promise as unknown) !== globalThis.Promise;
export const pageGlobal = globalThis.Promise;
`,
	);
	// A module that brings its own `Promise`. Injecting here is not a no-op, it
	// is `Identifier 'Promise' has already been declared` and the module is gone.
	write(
		"src/own-promise.ts",
		`class Promise {
	static readonly mine = true;
	readonly kind = "the module's own";
}

export const kind = new Promise().kind;
export const isOwn = Promise.mine === true;
export const hasDelay = "delay" in Promise;
`,
	);
	// A module that never says the word: nothing to inject, nothing to import.
	write(
		"src/quiet.ts",
		`export const answer = 42;
export const doubled = answer * 2;
`,
	);
	// An ordinary npm dependency, which means the *browser's* Promise the way
	// every npm package does.
	write(
		"node_modules/js-dep/package.json",
		JSON.stringify({
			name: "js-dep",
			version: "1.0.0",
			type: "module",
			main: "index.ts",
		}),
	);
	write(
		"node_modules/js-dep/index.ts",
		`export const settled = Promise.allSettled([Promise.resolve(7)]);
export const hasDelay = "delay" in Promise;
`,
	);
	write("src/uses-dep.ts", `export { settled, hasDelay } from "js-dep";\n`);

	const withServer = async (
		fn: (server: ViteDevServer) => Promise<void>,
	): Promise<void> => {
		const { createServer } = await import("vite");
		const server = await createServer({
			root,
			configFile: false,
			logLevel: "silent",
			server: { middlewareMode: true },
			optimizeDeps: { noDiscovery: true, include: [] },
			// The dependency is TypeScript in `node_modules`; node cannot import it
			// directly, and externalising it would take it out of the pipeline this
			// test is about.
			ssr: { noExternal: ["js-dep"] },
			plugins: [loomPreview({ html: false })],
		});
		try {
			await fn(server);
		} finally {
			await server.close();
		}
	};

	it("hands app code evaera's Promise, and runs it (dev)", async () => {
		await withServer(async (server) => {
			const mod = await server.ssrLoadModule("/src/app.ts");
			// `delay` does not exist on the browser's Promise at all.
			expect(mod.hasDelay).toBe(true);
			// `andThen` is the method whose absence kills a roblox-ts app on load.
			expect(await mod.waited).toBe("roblox");
			expect(mod.seen).toEqual(["waited"]);
			// The rest of the preview is untouched by the injection.
			expect(mod.hasInput).toBe(true);
		});
	});

	it("shadows the page global without replacing it", async () => {
		await withServer(async (server) => {
			const mod = await server.ssrLoadModule("/src/app.ts");
			expect(mod.shadowsGlobal).toBe(true);
			// Same realm, so this is the very `Promise` this test file sees — and
			// it still resolves `allSettled` to JS records rather than to the
			// `Promise.Status` values Roblox yields. Installing evaera's Promise
			// as the global is what this replaces, and this is what it cost.
			expect(mod.pageGlobal).toBe(Promise);
			await expect(
				(mod.pageGlobal as PromiseConstructor).allSettled([Promise.resolve(7)]),
			).resolves.toEqual([{ status: "fulfilled", value: 7 }]);
		});
	});

	it("leaves a module that declares its own Promise alone", async () => {
		await withServer(async (server) => {
			// A duplicate binding is a SyntaxError, so the module simply would not
			// evaluate — the assertions below never get to run if this regresses.
			const mod = await server.ssrLoadModule("/src/own-promise.ts");
			expect(mod.kind).toBe("the module's own");
			expect(mod.isOwn).toBe(true);
			expect(mod.hasDelay).toBe(false);
			const id = join(root, "src/own-promise.ts");
			expect(
				server.moduleGraph.getModuleById(id)?.ssrTransformResult?.code,
			).not.toContain("RobloxPromise");
		});
	});

	it("skips a module that never mentions Promise", async () => {
		await withServer(async (server) => {
			const mod = await server.ssrLoadModule("/src/quiet.ts");
			expect(mod.doubled).toBe(84);
			// No rewrite, and no module-graph edge to the runtime either: the cheap
			// `includes("Promise")` guard is what keeps this off the whole tree.
			const code = server.moduleGraph.getModuleById(join(root, "src/quiet.ts"))
				?.ssrTransformResult?.code;
			expect(code).toBeTypeOf("string");
			expect(code).not.toContain("RobloxPromise");
			expect(code).not.toContain("runtime");
		});
	});

	it("never injects into node_modules or into loom's own sources", async () => {
		await withServer(async (server) => {
			const mod = await server.ssrLoadModule("/src/uses-dep.ts");
			// The dependency kept the browser's Promise: JS-shaped records, no
			// `delay`. An injection here would have changed both.
			expect(mod.hasDelay).toBe(false);
			await expect(mod.settled).resolves.toEqual([
				{ status: "fulfilled", value: 7 },
			]);
			expect(
				server.moduleGraph.getModuleById(
					join(root, "node_modules/js-dep/index.ts"),
				)?.ssrTransformResult?.code,
			).not.toContain("RobloxPromise");

			// And loom's own. In this workspace checkout `services.ts` is a real
			// path *outside* node_modules, so the node_modules test alone waves it
			// through — injecting there would be circular, since the very module
			// the import points at lives in the same tree.
			await server.ssrLoadModule("/src/app.ts");
			const services =
				server.moduleGraph.getModuleById(SERVICES_PATH)?.ssrTransformResult
					?.code;
			expect(services).toBeTypeOf("string");
			expect(services).not.toContain("RobloxPromise");
			// …while the app module next to it, through the very same server, did
			// get the binding. Scoping is the claim; a transform that had simply
			// stopped running would satisfy every "not" above on its own.
			expect(
				server.moduleGraph.getModuleById(join(root, "src/app.ts"))
					?.ssrTransformResult?.code,
			).toContain("RobloxPromise");
		});
	});

	it("survives a static vite build", async () => {
		const { build } = await import("vite");
		await build({
			root,
			configFile: false,
			logLevel: "silent",
			plugins: [loomPreview({ html: false })],
			build: {
				outDir: "dist-promise",
				emptyOutDir: true,
				minify: false,
				rollupOptions: {
					input: join(root, "src/app.ts"),
					preserveEntrySignatures: "strict",
					output: { entryFileNames: "bundle.js" },
				},
			},
		});
		const file = join(root, "dist-promise/bundle.js");
		// Nothing left dangling: Rollup resolved the injected specifier the same
		// way the dev server did.
		expect(readFileSync(file, "utf8")).not.toMatch(
			/from\s*["']@loom-dev\/runtime["']/,
		);
		const mod = (await import(pathToFileURL(file).href)) as Record<
			string,
			unknown
		>;
		expect(mod.hasDelay).toBe(true);
		expect(await mod.waited).toBe("roblox");
		expect(mod.seen).toEqual(["waited"]);
		expect(mod.shadowsGlobal).toBe(true);
	});
});
