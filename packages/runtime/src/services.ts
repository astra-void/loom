/**
 * `services.ts` — the fake Roblox service singletons.
 *
 * GuiService (selection + reduced motion), RunService (the whole frame API —
 * environment predicates, RenderStepped/Stepped/Heartbeat and their modern
 * aliases, and priority-ordered render-step bindings), UserInputService (global
 * input signals, the held-key/held-button store, and honest device capability
 * flags), Players (LocalPlayer → PlayerGui, pre-built so `WaitForChild` works
 * synchronously, plus a clearly-fake identity and avatar thumbnails), Workspace
 * (CurrentCamera + viewport size), a real CollectionService (the tag registry
 * behind `@rbxts/react`'s `Tag` prop), a no-op ContextActionService, a
 * ContentProvider that genuinely preloads images, the deterministic slice of
 * HttpService (`GenerateGUID` over Web Crypto, plus JSON encoding), TextService
 * measuring against the renderer's own fonts, Debris on real timers,
 * StarterGui's core-UI no-ops, and the services that are only containers. Each
 * is a real `LoomInstance` parented under `game`, so `GetFullName`,
 * `GetPropertyChangedSignal`, and `IsA` behave normally.
 */
import { Vector2 } from "./datatypes";
import { Enum, EnumItem, enumName, RobloxEnum } from "./enums";
import { getService, registerService } from "./game";
import { type InputObject, makeInputObject } from "./input";
import {
	createInstance,
	getEventSignal,
	isLoomInstance,
	type LoomInstance,
	registerClassMethods,
	registerPropertyInterceptor,
	registerPropertyReader,
	setRawProperty,
} from "./instance";
import { heartbeat, renderStepped } from "./scheduler";
import { type LoomConnection, LoomSignal } from "./signal";

// --- GuiService --------------------------------------------------------------

// Watches the currently selected instance so a `Destroy()` clears the
// selection automatically (Roblox behavior — a dead instance can't stay
// selected).
let selectedDestroyingConnection: LoomConnection | undefined;

// SelectedObject fires SelectionLost(old) → SelectionGained(new) → the
// GuiService "SelectedObject" property signal, in that order.
registerPropertyInterceptor(
	"GuiService",
	"SelectedObject",
	(self, value, setRaw) => {
		const old = self.SelectedObject as LoomInstance | undefined;
		const next = value as LoomInstance | undefined;
		if (old === next) return;
		selectedDestroyingConnection?.Disconnect();
		selectedDestroyingConnection = undefined;
		if (old) getEventSignal(old, "SelectionLost").fire();
		if (next) {
			getEventSignal(next, "SelectionGained").fire();
			selectedDestroyingConnection = getEventSignal(next, "Destroying").Connect(
				() => {
					self.SelectedObject = undefined;
				},
			);
		}
		setRaw(value);
	},
);

registerClassMethods("GuiService", {
	/** Tuple destructuring shape: `const [topLeft, bottomRight] = ...`. */
	GetGuiInset: () => [Vector2.zero, Vector2.zero],
});

registerService("GuiService", () => {
	const service = createInstance("GuiService", "GuiService");
	let reduced = false;
	if (typeof matchMedia === "function") {
		try {
			const query = matchMedia("(prefers-reduced-motion: reduce)");
			reduced = query.matches;
			query.addEventListener("change", (event) => {
				// Normal property path: fires the ReducedMotionEnabled signal.
				service.ReducedMotionEnabled = event.matches;
			});
		} catch {
			// Environments without media query support keep the default.
		}
	}
	setRawProperty(service, "ReducedMotionEnabled", reduced);
	return service;
});

// --- RunService --------------------------------------------------------------

/**
 * Where a preview sits in Roblox's client/server/edit matrix.
 *
 * It is a *running client*: the DOM is the player's screen, there is no server
 * peer, and nothing is being edited. `IsServer` is the one that earns its keep —
 * shared modules open with `if RunService:IsServer() then … end` to skip the
 * half of themselves that only makes sense on a server, and a missing method
 * took the module down before its own guard could run.
 */
registerClassMethods("RunService", {
	IsStudio: () => false,
	IsRunning: () => true,
	IsClient: () => true,
	IsServer: () => false,
	IsEdit: () => false,
	IsRunMode: () => true,
	BindToRenderStep: (
		_self: LoomInstance,
		name: string,
		priority: unknown,
		callback: (deltaTime: number) => void,
	) => bindToRenderStep(name, priority, callback),
	UnbindFromRenderStep: (_self: LoomInstance, name: string) =>
		unbindFromRenderStep(name),
});

/**
 * `Stepped`, and its modern spelling `PreSimulation`, driven off the frame loop.
 *
 * Roblox runs RenderStepped → Stepped → Heartbeat; loom's scheduler exposes only
 * the two ends of that (`scheduler.ts` fires render, flushes, then fires
 * heartbeat), so the simulation phase rides the render tick. Handlers therefore
 * interleave with other `RenderStepped` listeners instead of running strictly
 * after them — the ordering *between* two different frame signals is the one
 * thing this cannot reproduce without a third scheduler phase. Everything a
 * `Stepped` handler actually reads is right: the running time, the delta, and a
 * tree nothing has flushed yet.
 *
 * The bridge is lazy in both directions. It connects on the first listener and
 * tears itself down on the first frame after the last one leaves, because a
 * permanent connection to `renderStepped` would hold the rAF loop awake for the
 * life of the page — and an idle preview is supposed to cost nothing.
 */
