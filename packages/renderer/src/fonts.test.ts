/**
 * The font registry: which Roblox family a name belongs to, what CSS stack it
 * paints with registered and unregistered, the `@font-face` rules a
 * registration declares, and the change notification the adapters re-measure
 * on.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	clearRegisteredFonts,
	familyKey,
	fontsPending,
	onFontsChanged,
	registerFont,
	requestFontFor,
} from "./fonts.ts";
import { fontFamily, measureText, shapedTextWidth } from "./index.ts";

afterEach(() => {
	clearRegisteredFonts();
});

/** The rules loom's own `<style>` element currently declares. */
function injectedCss(): string {
	return (
		document.querySelector<HTMLStyleElement>("style[data-loom-fonts]")
			?.textContent ?? ""
	);
}

describe("familyKey", () => {
	it("folds every spelling of a family onto one key", () => {
		// The legacy enum folds the weight in; `FontFace` carries the asset's own
		// family name. Both have to reach the same registration.
		expect(familyKey("Gotham")).toBe("Gotham");
		expect(familyKey("GothamBold")).toBe("Gotham");
		expect(familyKey("GothamSSm")).toBe("Gotham");
		expect(familyKey("SourceSans")).toBe("SourceSans");
		expect(familyKey("SourceSansPro")).toBe("SourceSans");
		expect(familyKey("SourceSansSemibold")).toBe("SourceSans");
	});

	it("does not read RobotoMono as Roboto", () => {
		// Longest prefix first, or the monospace family paints proportional.
		expect(familyKey("RobotoMono")).toBe("RobotoMono");
		expect(familyKey("Roboto")).toBe("Roboto");
	});

	it("lets no family shadow another it is a prefix of", () => {
		// The table is matched by prefix, so a shorter name sitting in front of a
		// longer one would quietly swallow it — `Roboto` taking `RobotoCondensed`
		// paints a condensed face proportional and measures every line short.
		// These are every pair in the table where one name starts with another.
		expect(familyKey("RobotoCondensed")).toBe("RobotoCondensed");
		expect(familyKey("SourceSansPro")).toBe("SourceSans");
		expect(familyKey("SourceSansSemibold")).toBe("SourceSans");
		expect(familyKey("GothamSSm")).toBe("Gotham");
		expect(familyKey("LegacyArial")).toBe("Legacy");
		expect(familyKey("ArialBold")).toBe("Arial");
		expect(familyKey("FredokaOne")).toBe("FredokaOne");
		expect(familyKey("Fredoka")).toBe("FredokaOne");
		expect(familyKey("HighwayGothic")).toBe("Highway");
		expect(familyKey("BuilderSansMedium")).toBe("BuilderSans");
	});

	it("knows every family the engine can name", () => {
		// `Antique` and friends have no face to ship, but they are still the
		// engine's, and a name loom does not know falls to the generic stack with
		// no warning — which is the silence this table exists to end.
		expect(familyKey("Antique")).toBe("Antique");
		expect(familyKey("Jura")).toBe("Jura");
		expect(familyKey("BuilderSansExtraBold")).toBe("BuilderSans");
		expect(familyKey("ArimoBold")).toBe("Arimo");
		expect(familyKey("Code")).toBe("Inconsolata");
	});

	it("is undefined for a name it does not know", () => {
		expect(familyKey("Wingdings")).toBeUndefined();
		expect(familyKey(undefined)).toBeUndefined();
	});
});

describe("fontFamily", () => {
	it("names the Roblox font first, then falls back", () => {
		// The name still leads: on a machine that has the real font installed it
		// is the right answer, and it costs nothing where it is missing.
		expect(fontFamily("GothamBold")).toMatch(/^"Gotham", /);
		expect(fontFamily("GothamBold")).toContain("system-ui");
	});

	it("puts a registered family in front of the fallback", () => {
		registerFont("Gotham", { family: "Builder Sans" });
		expect(fontFamily("GothamBold")).toBe(
			`"Builder Sans", ${'"Gotham", system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif'}`,
		);
		// Registered under one spelling, matched by any of them.
		expect(fontFamily("GothamSSm")).toContain('"Builder Sans"');
	});

	it("takes an explicit fallback over the family's default", () => {
		registerFont("SourceSans", {
			family: "Source Sans 3 Variable",
			fallback: "serif",
		});
		expect(fontFamily("SourceSansBold")).toBe(
			'"Source Sans 3 Variable", serif',
		);
	});

	it("leaves a family it does not know on the generic stack", () => {
		// Nothing Roblox-specific to lead with, so it starts at the system font.
		expect(fontFamily("Wingdings")).toBe(fontFamily(undefined));
		expect(fontFamily("Wingdings")).toMatch(/^system-ui, /);
		expect(fontFamily(undefined)).toContain("sans-serif");
	});

	it("leads with the engine's font for a family it ships no face for", () => {
		expect(fontFamily("Antique")).toMatch(/^"Sawarabi Mincho", /);
		expect(fontFamily("Arcade")).toMatch(/^"Press Start 2P", /);
	});
});

