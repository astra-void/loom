/**
 * The vide adapter's text measurement: `TextWrapped` / `TextWrap` wrapping,
 * which width it wraps against, and that a re-wrap settles inside the paint
 * that caused it rather than rendering the unwrapped pass first.
 *
 * Kept in step with the react adapter's copy in `@loom-dev/react`'s
 * `world.test.ts` — the two adapters feed the same Scene IR to the same engine,
 * so the same scene has to measure the same way through either.
 */
import { Enum, UDim, UDim2 } from "@loom-dev/runtime";
import type { LayoutResult, SceneNode, Viewport } from "@loom-dev/scene";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type ComputeLayout, create, mount, source } from "./index";

/**
 * happy-dom has no 2D canvas context, and `TextBounds` measurement needs one.
 * A width proportional to the string keeps the assertions about *which* string
 * was measured meaningful. Installed at import time: the adapter caches the
 * context on first use.
 */
const measureStub = {
	font: "",
	// An unkerned face at 6.3 a character: a browser-shaped run is 6.3 × length,
	// while the engine rounds each advance to the half pixel and spends 6.5. The
	// adapter must report the latter, like the static renderer does.
	measureText: (text: string) => ({ width: text.length * 6.3 }),
};
Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
	value: () => measureStub,
	configurable: true,
	writable: true,
});

// happy-dom's ResizeObserver fires again as soon as `renderScene` writes to the
// DOM, which would hand the adapter a second paint no real frame gives it — and
// a second paint is exactly what the settling test must not be able to lean on.
class InertResizeObserver {
	observe(): void {}
	unobserve(): void {}
	disconnect(): void {}
}
Object.defineProperty(globalThis, "ResizeObserver", {
	value: InertResizeObserver,
	configurable: true,
	writable: true,
});

// `mount` lays out against a container it creates itself, and happy-dom reports
// 0 for every client size — which the adapter reads as "not sized yet" and skips
// the paint. Give the whole document one.
for (const [name, value] of [
	["clientWidth", 800],
	["clientHeight", 600],
] as const) {
	Object.defineProperty(HTMLElement.prototype, name, {
		get: () => value,
		configurable: true,
	});
}

/**
 * A layout that records the `TextBounds` every text node carried, in the order
 * it saw them. `widthOf` pins the width of the nodes a test cares about;
 * everything else is 500, except an auto-sized label, which is its own text.
 */
function makeLayout(
	widthOf: (node: SceneNode) => number | undefined,
	measured: Array<{ x: number; y: number }>,
): ComputeLayout {
	return (root: SceneNode, _viewport: Viewport): LayoutResult => {
		const rects: LayoutResult["rects"] = {};
		const walk = (node: SceneNode): void => {
			const bounds = node.properties?.TextBounds;
			const text =
				bounds && bounds.type === "Vector2"
					? (bounds.value as { x: number; y: number })
					: undefined;
			if (text) measured.push(text);
			const pinned = widthOf(node);
			rects[node.id ?? "?"] = {
				rect: {
					x: 0,
					y: 0,
					width: pinned ?? (text ? text.x : 500),
					height: text ? text.y : 100,
				},
			};
			for (const child of node.children ?? []) walk(child);
		};
		walk(root);
		return { rects };
	};
}

const TEXT = "aaaa bbbb cccc dddd"; // 19 chars -> 133 wide on one line

