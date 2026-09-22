/**
 * World pipeline: React commits mutate LoomInstances and flush through
 * encode → (stubbed) layout → DOM session; element identity survives commits;
 * direct property writes flush without React; layout feedback fires the
 * Absolute* signals exactly once per actual change; `Event` handlers receive
 * Roblox `(rbx, ...args)` calling convention from delegated pointer input.
 */
import { clearRegisteredFonts, registerFont } from "@loom-dev/renderer";
import type { InputObject, LoomInstance } from "@loom-dev/runtime";
import { Color3, Enum, flushDirtyNow, UDim, UDim2 } from "@loom-dev/runtime";
import type { LayoutResult, SceneNode, Viewport } from "@loom-dev/scene";
import { createElement, type ReactElement, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type ComputeLayout, type MountedWorld, mountSync } from "./index";

/** Stub layout: every node gets x=0, y=0 and the (mutable) shared size. */
function makeStubLayout(size: {
	width: number;
	height: number;
}): ComputeLayout {
	return (root: SceneNode, _viewport: Viewport): LayoutResult => {
		const rects: LayoutResult["rects"] = {};
		const walk = (node: SceneNode): void => {
			rects[node.id ?? "?"] = {
				rect: { x: 0, y: 0, width: size.width, height: size.height },
			};
			for (const child of node.children ?? []) walk(child);
		};
		walk(root);
		return { rects };
	};
}

function makeMount(): HTMLElement {
	const mount = document.createElement("div");
	// happy-dom reports 0 for client sizes; the world skips zero-sized mounts.
	Object.defineProperty(mount, "clientWidth", { value: 800 });
	Object.defineProperty(mount, "clientHeight", { value: 600 });
	document.body.appendChild(mount);
	return mount;
}

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

const PointerEventCtor: typeof MouseEvent =
	(globalThis as { PointerEvent?: typeof MouseEvent }).PointerEvent ??
	MouseEvent;

