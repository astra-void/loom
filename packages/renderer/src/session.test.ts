/**
 * DomSession behavior: keyed incremental patching (element identity across
 * patches, stale-node removal, renderScene parity) and delegated pointer input
 * dispatch onto live LoomInstances.
 */
import type { InputObject, LoomInstance } from "@loom-dev/runtime";
import {
	createInstance,
	Enum,
	getEventSignal,
	getFocusedTextBox,
	getInternalId,
	getService,
	Vector2,
} from "@loom-dev/runtime";
import type { LayoutResult, Rect, SceneNode } from "@loom-dev/scene";
import { color3FromRGB, prop, udim2 } from "@loom-dev/scene";
import { beforeEach, describe, expect, it } from "vitest";
import { createDomSession, type DomSession, renderScene } from "./index";

function layoutOf(entries: Record<string, Rect>): LayoutResult {
	const rects: LayoutResult["rects"] = {};
	for (const [id, rect] of Object.entries(entries)) rects[id] = { rect };
	return { rects };
}

/** Attribute the session adds but renderScene doesn't; strip for parity diffs. */
function withoutIds(html: string): string {
	return html.replace(/ data-loom-id="[^"]*"/g, "");
}

// happy-dom ships PointerEvent; fall back to MouseEvent defensively.
const PointerEventCtor: typeof MouseEvent =
	(globalThis as { PointerEvent?: typeof MouseEvent }).PointerEvent ??
	MouseEvent;

function firePointer(
	target: Element,
	type: string,
	init: MouseEventInit = {},
): void {
	target.dispatchEvent(new PointerEventCtor(type, { bubbles: true, ...init }));
}