describe("vide adapter text measurement", () => {
	let host: HTMLElement;
	let unmounts: Array<() => void>;

	beforeEach(() => {
		document.body.innerHTML = "";
		host = document.createElement("div");
		document.body.appendChild(host);
		unmounts = [];
	});
	afterEach(() => {
		for (const unmount of unmounts) unmount();
	});

	/** The `Card` > padded auto-sized `Body` > label idiom every library uses. */
	function card(
		labelProps: Record<string, unknown>,
	): () => ReturnType<ReturnType<typeof create>> {
		return () =>
			create("ScreenGui")({
				1: create("Frame")({
					Name: "Card",
					1: create("Frame")({
						Name: "Body",
						AutomaticSize: Enum.AutomaticSize.XY,
						1: create("UIPadding")({
							PaddingLeft: new UDim(0, 10),
							PaddingRight: new UDim(0, 10),
						}),
						2: create("TextLabel")({
							Name: "Wrapped",
							Text: TEXT,
							AutomaticSize: Enum.AutomaticSize.XY,
							TextSize: 10,
							...labelProps,
						}),
					}),
				}),
			});
	}

	function mountCard(
		labelProps: Record<string, unknown>,
		widthOf: (node: SceneNode) => number | undefined,
	): Array<{ x: number; y: number }> {
		const measured: Array<{ x: number; y: number }> = [];
		unmounts.push(
			mount(card(labelProps), host, {
				computeLayout: makeLayout(widthOf, measured),
			}),
		);
		return measured;
	}

	it("wraps at the nearest ancestor that has a width, past auto-sized ones", () => {
		// The library idiom nests auto-sized containers — a padded body inside a
		// card — and the body's own width comes *from* this label, so wrapping
		// against it is the same circle as wrapping against the label itself and
		// the text never wraps. The card is the one node with room to run out of.
		const measured = mountCard({ TextWrapped: true }, (node) =>
			node.name === "Card" ? 100 : undefined,
		);
		const last = measured.at(-1);
		expect(last).toBeDefined();
		// The card's 100, less the body's 10 + 10 of padding — not the body's own
		// 500, and not the 133 the string measures on one line.
		expect(last?.x).toBeLessThanOrEqual(80);
		expect(last?.y).toBeGreaterThan(10);
	});

	it("wraps an item a Fill row shrinks at the room the row leaves it", () => {
		// Once the row overflows, the body box is sized by the row rather than by
		// the label inside it, so the label wraps inside what the icon leaves.
		const measured: Array<{ x: number; y: number }> = [];
		unmounts.push(
			mount(
				() =>
					create("ScreenGui")({
						1: create("Frame")({
							Name: "Row",
							1: create("UIListLayout")({
								FillDirection: Enum.FillDirection.Horizontal,
								HorizontalFlex: Enum.UIFlexAlignment.Fill,
							}),
							2: create("Frame")({
								Name: "Body",
								AutomaticSize: Enum.AutomaticSize.XY,
								1: create("TextLabel")({
									Name: "Wrapped",
									Text: TEXT,
									AutomaticSize: Enum.AutomaticSize.XY,
									TextSize: 10,
									TextWrapped: true,
								}),
							}),
							3: create("Frame")({
								Name: "Icon",
								Size: UDim2.fromOffset(60, 14),
							}),
						}),
					}),
				host,
				{
					computeLayout: makeLayout(
						(node) => (node.name === "Row" ? 120 : undefined),
						measured,
					),
				},
			),
		);
		const last = measured.at(-1);
		// 120 of row less the icon's own 60 (the stub lays it out at 500, which is
		// why the room reads its `Size`): "aaaa bbbb" is the widest line that fits,
		// not the "aaaa bbbb cccc" that 120 would allow.
		expect(last?.x).toBeLessThanOrEqual(60);
		expect(last?.y).toBeGreaterThan(10);
	});

	it("leaves a row on an automatic canvas its whole width", () => {
		// A canvas that grows to its items never makes them shrink, so the icon
		// takes nothing away from the text beside it.
		const measured: Array<{ x: number; y: number }> = [];
		unmounts.push(
			mount(
				() =>
					create("ScreenGui")({
						1: create("ScrollingFrame")({
							Name: "Row",
							AutomaticCanvasSize: Enum.AutomaticSize.X,
							1: create("UIListLayout")({
								FillDirection: Enum.FillDirection.Horizontal,
								HorizontalFlex: Enum.UIFlexAlignment.Fill,
							}),
							2: create("Frame")({
								Name: "Body",
								AutomaticSize: Enum.AutomaticSize.XY,
								1: create("TextLabel")({
									Name: "Wrapped",
									Text: TEXT,
									AutomaticSize: Enum.AutomaticSize.XY,
									TextSize: 10,
									TextWrapped: true,
								}),
							}),
							3: create("Frame")({
								Name: "Icon",
								Size: UDim2.fromOffset(60, 14),
							}),
						}),
					}),
				host,
				{
					computeLayout: makeLayout(
						(node) => (node.name === "Row" ? 120 : undefined),
						measured,
					),
				},
			),
		);
		// Wrapped at the frame's 120: "aaaa bbbb cccc" on the first line.
		expect(measured.at(-1)?.x).toBeGreaterThan(60);
	});

	it("keeps the renderer's half-pixel text width", () => {
		const measured: Array<{ x: number; y: number }> = [];
		unmounts.push(
			mount(
				() =>
					create("ScreenGui")({
						1: create("TextLabel")({
							Text: "~",
							AutomaticSize: Enum.AutomaticSize.XY,
							TextSize: 10,
						}),
					}),
				host,
				{ computeLayout: makeLayout(() => undefined, measured) },
			),
		);

		expect(measured.at(-1)?.x).toBe(6.5);
	});

	it("reads TextWrap as the alias it is, and lets TextWrapped overrule it", () => {
		// Roblox carries both names for one property. The library sets them
		// together; when they disagree the current one wins.
		const alias = mountCard({ TextWrap: true }, (node) =>
			node.name === "Card" ? 100 : undefined,
		);
		expect(alias.at(-1)?.x).toBeLessThanOrEqual(80);

		const overruled = mountCard(
			{ TextWrap: true, TextWrapped: false },
			(node) => (node.name === "Card" ? 100 : undefined),
		);
		// Unwrapped: the whole string on one line, past the card it sits in.
		expect(overruled.at(-1)?.x).toBe(TEXT.length * 6.5);
	});

	it("wraps a label with a width of its own against that width", () => {
		// No AutomaticSize on X, so the label's width is fixed and *is* the
		// constraint — the ancestor walk is only for labels that have no width yet.
		const measured = mountCard(
			{ TextWrapped: true, AutomaticSize: Enum.AutomaticSize.Y },
			(node) => (node.name === "Wrapped" ? 60 : undefined),
		);
		const last = measured.at(-1);
		expect(last?.x).toBeLessThanOrEqual(60);
		expect(last?.y).toBeGreaterThan(10);
	});

	it("settles a re-wrap inside one paint, never rendering the unwrapped pass", async () => {
		// The wrap width comes from the layout this same paint produces, so the
		// first snapshot after the container narrows still measures against the
		// width the container had a moment ago. Rendering that pass puts a label
		// wider than its container into the DOM — and during a live window resize,
		// where every frame narrows it again, that stale pass is what stays on
		// screen: text running past the edge of its card.
		const box = { width: 300 };
		const measured: Array<{ x: number; y: number }> = [];
		const tick = source(0);
		unmounts.push(
			mount(
				() =>
					create("ScreenGui")({
						1: create("Frame")({
							Name: "Card",
							// A reactive prop, so the test can ask for exactly one repaint.
							BackgroundTransparency: tick,
							1: create("Frame")({
								Name: "Body",
								AutomaticSize: Enum.AutomaticSize.XY,
								1: create("UIPadding")({
									PaddingLeft: new UDim(0, 10),
									PaddingRight: new UDim(0, 10),
								}),
								2: create("TextLabel")({
									Name: "Wrapped",
									Text: TEXT,
									TextWrapped: true,
									AutomaticSize: Enum.AutomaticSize.XY,
									TextSize: 10,
								}),
							}),
						}),
					}),
				host,
				{
					computeLayout: makeLayout(
						(node) => (node.name === "Card" ? box.width : undefined),
						measured,
					),
				},
			),
		);

		const rendered = (): number => {
			const el = host.querySelector<HTMLElement>('[data-loom-name="Wrapped"]');
			if (!el) throw new Error("label not rendered");
			return Number.parseFloat(el.style.width);
		};
		// Let the paint the mount queued drain, so the resize below gets exactly
		// one — which is what a real frame gives it.
		await new Promise((resolve) => setTimeout(resolve, 0));
		// 280 of room, so the 133 the string measures on one line fits as it is.
		expect(rendered()).toBe(TEXT.length * 6.5);

		// The container narrows — one resize, one paint.
		box.width = 100;
		tick(1);
		await new Promise((resolve) => setTimeout(resolve, 0));

		// Already wrapped: 80 of room, not the 133 of the pass that measured
		// against the width the card had a moment ago.
		expect(rendered()).toBeLessThanOrEqual(80);
	});
});
