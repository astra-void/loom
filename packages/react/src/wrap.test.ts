/**
 * Wrapped-text settling, against the **real** layout engine.
 *
 * `world.test.ts` stubs the layout, which is right for the questions it asks
 * and useless for this one: whether an auto-sizing `TextWrapped` label ends up
 * with a box that matches the text the browser will then paint into it. That is
 * a feedback loop — measure → lay out → learn the width → measure again — and
 * only the real engine closes it.
 *
 * The oracle is exact rather than visual. happy-dom paints no text, so the
 * canvas is stubbed with a fixed advance per character, and the test re-runs the
 * adapter's own greedy wrap at the width the layout actually gave the label. If
 * that line count disagrees with the one the label's height encodes, the label
 * is a box built for one wrap painted with another — the failure reported in
 * #11, where a body sized for two lines was painted with four and showed a
 * one-line slice of the middle.
 */
// Reading the wasm off disk is the only Node this package touches, so the types
// come in here rather than through tsconfig `types`, which the published
// declarations are also built with.
/// <reference types="node" />
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { registerFont } from "@loom-dev/renderer";
import type { LoomInstance } from "@loom-dev/runtime";
import {
	Enum,
	flushDirtyNow,
	getDirtyCount,
	markDirty,
	UDim,
	UDim2,
	Vector2,
} from "@loom-dev/runtime";
import type { LayoutResult, SceneNode, Viewport } from "@loom-dev/scene";
import { createElement, type ReactElement } from "react";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import initWasm, {
	computeLayout as rawComputeLayout,
} from "../../layout/pkg/loom_layout_wasm.js";
import { type MountedWorld, mountSync } from "./index";

/** Advance width of one character in the stubbed face. */
const CHAR_W = 7;

/**
 * The advance the stubbed canvas is currently reporting, so a test can change
 * the face under a mounted world the way a `@font-face` finishing its download
 * does. Everything but the late-face test leaves it at `CHAR_W`.
 */
let faceAdvance = CHAR_W;
const BODY = "View player information, statistics, and recent activity.";
const BODY_SIZE = 18;
const BODY_LINE_HEIGHT = 1.4;

/**
 * happy-dom has no 2D context and the adapter caches the first one it is given,
 * so this is installed at import time. A fixed advance per character makes the
 * wrap deterministic and lets the test recompute it exactly.
 */
Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
	configurable: true,
	writable: true,
	value: () => ({
		font: "",
		// Browsers shape a whole run fractionally, while Roblox rounds a separate
		// advance per character. An unkerned face at `CHAR_W - 0.2` rounds to
		// exactly `CHAR_W` a glyph while its runs stay fractional, so this still
		// fails if the live React path goes back to measuring whole words while the
		// static renderer uses engine-shaped widths.
		measureText: (text: string) => ({
			width: text.length * (faceAdvance - 0.2),
		}),
	}),
});

/**
 * The adapter's greedy wrap (`measureSegments`), re-run here over the stub's
 * metrics: pieces are words and the whitespace between them, a piece that no
 * longer fits opens a line, and a run of spaces that would overflow is dropped
 * rather than carried over.
 */
function wrapLines(
	text: string,
	wrapAt: number,
	advance = faceAdvance,
): number {
	let lines = 0;
	let lineWidth = 0;
	for (const piece of text.split(/(\s+)/)) {
		if (piece === "") continue;
		const pieceWidth = piece.length * advance;
		if (lineWidth > 0 && lineWidth + pieceWidth > wrapAt) {
			lines += 1;
			lineWidth = 0;
			if (piece.trim() === "") continue;
		}
		lineWidth += pieceWidth;
	}
	return lines + 1;
}

/** The line count a label's laid-out height encodes, given its text metrics. */
function linesFromHeight(height: number, size: number, lineHeight: number) {
	return 1 + (height - size) / (size * lineHeight);
}

const pad = (px: number) =>
	createElement("uipadding", {
		PaddingLeft: UDim.new(0, px),
		PaddingRight: UDim.new(0, px),
		PaddingTop: UDim.new(0, px),
		PaddingBottom: UDim.new(0, px),
	});

