/**
 * Phase 4b: portals + PlayerGui world root + multi-ScreenGui encoding.
 *
 * `createPortal` parents children into the shared runtime PlayerGui (the same
 * instance `Players.LocalPlayer.WaitForChild("PlayerGui")` resolves); the world
 * encodes each LayerCollector child of PlayerGui as a sibling full-viewport
 * subtree; DisplayOrder maps to the layer div's z-index; unmounting the portal
 * removes both the instance and its DOM.
 */
import type { LoomInstance } from "@loom-dev/runtime";
import { createInstance, getService } from "@loom-dev/runtime";
import type { LayoutResult, SceneNode, Viewport } from "@loom-dev/scene";
import { asUDim2 } from "@loom-dev/scene";
import { createElement, type ReactElement, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	type ComputeLayout,
	createPortal,
	type MountedWorld,
	mountSync,
} from "./index";

/** Stub layout that also captures the last encoded scene root. */
function makeCapturingLayout(capture: { root?: SceneNode }): ComputeLayout {
	return (root: SceneNode, _viewport: Viewport): LayoutResult => {
		capture.root = root;
		const rects: LayoutResult["rects"] = {};
		const walk = (node: SceneNode): void => {
			rects[node.id ?? "?"] = {
				rect: { x: 0, y: 0, width: 800, height: 600 },
			};
			for (const child of node.children ?? []) walk(child);
		};
		walk(root);
		return { rects };
	};
}

function makeMount(): HTMLElement {
	const mount = document.createElement("div");
	Object.defineProperty(mount, "clientWidth", { value: 800 });
	Object.defineProperty(mount, "clientHeight", { value: 600 });
	document.body.appendChild(mount);
	return mount;
}

function playerGui(): LoomInstance {
	const player = getService("Players").LocalPlayer as LoomInstance;
	return player.WaitForChild("PlayerGui") as LoomInstance;
}

