// @vitest-environment node
/**
 * The reported failure, reproduced against real builds.
 *
 * `"ReactComponent" is not exported by …/react-shim.js` was a **Rollup export
 * analysis** error: the dev server never checks that a named import exists (the
 * browser does that, at run time), so a unit test that imports the module
 * directly cannot see this class of bug at all. These tests run the actual
 * pipeline — Vite's dev transform, then a real `vite build` — over a fixture
 * that imports the broad `@rbxts/react` surface the way an external roblox-ts
 * project does, and then *executes the built bundle*.
 *
 * The fixture is deliberately written the way roblox-ts writes: a `tsconfig`
 * with `experimentalDecorators`, `@ReactComponent` on a class extending
 * `Component`, `Event` / `Change` handler tables, `Tag`, bindings. The other
 * decorator dialect (TC39 standard decorators, which esbuild emits without
 * `experimentalDecorators`) is covered by `./react.test.ts`, whose fixtures
 * compile under this repo's own tsconfig.
 */
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Rollup } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { REACT_COMPAT_PATH } from "../paths.ts";
import { loomPreview } from "../vite.ts";

const PACKAGE_ROOT = resolve(
	fileURLToPath(new URL(".", import.meta.url)),
	"..",
	"..",
);
/** `@loom-dev/react` by path: a temp project outside the workspace can't see it. */
const ADAPTER_SRC = resolve(PACKAGE_ROOT, "../react/src/index.ts");

const root = realpathSync(mkdtempSync(join(tmpdir(), "loom-react-build-")));
afterAll(() => rmSync(root, { recursive: true, force: true }));

/**
 * A DOM, installed by hand rather than by `@vitest-environment happy-dom`.
 *
 * This file runs in the node environment because it imports `../paths.ts`,
 * whose `import.meta.url` is only a `file:` URL outside vitest's web transform.
 * The built bundle still needs somewhere to render, so the globals it reaches
 * for are borrowed from a happy-dom window — and *only* around the build
 * assertions, never before the dev-server test: a defined `window` changes how
 * Vite decides what it is running in, and `createServer` never settles.
 */
async function installDom(): Promise<void> {
	const { Window } = await import("happy-dom");
	const win = new Window({ url: "http://localhost/" });
	const globals = globalThis as unknown as Record<string, unknown>;
	for (const key of Object.getOwnPropertyNames(win)) {
		if (key in globals) continue;
		globals[key] = (win as unknown as Record<string, unknown>)[key];
	}
	globals.window = win;
	globals.document = win.document;
}

function write(rel: string, code: string): void {
	const file = join(root, rel);
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(file, code);
}

// roblox-ts's own compiler options, as far as they matter to esbuild.
write(
	"tsconfig.json",
	JSON.stringify({
		compilerOptions: {
			target: "ESNext",
			module: "ESNext",
			jsx: "react-jsx",
			experimentalDecorators: true,
			useDefineForClassFields: false,
		},
	}),
);

// The exact import list from the report, widened to everything a roblox-ts
// project may reasonably pull from the package root. If any one of these names
// is missing from the compatibility module, `vite build` fails here.
write(
	"src/surface.ts",
	`import React, {
	Change,
	Children,
	Component,
	Event,
	Fragment,
	None,
	Profiler,
	PureComponent,
	ReactComponent,
	ReactPureComponent,
	StrictMode,
	Suspense,
	Tag,
	cloneElement,
	createBinding,
	createContext,
	createElement,
	createRef,
	forwardRef,
	isValidElement,
	joinBindings,
	lazy,
	memo,
	useBinding,
	useCallback,
	useContext,
	useDebugValue,
	useEffect,
	useImperativeHandle,
	useLayoutEffect,
	useMemo,
	useReducer,
	useRef,
	useState,
} from "@rbxts/react";
import ReactRoblox, { createPortal, createRoot } from "@rbxts/react-roblox";
import * as ReactNamespace from "react";

/**
 * The namespace form, which is how roblox-ts code actually mounts
 * (\`ReactRoblox.createRoot(...)\`) — upstream's typings are \`export =\`.
 */
export const roblox = {
	namespace: ReactRoblox,
	defaultMatchesNamed:
		ReactRoblox.createRoot === createRoot &&
		ReactRoblox.createPortal === createPortal,
};

/** Every named import, proven present at run time rather than merely imported. */
export const named = {
	Change, Children, Component, Event, Fragment, None, Profiler, PureComponent,
	ReactComponent, ReactPureComponent, StrictMode, Suspense, Tag, cloneElement,
	createBinding, createContext, createElement, createRef, forwardRef,
	isValidElement, joinBindings, lazy, memo, useBinding, useCallback,
	useContext, useDebugValue, useEffect, useImperativeHandle, useLayoutEffect,
	useMemo, useReducer, useRef, useState,
};

/** The identity contract, asserted from inside the bundle. */
export const identity = {
	defaultMatchesNamed:
		React.Component === Component &&
		React.createElement === createElement &&
		React.useState === useState &&
		React.Event === Event &&
		React.Tag === Tag,
	namedMatchesBrowserReact:
		Component === ReactNamespace.Component &&
		useState === ReactNamespace.useState,
};
`,
);

