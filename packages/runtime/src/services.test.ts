import { afterEach, describe, expect, it, vi } from "vitest";
import { Vector2 } from "./datatypes";
import { Enum, type EnumItem, RobloxEnum } from "./enums";
import { game } from "./game";
import type { InputObject } from "./input";
import { createInstance, getEventSignal, type LoomInstance } from "./instance";
import { renderStepped } from "./scheduler";
import {
	clearInputState,
	setContentResolver,
	setKeyState,
	setMouseButtonState,
	setTextMeasurer,
	setViewportSize,
} from "./services";
import type { LoomSignal } from "./signal";

describe("game.GetService", () => {
	it("returns stable singletons", () => {
		const players = game.GetService("Players");
		expect(players).toBe(game.GetService("Players"));
		expect(players.ClassName).toBe("Players");
		expect(players.Parent).toBe(game);
	});

	it("stubs unknown services, staying quiet until a missing member is read", () => {
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		const stub = game.GetService("TeleportService");
		expect(stub.ClassName).toBe("TeleportService");
		expect(stub).toBe(game.GetService("TeleportService"));
		// Resolving the service says nothing yet. `@rbxts/services` is a barrel,
		// so merely importing one service evaluates every export in it; warning
		// here buried the real warning under services the app never mentioned.
		// The tree API a stub genuinely supports stays silent too.
		expect(warnSpy).not.toHaveBeenCalled();
		expect(stub.Parent).toBe(game);
		expect(stub.IsA("Instance")).toBe(true);
		expect(warnSpy).not.toHaveBeenCalled();
		// Reaching for something the stub does not have is the moment worth a word.
		expect(stub.SomeMissingMember).toBeUndefined();
		expect(warnSpy).toHaveBeenCalledTimes(1);
		expect(String(warnSpy.mock.calls[0]?.[0])).toContain("TeleportService");
		warnSpy.mockRestore();
	});

	it("warns once for a stub, and refuses its method calls by name", () => {
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		const service = game.GetService("MarketplaceService");
		// Cached: the second resolution neither rebuilds nor re-warns.
		expect(game.GetService("MarketplaceService")).toBe(service);
		expect(service.SomeMissingMember).toBeUndefined();
		expect(warnSpy).toHaveBeenCalledTimes(1);
		// Still once, however many missing members are read afterwards.
		expect(service.AnotherMissingMember).toBeUndefined();
		expect(warnSpy).toHaveBeenCalledTimes(1);
		warnSpy.mockRestore();

		const prompt = service.PromptGamePassPurchase as () => unknown;
		expect(prompt).toBeTypeOf("function");
		expect(prompt).toThrow(
			/\[loom\] MarketplaceService:PromptGamePassPurchase\(\) is not implemented/,
		);
		// The `Async` suffix is a method name all on its own.
		expect(service.UserOwnsGamePassAsync as () => unknown).toThrow(
			/MarketplaceService:UserOwnsGamePassAsync\(\)/,
		);
	});

	it("leaves a stub's plain property reads undefined", () => {
		const service = game.GetService("MarketplaceService");
		// Nouns and participles are properties, not calls — a stub that answered
		// every read with a function would break `if service.Enabled then`.
		expect(service.Enabled).toBeUndefined();
		expect(service.Loaded).toBeUndefined();
		expect(service.SomeUnknownProperty).toBeUndefined();
		// It is a real instance underneath, so the tree API still works.
		expect(service.IsA("Instance")).toBe(true);
		expect(service.GetFullName()).toBe("MarketplaceService");
		expect(game.FindFirstChild("MarketplaceService")?.ClassName).toBe(
			"MarketplaceService",
		);
	});
});

describe("the DataModel itself", () => {
	it("builds a service the first time its game.<Name> property is read", () => {
		// Nothing has asked for ServerStorage yet, so it is not a child of `game`
		// — reading the property is what constructs it.
		expect(game.FindFirstChild("ServerStorage")).toBeUndefined();
		const serverStorage = game.ServerStorage as LoomInstance;
		expect(serverStorage.ClassName).toBe("ServerStorage");
		expect(serverStorage).toBe(game.GetService("ServerStorage"));
		expect(game.FindFirstChild("ServerStorage")).toBe(serverStorage);
	});

	it("reaches the well-known services as properties, as Roblox does", () => {
		expect(game.Workspace).toBe(game.GetService("Workspace"));
		expect(game.Players).toBe(game.GetService("Players"));
		expect(game.Lighting).toBe(game.GetService("Lighting"));
		expect(game.ReplicatedStorage).toBe(game.GetService("ReplicatedStorage"));
	});

	it("FindService answers for real services without minting a stub", () => {
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		const findService = game.FindService as (
			name: string,
		) => LoomInstance | undefined;
		expect(findService("Workspace")).toBe(game.GetService("Workspace"));
		expect(findService("NotARealService")).toBeUndefined();
		// Asking did not register one, and did not warn about one either.
		expect(findService("NotARealService")).toBeUndefined();
		expect(warnSpy).not.toHaveBeenCalled();
		warnSpy.mockRestore();
	});

	it("reports the identity of an unpublished place", () => {
		expect(game.PlaceId).toBe(0);
		expect(game.GameId).toBe(0);
		expect(game.JobId).toBe("");
	});

	it("is already loaded, and still runs a late Loaded handler", async () => {
		expect((game.IsLoaded as () => boolean)()).toBe(true);
		const loaded = game.Loaded as LoomSignal<[]>;
		const calls: number[] = [];
		const connection = loaded.Connect(() => calls.push(1));
		// Deferred, not synchronous: the engine never fires inside `Connect`.
		expect(calls).toEqual([]);
		await Promise.resolve();
		expect(calls).toEqual([1]);
		// Once only, exactly like the engine's own.
		await Promise.resolve();
		expect(calls).toEqual([1]);
		connection.Disconnect();
		// `Wait()` resolves for the same reason, instead of hanging forever.
		await expect(loaded.Wait()).resolves.toEqual([]);
	});

	it("runs BindToClose callbacks when the page goes away", () => {
		const closed: string[] = [];
		const bindToClose = game.BindToClose as (callback: () => void) => void;
		bindToClose(() => closed.push("saved"));
		bindToClose(() => {
			throw new Error("a bad shutdown hook");
		});
		bindToClose(() => closed.push("also saved"));
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		dispatchEvent(new Event("pagehide"));

		// Every hook runs, including the ones after the one that threw.
		expect(closed).toEqual(["saved", "also saved"]);
		expect(errorSpy).toHaveBeenCalledTimes(1);
		errorSpy.mockRestore();
	});
});