let simulationTime = 0;
let stepBridge: LoomConnection | undefined;

function ensureStepBridge(): void {
	if (stepBridge) return;
	stepBridge = renderStepped.Connect((delta) => {
		if (!stepped.hasConnections && !preSimulation.hasConnections) {
			stepBridge?.Disconnect();
			stepBridge = undefined;
			return;
		}
		simulationTime += delta;
		stepped.fire(simulationTime, delta);
		preSimulation.fire(delta);
	});
}

/** `RunService.Stepped` — `(time, deltaTime)`, as the engine fires it. */
const stepped = new LoomSignal<[number, number]>({
	onConnect: ensureStepBridge,
	name: "RunService.Stepped",
});

/**
 * `RunService.PreSimulation` — the same phase under the name Roblox ships now,
 * which dropped the leading `time` argument and passes only the delta. A
 * separate signal rather than an alias of `Stepped` precisely because of that:
 * aliasing would hand every `PreSimulation` handler the running time where it
 * expects the delta.
 */
const preSimulation = new LoomSignal<[number]>({
	onConnect: ensureStepBridge,
	name: "RunService.PreSimulation",
});

/**
 * `BindToRenderStep` — named per-frame callbacks, in priority order.
 *
 * Ordering is the entire point of the API: `Enum.RenderPriority` exists so a
 * camera binding at 200 can see what an input binding at 100 already wrote, and
 * a version that ran callbacks in bind order would look right in a demo and be
 * wrong in exactly the case the API was reached for. So the list is kept sorted
 * by priority, lowest first, with bind order breaking ties.
 *
 * Rebinding a live name replaces it rather than stacking a second callback —
 * the name is the identity, which is what makes `UnbindFromRenderStep(name)`
 * able to mean anything.
 */
interface RenderStepBinding {
	readonly name: string;
	readonly priority: number;
	readonly callback: (deltaTime: number) => void;
	/** Bind counter: equal priorities keep the order they were bound in. */
	readonly order: number;
}

const renderStepBindings: RenderStepBinding[] = [];
let renderStepBridge: LoomConnection | undefined;
let renderStepCounter = 0;

function bindToRenderStep(
	name: string,
	priority: unknown,
	callback: (deltaTime: number) => void,
): undefined {
	if (typeof callback !== "function") {
		throw new Error(
			`[loom] RunService:BindToRenderStep("${name}") needs a function to call`,
		);
	}
	unbindFromRenderStep(name);
	renderStepBindings.push({
		name,
		// Roblox takes a plain number here and casts nothing, but
		// `Enum.RenderPriority.Camera` is what the priority *means* and is an easy
		// thing to pass by hand; reading its `Value` is the same courtesy every
		// other enum-valued read in loom gives.
		priority:
			priority instanceof EnumItem
				? priority.Value
				: typeof priority === "number"
					? priority
					: 0,
		callback,
		order: renderStepCounter++,
	});
	renderStepBindings.sort(
		(a, b) => a.priority - b.priority || a.order - b.order,
	);
	renderStepBridge ??= renderStepped.Connect(runRenderStepBindings);
	return undefined;
}

function unbindFromRenderStep(name: string): undefined {
	const index = renderStepBindings.findIndex(
		(binding) => binding.name === name,
	);
	if (index >= 0) renderStepBindings.splice(index, 1);
	return undefined;
}

function runRenderStepBindings(delta: number): void {
	if (renderStepBindings.length === 0) {
		// Nothing left to run: let the frame loop go back to sleep.
		renderStepBridge?.Disconnect();
		renderStepBridge = undefined;
		return;
	}
	// A binding may bind or unbind others from inside its callback, so iterate a
	// snapshot and re-check membership: one that unbound itself this frame asked
	// not to be called, and one bound this frame starts next frame.
	for (const binding of [...renderStepBindings]) {
		if (!renderStepBindings.includes(binding)) continue;
		try {
			binding.callback(delta);
		} catch (err) {
			// The same isolation the signals give listeners: one bad binding must
			// not take the frame loop, and every other binding, down with it.
			console.error(
				`loom: the "${binding.name}" BindToRenderStep callback threw:`,
				err,
			);
		}
	}
}

registerService("RunService", () => {
	const service = createInstance("RunService", "RunService");
	// The scheduler owns the frame loop; the service just exposes its signals.
	setRawProperty(service, "RenderStepped", renderStepped);
	setRawProperty(service, "Stepped", stepped);
	setRawProperty(service, "Heartbeat", heartbeat);
	// The names Roblox ships now for the same three phases.
	setRawProperty(service, "PreRender", renderStepped);
	setRawProperty(service, "PreSimulation", preSimulation);
	setRawProperty(service, "PostSimulation", heartbeat);
	return service;
});

// --- UserInputService --------------------------------------------------------

let focusedTextBox: LoomInstance | undefined;

/** DOM bridge hook: record which TextBox currently holds focus. */
export function setFocusedTextBox(inst: LoomInstance | undefined): void {
	focusedTextBox = inst;
}

/** The TextBox holding focus, if any (= `UserInputService.GetFocusedTextBox`). */
export function getFocusedTextBox(): LoomInstance | undefined {
	return focusedTextBox;
}

