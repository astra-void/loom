/**
 * DomSession behavior: keyed incremental patching (element identity across
 * patches, stale-node removal, renderScene parity) and delegated pointer input
 * dispatch onto live LoomInstances.
 */
import type { InputObject, LoomInstance } from "@loom-dev/runtime";
import {
	clearInputState,
	createInstance,
	Enum,
	getEventSignal,
	getFocusedTextBox,
	getInternalId,
	getService,
	Vector2,
} from "@loom-dev/runtime";
import type {
	LayoutResult,
	PropertyValue,
	Rect,
	SceneNode,
} from "@loom-dev/scene";
import { color3FromRGB, prop, udim2 } from "@loom-dev/scene";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	clearImageSizeCache,
	clearRegisteredFonts,
	createDomSession,
	cssFontSize,
	type DomSession,
	fontShorthand,
	keyCodeFromKeyboardEvent,
	registerFont,
	renderScene,
	scaledTextSize,
	setImageResolver,
} from "./index";

/** A `ScaleType` enum property, the shape the adapters encode. */
const scaleType = (name: string) =>
	prop.enum({ enumType: "ScaleType", name, value: 0 });

function layoutOf(entries: Record<string, Rect>): LayoutResult {
	const rects: LayoutResult["rects"] = {};
	for (const [id, rect] of Object.entries(entries)) rects[id] = { rect };
	return { rects };
}

/** Attribute the session adds but renderScene doesn't; strip for parity diffs. */
function withoutIds(html: string): string {
	return html.replace(/ data-loom-id="[^"]*"/g, "");
}

/**
 * `(ascent + descent) / em` for the stub face below — 0 for "this browser has
 * no font metrics", which is happy-dom's real answer and the default every test
 * but the clipping ones wants.
 */
let stubFaceRatio = 0;

/**
 * A second ratio, reported for sizes below the 100px probe {@link cssFontSize}
 * reads the face at. It stands in for a browser whose small-size metrics do not
 * scale from the probe — hinting — which is the only thing left that can make a
 * face overhang the box after the size conversion.
 */
let stubSmallFaceRatio: number | undefined;

/**
 * happy-dom has no 2d context at all, so the renderer measures nothing and the
 * text-clipping geometry (which is driven by the face's own box) can never come
 * up. Installing a metrics-only context here, at import time, is what lets it:
 * the renderer caches the first context it is handed for the life of the
 * module, so this cannot be done from inside a test.
 */
Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
	configurable: true,
	value(this: HTMLCanvasElement, kind: string) {
		if (kind !== "2d") return null;
		return {
			font: "",
			measureText(): TextMetrics {
				const em = Number.parseFloat(
					/(\d+(?:\.\d+)?)px/.exec(this.font as string)?.[1] ?? "0",
				);
				const ratio =
					em < 100 && stubSmallFaceRatio !== undefined
						? stubSmallFaceRatio
						: stubFaceRatio;
				const box = em * ratio;
				return {
					width: 0,
					// Undefined metrics read as NaN, which is what a browser that
					// cannot answer gives the renderer.
					fontBoundingBoxAscent: box > 0 ? box * 0.8 : Number.NaN,
					fontBoundingBoxDescent: box > 0 ? box * 0.2 : Number.NaN,
				} as TextMetrics;
			},
		};
	},
});

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

/** `UserInputService:IsKeyDown`, called the way Roblox code calls it. */
function isKeyDown(key: unknown): boolean {
	return (getService("UserInputService").IsKeyDown as (k: unknown) => boolean)(
		key,
	);
}

/** `UserInputService:IsMouseButtonPressed`. */
function isMouseButtonPressed(button: unknown): boolean {
	return (
		getService("UserInputService").IsMouseButtonPressed as (
			b: unknown,
		) => boolean
	)(button);
}