describe("Players", () => {
	it("pre-builds LocalPlayer with a synchronous PlayerGui", () => {
		const players = game.GetService("Players");
		const localPlayer = players.LocalPlayer as LoomInstance;
		expect(localPlayer.ClassName).toBe("Player");
		const playerGui = localPlayer.WaitForChild("PlayerGui");
		expect(playerGui).toBeDefined();
		expect(playerGui?.IsA("PlayerGui")).toBe(true);
		expect(playerGui?.IsA("BasePlayerGui")).toBe(true);
		expect(playerGui?.GetGuiObjectsAtPosition).toBeTypeOf("function");
		const atPosition = (
			playerGui?.GetGuiObjectsAtPosition as (
				x: number,
				y: number,
			) => LoomInstance[]
		)(10, 10);
		expect(atPosition).toEqual([]);
	});

	it("answers the attribute API on LocalPlayer", () => {
		// The real consumer: an app-owned player attribute is how a game carries
		// a setting that is readable from anywhere and survives a rejoin, and
		// Vela's runtime resolves `dark:` off exactly this one.
		const localPlayer = game.GetService("Players").LocalPlayer as LoomInstance;
		const seen: string[] = [];
		localPlayer
			.GetAttributeChangedSignal("VelaColorScheme")
			.Connect(() =>
				seen.push(String(localPlayer.GetAttribute("VelaColorScheme"))),
			);

		expect(localPlayer.GetAttribute("VelaColorScheme")).toBeUndefined();
		localPlayer.SetAttribute("VelaColorScheme", "dark");
		expect(localPlayer.GetAttribute("VelaColorScheme")).toBe("dark");
		expect(seen).toEqual(["dark"]);

		localPlayer.SetAttribute("VelaColorScheme", undefined);
	});

	it("seeds a stable, clearly fake identity on LocalPlayer", () => {
		const player = game.GetService("Players").LocalPlayer as LoomInstance;
		expect(player.UserId).toBe(1234567890);
		expect(player.DisplayName).toBe("Loom Player");
		expect(player.AccountAge).toBe(365);
		// An `EnumItem`, not a string: a profile card comparing against
		// `Enum.MembershipType.None` has to be able to read `.Name`/`.Value`.
		const membership = player.MembershipType as EnumItem;
		expect(membership.Name).toBe("None");
		expect(membership.Value).toBe(0);
		expect(String(membership)).toBe("Enum.MembershipType.None");
	});

	it("returns a loadable Roblox thumbnail URL, and says it is ready", () => {
		const players = game.GetService("Players");
		const thumbnail = players.GetUserThumbnailAsync as (
			userId: number,
			thumbnailType?: unknown,
			thumbnailSize?: unknown,
		) => [string, boolean];

		const [content, isReady] = thumbnail(42, "HeadShot", "Size150x150");
		expect(content).toBe(
			"https://www.roblox.com/headshot-thumbnail/image?userId=42&width=150&height=150&format=png",
		);
		expect(isReady).toBe(true);

		expect(thumbnail(7, "AvatarBust", "Size48x48")[0]).toBe(
			"https://www.roblox.com/bust-thumbnail/image?userId=7&width=48&height=48&format=png",
		);
		// Arguments it cannot read fall back to a full-body avatar at 420px,
		// rather than to a URL nothing can load.
		expect(thumbnail(7)[0]).toBe(
			"https://www.roblox.com/avatar-thumbnail/image?userId=7&width=420&height=420&format=png",
		);
	});
});