let mouseLocation = Vector2.zero;

/** DOM bridge hook: record the latest pointer position. */
export function setMouseLocation(position: Vector2): void {
	mouseLocation = position;
}

/**
 * The held-key and held-button state behind `IsKeyDown`, `GetKeysPressed` and
 * `IsMouseButtonPressed`.
 *
 * The split is deliberate, and it is the contract with `@loom-dev/renderer`:
 * the renderer owns every DOM listener and the `KeyboardEvent.code` →
 * `Enum.KeyCode` table and reports transitions here; this side owns the state
 * and answers the service's questions from it. Neither reaches into the other,
 * so the key table can grow without touching the service and the service can
 * grow without touching the DOM.
 *
 * Keyed by item `Name` rather than by the `EnumItem`: the items are singletons,
 * but the engine also takes the bare string (`IsKeyDown("Space")`) and so does
 * every other enum-valued read in loom.
 */
const keysDown = new Map<string, EnumItem<"KeyCode">>();
const mouseButtonsDown = new Map<string, EnumItem<"UserInputType">>();

/** DOM bridge hook: a key went down (`true`) or came back up (`false`). */
export function setKeyState(key: EnumItem<"KeyCode">, down: boolean): void {
	if (down) keysDown.set(key.Name, key);
	else keysDown.delete(key.Name);
}

/** DOM bridge hook: a mouse button went down (`true`) or came up (`false`). */
export function setMouseButtonState(
	button: EnumItem<"UserInputType">,
	down: boolean,
): void {
	if (down) mouseButtonsDown.set(button.Name, button);
	else mouseButtonsDown.delete(button.Name);
}

/**
 * Drop every held key and button.
 *
 * The renderer calls this when the window loses focus. A browser stops
 * delivering `keyup` the moment focus leaves the page, so a key held through an
 * alt-tab is never reported as released and would read as held forever — the
 * classic stuck-movement-key bug, which in a preview looks like loom is broken
 * rather than like the tab changed.
 */
export function clearInputState(): void {
	keysDown.clear();
	mouseButtonsDown.clear();
}

/** `matchMedia`'s answer, or `undefined` where there is no `matchMedia`. */
function mediaMatches(query: string): boolean | undefined {
	if (typeof matchMedia !== "function") return undefined;
	try {
		return matchMedia(query).matches;
	} catch {
		// Environments without full media-query support have no opinion.
		return undefined;
	}
}

/**
 * `TouchEnabled` for the machine the preview is actually on.
 *
 * `maxTouchPoints` is the direct answer where the browser gives one; the coarse
 * pointer query catches the rest. A hybrid laptop reports both touch and mouse,
 * which is also what Roblox reports there — these are three independent
 * capabilities, not a device class.
 */
function detectTouch(): boolean {
	const points =
		typeof navigator === "undefined" ? 0 : (navigator.maxTouchPoints ?? 0);
	return points > 0 || mediaMatches("(any-pointer: coarse)") === true;
}

registerClassMethods("UserInputService", {
	GetFocusedTextBox: () => focusedTextBox,
	GetMouseLocation: () => mouseLocation,
	IsKeyDown: (_self: LoomInstance, keyCode: unknown) => {
		const name = enumName(keyCode);
		return name !== undefined && keysDown.has(name);
	},
	IsMouseButtonPressed: (_self: LoomInstance, inputType: unknown) => {
		const name = enumName(inputType);
		return name !== undefined && mouseButtonsDown.has(name);
	},
	/**
	 * Roblox answers with `InputObject`s, not key codes — handler code reads
	 * `.KeyCode` off each one — so these are built exactly the way the DOM
	 * bridge builds the ones it dispatches, with state `Begin`, because every
	 * key in the list is by definition still held.
	 */
	GetKeysPressed: (): InputObject[] =>
		[...keysDown.values()].map((keyCode) =>
			makeInputObject({
				UserInputType: Enum.UserInputType.Keyboard,
				UserInputState: Enum.UserInputState.Begin,
				KeyCode: keyCode,
			}),
		),
});

registerService("UserInputService", () => {
	const service = createInstance("UserInputService", "UserInputService");
	// Measured, not asserted. UI code branches hard on these — control-scheme
	// hints, hit-target sizes, whether a keyboard shortcut is worth showing at
	// all — and a hardcoded `TouchEnabled = false` was a lie on every phone and
	// tablet a preview runs on.
	setRawProperty(
		service,
		"MouseEnabled",
		mediaMatches("(any-pointer: fine)") ?? true,
	);
	setRawProperty(service, "TouchEnabled", detectTouch());
	// No browser API reports whether a physical keyboard exists, so hover
	// capability stands in for it: a machine with a hovering pointer is a
	// desktop and has one, a touch-only device does not. A proxy, not a fact —
	// and the closest one the platform offers.
	setRawProperty(
		service,
		"KeyboardEnabled",
		mediaMatches("(any-hover: hover)") ?? true,
	);
	// Gamepads only become visible to a page after a button press on them, so
	// there is nothing honest to report at construction time.
	setRawProperty(service, "GamepadEnabled", false);
	// InputBegan/InputChanged/InputEnded are lazy event signals on the
	// instance itself; the DOM bridge fires them via `getEventSignal`.
	//
	// The touch trio is not in the proxy's built-in event list, so it is created
	// here: `UserInputService.TouchStarted` has to resolve to a signal on the
	// first read, which is long before anything has fired one.
	for (const event of ["TouchStarted", "TouchMoved", "TouchEnded"]) {
		getEventSignal(service, event);
	}
	return service;
});