// The gallery-shaped scene: class components, decorators, state, refs, context,
// memo, forwardRef, fragments, an error boundary, bindings, Event/Change/Tag.
write(
	"src/scene.tsx",
	`import React, {
	Component,
	Fragment,
	PureComponent,
	ReactComponent,
	ReactPureComponent,
	createBinding,
	createContext,
	createRef,
	forwardRef,
	memo,
	useContext,
} from "@rbxts/react";
import { mountSync } from "@loom-dev/react";

interface CounterState {
	count: number;
}

@ReactComponent
class Counter extends Component<{}, CounterState> {
	state: CounterState = { count: 0 };

	render() {
		return (
			<textbutton
				Name="Counter"
				Text={\`Count: \${this.state.count}\`}
				Tag="counter"
				Event={{
					Activated: () =>
						this.setState((state) => ({ count: state.count + 1 })),
				}}
				Change={{ Visible: () => {} }}
			/>
		);
	}
}

@ReactPureComponent
class PureLabel extends PureComponent<{ text: string }> {
	render() {
		return <textlabel Name="PureLabel" Text={this.props.text} />;
	}
}

class Boundary extends Component<{ children?: unknown }, { failed: boolean }> {
	state = { failed: false };
	static getDerivedStateFromError() {
		return { failed: true };
	}
	render() {
		return this.state.failed ? (
			<textlabel Name="Fallback" Text="caught" />
		) : (
			<Fragment>{this.props.children as never}</Fragment>
		);
	}
}

function Boom(): never {
	throw new Error("boom");
}

const Theme = createContext("dark");
const Boxed = forwardRef<unknown, { name: string }>((props, ref) => (
	<frame Name={props.name} ref={ref as never} />
));
const Themed = memo(function Themed() {
	return <textlabel Name="Themed" Text={useContext(Theme)} />;
});

const [label] = createBinding("bound");
export const frameRef = createRef<unknown>();
export const counterRef = createRef<Counter>();

function Scene() {
	return (
		<Theme.Provider value="light">
			<screengui Name="Scene">
				<Counter ref={counterRef} />
				<PureLabel text="Working" />
				<Boxed name="Boxed" ref={frameRef} />
				<Themed />
				<textlabel Name="Bound" Text={label} />
				<Boundary>
					<Boom />
				</Boundary>
			</screengui>
		</Theme.Provider>
	);
}

/** Stub layout: the wasm engine is irrelevant to what this fixture proves. */
const stubLayout = (root: any) => {
	const rects: Record<string, unknown> = {};
	const walk = (node: any) => {
		rects[node.id ?? "?"] = { rect: { x: 0, y: 0, width: 100, height: 50 } };
		for (const child of node.children ?? []) walk(child);
	};
	walk(root);
	return { rects };
};

export function mountScene(mount: HTMLElement) {
	return mountSync(<Scene />, mount, { computeLayout: stubLayout as never });
}
`,
);

const OUT = join(root, "dist");

/**
 * A fresh config per Vite invocation — plugin instances carry per-run state
 * (the resolver's Luau verdict memo) and Vite does not support handing the same
 * instance to a dev server and to a build.
 */