describe("GuiService", () => {
	it("fires SelectionLost(old) → SelectionGained(new) → prop signal in order", () => {
		const guiService = game.GetService("GuiService");
		const a = createInstance("TextButton", "A");
		const b = createInstance("TextButton", "B");
		const order: string[] = [];
		(a.SelectionLost as LoomSignal<unknown[]>).Connect(() =>
			order.push("lost:A"),
		);
		(a.SelectionGained as LoomSignal<unknown[]>).Connect(() =>
			order.push("gained:A"),
		);
		(b.SelectionGained as LoomSignal<unknown[]>).Connect(() =>
			order.push("gained:B"),
		);
		guiService
			.GetPropertyChangedSignal("SelectedObject")
			.Connect(() => order.push("prop"));

		guiService.SelectedObject = a;
		expect(order).toEqual(["gained:A", "prop"]);
		expect(guiService.SelectedObject).toBe(a);

		guiService.SelectedObject = b;
		expect(order).toEqual(["gained:A", "prop", "lost:A", "gained:B", "prop"]);

		// Same value → nothing fires.
		guiService.SelectedObject = b;
		expect(order).toHaveLength(5);

		guiService.SelectedObject = undefined;
	});

	it("clears SelectedObject automatically when the selected instance is destroyed", () => {
		const guiService = game.GetService("GuiService");
		const doomed = createInstance("TextButton", "Doomed");
		const order: string[] = [];
		guiService
			.GetPropertyChangedSignal("SelectedObject")
			.Connect(() => order.push("prop"));

		guiService.SelectedObject = doomed;
		expect(guiService.SelectedObject).toBe(doomed);

		doomed.Destroy();
		expect(guiService.SelectedObject).toBeUndefined();
		expect(order).toEqual(["prop", "prop"]);

		// A later selection still works normally (the destroy hook detached).
		const next = createInstance("TextButton", "Next");
		guiService.SelectedObject = next;
		expect(guiService.SelectedObject).toBe(next);
		guiService.SelectedObject = undefined;
	});

	it("GetGuiInset returns a destructurable zero tuple", () => {
		const guiService = game.GetService("GuiService");
		const getGuiInset = guiService.GetGuiInset as () => [Vector2, Vector2];
		const [topLeft, bottomRight] = getGuiInset();
		expect(topLeft).toEqual(Vector2.zero);
		expect(bottomRight).toEqual(Vector2.zero);
	});

	it("exposes ReducedMotionEnabled as a boolean", () => {
		const guiService = game.GetService("GuiService");
		expect(guiService.ReducedMotionEnabled).toBeTypeOf("boolean");
	});
});