describe("createPortal + PlayerGui world root", () => {
	let mount: HTMLElement;
	let roots: MountedWorld[];
	let capture: { root?: SceneNode };

	beforeEach(() => {
		document.body.innerHTML = "";
		mount = makeMount();
		roots = [];
		capture = {};
	});
	afterEach(() => {
		for (const root of roots) root.unmount();
	});

	function mountWith(element: ReactElement): MountedWorld {
		const root = mountSync(element, mount, {
			computeLayout: makeCapturingLayout(capture),
		});
		roots.push(root);
		return root;
	}

	/** App gui + a toggleable dialog layer portaled into PlayerGui. */
	function DialogApp(props: {
		onToggle: (toggle: () => void) => void;
	}): ReactElement {
		const [open, setOpen] = useState(false);
		props.onToggle(() => setOpen((v) => !v));
		return createElement(
			"screengui",
			{ Name: "AppGui" },
			createElement("frame", { Name: "Content" }),
			open
				? createPortal(
						createElement(
							"screengui",
							{
								Name: "DialogLayer",
								DisplayOrder: 2000,
								IgnoreGuiInset: true,
								ResetOnSpawn: false,
							},
							createElement("frame", { Name: "Panel" }),
						),
						playerGui(),
					)
				: undefined,
		);
	}

	it("uses the runtime PlayerGui as the world root container", () => {
		const root = mountWith(createElement("screengui", { Name: "AppGui" }));
		expect(root.world.rootInstance).toBe(playerGui());
		// The app's ScreenGui is a direct PlayerGui child (LayerCollector route).
		const appGui = playerGui().FindFirstChild("AppGui");
		expect(appGui).toBeDefined();
		expect((appGui as LoomInstance).Parent).toBe(playerGui());
	});

	it("mounts non-LayerCollector root children under the default ScreenGui", () => {
		const root = mountWith(createElement("frame", { Name: "Loose" }));
		const loose = root.world.defaultGui.FindFirstChild("Loose");
		expect(loose).toBeDefined();
		expect((loose as LoomInstance).Parent).toBe(root.world.defaultGui);
		// Encode wraps it in the (now non-empty) default ScreenGui as scene root.
		expect(capture.root?.className).toBe("ScreenGui");
		expect(capture.root?.name).toBe("LoomDefaultGui");
	});

	it("leaves instances Roblox never draws out of the scene", () => {
		const root = mountWith(createElement("frame", { Name: "Panel" }));
		const panel = root.world.defaultGui.FindFirstChild("Panel") as LoomInstance;
		// What an imperative (Luau) tree puts beside GUI: its script, a value object.
		for (const className of ["LocalScript", "StringValue", "BindableEvent"]) {
			createInstance(className, className).Parent = panel;
		}
		createInstance("Frame", "Shown").Parent = panel;
		root.world.flushSync();
		const names = (capture.root?.children?.[0]?.children ?? []).map(
			(n) => n.name,
		);
		expect(names).toEqual(["Shown"]);
		expect(mount.querySelector('[data-loom-class="LocalScript"]')).toBeNull();
	});

	it("parents portal children into PlayerGui and removes them on unmount", () => {
		let toggle: (() => void) | undefined;
		mountWith(
			createElement(DialogApp, {
				onToggle: (t: () => void) => {
					toggle = t;
				},
			}),
		);
		expect(playerGui().FindFirstChild("DialogLayer")).toBeUndefined();

		toggle?.();
		const layer = playerGui().FindFirstChild("DialogLayer");
		expect(layer).toBeDefined();
		expect((layer as LoomInstance).Parent).toBe(playerGui());
		expect(mount.querySelector('[data-loom-name="Panel"]')).not.toBeNull();

		toggle?.();
		expect(playerGui().FindFirstChild("DialogLayer")).toBeUndefined();
		expect(mount.querySelector('[data-loom-name="DialogLayer"]')).toBeNull();
		expect(mount.querySelector('[data-loom-name="Panel"]')).toBeNull();
	});

	it("encodes multiple ScreenGuis as sibling viewport-filling subtrees", () => {
		let toggle: (() => void) | undefined;
		mountWith(
			createElement(DialogApp, {
				onToggle: (t: () => void) => {
					toggle = t;
				},
			}),
		);
		// Single layer: the app gui IS the scene root.
		expect(capture.root?.name).toBe("AppGui");

		toggle?.();
		// Two layers: synthetic wrapper with both as siblings.
		const root = capture.root as SceneNode;
		expect(root.id).toBe("loom-root");
		expect(root.children?.map((c) => c.name)).toEqual([
			"AppGui",
			"DialogLayer",
		]);
		// Each layer gets an explicit full-viewport Size (the engine only
		// force-fills the top node).
		for (const child of root.children ?? []) {
			const size = asUDim2(child.properties?.Size);
			expect(size).toEqual({
				x: { scale: 1, offset: 0 },
				y: { scale: 1, offset: 0 },
			});
		}
	});

	it("z-orders layer divs by DisplayOrder (portal paints above the app)", () => {
		let toggle: (() => void) | undefined;
		mountWith(
			createElement(DialogApp, {
				onToggle: (t: () => void) => {
					toggle = t;
				},
			}),
		);
		toggle?.();

		const appEl = mount.querySelector(
			'[data-loom-name="AppGui"]',
		) as HTMLElement;
		const layerEl = mount.querySelector(
			'[data-loom-name="DialogLayer"]',
		) as HTMLElement;
		expect(appEl).not.toBeNull();
		expect(layerEl).not.toBeNull();
		// Siblings under the synthetic wrapper, z-index from DisplayOrder.
		expect(layerEl.parentElement).toBe(appEl.parentElement);
		expect(appEl.style.zIndex).toBe("0"); // DisplayOrder default
		expect(layerEl.style.zIndex).toBe("2000");
		// LayerCollectors are transparent containers, not input sinkers: the div
		// is click-through so it never blocks interactive elements behind it
		// (pointer sinking is decided per GuiObject — buttons/TextBoxes/Active).
		expect(layerEl.style.pointerEvents).toBe("none");
		// Frames inside keep the ZIndex mapping.
		const panelEl = mount.querySelector(
			'[data-loom-name="Panel"]',
		) as HTMLElement;
		expect(panelEl.parentElement).toBe(layerEl);
		expect(panelEl.style.zIndex).toBe("1");
		// A plain Frame is not an input sinker either, so it stays click-through;
		// only GuiButtons / TextBoxes / Active objects re-enable pointer events.
		expect(panelEl.style.pointerEvents).toBe("none");
	});

	it("warns and skips non-LayerCollector children parented to PlayerGui", () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		try {
			mountWith(createElement("screengui", { Name: "AppGui" }));
			// Imperatively parent a Frame straight under PlayerGui.
			const loose = createInstance("Frame", "Stray");
			loose.Parent = playerGui();
			roots[0]?.world.flushSync();
			expect(warn).toHaveBeenCalledWith(
				expect.stringContaining("not a LayerCollector"),
			);
			// Skipped from the scene: root stays the single app gui.
			expect(capture.root?.name).toBe("AppGui");
			loose.Destroy();
		} finally {
			warn.mockRestore();
		}
	});
});