describe("registerFont", () => {
	it("declares the faces it is given, once each", () => {
		registerFont("SourceSans", {
			family: "Source Sans 3 Variable",
			faces: [
				{ src: "/fonts/ss3.woff2", weight: "200 900" },
				{ src: "/fonts/ss3-italic.woff2", weight: "200 900", style: "italic" },
			],
		});
		const css = injectedCss();
		expect(css).toContain('font-family:"Source Sans 3 Variable"');
		expect(css).toContain('src:url("/fonts/ss3.woff2")');
		expect(css).toContain("font-weight:200 900");
		expect(css).toContain("font-style:italic");
		// `swap` by default: paint in the fallback rather than not at all.
		expect(css).toContain("font-display:swap");

		// Re-registering the same face must not stack duplicate rules.
		const before = injectedCss().length;
		registerFont("SourceSans", {
			family: "Source Sans 3 Variable",
			faces: [{ src: "/fonts/ss3.woff2", weight: "200 900" }],
		});
		expect(injectedCss().length).toBe(before);
	});

	it("declares nothing when the page already provides the family", () => {
		registerFont("Gotham", { family: "Gotham" });
		expect(document.querySelector("style[data-loom-fonts]")).toBeNull();
	});

	it("notifies listeners so measured text is measured again", async () => {
		// Every AutomaticSize bound was measured against the faces available at
		// the time, so a face arriving later invalidates the layout it produced.
		const seen = vi.fn();
		const stop = onFontsChanged(seen);
		registerFont("Gotham", { family: "Builder Sans" });
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(seen).toHaveBeenCalled();

		seen.mockClear();
		stop();
		registerFont("Roboto", { family: "Roboto Variable" });
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(seen).not.toHaveBeenCalled();
	});

	it("notifies for a face that loads after the document settled", async () => {
		// #11: the registration itself never finds the face loaded — nothing has
		// asked for it, and the canvas that measures never will — so the layout
		// that comes out is the fallback's until the load is reported. Waiting on
		// `document.fonts.ready` only reports it when the read lands inside the
		// cycle that loads it, which a static build manages and a dev server,
		// booting long after the document is done, does not: there the promise is
		// already resolved and the face downloads unannounced.
		const fonts = Object.assign(new EventTarget(), {
			// Already resolved, the state a settled document leaves behind.
			ready: Promise.resolve(),
			status: "loaded",
		});
		Object.defineProperty(document, "fonts", {
			value: fonts,
			configurable: true,
		});
		vi.resetModules();
		const late = await import("./fonts.ts");
		try {
			const seen = vi.fn();
			late.onFontsChanged(seen);
			late.registerFont("Roboto", {
				family: "Roboto Variable",
				faces: [{ src: "/fonts/roboto.woff2" }],
			});
			await new Promise((resolve) => setTimeout(resolve, 0));
			expect(seen).toHaveBeenCalled(); // the stack change

			// The download only begins when the text first paints in it, which is
			// a cycle later — and the layout standing on screen was measured
			// before it.
			seen.mockClear();
			fonts.dispatchEvent(new Event("loadingdone"));
			await new Promise((resolve) => setTimeout(resolve, 0));
			expect(seen).toHaveBeenCalledTimes(1);

			// And again the next time, however many cycles later.
			seen.mockClear();
			fonts.dispatchEvent(new Event("loadingdone"));
			await new Promise((resolve) => setTimeout(resolve, 0));
			expect(seen).toHaveBeenCalledTimes(1);
		} finally {
			late.clearRegisteredFonts();
			Reflect.deleteProperty(document, "fonts");
		}
	});
});

describe("clearRegisteredFonts", () => {
	it("takes the registrations and the rules back out", () => {
		registerFont("Gotham", {
			family: "Builder Sans",
			faces: [{ src: "/fonts/builder.woff2" }],
		});
		expect(document.querySelector("style[data-loom-fonts]")).not.toBeNull();

		clearRegisteredFonts();
		expect(document.querySelector("style[data-loom-fonts]")).toBeNull();
		expect(fontFamily("GothamBold")).not.toContain("Builder Sans");
	});
});

