/**
 * A label's text has to fit the box the engine's width gave it, even where the
 * browser shapes the run wider than the engine's advances add up to.
 */
import type { LayoutResult, SceneNode } from "@loom-dev/scene";
import { prop } from "@loom-dev/scene";
import { describe, expect, it } from "vitest";
import { renderScene } from "./index";

/**
 * Glyphs and pairs measure 6 per character, so the engine width of a run is
 * 6 × length. A longer run comes back `EXTRA` wider — the browser's own shaping
 * spending more than its glyphs add up to, which is what clipped the last
 * letter of "Bank Transfer" at the edge of a table.
 */
const EXTRA = 4;
let extra = EXTRA;
Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
	configurable: true,
	writable: true,
	value: () => ({
		font: "",
		measureText: (text: string) => ({
			width: text.length * 6 + (text.length > 2 ? extra : 0),
		}),
	}),
});

function spacingOf(properties: SceneNode["properties"]): string {
	const mount = document.createElement("div");
	const layout: LayoutResult = {
		rects: {
			root: { rect: { x: 0, y: 0, width: 200, height: 50 } },
			label: { rect: { x: 0, y: 0, width: 48, height: 18 } },
		},
	};
	renderScene(
		{
			className: "Frame",
			name: "Root",
			id: "root",
			children: [
				{ className: "TextLabel", name: "Label", id: "label", properties },
			],
		},
		layout,
		mount,
	);
	const inner = mount.querySelector<HTMLElement>(
		'[data-loom-name="Label"] div > div',
	);
	if (!inner) throw new Error("text layer not rendered");
	return inner.style.letterSpacing;
}

describe("engine-width letter spacing", () => {
	it("tightens a line the browser shapes wider than the engine", () => {
		// 8 glyphs, 4px over: half a pixel off each.
		expect(spacingOf({ Text: prop.string("abcdefgh") })).toBe("-0.5px");
	});

	it("does the same for rich text in the label's own font", () => {
		expect(
			spacingOf({
				Text: prop.string('abcd<font color="#ff0000">efgh</font>'),
				RichText: prop.bool(true),
			}),
		).toBe("-0.5px");
	});

	it("leaves rich text that changes the font alone", () => {
		expect(
			spacingOf({
				Text: prop.string("abcd<b>efgh</b>"),
				RichText: prop.bool(true),
			}),
		).toBe("");
	});

	it("never widens a line the browser shapes narrower", () => {
		extra = -EXTRA;
		try {
			expect(spacingOf({ Text: prop.string("abcdefgh") })).toBe("");
		} finally {
			extra = EXTRA;
		}
	});
});