/** An auto-sizing text label, the shape the reported library's `Text` builds. */
const label = (name: string, text: string, size: number, lineHeight: number) =>
	createElement("textlabel", {
		Name: name,
		Size: UDim2.fromScale(0, 0),
		AutomaticSize: Enum.AutomaticSize.XY,
		Text: text,
		TextSize: size,
		LineHeight: lineHeight,
		TextWrapped: true,
		RichText: true,
	});

const button = (name: string, text: string) =>
	createElement(
		"frame",
		{
			key: name,
			Name: name,
			Size: UDim2.fromScale(0, 0),
			AutomaticSize: Enum.AutomaticSize.XY,
		},
		pad(10),
		label(`${name}Text`, text, 18, 1.4),
	);

/**
 * The reported scene, structurally: a wrapping row of `45%` columns, each
 * holding an auto-sizing card whose vertical list fills the cross axis, whose
 * body is a padded auto container inside a flex item, and whose footer has an
 * irreducible two-button minimum.
 */
function cards(count: number): ReactElement {
	const one = (i: number) =>
		createElement(
			"frame",
			{
				key: `col${i}`,
				Name: `Col${i}`,
				Size: UDim2.new(0.45, 0, 0, 0),
				AutomaticSize: Enum.AutomaticSize.Y,
				BackgroundTransparency: 1,
			},
			createElement(
				"frame",
				{
					Name: `Card${i}`,
					Size: UDim2.fromScale(1, 1),
					AutomaticSize: Enum.AutomaticSize.XY,
				},
				createElement("uilistlayout", {
					FillDirection: Enum.FillDirection.Vertical,
					HorizontalFlex: Enum.UIFlexAlignment.Fill,
					SortOrder: Enum.SortOrder.LayoutOrder,
				}),
				createElement(
					"frame",
					{
						Name: `Header${i}`,
						LayoutOrder: 0,
						Size: UDim2.fromScale(0, 0),
						AutomaticSize: Enum.AutomaticSize.XY,
					},
					pad(12),
					label(`HeaderText${i}`, "Player Profile", 24, 1.25),
				),
				createElement(
					"frame",
					{
						Name: `Flex${i}`,
						LayoutOrder: 1,
						Size: UDim2.fromScale(0, 0),
						AutomaticSize: Enum.AutomaticSize.XY,
					},
					createElement("uiflexitem", { FlexMode: Enum.UIFlexMode.Grow }),
					createElement("uilistlayout", {
						FillDirection: Enum.FillDirection.Horizontal,
					}),
					createElement(
						"frame",
						{
							Name: `BodyBox${i}`,
							Size: UDim2.fromScale(0, 0),
							AutomaticSize: Enum.AutomaticSize.XY,
						},
						pad(12),
						label(`BodyText${i}`, BODY, BODY_SIZE, BODY_LINE_HEIGHT),
					),
				),
				createElement(
					"frame",
					{
						Name: `Footer${i}`,
						LayoutOrder: 2,
						Size: UDim2.fromScale(0, 0),
						AutomaticSize: Enum.AutomaticSize.XY,
					},
					pad(12),
					createElement("uilistlayout", {
						FillDirection: Enum.FillDirection.Horizontal,
						Wraps: true,
					}),
					button(`Cancel${i}`, "Cancel"),
					button(`Save${i}`, "Save"),
				),
			),
		);
	return createElement(
		"screengui",
		{ Name: "Gui" },
		createElement(
			"frame",
			{
				Name: "Row",
				Size: UDim2.new(0.9, 0, 1, 0),
				BackgroundTransparency: 1,
			},
			createElement("uilistlayout", {
				FillDirection: Enum.FillDirection.Horizontal,
				Wraps: true,
			}),
			...Array.from({ length: count }, (_, i) => one(i)),
		),
	);
}