describe("RunService", () => {
	const runService = (): LoomInstance => game.GetService("RunService");

	it("exposes frame signals and environment predicates", () => {
		const service = runService();
		const heartbeat = service.Heartbeat as LoomSignal<[number]>;
		expect((service.RenderStepped as LoomSignal<[number]>).Connect).toBeTypeOf(
			"function",
		);
		expect(heartbeat.Connect).toBeTypeOf("function");
		expect(service.PostSimulation).toBe(heartbeat);
		// The modern spelling of RenderStepped is the very same signal.
		expect(service.PreRender).toBe(service.RenderStepped);
		expect((service.IsStudio as () => boolean)()).toBe(false);
		expect((service.IsRunning as () => boolean)()).toBe(true);
		expect((service.IsClient as () => boolean)()).toBe(true);
	});

	it("places a preview as a running client, not a server or an editor", () => {
		const service = runService();
		// The guard shared modules actually write.
		expect((service.IsServer as () => boolean)()).toBe(false);
		expect((service.IsEdit as () => boolean)()).toBe(false);
		expect((service.IsRunMode as () => boolean)()).toBe(true);
	});

	it("fires Stepped with (time, delta) and PreSimulation with the delta", () => {
		const service = runService();
		const stepped = service.Stepped as LoomSignal<[number, number]>;
		const preSimulation = service.PreSimulation as LoomSignal<[number]>;
		expect(preSimulation).not.toBe(stepped);

		const steps: [number, number][] = [];
		const deltas: number[] = [];
		const a = stepped.Connect((time, delta) => steps.push([time, delta]));
		const b = preSimulation.Connect((delta) => deltas.push(delta));

		renderStepped.fire(0.5);
		renderStepped.fire(0.25);

		expect(steps).toHaveLength(2);
		expect(steps[0]?.[1]).toBe(0.5);
		expect(steps[1]?.[1]).toBe(0.25);
		// `time` is running time, so it advances by the delta between frames.
		expect((steps[1]?.[0] ?? 0) - (steps[0]?.[0] ?? 0)).toBeCloseTo(0.25, 10);
		// The modern name drops the leading time argument.
		expect(deltas).toEqual([0.5, 0.25]);

		a.Disconnect();
		b.Disconnect();
		// The bridge lets go of the frame loop once nobody is listening.
		renderStepped.fire(0.1);
		renderStepped.fire(0.1);
		expect(steps).toHaveLength(2);
		expect(deltas).toHaveLength(2);
	});

	it("runs render-step bindings by priority, lowest first, with the delta", () => {
		const service = runService();
		const bind = service.BindToRenderStep as (
			name: string,
			priority: number,
			callback: (deltaTime: number) => void,
		) => void;
		const unbind = service.UnbindFromRenderStep as (name: string) => void;

		const order: string[] = [];
		const deltas: number[] = [];
		// Bound out of priority order on purpose: bind order must not decide it.
		bind("camera", 200, (delta) => {
			order.push("camera");
			deltas.push(delta);
		});
		bind("input", 100, () => order.push("input"));
		bind("first", 0, () => order.push("first"));

		renderStepped.fire(0.032);
		expect(order).toEqual(["first", "input", "camera"]);
		expect(deltas).toEqual([0.032]);

		order.length = 0;
		unbind("input");
		renderStepped.fire(0.016);
		expect(order).toEqual(["first", "camera"]);

		order.length = 0;
		unbind("first");
		unbind("camera");
		renderStepped.fire(0.016);
		expect(order).toEqual([]);
	});

	it("reads the priority off an Enum.RenderPriority item too", () => {
		const service = runService();
		const bind = service.BindToRenderStep as (
			name: string,
			priority: unknown,
			callback: (deltaTime: number) => void,
		) => void;
		const unbind = service.UnbindFromRenderStep as (name: string) => void;

		// `Enum.RenderPriority` is not in the namespace yet, so this stands in
		// with the engine's own item names and values.
		const renderPriority = new RobloxEnum("RenderPriority", {
			First: 0,
			Input: 100,
			Camera: 200,
			Character: 300,
			Last: 2000,
		});
		const order: string[] = [];
		bind("late", renderPriority.FromName("Last"), () => order.push("late"));
		bind("early", renderPriority.FromName("First"), () => order.push("early"));

		renderStepped.fire(0.016);
		expect(order).toEqual(["early", "late"]);

		unbind("late");
		unbind("early");
		renderStepped.fire(0.016);
	});

	it("replaces a binding of the same name, and survives one that throws", () => {
		const service = runService();
		const bind = service.BindToRenderStep as (
			name: string,
			priority: number,
			callback: (deltaTime: number) => void,
		) => void;
		const unbind = service.UnbindFromRenderStep as (name: string) => void;

		const order: string[] = [];
		bind("hud", 100, () => order.push("old"));
		bind("hud", 100, () => order.push("new"));
		bind("boom", 50, () => {
			throw new Error("a bad render-step binding");
		});
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		renderStepped.fire(0.016);

		// The rebind replaced rather than stacked, and the thrower did not stop
		// the binding behind it.
		expect(order).toEqual(["new"]);
		expect(errorSpy).toHaveBeenCalledTimes(1);
		errorSpy.mockRestore();

		unbind("hud");
		unbind("boom");
		renderStepped.fire(0.016);
	});

	it("refuses a binding with nothing to call", () => {
		const service = runService();
		const bind = service.BindToRenderStep as (
			name: string,
			priority: number,
			callback: unknown,
		) => void;
		expect(() => bind("broken", 100, undefined)).toThrow(
			/\[loom\] RunService:BindToRenderStep\("broken"\)/,
		);
	});
});