// --- Players (pre-built: WaitForChild("PlayerGui") must work synchronously) --

let hitTester: ((x: number, y: number) => LoomInstance[]) | undefined;

/** World hook: rect-based hit testing behind `GetGuiObjectsAtPosition`. */
export function setHitTester(
	fn: ((x: number, y: number) => LoomInstance[]) | undefined,
): void {
	hitTester = fn;
}

registerClassMethods("PlayerGui", {
	GetGuiObjectsAtPosition: (_self: LoomInstance, x: number, y: number) =>
		hitTester ? hitTester(x, y) : [],
});

/**
 * One item of `Enum.<type>` — from the real namespace when `enums.ts` declares
 * that type, and from an enum built here when it does not.
 *
 * The enums these services answer with — `MembershipType`, `AssetFetchStatus` —
 * are not in the namespace yet. Handing back a real `EnumItem` regardless keeps
 * everything app code reads off one correct: `.Name`, `.Value`, `.EnumType` and
 * `tostring` all match the engine today, and the moment the namespace grows the
 * type this picks up the shared item, so identity comparisons
 * (`=== Enum.MembershipType.None`) start working with no change here. The
 * alternative — a bare string, or `undefined` — is wrong in a way that survives
 * into whatever the app does with the value.
 *
 * The built enums are cached per type name so every item of one shares a single
 * `RobloxEnum`, which is what makes `item.EnumType` comparable across calls.
 */
const fallbackEnums = new Map<string, RobloxEnum>();

function enumItem<T extends string>(
	enumType: T,
	values: Record<string, number>,
	name: string,
): EnumItem<T> {
	const declared = (
		Enum as unknown as Record<string, RobloxEnum<T> | undefined>
	)[enumType];
	let enumeration = declared;
	if (!enumeration) {
		const cached = fallbackEnums.get(enumType) as RobloxEnum<T> | undefined;
		enumeration = cached ?? new RobloxEnum(enumType, values);
		fallbackEnums.set(enumType, enumeration as unknown as RobloxEnum);
	}
	// A declared enum missing the item loom asked for still gets an item built
	// against the real enum, so `tostring` reads `Enum.<Type>.<Name>` either way.
	return (
		enumeration.FromName(name) ??
		new EnumItem(enumeration, name, values[name] ?? 0)
	);
}

/** The engine's own `Enum.MembershipType` items and values. */
const MEMBERSHIP_TYPES: Record<string, number> = {
	None: 0,
	BuildersClub: 1,
	TurboBuildersClub: 2,
	OutrageousBuildersClub: 3,
	Premium: 4,
};

/**
 * The local player's identity. Every value here is invented.
 *
 * loom has no account, no session and no Roblox web API, so there is nothing
 * true to report — but there *is* UI that renders a profile card, and printing
 * `undefined` beside a blank avatar is not more honest, only less useful. These
 * are stable (a preview that re-renders must not change identity mid-session)
 * and fake on sight: `1234567890` is nobody's user id, and the display name says
 * so out loud.
 */
const FAKE_USER_ID = 1234567890;
const FAKE_DISPLAY_NAME = "Loom Player";
/** Days since the account was created, which is how Roblox counts it. */
const FAKE_ACCOUNT_AGE = 365;

registerService("Players", () => {
	const players = createInstance("Players", "Players");
	const player = createInstance("Player", "Player");
	const playerGui = createInstance("PlayerGui", "PlayerGui");
	playerGui.Parent = player;
	player.Parent = players;
	setRawProperty(player, "UserId", FAKE_USER_ID);
	setRawProperty(player, "DisplayName", FAKE_DISPLAY_NAME);
	setRawProperty(player, "AccountAge", FAKE_ACCOUNT_AGE);
	setRawProperty(
		player,
		"MembershipType",
		enumItem("MembershipType", MEMBERSHIP_TYPES, "None"),
	);
	setRawProperty(players, "LocalPlayer", player);
	return players;
});

/** Roblox's thumbnail endpoints, keyed by `Enum.ThumbnailType` item name. */
const THUMBNAIL_ENDPOINTS: Readonly<Record<string, string>> = {
	AvatarThumbnail: "avatar-thumbnail",
	AvatarBust: "bust-thumbnail",
	HeadShot: "headshot-thumbnail",
};

/** `Enum.ThumbnailSize.Size420x420` → `420`; anything unreadable → `420`. */
function thumbnailPixels(size: unknown): number {
	const parsed = /^Size(\d+)x\d+$/.exec(enumName(size) ?? "");
	return parsed ? Number(parsed[1]) : 420;
}