describe("createDomSession", () => {
	let mount: HTMLElement;

	beforeEach(() => {
		document.body.innerHTML = "";
		mount = document.createElement("div");
		document.body.appendChild(mount);
	});

	function makeSession(byId: Map<string, LoomInstance>): DomSession {
		return createDomSession(mount, {
			resolveInstance: (id) => byId.get(id),
		});
	}

	it("produces the same DOM as renderScene for the same scene", () => {
		const scene: SceneNode = {
			className: "Frame",
			name: "Card",
			id: "root",
			properties: {
				BackgroundColor3: prop.color3(color3FromRGB(28, 32, 38)),
				ZIndex: prop.int(2),
			},
			children: [
				{
					className: "UICorner",
					name: "UICorner",
					properties: { CornerRadius: prop.udim({ scale: 0, offset: 8 }) },
				},
				{
					className: "TextLabel",
					name: "Label",
					id: "label",
					properties: {
						Text: prop.string("hello"),
						TextSize: prop.number(18),
						Size: prop.udim2(udim2(1, 0, 0, 24)),
					},
				},
			],
		};
		const layout = layoutOf({
			root: { x: 10, y: 20, width: 200, height: 100 },
			label: { x: 20, y: 30, width: 180, height: 24 },
		});

		const reference = document.createElement("div");
		renderScene(scene, layout, reference);

		const session = makeSession(new Map());
		session.patch(scene, layout);

		expect(withoutIds(mount.innerHTML)).toBe(reference.innerHTML);
		session.dispose();
	});

	it("updates styles in place without recreating elements", () => {
		// The box must not be the scene root: roots are transparent containers.
		const makeScene = (color: {
			r: number;
			g: number;
			b: number;
		}): SceneNode => ({
			className: "ScreenGui",
			name: "Gui",
			id: "gui",
			children: [
				{
					className: "Frame",
					name: "Box",
					id: "box",
					properties: { BackgroundColor3: prop.color3(color) },
				},
			],
		});
		const layout = layoutOf({
			gui: { x: 0, y: 0, width: 200, height: 100 },
			box: { x: 0, y: 0, width: 100, height: 50 },
		});

		const session = makeSession(new Map());
		session.patch(makeScene({ r: 1, g: 0, b: 0 }), layout);
		const el = mount.querySelector('[data-loom-id="box"]') as HTMLElement;
		expect(el).not.toBeNull();
		expect(el.getAttribute("style")).toContain("255, 0, 0");

		session.patch(makeScene({ r: 0, g: 1, b: 0 }), layout);
		const after = mount.querySelector('[data-loom-id="box"]') as HTMLElement;
		expect(after).toBe(el); // same element, patched in place
		expect(after.getAttribute("style")).toContain("0, 255, 0");
		session.dispose();
	});

	it("removes elements for nodes that left the scene", () => {
		const child: SceneNode = { className: "Frame", name: "Child", id: "child" };
		const root = (children: SceneNode[]): SceneNode => ({
			className: "Frame",
			name: "Root",
			id: "root",
			children,
		});
		const layout = layoutOf({
			root: { x: 0, y: 0, width: 100, height: 50 },
			child: { x: 0, y: 0, width: 10, height: 10 },
		});

		const session = makeSession(new Map());
		session.patch(root([child]), layout);
		expect(mount.querySelector('[data-loom-id="child"]')).not.toBeNull();

		session.patch(root([]), layout);
		expect(mount.querySelector('[data-loom-id="child"]')).toBeNull();
		expect(mount.querySelector('[data-loom-id="root"]')).not.toBeNull();
		session.dispose();
	});

	it("dispatches InputBegan → InputEnded → Activated on pointer click", () => {
		const button = createInstance("TextButton", "Button");
		const buttonId = getInternalId(button);
		const byId = new Map([[buttonId, button]]);
		const scene: SceneNode = {
			className: "TextButton",
			name: "Button",
			id: buttonId,
		};
		const layout = layoutOf({
			[buttonId]: { x: 0, y: 0, width: 100, height: 40 },
		});

		const session = makeSession(byId);
		session.patch(scene, layout);
		const el = mount.querySelector(`[data-loom-id="${buttonId}"]`) as Element;

		const order: string[] = [];
		const activatedArgs: unknown[][] = [];
		getEventSignal(button, "InputBegan").Connect((input) => {
			order.push("InputBegan");
			expect((input as InputObject).UserInputState).toBe(
				Enum.UserInputState.Begin,
			);
		});
		getEventSignal(button, "InputEnded").Connect(() => {
			order.push("InputEnded");
		});
		getEventSignal(button, "Activated").Connect((...args) => {
			order.push("Activated");
			activatedArgs.push(args);
		});
		getEventSignal(button, "MouseButton1Click").Connect(() => {
			order.push("MouseButton1Click");
		});

		firePointer(el, "pointerdown", { clientX: 12, clientY: 8 });
		firePointer(el, "pointerup", { clientX: 12, clientY: 8 });

		expect(order).toEqual([
			"InputBegan",
			"InputEnded",
			"Activated",
			"MouseButton1Click",
		]);
		// Signal args are (inputObject, clickCount) — the react adapter prepends
		// the instance for `Event` handlers.
		const [input, clickCount] = activatedArgs[0] ?? [];
		expect((input as InputObject).UserInputType).toBe(
			Enum.UserInputType.MouseButton1,
		);
		expect((input as InputObject).Position.X).toBe(12);
		expect(clickCount).toBe(1);
		session.dispose();
	});

	it("reports a secondary press as MouseButton2 and does not activate", () => {
		const button = createInstance("TextButton", "Button");
		const buttonId = getInternalId(button);
		const byId = new Map([[buttonId, button]]);
		const scene: SceneNode = {
			className: "TextButton",
			name: "Button",
			id: buttonId,
		};
		const layout = layoutOf({
			[buttonId]: { x: 0, y: 0, width: 100, height: 40 },
		});

		const session = makeSession(byId);
		session.patch(scene, layout);
		const el = mount.querySelector(`[data-loom-id="${buttonId}"]`) as Element;

		const begun: InputObject[] = [];
		let activated = 0;
		getEventSignal(button, "InputBegan").Connect((input) => {
			begun.push(input as InputObject);
		});
		getEventSignal(button, "Activated").Connect(() => {
			activated += 1;
		});

		firePointer(el, "pointerdown", { clientX: 12, clientY: 8, button: 2 });
		firePointer(el, "pointerup", { clientX: 12, clientY: 8, button: 2 });

		// ContextMenu triggers listen for MouseButton2; collapsing every button
		// onto MouseButton1 would leave them dead.
		expect(begun[0]?.UserInputType).toBe(Enum.UserInputType.MouseButton2);
		// Roblox does not activate a GuiButton on a right-click.
		expect(activated).toBe(0);
		session.dispose();
	});

	it("fires MouseEnter/MouseLeave with (x, y) via hover chain diff", () => {
		const frame = createInstance("Frame", "Hover");
		const frameId = getInternalId(frame);
		const byId = new Map([[frameId, frame]]);
		const scene: SceneNode = { className: "Frame", name: "Hover", id: frameId };
		const layout = layoutOf({
			[frameId]: { x: 0, y: 0, width: 100, height: 40 },
		});

		const session = makeSession(byId);
		session.patch(scene, layout);
		const el = mount.querySelector(`[data-loom-id="${frameId}"]`) as Element;

		const events: unknown[][] = [];
		getEventSignal(frame, "MouseEnter").Connect((...args) =>
			events.push(["enter", ...args]),
		);
		getEventSignal(frame, "MouseLeave").Connect((...args) =>
			events.push(["leave", ...args]),
		);

		firePointer(el, "pointerover", { clientX: 5, clientY: 6 });
		firePointer(el, "pointerout", { clientX: 7, clientY: 8 });

		expect(events).toEqual([
			["enter", 5, 6],
			["leave", 7, 8],
		]);
		session.dispose();
	});

	// --- TextBox <input> + keyboard --------------------------------------------

	function mountTextBox(properties?: SceneNode["properties"]) {
		const inst = createInstance("TextBox", "Field");
		const id = getInternalId(inst);
		const byId = new Map([[id, inst]]);
		const scene: SceneNode = {
			className: "TextBox",
			name: "Field",
			id,
			properties,
		};
		const layout = layoutOf({ [id]: { x: 0, y: 0, width: 200, height: 36 } });
		const session = makeSession(byId);
		session.patch(scene, layout);
		const input = mount.querySelector("input") as HTMLInputElement;
		return { inst, id, byId, scene, layout, session, input };
	}

	it("renders a TextBox as a real <input> and typing sets Text via the proxy", () => {
		const { inst, session, input } = mountTextBox({
			Text: prop.string("seed"),
			PlaceholderText: prop.string("hint..."),
		});
		expect(input).not.toBeNull();
		expect(input.value).toBe("seed");
		expect(input.placeholder).toBe("hint...");
		// The input replaces the overlay: no text layer div inside the TextBox el.
		const box = mount.querySelector('[data-loom-class="TextBox"]');
		expect(box?.querySelector("div")).toBeNull();

		const textFires: string[] = [];
		inst
			.GetPropertyChangedSignal("Text")
			.Connect(() => textFires.push(String(inst.Text)));
		input.value = "hello";
		input.dispatchEvent(new Event("input", { bubbles: true }));
		expect(inst.Text).toBe("hello");
		expect(textFires).toEqual(["hello"]);
		session.dispose();
	});

	it("clears on focus by default (ClearTextOnFocus) and fires Focused/FocusLost", () => {
		const { inst, session, input } = mountTextBox({
			Text: prop.string("abc"),
		});
		const order: unknown[][] = [];
		getEventSignal(inst, "Focused").Connect(() => order.push(["Focused"]));
		getEventSignal(inst, "FocusLost").Connect((...args) =>
			order.push(["FocusLost", ...args]),
		);

		input.focus();
		expect(document.activeElement).toBe(input);
		expect(order).toEqual([["Focused"]]);
		expect(input.value).toBe(""); // Roblox default clears on focus
		expect(inst.Text).toBe("");
		expect(getFocusedTextBox()).toBe(inst);

		input.blur();
		expect(getFocusedTextBox()).toBeUndefined();
		expect(order).toHaveLength(2);
		expect(order[1]?.[0]).toBe("FocusLost");
		expect(order[1]?.[1]).toBe(false); // enterPressed
		session.dispose();
	});

	it("keeps text with ClearTextOnFocus=false and Enter blurs with enterPressed=true", () => {
		const { inst, session, input } = mountTextBox({
			Text: prop.string("keep"),
		});
		inst.ClearTextOnFocus = false;
		const lost: unknown[][] = [];
		getEventSignal(inst, "FocusLost").Connect((...args) => lost.push(args));

		input.focus();
		expect(input.value).toBe("keep");

		input.dispatchEvent(
			new KeyboardEvent("keydown", { code: "Enter", bubbles: true }),
		);
		expect(document.activeElement).not.toBe(input);
		expect(lost).toHaveLength(1);
		expect(lost[0]?.[0]).toBe(true); // enterPressed
		expect((lost[0]?.[1] as InputObject).KeyCode).toBe(Enum.KeyCode.Return);
		session.dispose();
	});

	it("CaptureFocus/ReleaseFocus/IsFocused drive the real input element", () => {
		const { inst, session, input } = mountTextBox();
		const isFocused = inst.IsFocused as () => boolean;
		expect(isFocused()).toBe(false);

		(inst.CaptureFocus as () => void)();
		expect(document.activeElement).toBe(input);
		expect(isFocused()).toBe(true);
		expect(getFocusedTextBox()).toBe(inst);

		const lost: unknown[][] = [];
		getEventSignal(inst, "FocusLost").Connect((...args) => lost.push(args));
		(inst.ReleaseFocus as (enterPressed?: boolean) => void)(true);
		expect(isFocused()).toBe(false);
		expect(lost[0]?.[0]).toBe(true);
		session.dispose();
	});

	it("fires global keyboard InputBegan/InputEnded; gameProcessed tracks TextBox focus", () => {
		const { session, input } = mountTextBox();
		const uis = getService("UserInputService");
		const began: unknown[][] = [];
		const ended: unknown[][] = [];
		const beganConn = getEventSignal(uis, "InputBegan").Connect((...args) =>
			began.push(args),
		);
		const endedConn = getEventSignal(uis, "InputEnded").Connect((...args) =>
			ended.push(args),
		);

		window.dispatchEvent(new KeyboardEvent("keydown", { code: "Space" }));
		window.dispatchEvent(new KeyboardEvent("keyup", { code: "Space" }));
		expect(began).toHaveLength(1);
		expect((began[0]?.[0] as InputObject).KeyCode).toBe(Enum.KeyCode.Space);
		expect((began[0]?.[0] as InputObject).UserInputType).toBe(
			Enum.UserInputType.Keyboard,
		);
		expect(began[0]?.[1]).toBe(false); // no TextBox focused
		expect((ended[0]?.[0] as InputObject).UserInputState).toBe(
			Enum.UserInputState.End,
		);

		input.focus();
		window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyA" }));
		expect(began).toHaveLength(2);
		expect((began[1]?.[0] as InputObject).KeyCode).toBe(Enum.KeyCode.A);
		expect(began[1]?.[1]).toBe(true); // TextBox focused → gameProcessed

		input.blur();
		beganConn.Disconnect();
		endedConn.Disconnect();
		session.dispose();
	});

	it("routes key input to the GuiService.SelectedObject instance only", () => {
		const session = makeSession(new Map());
		const button = createInstance("TextButton", "Selected");
		const guiService = getService("GuiService");
		guiService.SelectedObject = button;

		const keys: InputObject[] = [];
		getEventSignal(button, "InputBegan").Connect((arg) =>
			keys.push(arg as InputObject),
		);
		window.dispatchEvent(new KeyboardEvent("keydown", { code: "Space" }));
		expect(keys).toHaveLength(1);
		expect(keys[0]?.KeyCode).toBe(Enum.KeyCode.Space);

		guiService.SelectedObject = undefined;
		window.dispatchEvent(new KeyboardEvent("keydown", { code: "Space" }));
		expect(keys).toHaveLength(1); // deselected → no element routing
		session.dispose();
	});

	// --- GroupTransparency / Rotation --------------------------------------------

	it("maps CanvasGroup GroupTransparency to CSS opacity on the container", () => {
		const scene: SceneNode = {
			className: "ScreenGui",
			name: "Gui",
			id: "gui",
			children: [
				{
					className: "CanvasGroup",
					name: "Group",
					id: "group",
					properties: { GroupTransparency: prop.number(0.25) },
				},
			],
		};
		const layout = layoutOf({
			gui: { x: 0, y: 0, width: 200, height: 100 },
			group: { x: 0, y: 0, width: 100, height: 50 },
		});
		const session = makeSession(new Map());
		session.patch(scene, layout);
		const el = mount.querySelector('[data-loom-id="group"]') as HTMLElement;
		expect(el.style.opacity).toBe("0.75");
		session.dispose();
	});

	it("maps GuiObject Rotation to a center-origin CSS rotate transform", () => {
		const scene: SceneNode = {
			className: "ScreenGui",
			name: "Gui",
			id: "gui",
			children: [
				{
					className: "Frame",
					name: "Spinner",
					id: "spinner",
					properties: { Rotation: prop.number(45) },
				},
			],
		};
		const layout = layoutOf({
			gui: { x: 0, y: 0, width: 200, height: 100 },
			spinner: { x: 0, y: 0, width: 22, height: 22 },
		});
		const session = makeSession(new Map());
		session.patch(scene, layout);
		const el = mount.querySelector('[data-loom-id="spinner"]') as HTMLElement;
		expect(el.style.transform).toBe("rotate(45deg)");
		expect(el.style.transformOrigin).toBe("50% 50%");
		// The root/gui layer never rotates.
		const gui = mount.querySelector('[data-loom-id="gui"]') as HTMLElement;
		expect(gui.style.transform).toBe("");
		session.dispose();
	});

	// --- ScrollingFrame canvas wrapper + wheel ------------------------------------

	function scrollScene(canvasY: number): SceneNode {
		return {
			className: "ScreenGui",
			name: "Gui",
			id: "gui",
			children: [
				{
					className: "ScrollingFrame",
					name: "Scroll",
					id: "scroll",
					properties:
						canvasY === 0
							? {}
							: { CanvasPosition: prop.vector2({ x: 0, y: canvasY }) },
					children: [{ className: "Frame", name: "Item", id: "item" }],
				},
			],
		};
	}
	const scrollLayout = () =>
		layoutOf({
			gui: { x: 0, y: 0, width: 300, height: 200 },
			scroll: { x: 0, y: 0, width: 100, height: 100 },
			item: { x: 0, y: 0, width: 100, height: 300 },
		});

	it("mounts ScrollingFrame children in a wrapper shifted by -CanvasPosition", () => {
		const session = makeSession(new Map());
		session.patch(scrollScene(0), scrollLayout());
		const frameEl = mount.querySelector(
			'[data-loom-id="scroll"]',
		) as HTMLElement;
		const itemEl = mount.querySelector('[data-loom-id="item"]') as HTMLElement;
		// Children live inside the canvas wrapper, not directly in the frame.
		const wrapper = itemEl.parentElement as HTMLElement;
		expect(wrapper).not.toBe(frameEl);
		expect(wrapper.parentElement).toBe(frameEl);
		expect(wrapper.style.transform).toBe("");

		session.patch(scrollScene(40), scrollLayout());
		// Same wrapper and same child element — only the transform moved.
		expect(itemEl.parentElement).toBe(wrapper);
		expect(mount.querySelector('[data-loom-id="item"]')).toBe(itemEl);
		expect(wrapper.style.transform).toBe("translate(0px, -40px)");
		session.dispose();
	});

	it("wheel input scrolls the nearest ScrollingFrame with per-axis clamping", () => {
		const frame = createInstance("ScrollingFrame", "Scroll");
		const frameId = getInternalId(frame);
		const byId = new Map([[frameId, frame]]);
		const scene: SceneNode = {
			className: "ScrollingFrame",
			name: "Scroll",
			id: frameId,
		};
		const layout = layoutOf({
			[frameId]: { x: 0, y: 0, width: 100, height: 100 },
		});
		const session = makeSession(byId);
		session.patch(scene, layout);
		const el = mount.querySelector(`[data-loom-id="${frameId}"]`) as Element;

		// World feedback normally sets these; simulate it.
		frame.AbsoluteWindowSize = Vector2.new(100, 100);
		frame.AbsoluteCanvasSize = Vector2.new(100, 300);

		const positions: number[] = [];
		frame.GetPropertyChangedSignal("CanvasPosition").Connect(() => {
			positions.push((frame.CanvasPosition as Vector2).Y);
		});
		const wheel = (deltaY: number): WheelEvent => {
			const e = new WheelEvent("wheel", {
				deltaY,
				bubbles: true,
				cancelable: true,
			});
			el.dispatchEvent(e);
			return e;
		};

		expect((frame.CanvasPosition as Vector2).Y).toBe(0); // Vector2.zero default
		const first = wheel(60);
		expect((frame.CanvasPosition as Vector2).Y).toBe(60);
		expect(first.defaultPrevented).toBe(true); // consumed → page must not scroll

		wheel(1000); // clamps to canvas - window = 200
		expect((frame.CanvasPosition as Vector2).Y).toBe(200);

		const overshoot = wheel(50); // already at max → nothing consumed
		expect((frame.CanvasPosition as Vector2).Y).toBe(200);
		expect(overshoot.defaultPrevented).toBe(false);

		expect(positions).toEqual([60, 200]); // change signal per actual change only
		session.dispose();
	});

	it("wheel input skips frames with ScrollingEnabled=false", () => {
		const frame = createInstance("ScrollingFrame", "Scroll");
		const frameId = getInternalId(frame);
		const session = makeSession(new Map([[frameId, frame]]));
		session.patch(
			{ className: "ScrollingFrame", name: "Scroll", id: frameId },
			layoutOf({ [frameId]: { x: 0, y: 0, width: 100, height: 100 } }),
		);
		const el = mount.querySelector(`[data-loom-id="${frameId}"]`) as Element;
		frame.AbsoluteWindowSize = Vector2.new(100, 100);
		frame.AbsoluteCanvasSize = Vector2.new(100, 300);
		frame.ScrollingEnabled = false;

		const e = new WheelEvent("wheel", {
			deltaY: 60,
			bubbles: true,
			cancelable: true,
		});
		el.dispatchEvent(e);
		expect((frame.CanvasPosition as Vector2).Y).toBe(0);
		expect(e.defaultPrevented).toBe(false);
		session.dispose();
	});
});

describe("text sizing", () => {
	const fontSize = (name: string) =>
		prop.enum({ enumType: "FontSize", name, value: 0 });

	function paint(properties: SceneNode["properties"]): string {
		const host = document.createElement("div");
		renderScene(
			{
				className: "TextLabel",
				name: "Label",
				id: "label",
				properties: { Text: prop.string("hi"), ...properties },
			},
			layoutOf({ label: { x: 0, y: 0, width: 100, height: 20 } }),
			host,
		);
		// The text overlay is the only layer that sets a font size.
		const layer = [...host.querySelectorAll("div")].find(
			(el) => el.style.fontSize !== "",
		);
		return layer?.style.fontSize ?? "";
	}

	it("reads the pixel size out of a legacy FontSize enum", () => {
		expect(paint({ FontSize: fontSize("Size24") })).toBe("24px");
	});

	it("lets TextSize win when both are set, as in Roblox", () => {
		expect(
			paint({ TextSize: prop.number(20), FontSize: fontSize("Size24") }),
		).toBe("20px");
	});

	it("falls back to the Roblox default for an unparseable FontSize", () => {
		expect(paint({ FontSize: fontSize("Nonsense") })).toBe("14px");
	});
});