describe("UserInputService", () => {
	const uis = (): LoomInstance => game.GetService("UserInputService");

	afterEach(() => {
		clearInputState();
	});

	it("exposes capability props and input signals", () => {
		const service = uis();
		// happy-dom presents a fine, hovering pointer and no touch points — a
		// desktop — and these are measured from exactly that.
		expect(service.MouseEnabled).toBe(true);
		expect(service.TouchEnabled).toBe(false);
		expect(service.KeyboardEnabled).toBe(true);
		expect(service.GamepadEnabled).toBe(false);
		expect((service.InputBegan as LoomSignal<unknown[]>).Connect).toBeTypeOf(
			"function",
		);
		expect(
			(service.GetFocusedTextBox as () => LoomInstance | undefined)(),
		).toBeUndefined();
		expect((service.GetMouseLocation as () => Vector2)()).toEqual(Vector2.zero);
	});

	it("reports a touch-only device as touch-enabled, not as a desktop", async () => {
		// The capability flags are read once, when the service is built, so the
		// only way to see the detection run against a different device is to
		// build the whole runtime again behind a different `matchMedia`.
		vi.resetModules();
		vi.stubGlobal("matchMedia", (query: string) => ({
			matches: query.includes("coarse"),
			addEventListener: () => {},
		}));
		try {
			await import("./services");
			const freshGame = (await import("./game")).game;
			const service = freshGame.GetService("UserInputService");
			expect(service.TouchEnabled).toBe(true);
			expect(service.MouseEnabled).toBe(false);
			expect(service.KeyboardEnabled).toBe(false);
		} finally {
			vi.unstubAllGlobals();
			vi.resetModules();
		}
	});

	it("answers IsKeyDown and GetKeysPressed from the reported key state", () => {
		const service = uis();
		const isKeyDown = service.IsKeyDown as (keyCode: unknown) => boolean;
		const getKeysPressed = service.GetKeysPressed as () => InputObject[];

		expect(isKeyDown(Enum.KeyCode.W)).toBe(false);
		expect(getKeysPressed()).toEqual([]);

		setKeyState(Enum.KeyCode.W, true);
		setKeyState(Enum.KeyCode.LeftShift, true);
		expect(isKeyDown(Enum.KeyCode.W)).toBe(true);
		expect(isKeyDown(Enum.KeyCode.LeftShift)).toBe(true);
		expect(isKeyDown(Enum.KeyCode.A)).toBe(false);
		// The engine takes the bare item name wherever it takes the item.
		expect(isKeyDown("W")).toBe(true);
		expect(isKeyDown("A")).toBe(false);

		// Roblox answers with InputObjects, not key codes.
		const pressed = getKeysPressed();
		expect(pressed.map((input) => input.KeyCode)).toEqual([
			Enum.KeyCode.W,
			Enum.KeyCode.LeftShift,
		]);
		expect(pressed[0]?.UserInputType).toBe(Enum.UserInputType.Keyboard);
		expect(pressed[0]?.UserInputState).toBe(Enum.UserInputState.Begin);

		setKeyState(Enum.KeyCode.W, false);
		expect(isKeyDown(Enum.KeyCode.W)).toBe(false);
		expect(getKeysPressed().map((input) => input.KeyCode)).toEqual([
			Enum.KeyCode.LeftShift,
		]);
	});

	it("answers IsMouseButtonPressed from the reported button state", () => {
		const service = uis();
		const isPressed = service.IsMouseButtonPressed as (
			inputType: unknown,
		) => boolean;

		expect(isPressed(Enum.UserInputType.MouseButton1)).toBe(false);
		setMouseButtonState(Enum.UserInputType.MouseButton1, true);
		expect(isPressed(Enum.UserInputType.MouseButton1)).toBe(true);
		expect(isPressed(Enum.UserInputType.MouseButton2)).toBe(false);
		expect(isPressed("MouseButton1")).toBe(true);
		setMouseButtonState(Enum.UserInputType.MouseButton1, false);
		expect(isPressed(Enum.UserInputType.MouseButton1)).toBe(false);
	});

	it("clearInputState drops everything held, so a blur cannot stick a key", () => {
		const service = uis();
		setKeyState(Enum.KeyCode.W, true);
		setMouseButtonState(Enum.UserInputType.MouseButton1, true);

		clearInputState();

		expect(
			(service.IsKeyDown as (key: unknown) => boolean)(Enum.KeyCode.W),
		).toBe(false);
		expect(
			(service.IsMouseButtonPressed as (input: unknown) => boolean)(
				Enum.UserInputType.MouseButton1,
			),
		).toBe(false);
		expect((service.GetKeysPressed as () => InputObject[])()).toEqual([]);
	});

	it("exposes the touch signals before anything has fired one", () => {
		const service = uis();
		for (const name of ["TouchStarted", "TouchMoved", "TouchEnded"]) {
			expect((service[name] as LoomSignal<unknown[]>).Connect).toBeTypeOf(
				"function",
			);
		}
		const seen: unknown[][] = [];
		const connection = (
			service.TouchStarted as LoomSignal<[unknown, boolean]>
		).Connect((touch, processed) => seen.push([touch, processed]));

		// What the renderer's DOM bridge does on a `touchstart`.
		getEventSignal(service, "TouchStarted").fire(
			{ Position: Vector2.zero },
			false,
		);

		expect(seen).toEqual([[{ Position: Vector2.zero }, false]]);
		connection.Disconnect();
	});
});