/**
 * `Players:GetUserThumbnailAsync(userId, thumbnailType, thumbnailSize)` →
 * `[content, isReady]`.
 *
 * The content is a real Roblox thumbnail URL — `www.roblox.com/<kind>-thumbnail
 * /image`, the redirecting endpoint that has served avatar images for years —
 * so the image layer can load it straight into an `<img>` and a profile card in
 * a preview shows the same avatar it will in game. It cannot be the
 * `tr.rbxcdn.com` hash URL the engine returns: that hash only comes back from a
 * thumbnails API call, which a preview will not make on anyone's behalf.
 *
 * `isReady` is always `true`. Roblox reports `false` while its thumbnail farm is
 * still rendering an avatar it has never drawn; here the browser does the
 * fetching, and answering "not ready" for a URL that is perfectly loadable would
 * strand every retry loop written around the flag.
 */
registerClassMethods("Players", {
	GetUserThumbnailAsync: (
		_self: LoomInstance,
		userId: number,
		thumbnailType?: unknown,
		thumbnailSize?: unknown,
	) => {
		const kind =
			THUMBNAIL_ENDPOINTS[enumName(thumbnailType) ?? ""] ?? "avatar-thumbnail";
		const pixels = thumbnailPixels(thumbnailSize);
		const id = Number.isFinite(Number(userId))
			? Math.trunc(Number(userId))
			: FAKE_USER_ID;
		return [
			`https://www.roblox.com/${kind}/image?userId=${id}&width=${pixels}&height=${pixels}&format=png`,
			true,
		];
	},
});

// --- Workspace ---------------------------------------------------------------

registerService("Workspace", () => {
	const workspace = createInstance("Workspace", "Workspace");
	const camera = createInstance("Camera", "Camera");
	setRawProperty(camera, "ViewportSize", Vector2.new(1280, 720));
	camera.Parent = workspace;
	setRawProperty(workspace, "CurrentCamera", camera);
	return workspace;
});

/**
 * World hook: update `Workspace.CurrentCamera.ViewportSize`, firing its
 * property-changed signal when the size actually changes.
 */
export function setViewportSize(size: Vector2): void {
	const camera = getService("Workspace").CurrentCamera as LoomInstance;
	const current = camera.ViewportSize as Vector2;
	if (current.X === size.X && current.Y === size.Y) return;
	camera.ViewportSize = size;
}

// --- ContextActionService ----------------------------------------------------

registerClassMethods("ContextActionService", {
	BindAction: () => undefined,
	// `BindActionAtPriority` is `BindAction` plus a priority arg — the focus
	// manager binds Tab / D-pad navigation through it. Previews don't route real
	// ContextAction input, so a no-op is enough; omitting it threw
	// "BindActionAtPriority is not a function" and crashed every FocusScope
	// consumer (Select, Dialog, Tabs, …) the moment it opened.
	BindActionAtPriority: () => undefined,
	UnbindAction: () => undefined,
});

registerService("ContextActionService", () =>
	createInstance("ContextActionService", "ContextActionService"),
);

// --- HttpService -------------------------------------------------------------

/**
 * A fresh RFC 9562 (RFC 4122) version 4 UUID, lowercase and unbraced.
 *
 * `crypto.randomUUID` when the browser offers it (it is secure-context only),
 * otherwise the same value assembled from `crypto.getRandomValues` with the
 * version and variant bits set by hand. Never `Math.random`, never a timestamp
 * or a counter: app code uses a GUID as an identity, and a predictable one is a
 * bug waiting to be blamed on loom.
 */
function randomUuidV4(): string {
	const webCrypto = globalThis.crypto as Crypto | undefined;
	if (typeof webCrypto?.randomUUID === "function")
		return webCrypto.randomUUID();
	if (typeof webCrypto?.getRandomValues === "function") {
		const bytes = webCrypto.getRandomValues(new Uint8Array(16));
		// Version 4 in the high nibble of byte 6, variant 10xx in byte 8 — the two
		// fields `randomUUID` would have set for us.
		bytes[6] = ((bytes[6] as number) & 0x0f) | 0x40;
		bytes[8] = ((bytes[8] as number) & 0x3f) | 0x80;
		const hex = Array.from(bytes, (byte) =>
			byte.toString(16).padStart(2, "0"),
		).join("");
		return [
			hex.slice(0, 8),
			hex.slice(8, 12),
			hex.slice(12, 16),
			hex.slice(16, 20),
			hex.slice(20, 32),
		].join("-");
	}
	throw new Error(
		"[loom] HttpService.GenerateGUID requires the Web Crypto API",
	);
}

/** Every network method, with the one message that explains all of them. */
function networkUnsupported(method: string): () => never {
	return () => {
		throw new Error(
			`[loom] HttpService.${method} is not supported — loom previews render in ` +
				"the browser and never issue requests on your behalf. Call fetch (or " +
				"your own service layer) directly instead.",
		);
	};
}

/**
 * `HttpService` — the deterministic, browser-safe slice of the real service.
 *
 * `GenerateGUID` (Web Crypto) and the JSON pair are the whole of it: they are
 * pure computation with an unambiguous browser meaning, and they are what UI
 * code actually reaches for — component ids, serialized props. The network
 * methods throw by name rather than being silently absent, so a preview says
 * *why* it can't run that code instead of dying on `GetAsync is not a
 * function`; nothing here ever performs a request while documentation renders.
 *
 * `UrlEncode` is deliberately missing: the engine encodes more than
 * `encodeURIComponent` does (`.` becomes `%2E`), and the exact reserved set
 * could not be verified against a running engine — a near-miss encoder is worse
 * than an honest absence.
 */