describe("mountSync world", () => {
	let mount: HTMLElement;
	let roots: MountedWorld[];

	beforeEach(() => {
		document.body.innerHTML = "";
		mount = makeMount();
		roots = [];
	});
	afterEach(() => {
		for (const root of roots) root.unmount();
	});

	function mountWith(
		element: ReactElement,
		size = { width: 100, height: 50 },
	): MountedWorld {
		const root = mountSync(element, mount, {
			computeLayout: makeStubLayout(size),
		});
		roots.push(root);
		return root;
	}

	it("renders a tree into session DOM", () => {
		mountWith(
			createElement(
				"screengui",
				{ Name: "Gui" },
				createElement(
					"frame",
					{ Name: "Card", BackgroundColor3: Color3.fromRGB(255, 0, 0) },
					createElement("textlabel", { Name: "Label", Text: "hi" }),
				),
			),
		);
		const card = mount.querySelector('[data-loom-name="Card"]') as HTMLElement;
		expect(card).not.toBeNull();
		expect(card.style.width).toBe("100px");
		expect(card.getAttribute("style")).toContain("255, 0, 0");
		const label = mount.querySelector('[data-loom-name="Label"]');
		expect(label?.textContent).toBe("hi");
	});

	it("names an instance after its key, as React-Lua does", () => {
		function Panel(): ReactElement {
			// No key of its own: the nearest keyed ancestor's key names it.
			return createElement("frame", {});
		}
		const root = mountWith(
			createElement(
				"frame",
				{ key: "Card" },
				createElement("textlabel", { key: "Title", Text: "hi" }),
				createElement(Panel, { key: "Body" }),
				createElement("frame", { key: "Ignored", Name: "Explicit" }),
			),
		);
		const card = root.world.defaultGui.FindFirstChild("Card") as LoomInstance;
		expect(card).toBeDefined();
		expect(card.FindFirstChild("Title")?.ClassName).toBe("TextLabel");
		expect(card.FindFirstChild("Body")?.ClassName).toBe("Frame");
		// An explicit `Name` prop still wins over the key.
		expect(card.FindFirstChild("Explicit")).toBeDefined();
		expect(card.FindFirstChild("Ignored")).toBeUndefined();
	});

	it("holds the first layout until a web face the text needs has loaded", async () => {
		let loaded = false;
		let finish: () => void = () => {};
		const done = new Promise<void>((resolve) => {
			finish = () => {
				loaded = true;
				resolve();
			};
		});
		const original = Object.getOwnPropertyDescriptor(document, "fonts");
		Object.defineProperty(document, "fonts", {
			configurable: true,
			value: {
				addEventListener: () => {},
				check: () => loaded,
				load: () => done,
			},
		});
		// A registration resets the renderer's record of which faces are ready.
		clearRegisteredFonts();
		await Promise.resolve();
		try {
			const sizes: unknown[] = [];
			const root = mountWith(
				createElement("textlabel", {
					Name: "Late",
					Text: "held",
					AutomaticSize: Enum.AutomaticSize.XY,
				}),
			);
			const label = root.world.defaultGui.FindFirstChild(
				"Late",
			) as LoomInstance;
			label
				.GetPropertyChangedSignal("AbsoluteSize")
				.Connect(() => sizes.push(label.AbsoluteSize));
			// Measured against the fallback: nothing laid out, nothing read back.
			expect(mount.querySelector('[data-loom-name="Late"]')).toBeNull();
			expect(sizes).toEqual([]);
			finish();
			await new Promise((resolve) => setTimeout(resolve, 0));
			flushDirtyNow();
			expect(mount.querySelector('[data-loom-name="Late"]')).not.toBeNull();
			expect(sizes.length).toBe(1);
		} finally {
			if (original) Object.defineProperty(document, "fonts", original);
			else delete (document as { fonts?: unknown }).fonts;
		}
	});

	it("maps modifier intrinsics the fallback casing would mangle", () => {
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		const root = mountWith(
			createElement(
				"frame",
				{ Name: "Card" },
				createElement("uipagelayout", { Name: "Pager" }),
				createElement("uitablelayout", { Name: "Table" }),
				createElement("uitextsizeconstraint", { Name: "TextSize" }),
			),
		);
		const card = root.world.defaultGui.FindFirstChild("Card") as LoomInstance;
		const classOf = (name: string): string =>
			(card.FindFirstChild(name) as LoomInstance).ClassName;
		expect(classOf("Pager")).toBe("UIPageLayout");
		expect(classOf("Table")).toBe("UITableLayout");
		expect(classOf("TextSize")).toBe("UITextSizeConstraint");
		// Named properly they are non-layout modifiers: nothing painted, and no
		// unknown-class warning out of the registry.
		expect(mount.querySelector('[data-loom-name="Pager"]')).toBeNull();
		expect(mount.querySelector('[data-loom-name="Table"]')).toBeNull();
		expect(mount.querySelector('[data-loom-name="TextSize"]')).toBeNull();
		expect(warnSpy).not.toHaveBeenCalled();
		warnSpy.mockRestore();
	});

	it("preserves element identity across setState commits", () => {
		let setColor: ((c: unknown) => void) | undefined;
		function App(): ReactElement {
			const [color, set] = useState<unknown>(Color3.fromRGB(255, 0, 0));
			setColor = set;
			return createElement(
				"screengui",
				{ Name: "Gui" },
				createElement("frame", { Name: "Box", BackgroundColor3: color }),
			);
		}
		mountWith(createElement(App));
		const el = mount.querySelector('[data-loom-name="Box"]') as HTMLElement;
		expect(el.getAttribute("style")).toContain("255, 0, 0");

		setColor?.(Color3.fromRGB(0, 255, 0));

		const after = mount.querySelector('[data-loom-name="Box"]') as HTMLElement;
		expect(after).toBe(el); // patched in place — listeners/focus survive
		expect(after.getAttribute("style")).toContain("0, 255, 0");
	});

	it("flushes direct ref writes without a React commit", () => {
		let renders = 0;
		let instance: LoomInstance | undefined;
		function App(): ReactElement {
			renders += 1;
			return createElement(
				"screengui",
				{ Name: "Gui" },
				createElement("frame", {
					Name: "Motion",
					ref: (inst: LoomInstance | null) => {
						if (inst) instance = inst;
					},
				}),
			);
		}
		mountWith(createElement(App));
		const el = mount.querySelector('[data-loom-name="Motion"]') as HTMLElement;
		const rendersAfterMount = renders;

		expect(instance).toBeDefined();
		const inst = instance as LoomInstance;
		inst.BackgroundColor3 = Color3.fromRGB(9, 8, 7);
		inst.Position = UDim2.fromOffset(3, 4);
		flushDirtyNow();

		expect(renders).toBe(rendersAfterMount); // no React commit happened
		expect(el.getAttribute("style")).toContain("9, 8, 7");
	});

	it("fires the AbsoluteSize signal exactly once per actual change", () => {
		const size = { width: 100, height: 50 };
		let instance: LoomInstance | undefined;
		mountWith(
			createElement("frame", {
				Name: "Tracked",
				ref: (inst: LoomInstance | null) => {
					if (inst) instance = inst;
				},
			}),
			size,
		);
		expect(instance).toBeDefined();
		const inst = instance as LoomInstance;

		let fires = 0;
		inst.GetPropertyChangedSignal("AbsoluteSize").Connect(() => {
			fires += 1;
		});

		// Unchanged geometry: a re-flush must not re-fire the signal.
		inst.ZIndex = 2;
		flushDirtyNow();
		expect(fires).toBe(0);

		// Grow the stubbed layout: exactly one fire.
		size.width = 150;
		inst.ZIndex = 3;
		flushDirtyNow();
		expect(fires).toBe(1);
		expect((inst.AbsoluteSize as { X: number }).X).toBe(150);

		// And stable again afterwards.
		inst.ZIndex = 4;
		flushDirtyNow();
		expect(fires).toBe(1);
	});

	it("delivers Event handlers with (rbx, ...args) from pointer input", () => {
		const calls: unknown[][] = [];
		let instance: LoomInstance | undefined;
		mountWith(
			createElement("textbutton", {
				Name: "Button",
				ref: (inst: LoomInstance | null) => {
					if (inst) instance = inst;
				},
				Event: {
					Activated: (...args: unknown[]) => calls.push(["Activated", ...args]),
					InputBegan: (...args: unknown[]) =>
						calls.push(["InputBegan", ...args]),
				},
			}),
		);
		const el = mount.querySelector('[data-loom-name="Button"]') as Element;
		el.dispatchEvent(
			new PointerEventCtor("pointerdown", {
				bubbles: true,
				clientX: 10,
				clientY: 20,
			}),
		);
		el.dispatchEvent(
			new PointerEventCtor("pointerup", {
				bubbles: true,
				clientX: 10,
				clientY: 20,
			}),
		);

		expect(calls.map((c) => c[0])).toEqual(["InputBegan", "Activated"]);
		const began = calls[0] as unknown[];
		expect(began[1]).toBe(instance); // rbx first
		expect((began[2] as InputObject).UserInputType).toBe(
			Enum.UserInputType.MouseButton1,
		);
		const activated = calls[1] as unknown[];
		expect(activated[1]).toBe(instance);
		expect((activated[2] as InputObject).Position.Y).toBe(20);
		expect(activated[3]).toBe(1); // clickCount
	});

	/** Layout stub keyed by node name (hit-testing needs distinct rects). */
	function makeNamedLayout(
		rects: Record<
			string,
			{ x: number; y: number; width: number; height: number }
		>,
	): ComputeLayout {
		return (root: SceneNode): LayoutResult => {
			const out: LayoutResult["rects"] = {};
			const walk = (node: SceneNode): void => {
				out[node.id ?? "?"] = {
					rect: rects[node.name] ?? { x: 0, y: 0, width: 800, height: 600 },
				};
				for (const child of node.children ?? []) walk(child);
			};
			walk(root);
			return { rects: out };
		};
	}

	it("hit-tests GetGuiObjectsAtPosition topmost-first (ZIndex, then depth)", () => {
		const root = mountSync(
			createElement(
				"screengui",
				{ Name: "Gui" },
				createElement("frame", { Name: "Low", ZIndex: 1 }),
				createElement(
					"frame",
					{ Name: "High", ZIndex: 3 },
					createElement("frame", { Name: "Child", ZIndex: 3 }),
				),
				createElement("frame", { Name: "Hidden", Visible: false, ZIndex: 9 }),
			),
			mount,
			{
				computeLayout: makeNamedLayout({
					Gui: { x: 0, y: 0, width: 800, height: 600 },
					Low: { x: 0, y: 0, width: 100, height: 100 },
					High: { x: 50, y: 0, width: 100, height: 100 },
					Child: { x: 60, y: 0, width: 20, height: 20 },
					Hidden: { x: 0, y: 0, width: 200, height: 200 },
				}),
			},
		);
		roots.push(root);

		// The world root is PlayerGui-classed: the service method resolves on it.
		const playerGui = root.world.rootInstance;
		const atPosition = playerGui.GetGuiObjectsAtPosition as (
			x: number,
			y: number,
		) => LoomInstance[];

		// Overlap of all three (65, 5): equal ZIndex breaks by depth (Child on
		// top of High), Hidden excluded (Visible false), ScreenGui excluded
		// (not a GuiObject).
		expect(atPosition(65, 5).map((inst) => inst.Name)).toEqual([
			"Child",
			"High",
			"Low",
		]);
		// Only Low contains (10, 60).
		expect(atPosition(10, 60).map((inst) => inst.Name)).toEqual(["Low"]);
		// Outside everything.
		expect(atPosition(700, 500)).toEqual([]);
	});

	it("feeds ScrollingFrame metrics back after flush, change-gated", () => {
		const rects: Record<
			string,
			{ x: number; y: number; width: number; height: number }
		> = {
			Gui: { x: 0, y: 0, width: 800, height: 600 },
			Scroll: { x: 10, y: 10, width: 100, height: 100 },
			// Laid-out child extends 300px below the frame's origin.
			Content: { x: 10, y: 10, width: 100, height: 300 },
		};
		let instance: LoomInstance | undefined;
		const root = mountSync(
			createElement(
				"screengui",
				{ Name: "Gui" },
				createElement(
					"scrollingframe",
					{
						Name: "Scroll",
						AutomaticCanvasSize: Enum.AutomaticSize.XY,
						CanvasSize: UDim2.fromScale(0, 0),
						ref: (inst: LoomInstance | null) => {
							if (inst) instance = inst;
						},
					},
					createElement("frame", { Name: "Content" }),
				),
			),
			mount,
			{ computeLayout: makeNamedLayout(rects) },
		);
		roots.push(root);
		expect(instance).toBeDefined();
		const inst = instance as LoomInstance;

		// CanvasPosition reads as a real Vector2 before any write (lattice's
		// viewport effect dereferences `.Y` immediately on mount).
		expect((inst.CanvasPosition as { X: number; Y: number }).X).toBe(0);
		expect((inst.CanvasPosition as { X: number; Y: number }).Y).toBe(0);
		// Window = the frame's own rect; canvas = children bounding box (the
		// resolved CanvasSize is zero and AutomaticCanvasSize is XY).
		expect((inst.AbsoluteWindowSize as { X: number }).X).toBe(100);
		expect((inst.AbsoluteWindowSize as { Y: number }).Y).toBe(100);
		expect((inst.AbsoluteCanvasSize as { X: number }).X).toBe(100);
		expect((inst.AbsoluteCanvasSize as { Y: number }).Y).toBe(300);

		let fires = 0;
		inst.GetPropertyChangedSignal("AbsoluteCanvasSize").Connect(() => {
			fires += 1;
		});

		// Unchanged metrics: a re-flush must not re-fire the signal.
		inst.ZIndex = 2;
		flushDirtyNow();
		expect(fires).toBe(0);

		// Content grows: exactly one fire with the new extent.
		rects.Content = { x: 10, y: 10, width: 100, height: 400 };
		inst.ZIndex = 3;
		flushDirtyNow();
		expect(fires).toBe(1);
		expect((inst.AbsoluteCanvasSize as { Y: number }).Y).toBe(400);

		// And stable again afterwards.
		inst.ZIndex = 4;
		flushDirtyNow();
		expect(fires).toBe(1);
	});

	it("feeds UIListLayout AbsoluteContentSize back after flush", () => {
		// A dropdown that sizes itself from `Change={{ AbsoluteContentSize }}`
		// collapses to zero height without this — and everything inside it is
		// clipped away, click targets included.
		const rects: Record<
			string,
			{ x: number; y: number; width: number; height: number }
		> = {
			Gui: { x: 0, y: 0, width: 800, height: 600 },
			List: { x: 0, y: 0, width: 200, height: 600 },
			A: { x: 0, y: 0, width: 120, height: 40 },
			B: { x: 0, y: 50, width: 160, height: 40 },
			Hidden: { x: 0, y: 500, width: 999, height: 999 },
		};
		let layoutInst: LoomInstance | undefined;
		const seen: Array<{ X: number; Y: number }> = [];
		const root = mountSync(
			createElement(
				"screengui",
				{ Name: "Gui" },
				createElement(
					"frame",
					{ Name: "List" },
					createElement("uilistlayout", {
						Name: "Flow",
						ref: (inst: LoomInstance | null) => {
							if (inst) layoutInst = inst;
						},
						Change: {
							AbsoluteContentSize: (inst: LoomInstance) => {
								seen.push(inst.AbsoluteContentSize as { X: number; Y: number });
							},
						},
					}),
					createElement("frame", { Name: "A" }),
					createElement("frame", { Name: "B" }),
					// Roblox's list ignores hidden siblings, so this must not stretch
					// the reported content either.
					createElement("frame", { Name: "Hidden", Visible: false }),
				),
			),
			mount,
			{ computeLayout: makeNamedLayout(rects) },
		);
		roots.push(root);
		const inst = layoutInst as LoomInstance;
		expect(inst).toBeDefined();

		// Union of A and B: widest is 160, and they span y 0..90.
		expect((inst.AbsoluteContentSize as { X: number }).X).toBe(160);
		expect((inst.AbsoluteContentSize as { Y: number }).Y).toBe(90);
		expect(seen).toHaveLength(1);

		// Change-gated like the scroll metrics: a re-flush with the same content
		// must not re-fire.
		inst.ZIndex = 2;
		flushDirtyNow();
		expect(seen).toHaveLength(1);

		rects.B = { x: 0, y: 50, width: 160, height: 90 };
		inst.ZIndex = 3;
		flushDirtyNow();
		expect(seen).toHaveLength(2);
		expect((inst.AbsoluteContentSize as { Y: number }).Y).toBe(140);
	});

	it("measures an empty TextBox against its placeholder", () => {
		// The renderer puts `PlaceholderText` on the real <input>, so it is what
		// an empty box displays. Measuring "" instead collapsed an
		// `AutomaticSize.Y` field to zero height: invisible and unclickable.
		const measured: Array<{ x: number; y: number } | undefined> = [];
		const computeLayout: ComputeLayout = (node, viewport) => {
			const rects: LayoutResult["rects"] = {};
			const walk = (n: SceneNode): void => {
				if (n.className === "TextBox") {
					const bounds = n.properties?.TextBounds;
					measured.push(
						bounds && bounds.type === "Vector2"
							? (bounds.value as { x: number; y: number })
							: undefined,
					);
				}
				rects[n.id ?? "?"] = {
					rect: { x: 0, y: 0, width: viewport.width, height: viewport.height },
				};
				for (const child of n.children ?? []) walk(child);
			};
			walk(node);
			return { rects };
		};
		roots.push(
			mountSync(
				createElement(
					"screengui",
					null,
					createElement("textbox", {
						Text: "",
						PlaceholderText: "John Doe",
						AutomaticSize: Enum.AutomaticSize.Y,
						TextSize: 20,
					}),
				),
				mount,
				{ computeLayout },
			),
		);
		const bounds = measured.at(-1);
		expect(bounds).toBeDefined();
		// One line tall, and wide enough for the placeholder rather than zero.
		expect(bounds?.y).toBe(20);
		expect(bounds?.x).toBe("John Doe".length * 6.5);
	});

	it("makes a listening Frame hit-testable, Active or not", () => {
		// Roblox raises a GuiObject's own input events whether or not it is
		// `Active` — `Active` governs whether the input is *sunk*. A slider handle
		// is a plain Frame with an `InputBegan` handler and no `Active`, so it has
		// to be reachable by the pointer; a decorative Frame must stay
		// click-through, or a transparent positioning layer swallows the clicks
		// meant for what is underneath it.
		const began: string[] = [];
		roots.push(
			mountSync(
				createElement(
					"screengui",
					{ Name: "Gui" },
					createElement("frame", {
						Name: "Handle",
						Event: {
							InputBegan: (inst: LoomInstance) => {
								began.push(String(inst.Name));
							},
						},
					}),
					createElement("frame", { Name: "Decoration" }),
				),
				mount,
				{ computeLayout: makeStubLayout({ width: 100, height: 100 }) },
			),
		);
		const pointerEvents = (name: string): string => {
			const el = mount.querySelector<HTMLElement>(`[data-loom-name="${name}"]`);
			if (!el) throw new Error(`${name} not rendered`);
			return el.style.pointerEvents;
		};
		expect(pointerEvents("Handle")).toBe("auto");
		expect(pointerEvents("Decoration")).toBe("none");

		// And it really does receive the input, not merely the style.
		const handle = mount.querySelector<HTMLElement>(
			'[data-loom-name="Handle"]',
		);
		handle?.dispatchEvent(
			new PointerEventCtor("pointerdown", {
				bubbles: true,
				clientX: 5,
				clientY: 5,
			}),
		);
		expect(began).toEqual(["Handle"]);
	});

	it("wraps TextWrapped text at the parent's width when X is automatic", () => {
		// The library idiom is `Size={fromScale(0,0)} AutomaticSize={XY}` on every
		// label, so the wrap constraint cannot be the label's own width: starting
		// from zero it would settle at one word per line. The parent's width leaves
		// a short label hugging its text and wraps a long one at the container.
		const measured: Array<{ x: number; y: number }> = [];
		// Every node lands in a 100px-wide box, so the label's parent is 100 wide.
		const computeLayout: ComputeLayout = (node) => {
			const rects: LayoutResult["rects"] = {};
			const walk = (n: SceneNode): void => {
				if (n.className === "TextLabel") {
					const bounds = n.properties?.TextBounds;
					if (bounds && bounds.type === "Vector2") {
						measured.push(bounds.value as { x: number; y: number });
					}
				}
				rects[n.id ?? "?"] = { rect: { x: 0, y: 0, width: 100, height: 100 } };
				for (const child of n.children ?? []) walk(child);
			};
			walk(node);
			return { rects };
		};
		// The stub lays every node out at 100x100, so the parent is 100 wide and
		// the measure stub gives each character 7px: 5 words of 4 chars wrap to
		// roughly one word per line at 100px.
		roots.push(
			mountSync(
				createElement(
					"screengui",
					null,
					createElement(
						"frame",
						{ Name: "Parent" },
						createElement("textlabel", {
							Name: "Wrapped",
							Text: "aaaa bbbb cccc dddd",
							// The deprecated alias, which is what the library sets.
							TextWrap: true,
							AutomaticSize: Enum.AutomaticSize.XY,
							TextSize: 10,
						}),
					),
				),
				mount,
				{ computeLayout },
			),
		);
		// Wrapped text needs the layout that sizes its container, so the first
		// measurement is unwrapped and the flush re-marks it; the second settles.
		flushDirtyNow();
		flushDirtyNow();
		const last = measured.at(-1);
		expect(last).toBeDefined();
		// Wrapped: never wider than the 100px parent, and several lines tall.
		expect(last?.x).toBeLessThanOrEqual(100);
		expect(last?.y).toBeGreaterThan(10);
	});

	it("keeps the renderer's half-pixel text width", () => {
		let width = 0;
		roots.push(
			mountSync(
				createElement(
					"screenGui",
					null,
					createElement("textlabel", {
						Text: "~",
						AutomaticSize: Enum.AutomaticSize.XY,
						TextSize: 10,
					}),
				),
				mount,
				{
					computeLayout(node) {
						const label = node.children?.[0];
						const bounds = label?.properties?.TextBounds;
						if (bounds?.type === "Vector2") {
							width = (bounds.value as { x: number }).x;
						}
						return makeStubLayout({ width: 100, height: 100 })(node, {
							width: 100,
							height: 100,
						});
					},
				},
			),
		);

		expect(width).toBe(6.5);
	});

	it("wraps at the nearest ancestor that has a width, past auto-sized ones", () => {
		// The library idiom nests auto-sized containers — a padded body inside a
		// card — and the body's own width comes *from* this label, so wrapping
		// against it is the same circle as wrapping against the label itself and
		// the text never wraps. The card is the one node with room to run out of.
		const measured: Array<{ x: number; y: number }> = [];
		const computeLayout: ComputeLayout = (node) => {
			const rects: LayoutResult["rects"] = {};
			const walk = (n: SceneNode): void => {
				if (n.className === "TextLabel") {
					const bounds = n.properties?.TextBounds;
					if (bounds && bounds.type === "Vector2") {
						measured.push(bounds.value as { x: number; y: number });
					}
				}
				// The card has a width of its own; everything inside it hugged the
				// unwrapped text and came out far wider.
				rects[n.id ?? "?"] = {
					rect: {
						x: 0,
						y: 0,
						width: n.name === "Card" ? 100 : 500,
						height: 100,
					},
				};
				for (const child of n.children ?? []) walk(child);
			};
			walk(node);
			return { rects };
		};
		roots.push(
			mountSync(
				createElement(
					"screengui",
					null,
					createElement(
						"frame",
						{ Name: "Card" },
						createElement(
							"frame",
							{ Name: "Body", AutomaticSize: Enum.AutomaticSize.XY },
							createElement("uipadding", {
								PaddingLeft: new UDim(0, 10),
								PaddingRight: new UDim(0, 10),
							}),
							createElement("textlabel", {
								Name: "Wrapped",
								Text: "aaaa bbbb cccc dddd",
								TextWrapped: true,
								AutomaticSize: Enum.AutomaticSize.XY,
								TextSize: 10,
							}),
						),
					),
				),
				mount,
				{ computeLayout },
			),
		);
		flushDirtyNow();
		flushDirtyNow();
		const last = measured.at(-1);
		expect(last).toBeDefined();
		// The card's 100, less the body's 10 + 10 of padding — not the body's own
		// 500, and not the 133 the string measures on one line.
		expect(last?.x).toBeLessThanOrEqual(80);
		expect(last?.y).toBeGreaterThan(10);
	});

	it("settles a re-wrap inside one flush, never painting the unwrapped pass", () => {
		// The wrap width comes from the layout this same flush produces, so the
		// first encode after the container narrows still measures against the old,
		// wider one. Deferring the re-measure to the next frame put that unwrapped
		// label into the DOM for a frame — and during a live window resize, where
		// every frame narrows the container again, the stale pass is what stays on
		// screen: body text running past its card and under the next one.
		const card = { width: 300 };
		const computeLayout: ComputeLayout = (node) => {
			const rects: LayoutResult["rects"] = {};
			const walk = (n: SceneNode): void => {
				const bounds = n.properties?.TextBounds;
				// An auto-sized label is exactly its measured text; everything else
				// is the card, which is what the label has to wrap inside.
				const size =
					bounds && bounds.type === "Vector2"
						? (bounds.value as { x: number; y: number })
						: { x: card.width, y: 100 };
				rects[n.id ?? "?"] = {
					rect: { x: 0, y: 0, width: size.x, height: size.y },
				};
				for (const child of n.children ?? []) walk(child);
			};
			walk(node);
			return { rects };
		};
		const root = mountSync(
			createElement(
				"screengui",
				null,
				createElement(
					"frame",
					{ Name: "Card" },
					createElement(
						"frame",
						{ Name: "Body", AutomaticSize: Enum.AutomaticSize.XY },
						createElement("uipadding", {
							PaddingLeft: new UDim(0, 10),
							PaddingRight: new UDim(0, 10),
						}),
						createElement("textlabel", {
							Name: "Wrapped",
							Text: "aaaa bbbb cccc dddd",
							TextWrapped: true,
							AutomaticSize: Enum.AutomaticSize.XY,
							TextSize: 10,
						}),
					),
				),
			),
			mount,
			{ computeLayout },
		);
		roots.push(root);
		const label = mount.querySelector<HTMLElement>(
			'[data-loom-name="Wrapped"]',
		);
		const painted = (): number => Number.parseFloat(label?.style.width ?? "");
		// 280 of room, so the 123.5 the string measures on one line fits as it is.
		expect(painted()).toBe(123.5);

		// The container narrows — one resize tick, one flush.
		card.width = 100;
		root.world.flushSync();
		// Already wrapped: 80 of room, not the 123.5 of the pass that measured
		// against the width the card had a moment ago.
		expect(painted()).toBeLessThanOrEqual(80);
	});

	it("re-measures text when a font is registered", async () => {
		// Text bounds are measured against the faces the browser has at the time,
		// so a face registered (or finishing its download) after the first paint
		// leaves the whole layout measured in the fallback. The world listens and
		// lays out again with the font it is actually going to paint in.
		const fonts: string[] = [];
		const computeLayout: ComputeLayout = (node) => {
			const rects: LayoutResult["rects"] = {};
			const walk = (n: SceneNode): void => {
				if (n.className === "TextLabel") fonts.push(measureStub.font);
				rects[n.id ?? "?"] = { rect: { x: 0, y: 0, width: 100, height: 100 } };
				for (const child of n.children ?? []) walk(child);
			};
			walk(node);
			return { rects };
		};
		roots.push(
			mountSync(
				createElement(
					"screengui",
					null,
					createElement("textlabel", {
						Text: "hi",
						Font: Enum.Font.SourceSans,
						AutomaticSize: Enum.AutomaticSize.XY,
						TextSize: 10,
					}),
				),
				mount,
				{ computeLayout },
			),
		);
		const beforeCount = fonts.length;
		expect(fonts.at(-1)).toContain("Source Sans");
		expect(fonts.at(-1)).not.toContain("Registered Sans");

		registerFont("SourceSans", { family: "Registered Sans" });
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(fonts.length).toBeGreaterThan(beforeCount);
		// Measured again, in the family that was just installed.
		expect(fonts.at(-1)).toContain("Registered Sans");
		clearRegisteredFonts();
	});

	it("measures LineHeight into the gaps between lines only", () => {
		/** The `TextBounds` height the adapter emitted for `Text` at this spacing. */
		const measure = (text: string, lineHeight?: number): number => {
			let height = 0;
			const computeLayout: ComputeLayout = (node) => {
				const rects: LayoutResult["rects"] = {};
				const walk = (n: SceneNode): void => {
					const bounds = n.properties?.TextBounds;
					if (bounds && bounds.type === "Vector2") {
						height = (bounds.value as { y: number }).y;
					}
					rects[n.id ?? "?"] = {
						rect: { x: 0, y: 0, width: 100, height: 100 },
					};
					for (const child of n.children ?? []) walk(child);
				};
				walk(node);
				return { rects };
			};
			roots.push(
				mountSync(
					createElement(
						"screengui",
						null,
						createElement("textlabel", {
							Text: text,
							LineHeight: lineHeight,
							AutomaticSize: Enum.AutomaticSize.XY,
							TextSize: 10,
						}),
					),
					mount,
					{ computeLayout },
				),
			);
			flushDirtyNow();
			return height;
		};

		// Two lines at 10px: 20 single-spaced, and 10 + 10 * 2 at double.
		expect(measure("aaaa\nbbbb")).toBe(20);
		expect(measure("aaaa\nbbbb", 2)).toBe(30);
		// One line pays nothing for the spacing — there is no gap to stretch.
		expect(measure("aaaa", 2)).toBe(10);
		// Clamped to the 1…3 Studio allows, so a half-height line is not a thing.
		expect(measure("aaaa\nbbbb", 0.5)).toBe(20);
	});
});