function viteConfig() {
	return {
		root,
		configFile: false as const,
		logLevel: "silent" as const,
		plugins: [loomPreview({ html: false })],
		// The adapter is normally reachable from the previewed project; a temp dir
		// in /tmp is not part of any workspace, so it is pointed at by path.
		// Everything the adapter itself imports resolves from *its* directory, as
		// Vite always resolves bare ids relative to the importer.
		resolve: {
			alias: [{ find: /^@loom-dev\/react$/, replacement: ADAPTER_SRC }],
		},
	};
}

let built: Rollup.RollupOutput | undefined;

async function buildOnce(): Promise<Rollup.RollupOutput> {
	if (built) return built;
	const { build } = await import("vite");
	const result = (await build({
		...viteConfig(),
		build: {
			outDir: OUT,
			emptyOutDir: true,
			target: "esnext",
			minify: false,
			rollupOptions: {
				input: {
					surface: join(root, "src/surface.ts"),
					scene: join(root, "src/scene.tsx"),
				},
				// Vite's app builds drop entry exports (`preserveEntrySignatures:
				// false`); these entries are imported *by the test*, so they have to
				// keep them.
				preserveEntrySignatures: "strict",
				output: { format: "es", entryFileNames: "[name].js" },
			},
		},
	})) as Rollup.RollupOutput;
	built = result;
	return result;
}

const chunks = (result: Rollup.RollupOutput): Rollup.OutputChunk[] =>
	result.output.filter(
		(o: Rollup.RollupOutput["output"][number]): o is Rollup.OutputChunk =>
			o.type === "chunk",
	);

describe("Vite development", () => {
	it("transforms the broad @rbxts/react surface and the class scene", async () => {
		const { createServer } = await import("vite");
		const server = await createServer({
			...viteConfig(),
			server: { middlewareMode: true },
		});
		try {
			const surface = await server.transformRequest("/src/surface.ts");
			const scene = await server.transformRequest("/src/scene.tsx");
			expect(surface?.code).toBeTruthy();
			expect(scene?.code).toBeTruthy();
			// The specifier is gone: it resolved to the compatibility facade, not
			// to the package's Luau `main`.
			expect(surface?.code).not.toContain('"@rbxts/react"');
			const ids = [...server.moduleGraph.idToModuleMap.keys()];
			expect(ids).toContain(REACT_COMPAT_PATH);
			expect(ids).not.toContain("@rbxts/react");
			// The decorator survived the TS transform as a real call.
			expect(scene?.code).toContain("ReactComponent");
		} finally {
			// `close()` awaits the dependency optimizer, which does not settle in a
			// vitest worker once the fixture has pulled the adapter's CJS
			// `react-reconciler` into the scan. Every assertion is already made, so
			// the shutdown is capped rather than allowed to hang the suite.
			await Promise.race([
				server.close(),
				new Promise((resolve) => setTimeout(resolve, 2_000)),
			]);
		}
	});
});