describe("wrapped text against the real layout engine", () => {
	let mount: HTMLElement;
	let root: MountedWorld | undefined;

	beforeAll(async () => {
		// wasm-pack's `web` glue fetches by URL, which Node will not do for a
		// file:; hand it the bytes instead.
		await initWasm({
			module_or_path: await readFile(
				resolve(process.cwd(), "packages/layout/pkg/loom_layout_wasm_bg.wasm"),
			),
		});
	});

	beforeEach(() => {
		document.body.innerHTML = "";
		root?.unmount();
		root = undefined;
		mount = document.createElement("div");
		document.body.appendChild(mount);
	});

	const realLayout = (scene: SceneNode, viewport: Viewport): LayoutResult =>
		rawComputeLayout(scene, viewport) as LayoutResult;

	function setStage(width: number, height = 800): void {
		Object.defineProperty(mount, "clientWidth", {
			value: width,
			configurable: true,
		});
		Object.defineProperty(mount, "clientHeight", {
			value: height,
			configurable: true,
		});
	}

	/**
	 * Run frames until nothing is dirty. The adapter's give-up path defers the
	 * rest of a settle to the next `requestAnimationFrame`; driving the queue by
	 * hand makes "how many frames did that take" an observable, and a scene that
	 * never settles show up as the cap rather than as a hang.
	 */
	function settle(maxFrames = 20): number {
		let frames = 0;
		while (getDirtyCount() > 0 && frames < maxFrames) {
			flushDirtyNow();
			frames += 1;
		}
		return frames;
	}

	/** Push a fresh flush through the world, the way a resize does. */
	function reflow(world: MountedWorld): number {
		markDirty(world.world.rootInstance as LoomInstance);
		return settle();
	}

	function measure(name: string) {
		const el = mount.querySelector(
			`[data-loom-name="${name}"]`,
		) as HTMLElement | null;
		if (!el) throw new Error(`no element painted for ${name}`);
		return {
			width: Number.parseFloat(el.style.width),
			height: Number.parseFloat(el.style.height),
		};
	}

	/** One settled reading of the label under test. */
	function readLabel(labelName: string, text: string) {
		const box = measure(labelName);
		return {
			labelWidth: box.width,
			labelHeight: box.height,
			painted: wrapLines(text, box.width),
			encoded: linesFromHeight(box.height, BODY_SIZE, BODY_LINE_HEIGHT),
		};
	}

	/**
	 * A settled sweep: mount `tree`, then walk the stage a width at a time,
	 * settling each one, and report every width where the label's box disagrees
	 * with the wrap its own laid-out width produces.
	 */
	function sweep(
		tree: ReactElement,
		labelName: string,
		text: string,
		widths: readonly number[],
	): Array<Record<string, number>> {
		setStage(widths[0] as number);
		root = mountSync(tree, mount, { computeLayout: realLayout });
		settle();
		const mismatches: Array<Record<string, number>> = [];
		for (const width of widths) {
			setStage(width);
			const frames = reflow(root);
			const r = readLabel(labelName, text);
			if (Math.abs(r.encoded - r.painted) > 0.01 || getDirtyCount() > 0) {
				mismatches.push({
					stage: width,
					labelWidth: r.labelWidth,
					labelHeight: r.labelHeight,
					painted: r.painted,
					encoded: Math.round(r.encoded * 100) / 100,
					frames,
					stillDirty: getDirtyCount(),
				});
			}
		}
		return mismatches;
	}

	/**
	 * The same sweep read for *path independence*: a stage width has one right
	 * layout, and which widths it was dragged through on the way there cannot
	 * change it.
	 */
	function sweepBothWays(
		tree: ReactElement,
		labelName: string,
		text: string,
		widths: readonly number[],
	): Array<Record<string, number>> {
		setStage(widths[0] as number);
		root = mountSync(tree, mount, { computeLayout: realLayout });
		settle();
		const down = new Map<number, ReturnType<typeof readLabel>>();
		for (const width of widths) {
			setStage(width);
			reflow(root);
			down.set(width, readLabel(labelName, text));
		}
		const drifted: Array<Record<string, number>> = [];
		for (const width of [...widths].reverse()) {
			setStage(width);
			reflow(root);
			const back = readLabel(labelName, text);
			const first = down.get(width);
			if (!first) continue;
			if (
				Math.abs(back.labelWidth - first.labelWidth) > 0.01 ||
				Math.abs(back.labelHeight - first.labelHeight) > 0.01
			) {
				drifted.push({
					stage: width,
					widthNarrowing: first.labelWidth,
					widthWidening: back.labelWidth,
					linesNarrowing: first.painted,
					linesWidening: back.painted,
				});
			}
		}
		return drifted;
	}

	const range = (from: number, to: number, step = 10): number[] => {
		const out: number[] = [];
		for (let w = from; w >= to; w -= step) out.push(w);
		return out;
	};

	it("settles the reported card scene at every width", () => {
		// Desktop window down to a phone: the reported failure is
		// width-dependent, so a coarse sweep could step straight over it. Five
		// cards, a hundred stage widths and a real layout per width is a second
		// or two on its own and several under a loaded machine — hence the
		// explicit budget, which is about the box this runs in, not the work.
		expect(sweep(cards(5), "BodyText0", BODY, range(1200, 200, 10))).toEqual(
			[],
		);
	}, 60_000);

	it("lays the card scene out the same whichever way the stage was dragged", () => {
		// Narrow to 200 and back out to 1200. A width has one right layout;
		// which widths it was dragged through cannot change it. Consistency
		// alone does not catch a wrap that never comes back out — the box
		// freezes with it, so the label stays internally agreed and simply
		// stops using the room it has.
		expect(
			sweepBothWays(cards(5), "BodyText0", BODY, range(1200, 200, 10)),
		).toEqual([]);
	}, 60_000);

	it("measures and wraps a label sized by a plain-string AutomaticSize", () => {
		// The engine takes the bare string wherever it takes the item, and
		// `@loom-dev/scene` has always encoded either — so the layout auto-sized
		// the label while the adapter, which insisted on an `EnumItem`, measured
		// no `TextBounds` for it at all and never re-measured it. The wrap width
		// then resolved against an ancestor this label had sized, which is the
		// circle that leaves text wrapped at whatever width it first got.
		const tree = inBox(
			createElement(
				"frame",
				{
					Name: "StringAuto",
					Size: UDim2.fromScale(0, 0),
					AutomaticSize: "XY",
				},
				createElement("textlabel", {
					Name: "Body",
					Size: UDim2.fromScale(0, 0),
					AutomaticSize: "XY",
					Text: BODY,
					TextSize: BODY_SIZE,
					LineHeight: BODY_LINE_HEIGHT,
					TextWrapped: true,
				}),
			),
		);
		// Both oracles: without the measurement the label collapses to the same
		// nothing at every width, which is path-independent and still wrong.
		expect(sweep(tree, "Body", BODY, range(600, 200))).toEqual([]);
		expect(sweepBothWays(tree, "Body", BODY, range(600, 200))).toEqual([]);
	});

	/**
	 * The shapes where the wrap width and the painted width could come apart.
	 * `wrapWidth` measures against the nearest ancestor that has a width of its
	 * own, less the padding in between — it reads no siblings, no constraints and
	 * no scale insets, so anything else that takes room off the label leaves it
	 * painted narrower than it was measured, which is more lines than its box was
	 * built for.
	 */
	function inBox(
		child: ReactElement,
		extras: ReactElement[] = [],
		boxWidth = 300,
	): ReactElement {
		return createElement(
			"screengui",
			{ Name: "Gui" },
			createElement(
				"frame",
				{ Name: "Fixed", Size: UDim2.new(0, boxWidth, 0, 400) },
				...extras,
				child,
			),
		);
	}

	const wrapped = (name: string) =>
		createElement(
			"frame",
			{
				Name: `${name}Box`,
				Size: UDim2.fromScale(0, 0),
				AutomaticSize: Enum.AutomaticSize.XY,
			},
			label(name, BODY, BODY_SIZE, BODY_LINE_HEIGHT),
		);

	it("settles a label sharing a horizontal row with a sibling", () => {
		const tree = inBox(wrapped("Body"), [
			createElement("uilistlayout", {
				FillDirection: Enum.FillDirection.Horizontal,
			}),
			createElement("frame", {
				Name: "Spacer",
				LayoutOrder: -1,
				Size: UDim2.new(0, 120, 0, 20),
			}),
		]);
		expect(sweep(tree, "Body", BODY, range(600, 200))).toEqual([]);
	});

	it("settles a label under a scale UIPadding", () => {
		// `horizontalPadding` reads offsets only; a scale inset takes room the
		// wrap width never hears about.
		const tree = inBox(
			createElement(
				"frame",
				{
					Name: "Padded",
					Size: UDim2.fromScale(1, 0),
					AutomaticSize: Enum.AutomaticSize.Y,
				},
				createElement("uipadding", {
					PaddingLeft: new UDim(0.15, 0),
					PaddingRight: new UDim(0.15, 0),
				}),
				label("Body", BODY, BODY_SIZE, BODY_LINE_HEIGHT),
			),
		);
		expect(sweep(tree, "Body", BODY, range(600, 200))).toEqual([]);
	});

	it("settles a label capped by a UISizeConstraint", () => {
		const tree = inBox(
			createElement(
				"frame",
				{
					Name: "Holder",
					Size: UDim2.fromScale(0, 0),
					AutomaticSize: Enum.AutomaticSize.XY,
				},
				createElement("uisizeconstraint", {
					MaxSize: new Vector2(140, 10_000),
				}),
				label("Body", BODY, BODY_SIZE, BODY_LINE_HEIGHT),
			),
		);
		expect(sweep(tree, "Body", BODY, range(600, 200))).toEqual([]);
	});

	it("settles a label inside a shrinking flex item", () => {
		// `UIFlexMode.Shrink` is the one modifier that takes an item *below* its
		// natural width, which is the other way a label can be painted narrower
		// than it was measured.
		const tree = inBox(
			createElement(
				"frame",
				{
					Name: "Shrinker",
					Size: UDim2.fromScale(0, 0),
					AutomaticSize: Enum.AutomaticSize.XY,
				},
				createElement("uiflexitem", { FlexMode: Enum.UIFlexMode.Shrink }),
				label("Body", BODY, BODY_SIZE, BODY_LINE_HEIGHT),
			),
			[
				createElement("uilistlayout", {
					FillDirection: Enum.FillDirection.Horizontal,
				}),
				createElement("frame", {
					key: "sibling",
					Name: "Sibling",
					LayoutOrder: 1,
					Size: UDim2.new(0, 100, 0, 20),
				}),
			],
		);
		expect(sweep(tree, "Body", BODY, range(600, 200))).toEqual([]);
	});

	it("lands where a face present from the start would, arriving late", async () => {
		// #11's shape: the first measurement runs against whatever the browser has
		// *now*, and a registered face is almost never loaded by then — nothing has
		// asked for it, and the canvas loom measures with never will. So the first
		// layout is the fallback's, and the face that lands afterwards has to be
		// able to redo it. This pins the outcome rather than the mechanism: a dev
		// server, where the face arrives well after the document settled, has to
		// end up at the layout a static build reaches on its first frame.
		const tree = cards(5);

		/**
		 * Change the face the stub reports and announce it, which is the whole
		 * mechanism under test: a registration drops the renderer's per-font
		 * advance caches and re-measures every auto-sized label. Without the
		 * announcement the caches still hold the previous face's advances, keyed
		 * on a `ctx.font` that did not change.
		 */
		const setFace = async (advance: number, family: string) => {
			faceAdvance = advance;
			registerFont("Gotham", { family });
			await new Promise((resolve) => setTimeout(resolve, 0));
		};

		// The build's world: the real face from the first frame.
		await setFace(CHAR_W, "Builder Sans");
		setStage(760);
		root = mountSync(tree, mount, { computeLayout: realLayout });
		settle();
		const withFaceFromTheStart = measure("BodyText0");

		// The dev server's world: measured in a fallback narrow enough that the
		// body fits on one line in it and needs two in the real face — a
		// difference the label's own height records.
		root.unmount();
		document.body.innerHTML = "";
		mount = document.createElement("div");
		document.body.appendChild(mount);
		await setFace(CHAR_W - 3, "Fallback Sans");
		setStage(760);
		root = mountSync(tree, mount, { computeLayout: realLayout });
		settle();
		const inTheFallback = measure("BodyText0");

		// …and then the face lands and reports itself.
		await setFace(CHAR_W, "Builder Sans");
		settle();
		const afterTheFaceLoaded = measure("BodyText0");

		// The fallback really was a different face, or the rest proves nothing.
		expect(inTheFallback.height).not.toBe(withFaceFromTheStart.height);
		expect(afterTheFaceLoaded).toEqual(withFaceFromTheStart);
		// And the settled box still matches the wrap its own width produces.
		expect(
			linesFromHeight(afterTheFaceLoaded.height, BODY_SIZE, BODY_LINE_HEIGHT),
		).toBeCloseTo(wrapLines(BODY, afterTheFaceLoaded.width, CHAR_W), 2);
	}, 30_000);
});
