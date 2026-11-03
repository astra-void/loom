import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const client = vi.hoisted(() => ({
	render: vi.fn(),
	unmount: vi.fn(),
	setPreviewTheme: vi.fn(),
}));

vi.mock("../client.ts", () => ({
	createRoot: () => ({
		render: client.render,
		unmount: client.unmount,
	}),
	setPreviewTheme: client.setPreviewTheme,
}));

import { startGallery } from "./gallery-shell.ts";

const TARGET = "src/Scenes/Button.loom.tsx";

describe("gallery target diagnostics", () => {
	beforeEach(() => {
		client.render.mockClear();
		client.unmount.mockClear();
		client.setPreviewTheme.mockClear();
		document.body.innerHTML = `
			<aside id="loom-gallery-sidebar"></aside>
			<main id="loom-gallery-stage"><div id="loom-root"></div></main>
		`;
		window.history.replaceState(
			{},
			"",
			`/loom-preview/?chrome=none&target=${encodeURIComponent(TARGET)}`,
		);
	});

	it("shows the target path and preview contract for a default-only module", async () => {
		startGallery({
			[TARGET]: async () => ({ default: () => React.createElement("frame") }),
		});

		const panel = document.querySelector(".loom-gallery-error");
		await vi.waitFor(() => {
			expect(panel?.textContent).toContain(
				`invalid preview export in ${TARGET}`,
			);
		});
		expect(panel?.textContent).toContain(
			'target must export `const preview = { render: () => <.../>, title: "..." } as const`',
		);
		expect(client.render).not.toHaveBeenCalled();
	});

	it("keeps the sidebar out of chromeless mode entirely", () => {
		startGallery({
			[TARGET]: async () => ({
				preview: { render: () => React.createElement("frame") } as const,
			}),
		});
		expect(document.getElementById("loom-gallery-sidebar")?.hidden).toBe(true);
		expect(document.querySelector(".loom-gallery-toggle")).toBeNull();
	});

	it("mounts a valid preview export without showing an error", async () => {
		const render = () => React.createElement("frame");
		startGallery({
			[TARGET]: async () => ({
				preview: { render, title: "Button" } as const,
			}),
		});

		await vi.waitFor(() => expect(client.render).toHaveBeenCalledOnce());
		const boundary = client.render.mock.calls[0]?.[0] as React.ReactElement<{
			children: React.ReactElement;
		}>;
		expect(boundary.props.children.type).toBe(render);
		expect(
			document.querySelector(".loom-gallery-error")?.hasAttribute("hidden"),
		).toBe(true);
	});

	// React 18's dev build reports a throw to `window` from inside its guarded
	// callback before an error boundary catches it, so a target that catches its
	// own throw must not paint the uncaught-error panel.
	it("ignores a window error React is about to hand to a boundary", async () => {
		startGallery({
			[TARGET]: async () => ({
				preview: { render: () => React.createElement("frame") } as const,
			}),
		});
		await vi.waitFor(() => expect(client.render).toHaveBeenCalledOnce());
		const panel = document.querySelector(".loom-gallery-error");

		const report = () =>
			window.dispatchEvent(
				new ErrorEvent("error", { error: new Error("thrown on purpose") }),
			);
		function invokeGuardedCallbackDev(): void {
			report();
		}
		invokeGuardedCallbackDev();
		expect(panel?.hasAttribute("hidden")).toBe(true);

		report();
		expect(panel?.hasAttribute("hidden")).toBe(false);
		expect(panel?.textContent).toContain(
			`uncaught error while showing ${TARGET}`,
		);
	});
});

/**
 * The stage backdrop: `?theme=` picks one of loom's two palettes (a class on
 * `<html>`, coloured by the stylesheet), `?background=` overrides just the
 * colour with an inline style that outranks it.
 */