describe("measureText", () => {
	it("spends a rounded advance per glyph, not the browser's run width", () => {
		// An unkerned face at 6.2px a character: the run is 12.4 wide, while the
		// engine rounds each advance to the half pixel and spends 6 + 6 = 12.
		const measure = vi.fn((text: string) => ({ width: text.length * 6.2 }));
		const ctx = {
			font: "10px Test",
			measureText: measure,
		} as unknown as CanvasRenderingContext2D;

		expect(shapedTextWidth(ctx, "AV")).toBe(12);
		expect(measure).toHaveBeenCalledWith("A");
		expect(measure).toHaveBeenCalledWith("V");
	});

	it("spends the kerning between a pair as well as their advances", () => {
		// `AV` closes up by 0.4 in this face: 6 + 6 of advance, less a kern that
		// lands on the half pixel the engine reports every width on.
		const measure = vi.fn((text: string) => ({
			width: text === "AV" ? 12 : text.length * 6.2,
		}));
		const ctx = {
			font: "10px Test",
			measureText: measure,
		} as unknown as CanvasRenderingContext2D;

		expect(shapedTextWidth(ctx, "AV")).toBe(11.5);
		expect(measure).toHaveBeenCalledWith("AV");
	});

	it("keeps one grapheme cluster on one advance", () => {
		const family = "👨‍👩‍👧‍👦";
		const measure = vi.fn(() => ({ width: 12.2 }));
		const ctx = {
			font: "11px Emoji",
			measureText: measure,
		} as unknown as CanvasRenderingContext2D;

		expect(shapedTextWidth(ctx, family)).toBe(12);
		expect(measure).toHaveBeenCalledOnce();
		expect(measure).toHaveBeenCalledWith(family);
	});

	it("returns nothing for an empty string, and one line otherwise", () => {
		expect(measureText({ text: "", size: 18 })).toEqual({ x: 0, y: 0 });
		expect(measureText({ text: "hello", size: 18 }).y).toBe(18);
	});

	it("counts a line per newline, wrap or not", () => {
		expect(measureText({ text: "a\nb\nc", size: 10 }).y).toBe(30);
	});

	it("wraps at word boundaries when a width is given", () => {
		// happy-dom's canvas has no text metrics, so widths measure 0 and nothing
		// can overflow: the shape under test here is that a 0 width means "no
		// frame" (one line) rather than "wrap at zero" (a line per word).
		expect(measureText({ text: "one two three", size: 12, width: 0 }).y).toBe(
			12,
		);
	});
});

/**
 * A canvas that knows exactly the families it is told about, so a test can put
 * a face out of reach the way a failed download does.
 *
 * `measureText` answers off the *first* family in `ctx.font`'s stack: a known
 * one gets its own advance and face box, an unknown one falls through to the
 * generic named behind it — which is what a browser does, and what the probe in
 * `familyIsAvailable` reads.
 */
