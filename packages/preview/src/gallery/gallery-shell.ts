/**
 * The loom gallery shell — the browser chrome around preview targets, shared by
 * the dev server (`shell.ts`) and the static build (the generated entry).
 *
 * Deliberately plain DOM (no React for the chrome itself), so a broken target
 * or a broken loom runtime can never white-screen the gallery: the sidebar and
 * error panel stay alive no matter what a target does.
 *
 * - Sidebar lists every discovered `*.loom.tsx` (label = relative path until
 *   the module's `preview.title` is known; titles are lazy-loaded on idle).
 * - Routing: `#/<relPath>` selects a target and survives full reloads; an
 *   initial `?target=<relPath>` (the static-build deep-link contract) selects
 *   one on load without a hash.
 * - `?chrome=none` hides the sidebar and renders a single target full-bleed —
 *   this is what the docs-site iframes embed.
 * - `?debug=1` (or the header's `debug` button, or Ctrl+Alt+D) opens the debug
 *   panel over the stage — see `./debug.ts`.
 * - Each target renders through the preview's own `createRoot()`, inside a
 *   React error boundary; import failures, bad `preview` exports, and render
 *   throws all land in the inline red error panel instead of taking the page.
 *
 * This module is loom-owned browser code (served via /@fs/ under the dev server,
 * bundled by Rollup under `vite build`), so it may import plain `react` directly
 * (the preview plugin dedupes it with the adapter's). The client is reached by
 * relative path: the previewed project's node_modules need not contain
 * `@loom-dev/preview` at all.
 */

import * as React from "react";
import {
	createRoot,
	type LoomReactRoot,
	type PreviewTheme,
	setPreviewTheme,
} from "../client.ts";
import { createDebugPanel } from "./debug.ts";
import { parseBackgroundColor, parseGalleryParams } from "./params.ts";
import "./shell.css";

type TargetModule = Record<string, unknown>;
type TargetMap = Record<string, () => Promise<TargetModule>>;

interface PreviewExport {
	render: () => React.ReactElement;
	title?: unknown;
}

// ---------------------------------------------------------------------------
// Error boundary (the only React used by the chrome). Renders null on failure
// and reports through a callback so the plain-DOM panel can paint the stack.
// ---------------------------------------------------------------------------

interface BoundaryProps {
	onError: (error: unknown) => void;
	children?: React.ReactNode;
}

class ErrorBoundary extends React.Component<
	BoundaryProps,
	{ failed: boolean }
> {
	override state = { failed: false };

	static getDerivedStateFromError(): { failed: boolean } {
		return { failed: true };
	}

	override componentDidCatch(error: Error): void {
		this.props.onError(error);
	}

	override render(): React.ReactNode {
		return this.state.failed ? null : (this.props.children ?? null);
	}
}

/**
 * Whether a `window` error event is React 18's development build reporting a
 * throw it is about to hand to an error boundary.
 *
 * The dev reconciler runs render and commit work through
 * `invokeGuardedCallbackDev`, a fake DOM event dispatch, so the browser reports
 * every throw to `window` before React decides who catches it. Those throws
 * never escape: a target's own boundary catches them, or the shell's
 * {@link ErrorBoundary} does and paints "render error" itself. The report
 * fires synchronously inside that dispatch, so React's frames are still on the
 * listener's stack — a few frames down, whatever depth the throw came from.
 * Production React has no guarded callback, so there is nothing to skip there.
 */
function insideReactGuardedCallback(): boolean {
	return /\binvokeGuardedCallback/.test(new Error().stack ?? "");
}

function byId(id: string): HTMLElement {
	const el = document.getElementById(id);
	if (el) return el;
	const created = document.createElement("div");
	created.id = id;
	document.body.appendChild(created);
	return created;
}

/**
 * Boot the gallery over a target import map. Reads the URL contract
 * (`?target=`, `?chrome=none`, `#/<relPath>`) from `location` itself, so both
 * the dev-server boot and the static-build entry call this the same way.
 */