describe("gallery stage backdrop", () => {
	const boot = (search: string): void => {
		document.documentElement.className = "";
		document.body.className = "";
		document.documentElement.removeAttribute("style");
		document.body.innerHTML = `
			<aside id="loom-gallery-sidebar"></aside>
			<main id="loom-gallery-stage"><div id="loom-root"></div></main>
		`;
		window.history.replaceState({}, "", `/loom-preview/${search}`);
		startGallery({
			[TARGET]: async () => ({
				preview: { render: () => React.createElement("frame") } as const,
			}),
		});
	};

	it("leaves the themed default alone when no background is asked for", () => {
		boot("?theme=light");
		expect(
			document.documentElement.classList.contains("loom-theme-light"),
		).toBe(true);
		expect(document.documentElement.style.background).toBe("");
	});

	it("paints the stage the requested colour, over either theme", () => {
		boot("?background=white");
		expect(document.documentElement.style.background).toBe("white");
		// The theme still owns the rest of the palette.
		expect(
			document.documentElement.classList.contains("loom-theme-light"),
		).toBe(false);

		boot("?theme=light&background=%23ffffff");
		expect(document.documentElement.style.background).toBe("#ffffff");
	});

	it("accepts bare hex, which is what survives a query string", () => {
		boot("?background=f6f9fc");
		expect(document.documentElement.style.background).toBe("#f6f9fc");
	});

	it("keeps the themed default when the colour is unusable", () => {
		boot("?background=url(https://evil.test/x.png)");
		expect(document.documentElement.getAttribute("style")).toBeNull();

		// Shaped like a colour, but no such keyword: rejected by the CSSOM.
		boot("?background=nosuchcolor");
		expect(document.documentElement.style.background).toBe("");
	});

	it("re-points the backdrop from a host postMessage, and back", () => {
		boot("?background=white");

		window.dispatchEvent(
			new MessageEvent("message", {
				data: { type: "loom-background", background: "black" },
			}),
		);
		expect(document.documentElement.style.background).toBe("black");

		// A theme flip doesn't reclaim the override.
		window.dispatchEvent(
			new MessageEvent("message", {
				data: { type: "loom-theme", theme: "light" },
			}),
		);
		expect(document.documentElement.style.background).toBe("black");

		// An absent colour hands the backdrop back to the theme.
		window.dispatchEvent(
			new MessageEvent("message", { data: { type: "loom-background" } }),
		);
		expect(document.documentElement.style.background).toBe("");
	});
});

/**
 * Debug mode's three entry points, and the one place it deliberately does not
 * remember itself (a chromeless embed shares the host tab's sessionStorage).
 */
describe("gallery debug mode", () => {
	const boot = (search: string): void => {
		document.body.className = "";
		document.body.innerHTML = `
			<aside id="loom-gallery-sidebar"></aside>
			<main id="loom-gallery-stage"><div id="loom-root"></div></main>
		`;
		window.history.replaceState({}, "", `/loom-preview/${search}`);
		startGallery({
			[TARGET]: async () => ({
				preview: { render: () => React.createElement("frame") } as const,
			}),
		});
	};

	const panel = (): HTMLElement =>
		document.getElementById("loom-debug") as HTMLElement;

	beforeEach(() => {
		sessionStorage.clear();
	});

	it("stays closed until something asks for it", () => {
		boot("");
		expect(panel().hidden).toBe(true);
	});

	it("opens from ?debug=1, the header button, and Ctrl+Alt+D", () => {
		boot("?debug=1");
		expect(panel().hidden).toBe(false);

		const toggle = document.querySelector(
			".loom-gallery-debug-toggle",
		) as HTMLButtonElement;
		expect(toggle.getAttribute("aria-pressed")).toBe("true");

		toggle.click();
		expect(panel().hidden).toBe(true);
		expect(toggle.getAttribute("aria-pressed")).toBe("false");

		window.dispatchEvent(
			new KeyboardEvent("keydown", {
				code: "KeyD",
				key: "d",
				ctrlKey: true,
				altKey: true,
			}),
		);
		expect(panel().hidden).toBe(false);
	});

	it("remembers the toggle for the tab, but never for an embed", () => {
		boot("?debug=1");
		boot(""); // a reload with no param at all
		expect(panel().hidden).toBe(false);

		boot(`?chrome=none&target=${encodeURIComponent(TARGET)}`);
		expect(panel().hidden).toBe(true);
	});
});

/**
 * The narrow-screen chrome: the CSS media query stacks the sidebar over the
 * stage and hides the list unless `body.loom-gallery-open` is set — this is the
 * state side of that contract.
 */
describe("gallery chrome on a narrow screen", () => {
	beforeEach(() => {
		client.render.mockClear();
		document.body.className = "";
		document.body.innerHTML = `
			<aside id="loom-gallery-sidebar"></aside>
			<main id="loom-gallery-stage"><div id="loom-root"></div></main>
		`;
		window.history.replaceState({}, "", "/loom-preview/");
	});

	it("opens the target list from the toggle and closes it on selection", () => {
		startGallery({
			[TARGET]: async () => ({
				preview: { render: () => React.createElement("frame") } as const,
			}),
		});

		const toggle = document.querySelector(
			".loom-gallery-toggle",
		) as HTMLButtonElement;
		expect(toggle.getAttribute("aria-expanded")).toBe("false");

		toggle.click();
		expect(document.body.classList.contains("loom-gallery-open")).toBe(true);
		expect(toggle.getAttribute("aria-expanded")).toBe("true");

		// Picking a target hands the screen back to the stage.
		(document.querySelector(".loom-gallery-item") as HTMLElement).click();
		expect(document.body.classList.contains("loom-gallery-open")).toBe(false);
		expect(toggle.getAttribute("aria-expanded")).toBe("false");
		expect(location.hash).toBe(`#/${TARGET}`);
	});
});