describe("ContentProvider", () => {
	/** The URLs the fake `Image` was actually asked to load, in order. */
	const requested: string[] = [];

	/**
	 * A stand-in for the browser's `Image`. A URL with `missing` in it fails, and
	 * so does anything that is not `http(s)` — a real browser cannot load an
	 * `rbxassetid://` scheme either. Both outcomes land on the next microtask, so
	 * the preload under test is genuinely asynchronous.
	 */
	class FakeImage {
		onload: (() => void) | null = null;
		onerror: (() => void) | null = null;
		#src = "";
		get src(): string {
			return this.#src;
		}
		set src(value: string) {
			this.#src = value;
			requested.push(value);
			queueMicrotask(() => {
				if (value.includes("missing") || !value.startsWith("http")) {
					this.onerror?.();
				} else this.onload?.();
			});
		}
	}

	interface ContentProviderShape extends LoomInstance {
		PreloadAsync(
			list: unknown[],
			callback?: (contentId: string, status: EnumItem) => void,
		): Promise<void>;
		GetAssetFetchStatus(contentId: string): EnumItem;
		readonly RequestQueueSize: number;
	}
	const contentProvider = (): ContentProviderShape =>
		game.GetService("ContentProvider") as ContentProviderShape;

	afterEach(() => {
		requested.length = 0;
		setContentResolver(undefined);
		vi.unstubAllGlobals();
	});

	it("really fetches each id, reports its status, and tracks the queue", async () => {
		vi.stubGlobal("Image", FakeImage);
		const service = contentProvider();
		expect(service.GetAssetFetchStatus("https://loom.test/a.png").Name).toBe(
			"None",
		);
		expect(service.RequestQueueSize).toBe(0);

		const seen: [string, string][] = [];
		const preloading = service.PreloadAsync(
			["https://loom.test/a.png", "https://loom.test/missing.png"],
			(contentId, status) => seen.push([contentId, status.Name]),
		);
		// Both requests are in flight the moment the call returns.
		expect(service.RequestQueueSize).toBe(2);

		await preloading;

		expect(service.RequestQueueSize).toBe(0);
		expect(requested).toEqual([
			"https://loom.test/a.png",
			"https://loom.test/missing.png",
		]);
		expect(seen.sort((a, b) => a[0].localeCompare(b[0]))).toEqual([
			["https://loom.test/a.png", "Success"],
			["https://loom.test/missing.png", "Failure"],
		]);
		expect(service.GetAssetFetchStatus("https://loom.test/a.png").Name).toBe(
			"Success",
		);
		expect(
			service.GetAssetFetchStatus("https://loom.test/missing.png").Name,
		).toBe("Failure");
	});

	it("preloads the content property of an instance in the list", async () => {
		vi.stubGlobal("Image", FakeImage);
		const label = createInstance("ImageLabel");
		label.Image = "https://loom.test/from-instance.png";

		await contentProvider().PreloadAsync([label, createInstance("Frame")]);

		// The Frame carries no content at all, so it is skipped rather than
		// fetched as an empty URL.
		expect(requested).toEqual(["https://loom.test/from-instance.png"]);
	});

	it("fetches through the installed content resolver", async () => {
		vi.stubGlobal("Image", FakeImage);
		setContentResolver((contentId) =>
			contentId === "rbxassetid://12345"
				? "https://loom.test/resolved.png"
				: undefined,
		);
		const service = contentProvider();

		await service.PreloadAsync(["rbxassetid://12345", "rbxassetid://999"]);

		// The resolved id was fetched at its real URL; the unresolved one was
		// handed to the browser as-is and honestly reported as a failure.
		expect(requested).toEqual([
			"https://loom.test/resolved.png",
			"rbxassetid://999",
		]);
		expect(service.GetAssetFetchStatus("rbxassetid://12345").Name).toBe(
			"Success",
		);
		expect(service.GetAssetFetchStatus("rbxassetid://999").Name).toBe(
			"Failure",
		);
	});

	it("survives a per-asset callback that throws", async () => {
		vi.stubGlobal("Image", FakeImage);
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		await expect(
			contentProvider().PreloadAsync(["https://loom.test/b.png"], () => {
				throw new Error("a bad progress handler");
			}),
		).resolves.toBeUndefined();
		expect(errorSpy).toHaveBeenCalledTimes(1);
		errorSpy.mockRestore();
	});
});

describe("Workspace", () => {
	it("pre-builds CurrentCamera and fires viewport size changes", () => {
		const workspace = game.GetService("Workspace");
		const camera = workspace.CurrentCamera as LoomInstance;
		expect(camera.ClassName).toBe("Camera");
		expect(camera.ViewportSize).toEqual(Vector2.new(1280, 720));

		const cb = vi.fn();
		camera.GetPropertyChangedSignal("ViewportSize").Connect(cb);
		setViewportSize(Vector2.new(800, 600));
		expect(cb).toHaveBeenCalledTimes(1);
		expect(camera.ViewportSize).toEqual(Vector2.new(800, 600));
		// Same size → no fire.
		setViewportSize(Vector2.new(800, 600));
		expect(cb).toHaveBeenCalledTimes(1);
		setViewportSize(Vector2.new(1280, 720));
	});
});

describe("ContextActionService", () => {
	it("BindAction/BindActionAtPriority/UnbindAction are safe no-ops", () => {
		const cas = game.GetService("ContextActionService");
		expect(() => {
			(cas.BindAction as (...args: unknown[]) => void)(
				"action",
				() => {},
				false,
			);
			(cas.BindActionAtPriority as (...args: unknown[]) => void)(
				"action",
				() => {},
				false,
				1000,
			);
			(cas.UnbindAction as (...args: unknown[]) => void)("action");
		}).not.toThrow();
	});
});