export function startGallery(targets: TargetMap): void {
	const initial = parseGalleryParams(location.search);
	const chromeless = initial.chromeless;
	if (chromeless) document.body.classList.add("loom-chromeless");

	// Theme: seeded from `?theme=` (docs iframes pass the site theme) and
	// live-switchable via a `{type:"loom-theme"}` postMessage from the host
	// page. Flips the stage background and mirrors onto `PlayerGui.LoomTheme`
	// so scene shells can follow along.
	const applyTheme = (theme: PreviewTheme): void => {
		document.documentElement.classList.toggle(
			"loom-theme-light",
			theme === "light",
		);
		setPreviewTheme(theme);
	};
	applyTheme(initial.theme);

	// Backdrop: `?background=<css color>` paints the stage a specific colour
	// instead of the theme's own — a docs page whose article background isn't
	// either of loom's two can hand the embed its own. Written inline on
	// `<html>`, so it outranks the themed rule and survives a later theme flip;
	// a colour the browser won't take is dropped by the CSSOM and the theme
	// stands. `{type:"loom-background"}` re-points it live (a null/absent colour
	// restores the theme), mirroring the theme message.
	//
	// The initial pass is almost always a no-op: the generated page's boot script
	// has already painted this exact colour onto this exact element before the
	// first frame (see `./boot.ts`). It stays because a host page that embeds the
	// shell in a document of its own gets no boot script.
	const applyBackground = (color: string | undefined): void => {
		document.documentElement.style.removeProperty("background");
		if (color !== undefined) document.documentElement.style.background = color;
	};
	applyBackground(initial.background);

	window.addEventListener("message", (event: MessageEvent) => {
		const data = event.data as {
			type?: unknown;
			theme?: unknown;
			background?: unknown;
		} | null;
		if (data?.type === "loom-background") {
			applyBackground(
				typeof data.background === "string"
					? parseBackgroundColor(data.background)
					: undefined,
			);
			return;
		}
		if (data?.type !== "loom-theme") return;
		if (data.theme === "light" || data.theme === "dark") {
			applyTheme(data.theme);
		}
	});

	const sidebar = byId("loom-gallery-sidebar");
	const stage = byId("loom-gallery-stage");

	const keys = Object.keys(targets).sort();
	const items = new Map<string, HTMLLIElement>();
	const moduleCache = new Map<string, Promise<TargetModule>>();

	// -------------------------------------------------------------------------
	// Chrome DOM (skipped entirely in chromeless mode).
	// -------------------------------------------------------------------------

	// On a phone-sized screen the sidebar collapses to a top bar and the target
	// list opens on demand (the CSS media query owns the layout; this owns the
	// state). Selecting a target closes it again so the stage isn't left buried
	// under the list — harmless on a wide screen, where the list ignores the
	// class and stays open.
	const OPEN_CLASS = "loom-gallery-open";
	const setListOpen = (open: boolean, toggle?: HTMLButtonElement): void => {
		document.body.classList.toggle(OPEN_CLASS, open);
		toggle?.setAttribute("aria-expanded", String(open));
	};

	/** The sidebar's debug button, when there is a sidebar to put one in. */
	let debugButton: HTMLButtonElement | undefined;

	if (chromeless) {
		sidebar.hidden = true;
	} else {
		const header = document.createElement("div");
		header.className = "loom-gallery-header";
		const headerName = document.createElement("span");
		headerName.textContent = "loom gallery";
		const headerCount = document.createElement("span");
		headerCount.className = "loom-gallery-count";
		headerCount.textContent = String(keys.length);
		const debugToggle = document.createElement("button");
		debugToggle.type = "button";
		debugToggle.className = "loom-gallery-debug-toggle";
		debugToggle.textContent = "debug";
		debugToggle.title = "toggle the debug panel (Ctrl+Alt+D)";
		debugToggle.setAttribute("aria-pressed", "false");
		debugToggle.addEventListener("click", () => setDebugOpen(!debug.isOpen()));
		debugButton = debugToggle;
		const toggle = document.createElement("button");
		toggle.type = "button";
		toggle.className = "loom-gallery-toggle";
		toggle.textContent = "targets";
		toggle.setAttribute("aria-expanded", "false");
		toggle.addEventListener("click", () => {
			setListOpen(!document.body.classList.contains(OPEN_CLASS), toggle);
		});
		header.append(headerName, headerCount, debugToggle, toggle);

		const list = document.createElement("ul");
		list.className = "loom-gallery-list";
		for (const key of keys) {
			const item = document.createElement("li");
			item.className = "loom-gallery-item";
			item.textContent = key;
			item.title = key;
			item.addEventListener("click", () => {
				setListOpen(false, toggle);
				location.hash = `#/${key}`;
			});
			items.set(key, item);
			list.appendChild(item);
		}
		if (keys.length === 0) {
			const empty = document.createElement("li");
			empty.className = "loom-gallery-empty";
			empty.textContent = "no *.loom.tsx targets found";
			list.appendChild(empty);
		}
		sidebar.append(header, list);
	}

	const placeholder = document.createElement("div");
	placeholder.className = "loom-gallery-placeholder";
	placeholder.textContent = keys.length > 0 ? "select a target" : "no targets";
	stage.appendChild(placeholder);

	const errorPanel = document.createElement("div");
	errorPanel.className = "loom-gallery-error";
	errorPanel.hidden = true;
	stage.appendChild(errorPanel);

	function showError(title: string, error: unknown): void {
		const detail =
			error instanceof Error ? (error.stack ?? error.message) : String(error);
		errorPanel.replaceChildren();
		const heading = document.createElement("div");
		heading.className = "loom-gallery-error-title";
		heading.textContent = title;
		const stack = document.createElement("pre");
		stack.textContent = detail;
		errorPanel.append(heading, stack);
		errorPanel.hidden = false;
		debug.setError(title);
	}

	function clearError(): void {
		errorPanel.hidden = true;
		errorPanel.replaceChildren();
		debug.setError(undefined);
	}

	// -------------------------------------------------------------------------
	// Debug mode. Off unless asked for — by `?debug=1`, the sidebar button, or
	// Ctrl+Alt+D — and remembered for the tab, so the full reload the shell takes
	// on every HMR edit doesn't close it behind the author's back.
	// -------------------------------------------------------------------------

	const DEBUG_STORAGE_KEY = "loom-gallery-debug";

	/**
	 * sessionStorage, if this page has one (a sandboxed iframe throws) *and* is
	 * the gallery itself. A chromeless embed shares the host tab's storage, so
	 * remembering the toggle there would put a debug panel over every preview on
	 * a docs page as soon as the reader had opened one in the gallery. Embeds
	 * take `?debug=1` and nothing else.
	 */
	function debugMemory(): Storage | undefined {
		if (chromeless) return undefined;
		try {
			return window.sessionStorage;
		} catch {
			return undefined;
		}
	}

	const debug = createDebugPanel(stage, {
		remount: () => {
			if (activeKey !== undefined) void mount(activeKey);
		},
		onClose: () => setDebugOpen(false),
	});

	function setDebugOpen(open: boolean): void {
		debug.setOpen(open);
		debugButton?.setAttribute("aria-pressed", String(open));
		debugButton?.classList.toggle("active", open);
		try {
			debugMemory()?.setItem(DEBUG_STORAGE_KEY, open ? "1" : "0");
		} catch {
			// A storage quota or a privacy mode that refuses writes is not a reason
			// to fail the toggle — the panel just won't survive the next reload.
		}
	}

	setDebugOpen(
		initial.debug || debugMemory()?.getItem(DEBUG_STORAGE_KEY) === "1",
	);

	// Ctrl+Alt+D: free on every platform loom runs on (⌘⌥D is macOS's own dock
	// toggle, which is why the meta chord isn't the one). Scene keyboard input
	// goes through the renderer's own window listener, so this deliberately does
	// not consume the event beyond its own default.
	window.addEventListener("keydown", (event: KeyboardEvent) => {
		if (!event.ctrlKey || !event.altKey || event.metaKey) return;
		if (event.code !== "KeyD" && event.key.toLowerCase() !== "d") return;
		event.preventDefault();
		setDebugOpen(!debug.isOpen());
	});

	// -------------------------------------------------------------------------
	// Target loading + mounting
	// -------------------------------------------------------------------------

	function loadTarget(key: string): Promise<TargetModule> {
		let promise = moduleCache.get(key);
		if (!promise) {
			const loader = targets[key];
			promise = loader
				? loader()
				: Promise.reject(new Error(`unknown target: ${key}`));
			promise.catch(() => moduleCache.delete(key)); // keep failures retryable
			moduleCache.set(key, promise);
		}
		return promise;
	}

	function getPreview(mod: TargetModule): PreviewExport {
		const preview = mod.preview;
		if (
			typeof preview !== "object" ||
			preview === null ||
			typeof (preview as { render?: unknown }).render !== "function"
		) {
			throw new Error(
				'target must export `const preview = { render: () => <.../>, title: "..." } as const`',
			);
		}
		return preview as unknown as PreviewExport;
	}

	/** Upgrade a sidebar label from its relPath to the target's `preview.title`. */
	function applyTitle(key: string, preview: PreviewExport): void {
		const item = items.get(key);
		if (!item) return;
		if (typeof preview.title === "string" && preview.title.length > 0) {
			item.textContent = preview.title;
			item.title = `${preview.title} — ${key}`;
		}
	}

	let activeRoot: LoomReactRoot | undefined;
	let activeKey: string | undefined;
	let mountSeq = 0;

	function unmountActive(): void {
		try {
			activeRoot?.unmount();
		} catch (error) {
			console.warn("[loom gallery] unmount failed:", error);
		}
		activeRoot = undefined;
	}

	async function mount(key: string): Promise<void> {
		const seq = ++mountSeq;
		activeKey = key;
		placeholder.hidden = true;
		clearError();
		unmountActive();
		for (const [k, item] of items) item.classList.toggle("active", k === key);

		let mod: TargetModule;
		const importStartedAt = performance.now();
		try {
			mod = await loadTarget(key);
		} catch (error) {
			if (seq === mountSeq) showError(`failed to import ${key}`, error);
			return;
		}
		const importMs = performance.now() - importStartedAt;
		if (seq !== mountSeq) return; // superseded while awaiting

		let preview: PreviewExport;
		try {
			preview = getPreview(mod);
		} catch (error) {
			showError(`invalid preview export in ${key}`, error);
			return;
		}
		applyTitle(key, preview);
		// Before the render, not after: the debug panel times the first frame from
		// here, and the mount it is timing starts on the next line.
		debug.setTarget({
			key,
			title: typeof preview.title === "string" ? preview.title : undefined,
			importMs,
		});

		const root = createRoot();
		activeRoot = root;
		try {
			root.render(
				React.createElement(
					ErrorBoundary,
					{
						onError: (error: unknown) => {
							if (seq === mountSeq) showError(`render error in ${key}`, error);
						},
					},
					// `preview.render` is `() => ReactElement` — exactly a function
					// component, so React re-renders (and re-throws into the boundary)
					// on its own schedule.
					React.createElement(preview.render as React.FunctionComponent),
				),
			);
		} catch (error) {
			showError(`render error in ${key}`, error);
		}
	}

	// -------------------------------------------------------------------------
	// Routing. Chromeless mode is a fixed single mount from `?target=` (no hash
	// listener); full-chrome mode is `#/relPath` hash routing with an initial
	// `?target=` seed.
	// -------------------------------------------------------------------------

	function currentHashKey(): string | undefined {
		if (!location.hash.startsWith("#/")) return undefined;
		const raw = location.hash.slice(2);
		if (raw === "") return undefined;
		try {
			return decodeURIComponent(raw);
		} catch {
			return raw;
		}
	}

	function route(): void {
		const key = currentHashKey();
		if (key !== undefined && Object.hasOwn(targets, key)) {
			void mount(key);
			return;
		}
		mountSeq += 1;
		activeKey = undefined;
		unmountActive();
		clearError();
		debug.setTarget(undefined);
		placeholder.hidden = false;
		for (const item of items.values()) item.classList.remove("active");
		if (key !== undefined) {
			showError(
				`unknown target: ${key}`,
				new Error("not in the discovered target list (was the file removed?)"),
			);
		}
	}

	if (chromeless) {
		const key = initial.target;
		if (key !== undefined && Object.hasOwn(targets, key)) {
			void mount(key);
		} else if (key !== undefined) {
			showError(
				`unknown target: ${key}`,
				new Error("not in the discovered target list"),
			);
		} else {
			showError(
				"no target selected",
				new Error("chrome=none requires a ?target=<relPath> query param"),
			);
		}
	} else {
		window.addEventListener("hashchange", route);
		// An initial `?target=` with no hash seeds the selection (deep-link).
		if (
			!location.hash.startsWith("#/") &&
			initial.target !== undefined &&
			Object.hasOwn(targets, initial.target)
		) {
			location.hash = `#/${initial.target}`;
		}
		route();
	}

	// Last-resort containment: async errors that escape the boundary (e.g. thrown
	// from the render promise chain or target module side effects) still paint the
	// panel instead of dying silently in the console.
	window.addEventListener("error", (event) => {
		if (activeKey !== undefined && !insideReactGuardedCallback())
			showError(
				`uncaught error while showing ${activeKey}`,
				event.error ?? event.message,
			);
	});
	window.addEventListener("unhandledrejection", (event) => {
		if (activeKey !== undefined)
			showError(`unhandled rejection while showing ${activeKey}`, event.reason);
	});

	// -------------------------------------------------------------------------
	// Lazy title upgrade: one target module per idle slice, in the background.
	// Import failures just tint the sidebar item; the label stays the relPath.
	// Skipped in chromeless mode (no sidebar to upgrade).
	// -------------------------------------------------------------------------

	if (!chromeless) {
		const idle: (cb: () => void) => void =
			typeof requestIdleCallback === "function"
				? (cb) => requestIdleCallback(() => cb(), { timeout: 1000 })
				: (cb) => {
						setTimeout(cb, 250);
					};

		const pendingTitles = [...keys];
		const pumpTitles = (): void => {
			const key = pendingTitles.shift();
			if (key === undefined) return;
			void loadTarget(key)
				.then((mod) => applyTitle(key, getPreview(mod)))
				.catch(() => items.get(key)?.classList.add("failed"))
				.finally(() => idle(pumpTitles));
		};
		idle(pumpTitles);
	}

	// HMR: the shell holds live DOM + a mounted loom root, so a self-patch would
	// double everything — let vite fall back to a full reload (the hash keeps the
	// selection). Target edits bubble up to the same full reload.
	if (import.meta.hot) {
		import.meta.hot.on("vite:beforeFullReload", () => {
			unmountActive();
		});
	}
}