/** `UserInputService:GetKeysPressed`, as the `InputObject`s Roblox answers with. */
function keysPressed(): InputObject[] {
	return (
		getService("UserInputService").GetKeysPressed as () => InputObject[]
	)();
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

	/** A button (id `"btn"`) inside a frame (id `"box"`), both live instances. */
	function mountButton(): {
		button: LoomInstance;
		frame: LoomInstance;
		buttonEl: Element;
		frameEl: Element;
		session: DomSession;
	} {
		const frame = createInstance("Frame", "Box");
		const button = createInstance("TextButton", "Button");
		const frameId = getInternalId(frame);
		const buttonId = getInternalId(button);
		const scene: SceneNode = {
			className: "Frame",
			name: "Box",
			id: frameId,
			properties: { Active: prop.bool(true) },
			children: [{ className: "TextButton", name: "Button", id: buttonId }],
		};
		const layout = layoutOf({
			[frameId]: { x: 0, y: 0, width: 200, height: 100 },
			[buttonId]: { x: 0, y: 0, width: 100, height: 40 },
		});
		const session = makeSession(
			new Map([
				[frameId, frame],
				[buttonId, button],
			]),
		);
		session.patch(scene, layout);
		return {
			button,
			frame,
			buttonEl: mount.querySelector(`[data-loom-id="${buttonId}"]`) as Element,
			frameEl: mount.querySelector(`[data-loom-id="${frameId}"]`) as Element,
			session,
		};
	}

	/** Record every firing of `names` on `inst`, tagged with the event name. */
	function record(inst: LoomInstance, names: string[]): unknown[][] {
		const seen: unknown[][] = [];
		for (const name of names) {
			getEventSignal(inst, name).Connect((...args) =>
				seen.push([name, ...args]),
			);
		}
		return seen;
	}

	it("fires the global InputBegan/InputEnded pair for every press", () => {
		// The service half, not the control half: outside-press dismissal (a menu
		// closing when you click anywhere else) is built entirely on these two,
		// and they fire whether or not the press landed on anything.
		const { buttonEl, session } = mountButton();
		const uis = getService("UserInputService");
		const seen: unknown[][] = [];
		const began = getEventSignal(uis, "InputBegan").Connect((...args) =>
			seen.push(["began", ...args]),
		);
		const ended = getEventSignal(uis, "InputEnded").Connect((...args) =>
			seen.push(["ended", ...args]),
		);

		firePointer(buttonEl, "pointerdown", { clientX: 2, clientY: 2 });
		firePointer(buttonEl, "pointerup", { clientX: 2, clientY: 2 });
		// The press that never paired (released over nothing) still ends.
		firePointer(mount, "pointerdown", { clientX: 2, clientY: 2, button: 2 });
		firePointer(mount, "pointerup", { clientX: 2, clientY: 2, button: 2 });

		expect(seen.map((entry) => entry[0])).toEqual([
			"began",
			"ended",
			"began",
			"ended",
		]);
		expect((seen[1]?.[1] as InputObject).UserInputState).toBe(
			Enum.UserInputState.End,
		);
		began.Disconnect();
		ended.Disconnect();
		session.dispose();
	});

	it("fires MouseButton1Down/Up on the button with (x, y)", () => {
		const { button, buttonEl, session } = mountButton();
		const seen = record(button, [
			"MouseButton1Down",
			"MouseButton1Up",
			"MouseButton1Click",
		]);

		firePointer(buttonEl, "pointerdown", { clientX: 12, clientY: 8 });
		firePointer(buttonEl, "pointerup", { clientX: 14, clientY: 9 });

		// Down and up carry the pointer in mount-relative pixels; the click, which
		// is the *pair*, carries nothing — exactly the engine's three signatures.
		expect(seen).toEqual([
			["MouseButton1Down", 12, 8],
			["MouseButton1Up", 14, 9],
			["MouseButton1Click"],
		]);
		session.dispose();
	});

	it("fires the MouseButton2 trio on a secondary press without activating", () => {
		const { button, buttonEl, session } = mountButton();
		const seen = record(button, [
			"MouseButton2Down",
			"MouseButton2Up",
			"MouseButton2Click",
			"MouseButton1Click",
			"Activated",
		]);

		firePointer(buttonEl, "pointerdown", { clientX: 5, clientY: 6, button: 2 });
		firePointer(buttonEl, "pointerup", { clientX: 5, clientY: 6, button: 2 });

		// A right-click raises no `Activated` and no `MouseButton1Click` in Roblox;
		// a context menu listens for `MouseButton2Click` and had nothing to hear.
		expect(seen).toEqual([
			["MouseButton2Down", 5, 6],
			["MouseButton2Up", 5, 6],
			["MouseButton2Click"],
		]);
		session.dispose();
	});

	it("routes a press on a button's decorative child back to the button", () => {
		// A TextButton with a label inside it: the pointer lands on the label, and
		// the engine still reports the button's own down/up/click.
		const button = createInstance("TextButton", "Button");
		const label = createInstance("TextLabel", "Caption");
		const buttonId = getInternalId(button);
		const labelId = getInternalId(label);
		const scene: SceneNode = {
			className: "TextButton",
			name: "Button",
			id: buttonId,
			children: [{ className: "TextLabel", name: "Caption", id: labelId }],
		};
		const session = makeSession(
			new Map([
				[buttonId, button],
				[labelId, label],
			]),
		);
		session.patch(
			scene,
			layoutOf({
				[buttonId]: { x: 0, y: 0, width: 100, height: 40 },
				[labelId]: { x: 0, y: 0, width: 100, height: 40 },
			}),
		);
		const labelEl = mount.querySelector(
			`[data-loom-id="${labelId}"]`,
		) as Element;
		const seen = record(button, ["MouseButton1Down", "MouseButton1Click"]);

		firePointer(labelEl, "pointerdown", { clientX: 3, clientY: 4 });
		firePointer(labelEl, "pointerup", { clientX: 3, clientY: 4 });

		expect(seen).toEqual([["MouseButton1Down", 3, 4], ["MouseButton1Click"]]);
		session.dispose();
	});

	it("pairs a click per button, so a right press cannot be left-clicked shut", () => {
		const { button, buttonEl, session } = mountButton();
		const seen = record(button, [
			"MouseButton1Click",
			"MouseButton2Click",
			"Activated",
		]);

		// Press with the secondary button, release with the primary one: two
		// unrelated halves, and neither button has a pair to report.
		firePointer(buttonEl, "pointerdown", { clientX: 5, clientY: 6, button: 2 });
		firePointer(buttonEl, "pointerup", { clientX: 5, clientY: 6, button: 0 });

		expect(seen).toEqual([]);
		session.dispose();
	});

	it("reports the held mouse button to UserInputService", () => {
		const { buttonEl, session } = mountButton();
		expect(isMouseButtonPressed(Enum.UserInputType.MouseButton1)).toBe(false);

		firePointer(buttonEl, "pointerdown", { clientX: 1, clientY: 1 });
		expect(isMouseButtonPressed(Enum.UserInputType.MouseButton1)).toBe(true);
		expect(isMouseButtonPressed(Enum.UserInputType.MouseButton2)).toBe(false);

		firePointer(buttonEl, "pointerup", { clientX: 1, clientY: 1 });
		expect(isMouseButtonPressed(Enum.UserInputType.MouseButton1)).toBe(false);
		session.dispose();
	});

	it("drives a button's whole MouseButton1 family from a tap", () => {
		// The engine synthesizes the mouse family from a touch on a GuiButton — a
		// phone can press a button loom's UI never gave a mouse — but
		// `IsMouseButtonPressed` stays false there, because a finger is
		// `UserInputType.Touch` and not a button.
		const { button, buttonEl, session } = mountButton();
		const seen = record(button, [
			"MouseButton1Down",
			"MouseButton1Up",
			"MouseButton1Click",
		]);
		const touch = { pointerType: "touch", pointerId: 4 };

		firePointer(buttonEl, "pointerdown", { clientX: 1, clientY: 1, ...touch });
		expect(isMouseButtonPressed(Enum.UserInputType.MouseButton1)).toBe(false);
		firePointer(buttonEl, "pointerup", { clientX: 1, clientY: 1, ...touch });

		expect(seen).toEqual([
			["MouseButton1Down", 1, 1],
			["MouseButton1Up", 1, 1],
			["MouseButton1Click"],
		]);
		session.dispose();
	});

	it("releases a held button when the gesture is cancelled", () => {
		const { buttonEl, session } = mountButton();
		firePointer(buttonEl, "pointerdown", { clientX: 1, clientY: 1 });
		expect(isMouseButtonPressed(Enum.UserInputType.MouseButton1)).toBe(true);
		// No `pointerup` follows a cancel, so the button has to be retired here or
		// it reads as held for the rest of the session.
		firePointer(buttonEl, "pointercancel", { clientX: 1, clientY: 1 });
		expect(isMouseButtonPressed(Enum.UserInputType.MouseButton1)).toBe(false);
		session.dispose();
	});

	it("fires MouseMoved on the whole hovered chain with (x, y)", () => {
		const { button, frame, buttonEl, session } = mountButton();
		const onButton = record(button, ["MouseMoved"]);
		const onFrame = record(frame, ["MouseMoved"]);

		firePointer(buttonEl, "pointermove", { clientX: 21, clientY: 7 });

		// Declared in EVENT_NAMES but never dispatched before: `:Connect`
		// succeeded, so a hover-tracking tooltip looked wired and never moved.
		expect(onButton).toEqual([["MouseMoved", 21, 7]]);
		// The ancestor is under the pointer too, exactly as MouseEnter/Leave are.
		expect(onFrame).toEqual([["MouseMoved", 21, 7]]);
		session.dispose();
	});

	it("fires MouseWheelForward/Backward and a MouseWheel input", () => {
		const { button, buttonEl, session } = mountButton();
		const seen = record(button, ["MouseWheelForward", "MouseWheelBackward"]);
		const uis = getService("UserInputService");
		const changed: InputObject[] = [];
		const conn = getEventSignal(uis, "InputChanged").Connect((input) =>
			changed.push(input as InputObject),
		);

		const wheel = (deltaY: number): void => {
			const e = new WheelEvent("wheel", {
				bubbles: true,
				cancelable: true,
				deltaY,
			});
			// happy-dom's WheelEvent drops the MouseEvent half of the init, so the
			// pointer coordinates the handler reports have to be put on by hand.
			Object.defineProperty(e, "clientX", { value: 9 });
			Object.defineProperty(e, "clientY", { value: 3 });
			buttonEl.dispatchEvent(e);
		};
		wheel(-120); // away from the user
		wheel(120);

		expect(seen).toEqual([
			["MouseWheelForward", 9, 3],
			["MouseWheelBackward", 9, 3],
		]);
		// Roblox reports the direction in the input object's Position.Z, which is
		// where every zoom-on-scroll handler reads it from.
		expect(changed.map((input) => input.UserInputType)).toEqual([
			Enum.UserInputType.MouseWheel,
			Enum.UserInputType.MouseWheel,
		]);
		expect(changed.map((input) => input.Position.Z)).toEqual([1, -1]);
		conn.Disconnect();
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

	it("maps DOM key codes onto the engine's KeyCode items", () => {
		// Keyed off `KeyboardEvent.code` — the physical key — so WASD stays WASD on
		// an AZERTY board, which is what `Enum.KeyCode` does in the engine.
		const codeFor = (code: string) =>
			keyCodeFromKeyboardEvent(new KeyboardEvent("keydown", { code }));
		expect(codeFor("KeyW")).toBe(Enum.KeyCode.W);
		expect(codeFor("Digit4")).toBe(Enum.KeyCode.Four);
		expect(codeFor("Numpad4")).toBe(Enum.KeyCode.KeypadFour);
		expect(codeFor("F5")).toBe(Enum.KeyCode.F5);
		expect(codeFor("ShiftLeft")).toBe(Enum.KeyCode.LeftShift);
		expect(codeFor("ShiftRight")).toBe(Enum.KeyCode.RightShift);
		expect(codeFor("ControlLeft")).toBe(Enum.KeyCode.LeftControl);
		expect(codeFor("Minus")).toBe(Enum.KeyCode.Minus);
		expect(codeFor("Equal")).toBe(Enum.KeyCode.Equals);
		expect(codeFor("BracketLeft")).toBe(Enum.KeyCode.LeftBracket);
		expect(codeFor("Backquote")).toBe(Enum.KeyCode.Backquote);
		expect(codeFor("Escape")).toBe(Enum.KeyCode.Escape);
		expect(codeFor("Insert")).toBe(Enum.KeyCode.Insert);
		expect(codeFor("ContextMenu")).toBe(Enum.KeyCode.Menu);
		// The keypad's Enter is its own item in the engine, not `Return`.
		expect(codeFor("Enter")).toBe(Enum.KeyCode.Return);
		expect(codeFor("NumpadEnter")).toBe(Enum.KeyCode.KeypadEnter);
		// Nothing is guessed at: a key the engine has no item for reads Unknown.
		expect(codeFor("IntlBackslash")).toBe(Enum.KeyCode.Unknown);
		expect(codeFor("F19")).toBe(Enum.KeyCode.Unknown);
	});

	it("reports held keys so UserInputService can answer IsKeyDown", () => {
		clearInputState();
		const session = makeSession(new Map());
		expect(isKeyDown(Enum.KeyCode.W)).toBe(false);

		window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyW" }));
		window.dispatchEvent(new KeyboardEvent("keydown", { code: "ShiftLeft" }));
		expect(isKeyDown(Enum.KeyCode.W)).toBe(true);
		expect(isKeyDown(Enum.KeyCode.LeftShift)).toBe(true);
		// Roblox answers `GetKeysPressed` with real InputObjects, not key codes.
		expect(keysPressed().map((input) => input.KeyCode)).toEqual([
			Enum.KeyCode.W,
			Enum.KeyCode.LeftShift,
		]);

		window.dispatchEvent(new KeyboardEvent("keyup", { code: "KeyW" }));
		expect(isKeyDown(Enum.KeyCode.W)).toBe(false);
		expect(isKeyDown(Enum.KeyCode.LeftShift)).toBe(true);
		session.dispose();
	});

	it("raises InputBegan once per press, not once per auto-repeat", () => {
		clearInputState();
		const session = makeSession(new Map());
		const button = createInstance("TextButton", "Selected");
		const guiService = getService("GuiService");
		guiService.SelectedObject = button;
		const began: InputObject[] = [];
		const conn = getEventSignal(button, "InputBegan").Connect((input) =>
			began.push(input as InputObject),
		);

		const key = (repeat: boolean): KeyboardEvent => {
			const e = new KeyboardEvent("keydown", {
				code: "ArrowDown",
				repeat,
				cancelable: true,
			});
			window.dispatchEvent(e);
			return e;
		};
		const first = key(false);
		const held = key(true);
		const stillHeld = key(true);

		// The OS repeating a held key is not a second press, and the engine raises
		// no second InputBegan for it.
		expect(began).toHaveLength(1);
		// The repeats are still swallowed, though: an arrow that stopped being
		// prevented halfway through would start scrolling the page under the app.
		expect(first.defaultPrevented).toBe(true);
		expect(held.defaultPrevented).toBe(true);
		expect(stillHeld.defaultPrevented).toBe(true);
		expect(isKeyDown(Enum.KeyCode.Down)).toBe(true);

		window.dispatchEvent(new KeyboardEvent("keyup", { code: "ArrowDown" }));
		expect(isKeyDown(Enum.KeyCode.Down)).toBe(false);
		conn.Disconnect();
		guiService.SelectedObject = undefined;
		session.dispose();
	});

	it("routes keys to the focused TextBox as well as the selection", () => {
		clearInputState();
		const { inst, session, input } = mountTextBox();
		const seen: unknown[][] = [];
		getEventSignal(inst, "InputBegan").Connect((...args) =>
			seen.push(["began", ...args]),
		);
		getEventSignal(inst, "InputEnded").Connect((...args) =>
			seen.push(["ended", ...args]),
		);

		// Unfocused, the box hears nothing: the keys are not landing on it.
		window.dispatchEvent(new KeyboardEvent("keydown", { code: "Escape" }));
		expect(seen).toHaveLength(0);

		input.focus();
		window.dispatchEvent(new KeyboardEvent("keydown", { code: "Escape" }));
		window.dispatchEvent(new KeyboardEvent("keyup", { code: "Escape" }));
		expect(seen).toHaveLength(2);
		expect((seen[0]?.[1] as InputObject).KeyCode).toBe(Enum.KeyCode.Escape);
		expect((seen[0]?.[1] as InputObject).UserInputType).toBe(
			Enum.UserInputType.Keyboard,
		);
		expect((seen[1]?.[1] as InputObject).UserInputState).toBe(
			Enum.UserInputState.End,
		);
		input.blur();
		session.dispose();
	});

	it("drops every held key when focus leaves the page", () => {
		// A browser stops delivering `keyup` the moment focus goes, so a key held
		// through an alt-tab would read as held forever — the stuck-movement-key
		// bug, which in a preview looks like loom is broken rather than like the
		// tab changed.
		clearInputState();
		const session = makeSession(new Map());
		window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyW" }));
		expect(isKeyDown(Enum.KeyCode.W)).toBe(true);

		window.dispatchEvent(new Event("blur"));
		expect(isKeyDown(Enum.KeyCode.W)).toBe(false);
		expect(keysPressed()).toEqual([]);
		session.dispose();
	});

	it("takes its window listeners with it on dispose", () => {
		// The session is re-created on every re-mount; a leaked keydown listener
		// would fire the app's handlers twice and then three times.
		clearInputState();
		const session = makeSession(new Map());
		const uis = getService("UserInputService");
		const began: unknown[][] = [];
		const conn = getEventSignal(uis, "InputBegan").Connect((...args) =>
			began.push(args),
		);

		window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyQ" }));
		expect(began).toHaveLength(1);

		session.dispose();
		window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyQ" }));
		expect(began).toHaveLength(1);
		// And the state it owned went with it, so a fresh session starts clean.
		expect(isKeyDown(Enum.KeyCode.Q)).toBe(false);
		conn.Disconnect();
	});

	// --- TextScaled ---------------------------------------------------------------

	it("scales a TextScaled TextBox to its box and reports bounds to match", () => {
		// The box is 200 x 36 (see `mountTextBox`), so one line of text resolves to
		// 36 — `TextSize` is not read at all while `TextScaled` is on.
		const { inst, session, input } = mountTextBox({
			Text: prop.string("hi"),
			TextSize: prop.number(9),
			TextScaled: prop.bool(true),
		});
		expect(input.style.fontSize).toBe("36px");
		// TextBounds has to describe the size actually painted, or the auto-resize
		// that reads it sizes the box against a font nothing is wearing.
		expect((inst.TextBounds as Vector2).Y).toBe(36);
		session.dispose();

		const plain = mountTextBox({
			Text: prop.string("hi"),
			TextSize: prop.number(9),
		});
		expect(plain.input.style.fontSize).toBe("9px");
		expect((plain.inst.TextBounds as Vector2).Y).toBe(9);
		plain.session.dispose();
	});

	it("re-fits a TextScaled node when its rect changes, not its props", () => {
		const inst = createInstance("TextLabel", "Label");
		const id = getInternalId(inst);
		const scene: SceneNode = {
			className: "TextLabel",
			name: "Label",
			id,
			properties: { Text: prop.string("hi"), TextScaled: prop.bool(true) },
		};
		const session = makeSession(new Map([[id, inst]]));
		const fontSize = (): string => {
			const layer = mount.querySelector<HTMLElement>(
				`[data-loom-id="${id}"] > div`,
			);
			return layer?.style.fontSize ?? "";
		};

		session.patch(
			scene,
			layoutOf({ [id]: { x: 0, y: 0, width: 200, height: 40 } }),
		);
		expect(fontSize()).toBe("40px");
		// Nothing about the node changed — only the box it was given.
		session.patch(
			scene,
			layoutOf({ [id]: { x: 0, y: 0, width: 200, height: 18 } }),
		);
		expect(fontSize()).toBe("18px");
		session.dispose();
	});

	it("scaledTextSize stops at the engine's 1…100 window", () => {
		const font = { family: "Arial", weight: "400", italic: false };
		// The measurer here reports no advances, so only the height binds.
		expect(scaledTextSize({ text: "hi", font, width: 200, height: 4000 })).toBe(
			100,
		);
		expect(scaledTextSize({ text: "hi", font, width: 200, height: 0 })).toBe(1);
		expect(scaledTextSize({ text: "", font, width: 200, height: 100 })).toBe(1);
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

	// --- ScrollingFrame scroll bars ----------------------------------------------

	/** The frame's scroll-bar overlay: its last layer, when it has one. */
	function barLayer(frameEl: Element): HTMLElement | null {
		const last = frameEl.lastElementChild as HTMLElement | null;
		return last?.querySelector("[data-loom-scrollbar]") ? last : null;
	}

	/**
	 * A frame with `canvasY` px of canvas in a 100px window — enough to scroll
	 * (and therefore to show a bar) whenever `canvasY > 100`.
	 */
	function overflowScene(
		canvasY: number,
		properties: SceneNode["properties"] = {},
	): SceneNode {
		return {
			className: "ScreenGui",
			name: "Gui",
			id: "gui",
			children: [
				{
					className: "ScrollingFrame",
					name: "Scroll",
					id: "scroll",
					properties: {
						CanvasSize: prop.udim2(udim2(0, 100, 0, canvasY)),
						...properties,
					},
					children: [{ className: "Frame", name: "Item", id: "item" }],
				},
			],
		};
	}
	const overflowLayout = () =>
		layoutOf({
			gui: { x: 0, y: 0, width: 300, height: 200 },
			scroll: { x: 0, y: 0, width: 100, height: 100 },
			item: { x: 0, y: 0, width: 100, height: 300 },
		});

	it("paints a Roblox-shaped scroll bar over the canvas when it overflows", () => {
		const session = makeSession(new Map());
		session.patch(overflowScene(300), overflowLayout());
		const frameEl = mount.querySelector(
			'[data-loom-id="scroll"]',
		) as HTMLElement;
		const layer = barLayer(frameEl) as HTMLElement;
		// The bar layer is a sibling of the canvas wrapper, so it stays put while
		// the canvas moves, and paints above every possible child ZIndex.
		expect(layer.style.zIndex).toBe("2147483647");
		expect(layer.style.pointerEvents).toBe("none");
		const thumb = layer.querySelector(
			'[data-loom-scrollbar="Y"]',
		) as HTMLElement;
		// One rounded thumb, 12px default thickness, down the right edge — the
		// engine's bar has no end buttons.
		expect(layer.children.length).toBe(1);
		expect(thumb.style.left).toBe("88px");
		expect(thumb.style.width).toBe("12px");
		expect(thumb.style.borderRadius).toBe("6px");
		// Track = the 100px window; thumb = its share of the 300px canvas.
		expect(thumb.style.top).toBe("0px");
		expect(Number.parseFloat(thumb.style.height)).toBeCloseTo(100 / 3, 4);
		expect(thumb.style.pointerEvents).toBe("auto");
		expect(thumb.style.background).toBe("rgba(153, 153, 153, 1)"); // untinted grey
		session.dispose();
	});

	it("leaves the corner free when both bars are up", () => {
		const session = makeSession(new Map());
		session.patch(
			overflowScene(300, { CanvasSize: prop.udim2(udim2(0, 400, 0, 300)) }),
			overflowLayout(),
		);
		const vertical = mount.querySelector(
			'[data-loom-scrollbar="Y"]',
		) as HTMLElement;
		const horizontal = mount.querySelector(
			'[data-loom-scrollbar="X"]',
		) as HTMLElement;
		// Each bar's track stops a thickness short, so neither runs under the
		// other: 100 - 12 = 88 of track apiece.
		expect(Number.parseFloat(vertical.style.height)).toBeCloseTo(
			(88 * 100) / 300,
			4,
		);
		expect(Number.parseFloat(horizontal.style.width)).toBeCloseTo(
			(88 * 100) / 400,
			4,
		);
		expect(horizontal.style.top).toBe("88px");
		expect(vertical.style.left).toBe("88px");
		session.dispose();
	});

	it("has no bar without overflow, and drops it again when the canvas shrinks", () => {
		const session = makeSession(new Map());
		session.patch(overflowScene(100), overflowLayout());
		const frameEl = mount.querySelector(
			'[data-loom-id="scroll"]',
		) as HTMLElement;
		expect(frameEl.querySelector("[data-loom-scrollbar]")).toBe(null);

		session.patch(overflowScene(300), overflowLayout());
		expect(frameEl.querySelector("[data-loom-scrollbar]")).not.toBe(null);

		session.patch(overflowScene(100), overflowLayout());
		expect(frameEl.querySelector("[data-loom-scrollbar]")).toBe(null);
		session.dispose();
	});

	it("hides the bar for ScrollingEnabled=false, a zero thickness, or the other axis", () => {
		const session = makeSession(new Map());
		const frameEl = () =>
			mount.querySelector('[data-loom-id="scroll"]') as HTMLElement;
		const cases: Record<string, PropertyValue>[] = [
			{ ScrollingEnabled: prop.bool(false) },
			{ ScrollBarThickness: prop.int(0) },
			{
				ScrollingDirection: prop.enum({
					enumType: "ScrollingDirection",
					name: "X",
					value: 1,
				}),
			},
		];
		for (const properties of cases) {
			session.patch(overflowScene(300, properties), overflowLayout());
			expect(frameEl().querySelector("[data-loom-scrollbar]")).toBe(null);
		}
		session.dispose();
	});

	it("moves the thumb with CanvasPosition and colors it from ScrollBarImageColor3", () => {
		const session = makeSession(new Map());
		const scene = overflowScene(300, {
			CanvasPosition: prop.vector2({ x: 0, y: 200 }),
			ScrollBarImageColor3: prop.color3(color3FromRGB(255, 0, 0)),
		});
		session.patch(scene, overflowLayout());
		const thumb = mount.querySelector(
			'[data-loom-scrollbar="Y"]',
		) as HTMLElement;
		// Fully scrolled (canvas 300 - window 100 = 200): the thumb sits at the far
		// end of its travel, flush with the bottom of the track.
		expect(Number.parseFloat(thumb.style.top)).toBeCloseTo(100 - 100 / 3, 4);
		expect(thumb.style.background).toBe("rgba(255, 0, 0, 1)");
		session.dispose();
	});

	it("scrolls the frame by dragging the thumb", () => {
		const frame = createInstance("ScrollingFrame", "Scroll");
		const frameId = getInternalId(frame);
		const scene: SceneNode = {
			className: "ScrollingFrame",
			name: "Scroll",
			id: frameId,
			properties: { CanvasSize: prop.udim2(udim2(0, 100, 0, 300)) },
		};
		const layout = layoutOf({
			[frameId]: { x: 0, y: 0, width: 100, height: 100 },
		});
		const session = makeSession(new Map([[frameId, frame]]));
		session.patch(scene, layout);
		frame.AbsoluteWindowSize = Vector2.new(100, 100);
		frame.AbsoluteCanvasSize = Vector2.new(100, 300);
		const thumb = mount.querySelector(
			'[data-loom-scrollbar="Y"]',
		) as HTMLElement;

		// Track 100, thumb 100/3 -> the ~66.7px of travel is worth the whole
		// 200px of canvas.
		const ratio = Number(thumb.dataset.loomScrollRatio);
		expect(ratio).toBeCloseTo(200 / (100 - 100 / 3), 5);

		firePointer(thumb, "pointerdown", { clientX: 94, clientY: 20 });
		firePointer(thumb, "pointermove", { clientX: 94, clientY: 30 });
		expect((frame.CanvasPosition as Vector2).Y).toBeCloseTo(10 * ratio, 5);

		// Mapped from where the grab started, not accumulated: a pointer that runs
		// past the end and comes back lands where the thumb would be.
		firePointer(thumb, "pointermove", { clientX: 94, clientY: 500 });
		expect((frame.CanvasPosition as Vector2).Y).toBe(200); // clamped
		firePointer(thumb, "pointermove", { clientX: 94, clientY: 25 });
		expect((frame.CanvasPosition as Vector2).Y).toBeCloseTo(5 * ratio, 5);
		firePointer(thumb, "pointerup", { clientX: 94, clientY: 25 });

		// The drag is over: a later move must not keep scrolling.
		firePointer(thumb, "pointermove", { clientX: 94, clientY: 60 });
		expect((frame.CanvasPosition as Vector2).Y).toBeCloseTo(5 * ratio, 5);
		session.dispose();
	});

	it("renderScene paints the same bars as the session", () => {
		const session = makeSession(new Map());
		session.patch(overflowScene(300), overflowLayout());
		const sessionHtml = withoutIds(mount.innerHTML);
		const oneShot = document.createElement("div");
		renderScene(overflowScene(300), overflowLayout(), oneShot);
		expect(oneShot.innerHTML).toBe(sessionHtml);
		session.dispose();
	});

	// --- scaled mount (?base= logical viewport) + touch --------------------------

	/**
	 * Pretend the mount is `rendered` px wide on screen while laying out at
	 * `layoutWidth` — what `@loom-dev/preview`'s `?base=` does (CSS-transform the
	 * whole stage down, keep the wide logical viewport).
	 * happy-dom lays nothing out, so both measurements are stubbed.
	 */
	function scaleMount(rendered: number, layoutWidth: number): number {
		Object.defineProperty(mount, "offsetWidth", {
			value: layoutWidth,
			configurable: true,
		});
		mount.getBoundingClientRect = () =>
			({
				x: 0,
				y: 0,
				left: 0,
				top: 0,
				right: rendered,
				bottom: rendered,
				width: rendered,
				height: rendered,
				toJSON: () => ({}),
			}) as DOMRect;
		return rendered / layoutWidth;
	}

	it("maps pointer coordinates back through a scaled mount", () => {
		const button = createInstance("TextButton", "Button");
		const buttonId = getInternalId(button);
		const session = makeSession(new Map([[buttonId, button]]));
		session.patch(
			{ className: "TextButton", name: "Button", id: buttonId },
			layoutOf({ [buttonId]: { x: 0, y: 0, width: 100, height: 40 } }),
		);
		const el = mount.querySelector(`[data-loom-id="${buttonId}"]`) as Element;
		const scale = scaleMount(390, 1280);

		const inputs: InputObject[] = [];
		getEventSignal(button, "InputBegan").Connect((input) =>
			inputs.push(input as InputObject),
		);
		// On-screen pixels in, layout pixels (the space rects live in) out.
		firePointer(el, "pointerdown", { clientX: 39, clientY: 12 });

		expect(inputs[0]?.Position.X).toBeCloseTo(39 / scale);
		expect(inputs[0]?.Position.Y).toBeCloseTo(12 / scale);
		session.dispose();
	});

	/** A ScrollingFrame with a button inside it, both live instances. */
	function mountTouchScroll() {
		const frame = createInstance("ScrollingFrame", "Scroll");
		const button = createInstance("TextButton", "Item");
		const frameId = getInternalId(frame);
		const buttonId = getInternalId(button);
		const session = makeSession(
			new Map([
				[frameId, frame],
				[buttonId, button],
			]),
		);
		session.patch(
			{
				className: "ScrollingFrame",
				name: "Scroll",
				id: frameId,
				children: [{ className: "TextButton", name: "Item", id: buttonId }],
			},
			layoutOf({
				[frameId]: { x: 0, y: 0, width: 100, height: 100 },
				[buttonId]: { x: 0, y: 0, width: 100, height: 40 },
			}),
		);
		// World feedback normally sets these; simulate it.
		frame.AbsoluteWindowSize = Vector2.new(100, 100);
		frame.AbsoluteCanvasSize = Vector2.new(100, 300);
		let activated = 0;
		getEventSignal(button, "Activated").Connect(() => {
			activated += 1;
		});
		return {
			session,
			frame,
			el: mount.querySelector(`[data-loom-id="${buttonId}"]`) as Element,
			canvasY: () => (frame.CanvasPosition as Vector2).Y,
			activated: () => activated,
		};
	}

	it("scrolls a ScrollingFrame from a touch drag instead of tapping through", () => {
		const { session, el, canvasY, activated } = mountTouchScroll();
		const touch = { pointerType: "touch", pointerId: 1 };

		firePointer(el, "pointerdown", { ...touch, clientX: 10, clientY: 100 });
		// Finger up the screen → content follows → canvas moves down.
		firePointer(el, "pointermove", { ...touch, clientX: 10, clientY: 60 });
		expect(canvasY()).toBe(40);
		firePointer(el, "pointermove", { ...touch, clientX: 10, clientY: 40 });
		expect(canvasY()).toBe(60);

		// The finger left the control: the drag must not also press the button.
		firePointer(el, "pointerup", { ...touch, clientX: 10, clientY: 40 });
		expect(activated()).toBe(0);
		session.dispose();
	});

	it("still activates on a touch tap that never left the slop radius", () => {
		const { session, el, canvasY, activated } = mountTouchScroll();
		const touch = { pointerType: "touch", pointerId: 1 };

		firePointer(el, "pointerdown", { ...touch, clientX: 10, clientY: 100 });
		firePointer(el, "pointermove", { ...touch, clientX: 11, clientY: 98 });
		firePointer(el, "pointerup", { ...touch, clientX: 11, clientY: 98 });

		expect(activated()).toBe(1);
		expect(canvasY()).toBe(2); // the jitter still moved the canvas, as Roblox does
		session.dispose();
	});

	it("leaves a mouse drag over a ScrollingFrame alone", () => {
		const { session, el, canvasY, activated } = mountTouchScroll();

		firePointer(el, "pointerdown", { clientX: 10, clientY: 100 });
		firePointer(el, "pointermove", { clientX: 10, clientY: 40 });
		firePointer(el, "pointerup", { clientX: 10, clientY: 40 });

		expect(canvasY()).toBe(0); // mouse scrolling is the wheel's job
		expect(activated()).toBe(1);
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

describe("text clipping", () => {
	// The renderer keeps the face box it measured per font-and-size, so the ratio
	// each test sets only reaches it once that is dropped — which is exactly what
	// a face finishing its download does, through the same notification.
	beforeEach(async () => {
		clearRegisteredFonts();
		await Promise.resolve();
	});

	afterEach(async () => {
		stubFaceRatio = 0;
		stubSmallFaceRatio = undefined;
		clearRegisteredFonts();
		await Promise.resolve();
	});

	/** The text overlay of a painted label. */
	function layerOf(properties: SceneNode["properties"]): HTMLElement {
		const host = document.createElement("div");
		renderScene(
			{
				className: "TextLabel",
				name: "Label",
				id: "label",
				properties: { Text: prop.string("activity"), ...properties },
			},
			layoutOf({ label: { x: 0, y: 0, width: 100, height: 40 } }),
			host,
		);
		const layer = [...host.querySelectorAll("div")].find(
			(el) => el.style.fontSize !== "",
		);
		if (!layer) throw new Error("no text layer painted");
		return layer;
	}

	it("sizes the font so the face occupies TextSize", () => {
		// `TextSize` is the height of the whole face, not the em. A face 1.25 em
		// tall asked for TextSize 20 is a 16px font — painting 20px drew every
		// glyph 25% too big, and wrapped the text that much early.
		stubFaceRatio = 1.25;
		expect(layerOf({ TextSize: prop.number(20) }).style.fontSize).toBe("16px");
		// Nothing overhangs a box the face was just fitted to, so the clip rect
		// the renderer used to need is flush.
		const layer = layerOf({ TextSize: prop.number(20) });
		expect([layer.style.top, layer.style.bottom]).toEqual(["", ""]);
		expect(layer.style.boxSizing).toBe("");
	});

	it("keeps the 1:1 mapping when the browser reports no metrics", () => {
		// happy-dom's real answer, and any browser without `fontBoundingBox*`:
		// there is nothing to convert by, so the old behaviour stands rather than
		// a guess.
		stubFaceRatio = 0;
		expect(layerOf({ TextSize: prop.number(21) }).style.fontSize).toBe("21px");
	});

	it("grows the clip rect when the face overhangs anyway", () => {
		// The conversion reads the face at 100px; a browser that hints small sizes
		// differently can still hand back a line box taller than `TextSize`. At
		// TextSize 20 a 1.2 box is 2px over each edge, plus the renderer's pixel
		// of slack. Without the room the last line's descenders were cut off.
		stubFaceRatio = 1;
		stubSmallFaceRatio = 1.2;
		const layer = layerOf({ TextSize: prop.number(20) });
		expect([layer.style.top, layer.style.bottom]).toEqual(["-3px", "-3px"]);
		// Padding hands the content box its original height straight back, so the
		// text sits exactly where it did before; only the clip moved.
		expect([layer.style.paddingTop, layer.style.paddingBottom]).toEqual([
			"3px",
			"3px",
		]);
		expect(layer.style.boxSizing).toBe("border-box");
		expect(layer.style.overflow).toBe("hidden");
	});

	it("re-reads the ratio when a face arrives", async () => {
		// The ratio belongs to the face, not to the name it was asked for: a
		// registration (or a download finishing) puts a different typeface behind
		// an unchanged stack, and a size converted through the old one is wrong
		// for it.
		const font = { family: "Gotham", weight: "400", italic: false };
		stubFaceRatio = 1.25;
		expect(cssFontSize(font, 20)).toBe(16);
		stubFaceRatio = 1;
		expect(cssFontSize(font, 20)).toBe(16); // cached, nothing has changed

		registerFont("Gotham", { family: "Builder Sans" });
		await Promise.resolve();
		expect(cssFontSize(font, 20)).toBe(20);
	});

	it("measures at the size it paints", async () => {
		// The whole point of doing this in `fontShorthand`: every measurer in the
		// workspace goes through it, so none of them can drift from the paint.
		stubFaceRatio = 1.25;
		clearRegisteredFonts();
		await Promise.resolve();
		expect(
			fontShorthand({ family: "Arial", weight: "700", italic: true }, 20),
		).toBe("italic 700 16px Arial");
	});

	it("needs the same room whatever LineHeight asks for", () => {
		// The lines after the first are spaced `TextSize * LineHeight` apart in
		// both renderers, so they cancel: what overhangs is one face box against
		// one TextSize, however the rest of the block is spread out.
		stubFaceRatio = 1;
		stubSmallFaceRatio = 1.2;
		const single = layerOf({ TextSize: prop.number(22) });
		const spaced = layerOf({
			TextSize: prop.number(22),
			LineHeight: prop.number(2.4),
		});
		expect(spaced.style.top).toBe(single.style.top);
		expect(spaced.style.paddingTop).toBe(single.style.paddingTop);
	});

	it("repaints a label whose LineHeight is all that changed", () => {
		const mount = document.createElement("div");
		document.body.appendChild(mount);
		const session = createDomSession(mount, {
			resolveInstance: () => undefined,
		});
		const scene = (lineHeight: number): SceneNode => ({
			className: "ScreenGui",
			name: "Gui",
			id: "gui",
			children: [
				{
					className: "TextLabel",
					name: "Label",
					id: "label",
					properties: {
						Text: prop.string("activity"),
						TextSize: prop.number(18),
						LineHeight: prop.number(lineHeight),
					},
				},
			],
		});
		const layout = layoutOf({
			gui: { x: 0, y: 0, width: 200, height: 100 },
			label: { x: 0, y: 0, width: 100, height: 40 },
		});
		const lineHeightOf = (): string => {
			const el = mount.querySelector('[data-loom-id="label"]');
			const layer = el?.firstElementChild as HTMLElement | null;
			return layer?.style.lineHeight ?? "";
		};

		session.patch(scene(1), layout);
		expect(lineHeightOf()).toBe("18px");
		session.patch(scene(2), layout);
		expect(lineHeightOf()).toBe("36px");
		session.dispose();
	});
});

describe("image layer", () => {
	afterEach(() => {
		setImageResolver(undefined);
		clearImageSizeCache();
	});

	function imageScene(properties: SceneNode["properties"]): SceneNode {
		return {
			className: "ImageLabel",
			name: "Icon",
			id: "icon",
			properties,
		};
	}

	const iconLayout = layoutOf({
		icon: { x: 0, y: 0, width: 64, height: 64 },
	});

	const LAYER = '[data-loom-layer="image"]';

	function paint(
		properties: SceneNode["properties"],
		layout = iconLayout,
	): HTMLElement | null {
		const host = document.createElement("div");
		renderScene(imageScene(properties), layout, host);
		return host.querySelector<HTMLElement>(LAYER);
	}

	const background = (el: HTMLElement | null): string =>
		el?.style.backgroundImage ?? "";

	it("paints a plain URL without consulting the resolver", () => {
		let calls = 0;
		setImageResolver(() => {
			calls += 1;
			return "never";
		});
		const layer = paint({ Image: prop.string("https://example.test/a.png") });
		expect(background(layer)).toBe('url("https://example.test/a.png")');
		expect(calls).toBe(0);
	});

	it("leaves an asset id unpainted when no resolver is installed", () => {
		const layer = paint({ Image: prop.string("rbxassetid://1818") });
		expect(layer).not.toBeNull();
		expect(background(layer)).toBe("");
	});

	it("fills in the background once an async resolver answers", async () => {
		setImageResolver(async (image) => `https://cdn.test/${image.slice(13)}`);
		const layer = paint({ Image: prop.string("rbxassetid://1818") });
		expect(background(layer)).toBe(""); // nothing to paint yet
		await vi.waitFor(() =>
			expect(background(layer)).toBe('url("https://cdn.test/1818")'),
		);
	});

	it("resolves an asset id once, however many nodes and paints use it", async () => {
		let calls = 0;
		setImageResolver(async (image) => {
			calls += 1;
			return `https://cdn.test/${image.slice(13)}`;
		});
		const scene: SceneNode = {
			className: "Frame",
			name: "Row",
			id: "row",
			children: [
				imageScene({ Image: prop.string("rbxassetid://1818") }),
				{
					...imageScene({ Image: prop.string("rbxassetid://1818") }),
					id: "icon2",
				},
			],
		};
		const layout = layoutOf({
			row: { x: 0, y: 0, width: 128, height: 64 },
			icon: { x: 0, y: 0, width: 64, height: 64 },
			icon2: { x: 64, y: 0, width: 64, height: 64 },
		});
		const host = document.createElement("div");
		renderScene(scene, layout, host);
		await vi.waitFor(() => expect(calls).toBe(1));

		// A repaint — what the vide adapter does on every frame — must reuse the
		// resolved URL rather than resolving again, and paint it synchronously.
		renderScene(scene, layout, host);
		expect(
			[...host.querySelectorAll<HTMLElement>(LAYER)].map(
				(el) => el.style.backgroundImage,
			),
		).toEqual(['url("https://cdn.test/1818")', 'url("https://cdn.test/1818")']);
		expect(calls).toBe(1);
	});

	it("maps ScaleType onto the background size", () => {
		const sizeOf = (name?: string) =>
			paint({
				Image: prop.string("https://example.test/a.png"),
				...(name ? { ScaleType: scaleType(name) } : {}),
			})?.style.backgroundSize;
		expect(sizeOf()).toBe("100% 100%"); // Stretch is the Roblox default
		expect(sizeOf("Fit")).toBe("contain");
		expect(sizeOf("Crop")).toBe("cover");
		// Slice with no SliceCenter has no border to keep: it stretches, which is
		// what the engine shows for an empty slice rect too.
		expect(sizeOf("Slice")).toBe("100% 100%");
	});

	it("tiles from TileSize, resolved against the node in CSS", () => {
		const layer = paint({
			Image: prop.string("https://example.test/a.png"),
			ScaleType: scaleType("Tile"),
			TileSize: prop.udim2({
				x: { scale: 0, offset: 16 },
				y: { scale: 0.5, offset: 0 },
			}),
		});
		expect(layer?.style.backgroundRepeat).toBe("repeat");
		expect(layer?.style.backgroundSize).toBe("calc(0% + 16px) calc(50% + 0px)");
	});

	it("defaults TileSize to one tile filling the node", () => {
		const layer = paint({
			Image: prop.string("https://example.test/a.png"),
			ScaleType: scaleType("Tile"),
		});
		expect(layer?.style.backgroundSize).toBe(
			"calc(100% + 0px) calc(100% + 0px)",
		);
	});

	it("maps ImageTransparency onto opacity", () => {
		const layer = paint({
			Image: prop.string("https://example.test/a.png"),
			ImageTransparency: prop.number(0.25),
		});
		expect(layer?.style.opacity).toBe("0.75");
	});

	it("turns off smoothing for ResampleMode.Pixelated", () => {
		const resample = (name: string) =>
			prop.enum({ enumType: "ResamplerMode", name, value: 0 });
		expect(
			paint({
				Image: prop.string("https://example.test/a.png"),
				ResampleMode: resample("Pixelated"),
			})?.style.imageRendering,
		).toBe("pixelated");
		expect(
			paint({ Image: prop.string("https://example.test/a.png") })?.style
				.imageRendering,
		).toBe("");
	});

	it("keeps the image behind the node's children", () => {
		const host = document.createElement("div");
		renderScene(
			{
				className: "ImageButton",
				name: "Icon",
				id: "icon",
				properties: { Image: prop.string("https://example.test/a.png") },
				children: [{ className: "TextLabel", name: "Caption", id: "caption" }],
			},
			layoutOf({
				icon: { x: 0, y: 0, width: 64, height: 64 },
				caption: { x: 0, y: 0, width: 64, height: 16 },
			}),
			host,
		);
		const el = host.firstElementChild as HTMLElement;
		// The image is an overlay, so it precedes every laid-out child.
		expect(
			[...el.children].map((c) => c.getAttribute("data-loom-layer")),
		).toEqual(["image", null]);
	});

	it("rebuilds the layer only when an image prop changes", async () => {
		setImageResolver(async () => "https://cdn.test/1818");
		const mount = document.createElement("div");
		document.body.appendChild(mount);
		const session = createDomSession(mount, {
			resolveInstance: () => undefined,
		});

		session.patch(
			imageScene({ Image: prop.string("rbxassetid://1818") }),
			iconLayout,
		);
		const first = mount.querySelector<HTMLElement>(LAYER);
		await vi.waitFor(() =>
			expect(background(first)).toBe('url("https://cdn.test/1818")'),
		);

		// Same image, unrelated prop churn: the element must survive.
		session.patch(
			imageScene({
				Image: prop.string("rbxassetid://1818"),
				BackgroundTransparency: prop.number(1),
			}),
			iconLayout,
		);
		expect(mount.querySelector(LAYER)).toBe(first);

		// …and so must a resize, since nothing about this paint reads the box.
		session.patch(
			imageScene({ Image: prop.string("rbxassetid://1818") }),
			layoutOf({ icon: { x: 0, y: 0, width: 128, height: 32 } }),
		);
		expect(mount.querySelector(LAYER)).toBe(first);

		// A different image replaces it.
		session.patch(
			imageScene({ Image: prop.string("https://example.test/b.png") }),
			iconLayout,
		);
		const second = mount.querySelector<HTMLElement>(LAYER);
		expect(second).not.toBe(first);
		expect(background(second)).toBe('url("https://example.test/b.png")');

		// Dropping Image entirely removes the layer.
		session.patch(imageScene({}), iconLayout);
		expect(mount.querySelector(LAYER)).toBeNull();
		session.dispose();
	});

	describe("with the source's own size known", () => {
		// happy-dom never loads anything, so the decode step is the fake here —
		// everything downstream of `naturalWidth` is the real renderer.
		const SIZES: Record<string, { width: number; height: number }> = {
			"https://example.test/sheet.png": { width: 100, height: 50 },
			"https://example.test/panel.png": { width: 32, height: 32 },
		};
		beforeEach(() => {
			vi.stubGlobal(
				"Image",
				class {
					onload: (() => void) | null = null;
					onerror: (() => void) | null = null;
					naturalWidth = 0;
					naturalHeight = 0;
					set src(value: string) {
						const size = SIZES[value];
						queueMicrotask(() => {
							if (size) {
								this.naturalWidth = size.width;
								this.naturalHeight = size.height;
								this.onload?.();
							} else this.onerror?.();
						});
					}
				},
			);
		});
		afterEach(() => {
			vi.unstubAllGlobals();
		});

		/** Paint, then let the (faked) decode land and repaint. */
		async function painted(
			properties: SceneNode["properties"],
			layout = iconLayout,
		): Promise<HTMLElement> {
			const layer = paint(properties, layout);
			if (!layer) throw new Error("image layer not rendered");
			await new Promise((resolve) => setTimeout(resolve, 0));
			return layer;
		}

		/** The clip box a sprite window gets, and the sheet inside it. */
		const windowOf = (
			layer: HTMLElement,
		): { box: HTMLElement; sheet: HTMLElement } => {
			const box = layer.firstElementChild as HTMLElement | null;
			const sheet = box?.firstElementChild as HTMLElement | null;
			if (!box || !sheet) throw new Error("sprite window painted no child");
			return { box, sheet };
		};

		it("windows a sprite out of a sheet", async () => {
			// A 20x10 sprite at (40, 20) of a 100x50 sheet, stretched over a 64x64
			// node: the sheet scales by 64/20 and 64/10, and slides so the sprite's
			// own corner lands on the node's.
			const layer = await painted({
				Image: prop.string("https://example.test/sheet.png"),
				ImageRectOffset: prop.vector2({ x: 40, y: 20 }),
				ImageRectSize: prop.vector2({ x: 20, y: 10 }),
			});
			// A background alone would paint the sprites either side of this one all
			// over the node; the clip box is what keeps them out.
			expect(layer.style.backgroundImage).toBe("");
			const { box, sheet } = windowOf(layer);
			expect(box.style.overflow).toBe("hidden");
			// Stretch gives the window the whole node.
			expect([box.style.left, box.style.top]).toEqual(["0px", "0px"]);
			expect([box.style.width, box.style.height]).toEqual(["64px", "64px"]);
			expect(sheet.style.backgroundImage).toBe(
				'url("https://example.test/sheet.png")',
			);
			expect([sheet.style.width, sheet.style.height]).toEqual([
				"320px",
				"320px",
			]);
			expect([sheet.style.left, sheet.style.top]).toEqual(["-128px", "-128px"]);
		});

		it("fits a sprite window inside the node, centred", async () => {
			// 20x10 sprite, 64x64 node, Fit: scale 3.2 on both axes (the smaller),
			// leaving (64 - 32) / 2 = 16px above and below.
			const layer = await painted({
				Image: prop.string("https://example.test/sheet.png"),
				ScaleType: scaleType("Fit"),
				ImageRectOffset: prop.vector2({ x: 40, y: 20 }),
				ImageRectSize: prop.vector2({ x: 20, y: 10 }),
			});
			const { box, sheet } = windowOf(layer);
			// The window is 64x32 and centred; the sheet inside it is the whole
			// 100x50 source at the same scale.
			expect([box.style.left, box.style.top]).toEqual(["0px", "16px"]);
			expect([box.style.width, box.style.height]).toEqual(["64px", "32px"]);
			expect([sheet.style.width, sheet.style.height]).toEqual([
				"320px",
				"160px",
			]);
			expect([sheet.style.left, sheet.style.top]).toEqual(["-128px", "-64px"]);
		});

		it("ignores a zero-sized sprite window, like the engine", async () => {
			const layer = await painted({
				Image: prop.string("https://example.test/sheet.png"),
				ImageRectOffset: prop.vector2({ x: 40, y: 20 }),
				ImageRectSize: prop.vector2({ x: 0, y: 0 }),
			});
			expect(layer.style.backgroundSize).toBe("100% 100%");
			expect(layer.style.backgroundPosition).toBe("center center");
		});

		it("9-slices from SliceCenter, in source pixels", async () => {
			// A 32x32 panel with an 8px border all round: the slice insets are the
			// distances from each edge to SliceCenter, and SliceScale doubles the
			// painted border without touching the source.
			const layer = await painted({
				Image: prop.string("https://example.test/panel.png"),
				ScaleType: scaleType("Slice"),
				SliceCenter: prop.rect({ min: { x: 8, y: 8 }, max: { x: 24, y: 24 } }),
				SliceScale: prop.number(2),
			});
			expect(layer.style.borderImageSource).toBe(
				'url("https://example.test/panel.png")',
			);
			expect(layer.style.borderImageSlice).toBe("8 fill");
			expect(layer.style.borderImageWidth).toBe("16px"); // 8 * SliceScale
			expect(layer.style.borderImageRepeat).toBe("stretch");
			// The border image must not push the node's own box around.
			expect(layer.style.borderWidth).toBe("0px");
			expect(layer.style.backgroundImage).toBe("");
		});

		it("keeps each slice on its own side when they differ", async () => {
			// Min (4, 8), Max (20, 28) of a 32x32 source: left 4, top 8, right 12,
			// bottom 4 — in CSS's top/right/bottom/left order.
			const layer = await painted({
				Image: prop.string("https://example.test/panel.png"),
				ScaleType: scaleType("Slice"),
				SliceCenter: prop.rect({ min: { x: 4, y: 8 }, max: { x: 20, y: 28 } }),
			});
			expect(layer.style.borderImageWidth).toBe("8px 12px 4px 4px");
		});

		it("stretches instead when SliceCenter leaves no centre", async () => {
			const layer = await painted({
				Image: prop.string("https://example.test/panel.png"),
				ScaleType: scaleType("Slice"),
				SliceCenter: prop.rect({
					min: { x: 16, y: 16 },
					max: { x: 16, y: 16 },
				}),
			});
			expect(layer.style.backgroundSize).toBe("100% 100%");
			expect(layer.style.borderImageSource).toBe("");
		});

		it("re-paints a sprite window when the node is resized", async () => {
			setImageResolver(undefined);
			const mount = document.createElement("div");
			const session = createDomSession(mount, {
				resolveInstance: () => undefined,
			});
			const sprite = {
				Image: prop.string("https://example.test/sheet.png"),
				ImageRectOffset: prop.vector2({ x: 0, y: 0 }),
				ImageRectSize: prop.vector2({ x: 50, y: 25 }),
			};
			const sheetWidth = () =>
				mount.querySelector<HTMLElement>(`${LAYER} > div > div`)?.style.width;
			session.patch(imageScene(sprite), iconLayout);
			await vi.waitFor(() => expect(sheetWidth()).toBe("128px"));
			session.patch(
				imageScene(sprite),
				layoutOf({ icon: { x: 0, y: 0, width: 100, height: 25 } }),
			);
			await vi.waitFor(() => expect(sheetWidth()).toBe("200px"));
			session.dispose();
		});
	});
});