describe("HttpService", () => {
	/** RFC 9562 v4: version nibble `4`, variant nibble `8`/`9`/`a`/`b`. */
	const UUID_V4 =
		/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

	const http = (): LoomInstance => game.GetService("HttpService");
	const generateGUID = (...args: [] | [boolean]): string =>
		(http().GenerateGUID as (wrapInCurlyBraces?: boolean) => string)(...args);

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it("is a real service instance, not a plain object", () => {
		const service = http();
		expect(service.ClassName).toBe("HttpService");
		expect(service.Name).toBe("HttpService");
		expect(service.Parent).toBe(game);
		expect(service.IsA("HttpService")).toBe(true);
		expect(service.IsA("Instance")).toBe(true);
		expect(service.GetFullName()).toBe("HttpService");
	});

	it("returns the same cached singleton every time", () => {
		expect(http()).toBe(http());
	});

	it("GenerateGUID(false) returns a bare v4 UUID", () => {
		const guid = generateGUID(false);
		expect(guid).toMatch(UUID_V4);
		expect(guid).toHaveLength(36);
	});

	it("GenerateGUID(true) wraps the same value in curly braces", () => {
		const guid = generateGUID(true);
		expect(guid.startsWith("{")).toBe(true);
		expect(guid.endsWith("}")).toBe(true);
		expect(guid.slice(1, -1)).toMatch(UUID_V4);
	});

	it("defaults wrapInCurlyBraces to true, as Roblox does", () => {
		expect(generateGUID()).toMatch(/^\{.+\}$/);
		expect(generateGUID().slice(1, -1)).toMatch(UUID_V4);
	});

	it("returns a fresh value on every call", () => {
		const guids = new Set(Array.from({ length: 8 }, () => generateGUID(false)));
		expect(guids.size).toBe(8);
	});

	it("never falls back to Math.random", () => {
		const randomSpy = vi.spyOn(Math, "random");
		for (let i = 0; i < 4; i++) expect(generateGUID(false)).toMatch(UUID_V4);
		expect(randomSpy).not.toHaveBeenCalled();
	});

	it("generates a valid v4 UUID from getRandomValues alone", () => {
		// No `randomUUID` — the shape of a non-secure browsing context.
		const source = globalThis.crypto;
		vi.stubGlobal("crypto", {
			getRandomValues: (array: Uint8Array) => source.getRandomValues(array),
		});
		const guid = generateGUID(false);
		expect(guid).toMatch(UUID_V4);
		expect(generateGUID(false)).not.toBe(guid);
	});

	it("sets the version and variant bits itself in the fallback", () => {
		// All-zero entropy: whatever survives is what the implementation wrote.
		vi.stubGlobal("crypto", {
			getRandomValues: (array: Uint8Array) => array.fill(0),
		});
		expect(generateGUID(false)).toBe("00000000-0000-4000-8000-000000000000");
		// …and all-ones, for the other end of each masked nibble.
		vi.stubGlobal("crypto", {
			getRandomValues: (array: Uint8Array) => array.fill(0xff),
		});
		expect(generateGUID(false)).toBe("ffffffff-ffff-4fff-bfff-ffffffffffff");
	});

	it("throws an explicit loom error without Web Crypto", () => {
		vi.stubGlobal("crypto", undefined);
		expect(() => generateGUID(false)).toThrow(
			"[loom] HttpService.GenerateGUID requires the Web Crypto API",
		);
		// Not a weak identifier quietly handed back instead.
		vi.stubGlobal("crypto", {});
		expect(() => generateGUID(false)).toThrow(/Web Crypto API/);
	});

	it("round-trips JSON", () => {
		const service = http();
		const encode = service.JSONEncode as (value: unknown) => string;
		const decode = service.JSONDecode as (value: string) => unknown;
		expect(encode({ a: 1, b: [true, "x"] })).toBe('{"a":1,"b":[true,"x"]}');
		expect(decode('{"a":1,"b":[true,"x"]}')).toEqual({ a: 1, b: [true, "x"] });
		// `nil` encodes as null rather than returning a non-string.
		expect(encode(undefined)).toBe("null");
		expect(decode("null")).toBeNull();
		expect(() => decode("{oops")).toThrow(/\[loom\] HttpService\.JSONDecode/);
	});

	it("refuses network methods by name instead of issuing requests", () => {
		const service = http();
		for (const method of ["GetAsync", "PostAsync", "RequestAsync"]) {
			expect(service[method]).toBeTypeOf("function");
			expect(() => (service[method] as () => unknown)()).toThrow(
				new RegExp(`\\[loom\\] HttpService\\.${method} is not supported`),
			);
		}
	});
});

describe("CollectionService", () => {
	interface Tags {
		AddTag(instance: LoomInstance, tag: string): void;
		RemoveTag(instance: LoomInstance, tag: string): void;
		HasTag(instance: LoomInstance, tag: string): boolean;
		GetTags(instance: LoomInstance): string[];
		GetTagged(tag: string): LoomInstance[];
		GetAllTags(): string[];
		GetInstanceAddedSignal(tag: string): LoomSignal<[LoomInstance]>;
		GetInstanceRemovedSignal(tag: string): LoomSignal<[LoomInstance]>;
	}
	const tags = (): Tags =>
		game.GetService("CollectionService") as unknown as Tags;

	// Must run before anything else here resolves the singleton: `classParent`
	// only warns once per class, so a later spy would miss the warning.
	it("resolves as a known class without warning", () => {
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		const service = game.GetService("CollectionService");
		expect(service.IsA("CollectionService")).toBe(true);
		// A miss walks the whole chain, so an unregistered class would warn here.
		expect(service.IsA("GuiObject")).toBe(false);
		expect(warnSpy).not.toHaveBeenCalled();
		warnSpy.mockRestore();
	});

	it("adds, reports and removes tags", () => {
		const service = tags();
		const frame = createInstance("Frame");
		expect(service.HasTag(frame, "card")).toBe(false);

		service.AddTag(frame, "card");
		expect(service.HasTag(frame, "card")).toBe(true);
		expect(service.GetTags(frame)).toEqual(["card"]);
		expect(service.GetTagged("card")).toContain(frame);
		expect(service.GetAllTags()).toContain("card");

		service.RemoveTag(frame, "card");
		expect(service.HasTag(frame, "card")).toBe(false);
		expect(service.GetTagged("card")).not.toContain(frame);
	});

	it("returns fresh arrays a caller can mutate safely", () => {
		const service = tags();
		const frame = createInstance("Frame");
		service.AddTag(frame, "fresh");
		const first = service.GetTagged("fresh");
		first.length = 0;
		expect(service.GetTagged("fresh")).toContain(frame);
		service.RemoveTag(frame, "fresh");
	});

	it("fires the added and removed signals once per real change", () => {
		const service = tags();
		const frame = createInstance("Frame");
		const added: LoomInstance[] = [];
		const removed: LoomInstance[] = [];
		service.GetInstanceAddedSignal("signalled").Connect((i) => added.push(i));
		service
			.GetInstanceRemovedSignal("signalled")
			.Connect((i) => removed.push(i));

		service.AddTag(frame, "signalled");
		service.AddTag(frame, "signalled"); // already tagged — no second fire
		expect(added).toEqual([frame]);

		service.RemoveTag(frame, "signalled");
		service.RemoveTag(frame, "signalled");
		expect(removed).toEqual([frame]);
	});
});