registerClassMethods("HttpService", {
	GenerateGUID: (_self: LoomInstance, wrapInCurlyBraces = true) => {
		const guid = randomUuidV4();
		return wrapInCurlyBraces ? `{${guid}}` : guid;
	},
	// The Luau ↔ JSON mapping is `JSON.stringify`/`JSON.parse` here, because
	// loom's values *are* JavaScript values: what roblox-ts writes as an array or
	// an object is exactly what these encode. `undefined` encodes as `null` so the
	// declared string return always holds (`JSON.stringify(undefined)` is not a
	// string), matching `JSONEncode(nil)`.
	JSONEncode: (_self: LoomInstance, value: unknown) =>
		JSON.stringify(value) ?? "null",
	JSONDecode: (_self: LoomInstance, value: string) => {
		try {
			return JSON.parse(value) as unknown;
		} catch (cause) {
			throw new Error(
				"[loom] HttpService.JSONDecode could not parse the given string as JSON",
				{ cause },
			);
		}
	},
	GetAsync: networkUnsupported("GetAsync"),
	PostAsync: networkUnsupported("PostAsync"),
	RequestAsync: networkUnsupported("RequestAsync"),
});

registerService("HttpService", () =>
	createInstance("HttpService", "HttpService"),
);

// --- CollectionService -------------------------------------------------------

/**
 * Tags per instance, and the reverse index. Two maps rather than one: `GetTags`
 * and `GetTagged` are both O(1) lookups in Roblox, and the reverse index is
 * what `GetInstanceAddedSignal` fires from.
 *
 * The forward map is weak (an instance dropped by the app takes its tags with
 * it); the reverse index holds strong references, exactly as Roblox's does —
 * `GetTagged` must keep returning a tagged instance nobody else references.
 */
const INSTANCE_TAGS = new WeakMap<LoomInstance, Set<string>>();
const TAGGED = new Map<string, Set<LoomInstance>>();
const TAG_ADDED = new Map<string, LoomSignal<[LoomInstance]>>();
const TAG_REMOVED = new Map<string, LoomSignal<[LoomInstance]>>();

function tagSignal(
	registry: Map<string, LoomSignal<[LoomInstance]>>,
	tag: string,
): LoomSignal<[LoomInstance]> {
	let signal = registry.get(tag);
	if (!signal) {
		signal = new LoomSignal<[LoomInstance]>();
		registry.set(tag, signal);
	}
	return signal;
}

/**
 * `CollectionService` — the browser home for `@rbxts/react`'s `Tag` prop.
 *
 * Roblox's tag system is a plain string registry with change signals, none of
 * which needs the engine, so this is the real thing rather than a stand-in: the
 * adapter's `Tag` prop routes here (see `@loom-dev/react`), and app code that
 * queries tags — a theme pass walking `GetTagged("theme-surface")`, say — works
 * unchanged. What a preview does *not* have is Studio's tag editor, so tags only
 * ever come from code.
 */
registerClassMethods("CollectionService", {
	AddTag: (_self: LoomInstance, instance: LoomInstance, tag: string) => {
		let tags = INSTANCE_TAGS.get(instance);
		if (!tags) {
			tags = new Set();
			INSTANCE_TAGS.set(instance, tags);
		}
		if (tags.has(tag)) return undefined;
		tags.add(tag);
		let members = TAGGED.get(tag);
		if (!members) {
			members = new Set();
			TAGGED.set(tag, members);
		}
		members.add(instance);
		TAG_ADDED.get(tag)?.fire(instance);
		return undefined;
	},
	RemoveTag: (_self: LoomInstance, instance: LoomInstance, tag: string) => {
		const tags = INSTANCE_TAGS.get(instance);
		if (!tags?.delete(tag)) return undefined;
		TAGGED.get(tag)?.delete(instance);
		TAG_REMOVED.get(tag)?.fire(instance);
		return undefined;
	},
	HasTag: (_self: LoomInstance, instance: LoomInstance, tag: string) =>
		INSTANCE_TAGS.get(instance)?.has(tag) ?? false,
	// Roblox returns fresh arrays, so mutating a result can't corrupt the
	// registry.
	GetTags: (_self: LoomInstance, instance: LoomInstance) => [
		...(INSTANCE_TAGS.get(instance) ?? []),
	],
	GetTagged: (_self: LoomInstance, tag: string) => [...(TAGGED.get(tag) ?? [])],
	GetAllTags: () => [...TAGGED.keys()].filter((tag) => TAGGED.get(tag)?.size),
	GetInstanceAddedSignal: (_self: LoomInstance, tag: string) =>
		tagSignal(TAG_ADDED, tag),
	GetInstanceRemovedSignal: (_self: LoomInstance, tag: string) =>
		tagSignal(TAG_REMOVED, tag),
});

registerService("CollectionService", () =>
	createInstance("CollectionService", "CollectionService"),
);

/**
 * Drop every tag an instance carries — called when the adapter unmounts it, so
 * the strong reverse index doesn't pin a dead subtree. Fires the removal
 * signals, matching what Roblox does when a tagged instance is destroyed.
 */
export function clearTags(instance: LoomInstance): void {
	const tags = INSTANCE_TAGS.get(instance);
	if (!tags) return;
	INSTANCE_TAGS.delete(instance);
	for (const tag of tags) {
		TAGGED.get(tag)?.delete(instance);
		TAG_REMOVED.get(tag)?.fire(instance);
	}
}