describe("the production build", () => {
	beforeAll(installDom);

	it("resolves every named import (this is the reported failure)", async () => {
		// A missing export is a hard Rollup error, so reaching this line at all is
		// most of the assertion.
		const result = await buildOnce();
		expect(chunks(result).length).toBeGreaterThan(0);
	});

	it("leaves no unresolved @rbxts import in the emitted chunks", async () => {
		const result = await buildOnce();
		for (const chunk of chunks(result)) {
			expect(chunk.code, chunk.fileName).not.toMatch(/from\s*["']@rbxts\//);
			expect(chunk.imports.filter((id) => id.startsWith("@rbxts/"))).toEqual(
				[],
			);
		}
	});

	it("bundles exactly one React implementation", async () => {
		const result = await buildOnce();
		const MARKER = "/node_modules/react/";
		const reactRoots = new Set<string>();
		for (const chunk of chunks(result)) {
			for (const id of Object.keys(chunk.modules)) {
				const at = id.lastIndexOf(MARKER);
				if (at < 0) continue;
				const path = id.slice(0, at + MARKER.length);
				// Rollup's CJS interop ids carry a prefix (`\0commonjs-proxy:…`);
				// the package root starts at the first separator.
				reactRoots.add(path.slice(path.indexOf("/")));
			}
		}
		// One react package directory across every chunk: two would mean two
		// dispatchers, and hooks would throw the moment a component rendered.
		expect([...reactRoots]).toHaveLength(1);
	});

	it("keeps the facade's identity contract after bundling", async () => {
		await buildOnce();
		const mod = (await import(pathToFileURL(join(OUT, "surface.js")).href)) as {
			named: Record<string, unknown>;
			identity: {
				defaultMatchesNamed: boolean;
				namedMatchesBrowserReact: boolean;
			};
			roblox: {
				namespace: Record<string, unknown> | undefined;
				defaultMatchesNamed: boolean;
			};
		};
		// Every named import survived CJS interop with a real value.
		const undefinedNames = Object.entries(mod.named)
			.filter(([, value]) => value === undefined)
			.map(([name]) => name);
		expect(undefinedNames).toEqual([]);
		expect(mod.identity.defaultMatchesNamed).toBe(true);
		expect(mod.identity.namedMatchesBrowserReact).toBe(true);
		// `import ReactRoblox from "@rbxts/react-roblox"` — a named-exports-only
		// stand-in leaves this undefined (and, under the dev server's pre-bundled
		// dep, fails the module at load: "does not provide an export named
		// 'default'").
		expect(mod.roblox.namespace).toBeTypeOf("object");
		expect(mod.roblox.defaultMatchesNamed).toBe(true);
	});

	it("mounts the built class-component scene", async () => {
		await buildOnce();
		const mod = (await import(pathToFileURL(join(OUT, "scene.js")).href)) as {
			mountScene(mount: HTMLElement): { unmount(): void };
			counterRef: { current: { constructor: unknown } | null };
			frameRef: { current: unknown };
		};
		const mount = document.createElement("div");
		Object.defineProperty(mount, "clientWidth", { value: 800 });
		Object.defineProperty(mount, "clientHeight", { value: 600 });
		document.body.appendChild(mount);

		const world = mod.mountScene(mount);
		try {
			const text = (name: string) =>
				mount.querySelector(`[data-loom-name="${name}"]`)?.textContent;
			expect(text("Counter")).toBe("Count: 0");
			expect(text("PureLabel")).toBe("Working");
			expect(text("Themed")).toBe("light");
			expect(text("Bound")).toBe("bound");
			// The error boundary contained the throwing child.
			expect(text("Fallback")).toBe("caught");
			expect(mount.querySelector('[data-loom-name="Boxed"]')).not.toBeNull();
			expect(mod.frameRef.current).not.toBeNull();
			expect(mod.counterRef.current).not.toBeNull();
		} finally {
			world.unmount();
			mount.remove();
		}
	});

	it("preserves constructor identity through the decorators, post-bundle", async () => {
		await buildOnce();
		const code = readFileSync(join(OUT, "scene.js"), "utf8");
		// The decorator is applied (esbuild's legacy-decorator helper), and the
		// facade's implementation is the identity function it was written as.
		expect(code).toMatch(/ReactComponent/);
		const mod = (await import(pathToFileURL(join(OUT, "surface.js")).href)) as {
			named: {
				ReactComponent: <T>(c: T) => T;
				ReactPureComponent: <T>(c: T) => T;
			};
		};
		class Probe {}
		expect(mod.named.ReactComponent(Probe)).toBe(Probe);
		expect(mod.named.ReactPureComponent(Probe)).toBe(Probe);
	});
});

describe("unsupported entrypoints", () => {
	it("fails the build with loom's own diagnostic, not Rollup's", async () => {
		write("src/bad-subpath.ts", 'export * from "@rbxts/react/internal";\n');
		const { build } = await import("vite");
		await expect(
			build({
				...viteConfig(),
				build: {
					write: false,
					rollupOptions: { input: join(root, "src/bad-subpath.ts") },
				},
			}),
		).rejects.toThrow(
			/is not supported by\nLoom's browser compatibility layer/,
		);
	});

	it("says the same thing for an unadapted react-roblox subpath", async () => {
		write("src/bad-roblox.ts", 'export * from "@rbxts/react-roblox/client";\n');
		const { build } = await import("vite");
		await expect(
			build({
				...viteConfig(),
				build: {
					write: false,
					rollupOptions: { input: join(root, "src/bad-roblox.ts") },
				},
			}),
		).rejects.toThrow(/@rbxts\/react-roblox/);
	});
});