function installFakeCanvas(available: ReadonlySet<string>): () => void {
	const original = HTMLCanvasElement.prototype.getContext;
	const context = {
		font: "10px sans-serif",
		measureText(text: string) {
			const stack = this.font.slice(this.font.indexOf("px ") + 3);
			const first = (stack.split(",")[0] ?? "")
				.trim()
				.replace(/^["']|["']$/g, "");
			const known = available.has(first);
			// The two generics the probe compares against have to differ, or a real
			// family could not shift either of them.
			const generic = stack.includes("monospace") ? 10 : 8;
			const per = known ? 12 : generic;
			// The box the *browser* reports: 1.17 for the real face, 1.18 for the
			// fallback. Both are deliberately unlike the engine's 1.2212 for Source
			// Sans 3, so a test can tell a table lookup from a measurement.
			const box = known ? 1.17 : 1.18;
			const size = Number.parseFloat(
				this.font.slice(0, this.font.indexOf("px")).split(" ").at(-1) ?? "10",
			);
			return {
				width: text.length * per,
				fontBoundingBoxAscent: box * size * 0.8,
				fontBoundingBoxDescent: box * size * 0.2,
			};
		},
	};
	HTMLCanvasElement.prototype.getContext = (() =>
		context) as unknown as typeof original;
	return () => {
		HTMLCanvasElement.prototype.getContext = original;
	};
}

/** A fresh renderer + font registry, so the metric caches start empty. */
async function freshRenderer(): Promise<{
	fonts: typeof import("./fonts.ts");
	renderer: typeof import("./index.ts");
}> {
	vi.resetModules();
	return {
		fonts: await import("./fonts.ts"),
		renderer: await import("./index.ts"),
	};
}

describe("familyIsAvailable", () => {
	it("is true only for a family the browser can actually paint", async () => {
		const restore = installFakeCanvas(new Set(["Source Sans 3 Variable"]));
		try {
			const { fonts } = await freshRenderer();
			expect(fonts.familyIsAvailable("Source Sans 3 Variable")).toBe(true);
			// Registered, declared, named in the stack — and still not there.
			expect(fonts.familyIsAvailable("Roboto Variable")).toBe(false);
		} finally {
			restore();
		}
	});

	it("says yes when it cannot tell, rather than guessing no", async () => {
		// A canvas with no text metrics at all (a stub, a headless DOM) measures
		// every string at 0, so the probe and its baseline agree for a family that
		// is present and one that is not alike. Reading that as "missing" would
		// take the engine's face metrics away from every family on a platform that
		// simply cannot be asked.
		const original = HTMLCanvasElement.prototype.getContext;
		HTMLCanvasElement.prototype.getContext = (() => ({
			font: "10px sans-serif",
			measureText: () => ({ width: 0 }),
		})) as unknown as typeof original;
		try {
			const { fonts } = await freshRenderer();
			expect(fonts.familyIsAvailable("Source Sans 3 Variable")).toBe(true);
		} finally {
			HTMLCanvasElement.prototype.getContext = original;
		}
	});
});

describe("engine face metrics", () => {
	/**
	 * `TextSize` 18 through the stack a registered `SourceSans` resolves to,
	 * against whatever canvas the caller has installed.
	 */
	async function registeredSize(): Promise<number> {
		const { fonts, renderer } = await freshRenderer();
		fonts.registerFont("SourceSans", { family: "Source Sans 3 Variable" });
		return renderer.cssFontSize(
			{
				family: renderer.fontFamily("SourceSans"),
				weight: "400",
				italic: false,
			},
			18,
		);
	}

	it("uses the engine's calibration for a face that is really there", async () => {
		const restore = installFakeCanvas(new Set(["Source Sans 3 Variable"]));
		try {
			// The engine's 1.2212 for this face, not the 1.17 the browser reports.
			expect(await registeredSize()).toBeCloseTo(18 / 1.2212, 4);
		} finally {
			restore();
		}
	});

	it("measures instead when the registered face never loaded", async () => {
		// #11's dev-only shape: the registration succeeded, the download did not.
		// The browser is painting the fallback, so sizing the text by the engine's
		// ratio for a face that is not there puts every advance on the wrong
		// glyphs — the text then wraps in places the engine never would, and the
		// AutomaticSize box does not fit the text drawn inside it. A static build
		// carries its font files in its own output and never lands here, which is
		// what made this look like a dev-only rendering bug.
		const restore = installFakeCanvas(new Set());
		try {
			expect(await registeredSize()).toBeCloseTo(18 / 1.18, 4);
		} finally {
			restore();
		}
	});

	it("settles on the engine's calibration once the face arrives", async () => {
		// The load is reported through `onFontsChanged`, which drops the metric
		// caches — so the same label re-measures against the face that just landed
		// and ends up where a build that had it from the start does.
		const present = new Set<string>();
		const restore = installFakeCanvas(present);
		try {
			const { fonts, renderer } = await freshRenderer();
			fonts.registerFont("SourceSans", { family: "Source Sans 3 Variable" });
			const font = {
				family: renderer.fontFamily("SourceSans"),
				weight: "400",
				italic: false,
			};
			expect(renderer.cssFontSize(font, 18)).toBeCloseTo(18 / 1.18, 4);

			// The face lands, and the browser reports the end of the cycle.
			present.add("Source Sans 3 Variable");
			fonts.registerFont("SourceSans", { family: "Source Sans 3 Variable" });
			await new Promise((resolve) => setTimeout(resolve, 0));

			expect(renderer.cssFontSize(font, 18)).toBeCloseTo(18 / 1.2212, 4);
		} finally {
			restore();
		}
	});
});

describe("requestFontFor / fontsPending", () => {
	/** A `document.fonts` whose one web face loads when told to. */
	function stubFonts(): { finish: () => void; loads: string[] } {
		let loaded = false;
		let finish: () => void = () => {};
		const done = new Promise<void>((resolve) => {
			finish = () => {
				loaded = true;
				resolve();
			};
		});
		const loads: string[] = [];
		Object.defineProperty(document, "fonts", {
			configurable: true,
			value: {
				addEventListener: () => {},
				check: (font: string) => loaded || !font.includes("WebFace"),
				load: (font: string) => {
					loads.push(font);
					return done;
				},
			},
		});
		return { finish, loads };
	}

	it("starts the download a measurement needs and reports it pending", async () => {
		const { finish, loads } = stubFonts();
		// A registration resets what counts as ready, so start from a clean slate.
		clearRegisteredFonts();
		await Promise.resolve();
		requestFontFor("16px WebFace", "abc");
		requestFontFor("16px WebFace", "abc");
		requestFontFor("16px SystemFace", "abc");
		expect(loads).toEqual(["16px WebFace"]);
		const pending = fontsPending();
		expect(pending).toBeDefined();
		finish();
		await pending;
		expect(fontsPending()).toBeUndefined();
	});

	it("has nothing pending when every face is already there", async () => {
		stubFonts();
		clearRegisteredFonts();
		await Promise.resolve();
		requestFontFor("16px SystemFace", "abc");
		expect(fontsPending()).toBeUndefined();
	});
});