// --- TextService -------------------------------------------------------------

/** How the host measures a string; `@loom-dev/renderer` installs a real one. */
export type TextMeasurer = (request: {
	text: string;
	size: number;
	/** A legacy `Enum.Font` name, or nothing for the default face. */
	font?: string;
	/** Wrap width in pixels; 0 or absent means no wrapping. */
	width?: number;
}) => { x: number; y: number };

let textMeasurer: TextMeasurer | undefined;
let warnedNoMeasurer = false;

/**
 * Install the text measurer behind `TextService`. The renderer calls this on
 * load — it is the half of loom that knows about fonts and canvases — so app
 * code sizing a label gets the same numbers the label will paint at.
 */
export function setTextMeasurer(measurer: TextMeasurer | undefined): void {
	textMeasurer = measurer;
}

/** The measurer's answer, or a warned-about estimate when none is installed. */
function measureString(
	text: string,
	size: number,
	font: unknown,
	width: number,
): Vector2 {
	const fontName =
		font instanceof EnumItem
			? font.Name
			: typeof font === "string" && font !== ""
				? font
				: undefined;
	if (textMeasurer) {
		const bounds = textMeasurer({
			text,
			size,
			...(fontName === undefined ? {} : { font: fontName }),
			width,
		});
		return new Vector2(bounds.x, bounds.y);
	}
	if (!warnedNoMeasurer) {
		warnedNoMeasurer = true;
		console.warn(
			"[loom] TextService has no text measurer installed — import " +
				"@loom-dev/renderer (every adapter does) for real measurements; " +
				"returning a rough estimate until then",
		);
	}
	// Deliberately crude, and warned about: half an em per character is wrong for
	// every font, but a zero would have UI code divide by nothing and lay out
	// against it as if it were the truth.
	return new Vector2(text.length * size * 0.5, text === "" ? 0 : size);
}

/**
 * `TextService` — the measurement half, which is the half a UI needs.
 *
 * `GetTextSize` and `GetTextBoundsAsync` both answer from the renderer's own
 * font stack, so a component that measures before it lays out agrees with what
 * lands on screen. Neither yields here (nothing to wait for in a browser), and
 * the filtering methods are absent: moderation is a server call loom will not
 * make on anyone's behalf.
 */
registerClassMethods("TextService", {
	GetTextSize: (
		_self: LoomInstance,
		text: string,
		fontSize: number,
		font?: unknown,
		frameSize?: Vector2,
	) => measureString(String(text ?? ""), fontSize, font, frameSize?.X ?? 0),
	// The modern spelling takes a `GetTextBoundsParams` instance instead of four
	// arguments; the properties it carries are the same measurement.
	GetTextBoundsAsync: (_self: LoomInstance, params: LoomInstance) =>
		measureString(
			String(params?.Text ?? ""),
			typeof params?.Size === "number" ? params.Size : 14,
			params?.Font,
			typeof params?.Width === "number" ? params.Width : 0,
		),
});

registerService("TextService", () =>
	createInstance("TextService", "TextService"),
);

// --- Debris ------------------------------------------------------------------

/**
 * `Debris` — the one-line lifetime service, which is a real timer here rather
 * than a stub: `AddItem(instance, 3)` genuinely destroys the instance three
 * seconds later, so a toast that cleans itself up behaves as it does in-game.
 */
registerClassMethods("Debris", {
	AddItem: (_self: LoomInstance, instance: LoomInstance, lifetime = 10) => {
		if (!instance) return undefined;
		setTimeout(() => {
			try {
				instance.Destroy();
			} catch {
				// Already destroyed, or never a live instance — either way there is
				// nothing left for the timer to clean up.
			}
		}, Math.max(0, lifetime) * 1000);
		return undefined;
	},
});

registerService("Debris", () => createInstance("Debris", "Debris"));

// --- StarterGui --------------------------------------------------------------

/**
 * `StarterGui` — a real container (app code parents `ScreenGui` templates into
 * it) whose `SetCore`/`GetCore` pair covers the core-UI toggles a preview has no
 * core UI to toggle. They are no-ops rather than absent so a mount that turns
 * the backpack off does not take the whole preview down with it; `GetCore`
 * answers `true`, which is what an untouched client reports.
 */
registerClassMethods("StarterGui", {
	SetCore: () => undefined,
	GetCore: () => true,
	SetCoreGuiEnabled: () => undefined,
	GetCoreGuiEnabled: () => true,
});

// --- ContentProvider ---------------------------------------------------------

/** The engine's own `Enum.AssetFetchStatus` items and values. */
const ASSET_FETCH_STATUSES: Record<string, number> = {
	None: 0,
	Success: 1,
	Failure: 2,
	TimedOut: 3,
};

const ASSET_NONE = enumItem("AssetFetchStatus", ASSET_FETCH_STATUSES, "None");
const ASSET_SUCCESS = enumItem(
	"AssetFetchStatus",
	ASSET_FETCH_STATUSES,
	"Success",
);
const ASSET_FAILURE = enumItem(
	"AssetFetchStatus",
	ASSET_FETCH_STATUSES,
	"Failure",
);

let contentResolver: ((contentId: string) => string | undefined) | undefined;