/** The service methods this file calls, past `LoomInstance`'s `unknown` index. */
interface TextServiceShape {
	GetTextSize(
		text: string,
		fontSize: number,
		font?: unknown,
		frameSize?: Vector2,
	): Vector2;
	GetTextBoundsAsync(params: LoomInstance): Vector2;
}
interface DebrisShape {
	AddItem(instance: LoomInstance, lifetime?: number): void;
}
interface StarterGuiShape extends LoomInstance {
	SetCore(name: string, value: unknown): void;
	GetCoreGuiEnabled(coreGuiType: unknown): boolean;
}

describe("TextService", () => {
	afterEach(() => {
		setTextMeasurer(undefined);
	});

	it("measures through the installed measurer, in the requested font", () => {
		const seen: unknown[] = [];
		setTextMeasurer((request) => {
			seen.push(request);
			return { x: 71.5, y: 18 };
		});
		const service = game.GetService(
			"TextService",
		) as unknown as TextServiceShape;
		const size = service.GetTextSize(
			"Hello world",
			18,
			Enum.Font.SourceSans,
			Vector2.new(200, 1000),
		);
		// Studio measures this string at (71.5, 18) — a float width, so the
		// measurement is not rounded on the way out.
		expect(size).toEqual(Vector2.new(71.5, 18));
		expect(seen).toEqual([
			{ text: "Hello world", size: 18, font: "SourceSans", width: 200 },
		]);
	});

	it("takes the modern GetTextBoundsParams spelling too", () => {
		setTextMeasurer((request) => ({ x: request.width ?? 0, y: request.size }));
		const params = createInstance("GetTextBoundsParams");
		params.Text = "wrapped";
		params.Size = 24;
		params.Width = 120;
		const service = game.GetService(
			"TextService",
		) as unknown as TextServiceShape;
		expect(service.GetTextBoundsAsync(params)).toEqual(Vector2.new(120, 24));
	});

	it("warns once and estimates when no measurer is installed", () => {
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		const service = game.GetService(
			"TextService",
		) as unknown as TextServiceShape;
		const first = service.GetTextSize("abcd", 10);
		expect(first.Y).toBe(10);
		expect(first.X).toBeGreaterThan(0);
		service.GetTextSize("abcd", 10);
		expect(warnSpy).toHaveBeenCalledTimes(1);
		warnSpy.mockRestore();
	});
});

describe("Debris", () => {
	it("destroys the instance after its lifetime", () => {
		vi.useFakeTimers();
		const frame = createInstance("Frame");
		const parent = createInstance("Frame");
		frame.Parent = parent;
		(game.GetService("Debris") as unknown as DebrisShape).AddItem(frame, 2);
		vi.advanceTimersByTime(1999);
		expect(parent.GetChildren()).toEqual([frame]);
		vi.advanceTimersByTime(2);
		expect(parent.GetChildren()).toEqual([]);
		vi.useRealTimers();
	});

	it("survives an instance destroyed before the timer fires", () => {
		vi.useFakeTimers();
		const frame = createInstance("Frame");
		(game.GetService("Debris") as unknown as DebrisShape).AddItem(frame, 1);
		frame.Destroy();
		expect(() => vi.advanceTimersByTime(2000)).not.toThrow();
		vi.useRealTimers();
	});
});

describe("StarterGui and the container services", () => {
	it("answers the core-UI calls instead of crashing on them", () => {
		const starterGui = game.GetService("StarterGui") as StarterGuiShape;
		expect(() =>
			starterGui.SetCore("ResetButtonCallback", false),
		).not.toThrow();
		expect(starterGui.GetCoreGuiEnabled(undefined)).toBe(true);
		// It is a real container too: app code parents templates into it.
		const gui = createInstance("ScreenGui", "Template");
		gui.Parent = starterGui;
		expect(starterGui.FindFirstChild("Template")).toBe(gui);
		gui.Destroy();
	});

	it("registers the container services rather than warning about them", () => {
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		for (const name of [
			"Lighting",
			"ReplicatedFirst",
			"ReplicatedStorage",
			"SoundService",
			"StarterPack",
			"StarterPlayer",
			"Teams",
		]) {
			const service = game.GetService(name);
			expect(service.ClassName).toBe(name);
			expect(service).toBe(game.GetService(name));
		}
		expect(warnSpy).not.toHaveBeenCalled();
		warnSpy.mockRestore();
	});
});