/**
 * Install the `rbxassetid://` → URL resolver `PreloadAsync` fetches through.
 *
 * The runtime has no idea how an asset id becomes a URL — that is the host's
 * business (`@loom-dev/preview` serves them off its own asset route, a static
 * build bakes a manifest), and it is already the same question the renderer's
 * image resolver answers. Without one, an `rbxassetid://` in a preload list is
 * handed to the browser as-is and honestly reports `Failure`; with one, the
 * preload warms exactly the cache entry the image layer will read from.
 */
export function setContentResolver(
	resolver: ((contentId: string) => string | undefined) | undefined,
): void {
	contentResolver = resolver;
}

const assetStatus = new Map<string, EnumItem<"AssetFetchStatus">>();
let requestQueueSize = 0;

/** The content id an entry names: a string is one, an instance carries one. */
function contentIdOf(entry: unknown): string | undefined {
	if (typeof entry === "string") return entry === "" ? undefined : entry;
	// Roblox takes instances too, and preloads whatever content property they
	// carry — the point of passing an ImageLabel is "fetch its Image".
	if (!isLoomInstance(entry)) return undefined;
	for (const key of ["Image", "Texture", "TextureID", "SoundId"]) {
		const value = entry[key];
		if (typeof value === "string" && value !== "") return value;
	}
	return undefined;
}

/** Load one content id, answering whether the browser actually got it. */
function fetchContent(contentId: string): Promise<boolean> {
	const url = contentResolver?.(contentId) ?? contentId;
	if (typeof Image !== "function") return Promise.resolve(false);
	return new Promise<boolean>((resolve) => {
		const image = new Image();
		image.onload = () => resolve(true);
		image.onerror = () => resolve(false);
		image.src = url;
	});
}

/**
 * `ContentProvider` — a real preloader rather than a stub.
 *
 * `PreloadAsync` genuinely fetches: each id goes through an `Image`, so the
 * browser cache is warm by the time the scene shows it, which is the entire
 * reason a loading screen calls this. The per-asset callback fires with the
 * `(contentId, status)` pair Roblox passes, so a progress bar counts up for
 * real.
 *
 * The one thing it cannot do is yield. Roblox blocks the calling thread until
 * every asset has resolved; a browser has one thread it is not allowed to
 * block, so this returns a promise for that same moment — `await` it in preview
 * code, and compiled roblox-ts that ignores the return value simply carries on
 * while the fetches run, which is the honest closest behaviour and never worse
 * than not preloading at all.
 */
async function preloadAsync(
	list: unknown,
	callback?: (contentId: string, status: EnumItem<"AssetFetchStatus">) => void,
): Promise<void> {
	const entries = Array.isArray(list) ? (list as unknown[]) : [list];
	await Promise.all(
		entries.map(async (entry) => {
			const contentId = contentIdOf(entry);
			if (contentId === undefined) return;
			requestQueueSize++;
			let loaded = false;
			try {
				loaded = await fetchContent(contentId);
			} finally {
				requestQueueSize--;
			}
			const status = loaded ? ASSET_SUCCESS : ASSET_FAILURE;
			assetStatus.set(contentId, status);
			try {
				callback?.(contentId, status);
			} catch (err) {
				// A loading screen's own progress handler must not sink the rest of
				// the preload, and there is nowhere else to put its error.
				console.error("loom: a PreloadAsync callback threw:", err);
			}
		}),
	);
}

registerClassMethods("ContentProvider", {
	PreloadAsync: (
		_self: LoomInstance,
		list: unknown,
		callback?: (
			contentId: string,
			status: EnumItem<"AssetFetchStatus">,
		) => void,
	) => preloadAsync(list, callback),
	GetAssetFetchStatus: (_self: LoomInstance, contentId: string) =>
		assetStatus.get(contentId) ?? ASSET_NONE,
});

// Derived, not stored: the number of preloads in flight changes several times
// per `PreloadAsync` call and nothing should have to remember to write it.
registerPropertyReader(
	"ContentProvider",
	"RequestQueueSize",
	() => requestQueueSize,
);

registerService("ContentProvider", () =>
	createInstance("ContentProvider", "ContentProvider"),
);

// --- plain containers --------------------------------------------------------

/**
 * The services that are *only* containers in a client: no behavior to model,
 * just a place instances live. Registering them turns `GetService` from a warned
 * stub into a plain instance — the same object every time, `IsA` correct, and
 * children that survive — which is all a preview ever needs from them.
 *
 * Anything not listed still resolves to a warned stub. That list stays
 * deliberate rather than exhaustive: a service loom cannot honestly model
 * (DataStores, marketplace, teleports) should say so by warning, not by looking
 * like it works.
 */
const CONTAINER_SERVICES = [
	"Lighting",
	"ReplicatedFirst",
	"ReplicatedStorage",
	"ServerScriptService",
	"ServerStorage",
	"SoundService",
	"StarterGui",
	"StarterPack",
	"StarterPlayer",
	"Teams",
] as const;

for (const name of CONTAINER_SERVICES) {
	registerService(name, () => createInstance(name, name));
}

// --- eager construction ------------------------------------------------------

// Pre-build the trees app code touches synchronously before the first render
// (`Players.LocalPlayer.WaitForChild("PlayerGui")`, camera viewport reads).
getService("Players");
getService("Workspace");
