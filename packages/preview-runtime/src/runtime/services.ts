import { runtimeOnlyTypeNames } from "../hosts/metadata";
import { PREVIEW_HOST_DATA_ATTRIBUTE } from "../internal/previewAttributes";
import { Enum } from "./Enum";
import {
	findMockAncestorOfClass,
	findMockAncestorWhichIsA,
	type MockInstanceLike,
} from "./mockInstance";
import {
	type RBXScriptConnection,
	type RBXScriptSignal,
	RunService,
} from "./RunService";
import robloxMock from "./robloxMock";
import {
	normalizePreviewRuntimeError,
	publishPreviewRuntimeIssue,
} from "./runtimeError";
import { createPreviewTweenController } from "./tween";

const SERVICES_KEY = Symbol.for("loom-dev.preview-runtime.services");
const PLAYER_GUI_KEY = Symbol.for("loom-dev.preview-runtime.playerGui");
const TWEEN_INFO_KEY = Symbol.for("loom-dev.preview-runtime.TweenInfo");
const USER_INPUT_TRACKER_KEY = Symbol.for(
	"loom-dev.preview-runtime.userInputTracker",
);

const robloxMockRecord = robloxMock as unknown as Record<PropertyKey, unknown>;

function createMockVector2(x: number, y: number) {
	return { X: x, Y: y };
}

function createMockUDim(offset: number, scale: number) {
	return { Offset: offset, Scale: scale };
}

function createMockUDim2() {
	return {
		X: createMockUDim(0, 0),
		Y: createMockUDim(0, 0),
	};
}

function createMockSignal() {
	return {
		Connect() {
			const connection = {
				Connected: true,
				Disconnect() {
					connection.Connected = false;
				},
			};

			return connection;
		},
	};
}

const mockScreenGui = {
	AbsolutePosition: createMockVector2(0, 0),
	AbsoluteSize: createMockVector2(1000, 1000),
	AbsoluteWindowSize: createMockVector2(0, 0),
	CanvasSize: createMockUDim2(),
	ClassName: "ScreenGui" as const,
	GetFullName() {
		return "MockScreenGui";
	},
	GetPropertyChangedSignal() {
		return createMockSignal();
	},
	FindFirstAncestorOfClass(className: string): MockInstanceLike | undefined {
		return findMockAncestorOfClass(this, className);
	},
	FindFirstAncestorWhichIsA(className: string): MockInstanceLike | undefined {
		return findMockAncestorWhichIsA(this, className);
	},
	IsA(name: string) {
		return (
			name === "ScreenGui" || name === "LayerCollector" || name === "Instance"
		);
	},
	Name: "MockScreenGui" as const,
	Parent: undefined as MockInstanceLike | undefined,
	TextBounds: createMockVector2(0, 0),
};

type PreviewEnumValueLookup = Record<string, unknown>;

const previewEnum = Enum as unknown as {
	EasingDirection: PreviewEnumValueLookup;
	EasingStyle: PreviewEnumValueLookup;
	PlaybackState: PreviewEnumValueLookup;
};

type PreviewServiceName =
	| "GuiService"
	| "Players"
	| "RunService"
	| "TweenService"
	| "UserInputService"
	| "Workspace";

type PreviewServiceRegistry = {
	game: PreviewGame;
	services: Map<string, unknown>;
	playerGui: PreviewPlayerGui;
	tweenInfo: typeof TweenInfo;
	workspace: PreviewWorkspace;
};

type InputTracker = {
	current: string;
	installed: boolean;
	signal: Signal<[lastInputType: string]>;
};

export interface PreviewGame {
	readonly ClassName: "DataModel";
	readonly Name: "game";
	readonly Workspace: PreviewWorkspace;
	FindService(name: string): unknown;
	GetFullName(): string;
	GetService(name: string): unknown;
	IsA(name: string): boolean;
}

export interface PreviewWorkspace {
	readonly ClassName: "Workspace";
	readonly Name: "Workspace";
	GetFullName(): string;
	IsA(name: string): boolean;
}

export interface PreviewPlayer {
	readonly ClassName: "Player";
	readonly DisplayName: "LocalPlayer";
	readonly Name: "LocalPlayer";
	readonly PlayerGui: PreviewPlayerGui;
	readonly UserId: 0;
	FindFirstChild(name: string): PreviewPlayerGui | undefined;
	GetFullName(): string;
	IsA(name: string): boolean;
	WaitForChild(name: string): PreviewPlayerGui;
}

export type PreviewGuiHitObject = {
	readonly ClassName: string;
	readonly Name: string;
	readonly Parent: MockInstanceLike | undefined;
	FindFirstAncestorOfClass(className: string): MockInstanceLike | undefined;
	FindFirstAncestorWhichIsA(className: string): MockInstanceLike | undefined;
	GetFullName(): string;
	IsA(name: string): boolean;
	IsDescendantOf(ancestor: unknown): boolean;
};

export type PreviewPlayerGui = {
	ClassName: "PlayerGui";
	FindFirstChild(name: string): PreviewPlayerGui | undefined;
	GetFullName(): string;
	GetGuiObjectsAtPosition(x: number, y: number): PreviewGuiHitObject[];
	IsA(name: string): boolean;
	IsDescendantOf(ancestor: unknown): boolean;
	Name: "PlayerGui";
	Parent: MockInstanceLike | undefined;
	WaitForChild(name: string): PreviewPlayerGui;
};

export interface PreviewPlayersService {
	readonly ClassName: "Players";
	readonly LocalPlayer: PreviewPlayer;
	readonly Name: "Players";
	readonly PlayerAdded: RBXScriptSignal<[player: PreviewPlayer]>;
	readonly PlayerRemoving: RBXScriptSignal<[player: PreviewPlayer]>;
	FindFirstChild(name: string): PreviewPlayer | undefined;
	GetFullName(): string;
	GetPlayers(): PreviewPlayer[];
	IsA(name: string): boolean;
}

export interface PreviewUserInputService {
	readonly ClassName: "UserInputService";
	readonly GamepadEnabled: false;
	readonly InputBegan: RBXScriptSignal<[event: Event]>;
	readonly InputChanged: RBXScriptSignal<[event: Event]>;
	readonly InputEnded: RBXScriptSignal<[event: Event]>;
	readonly KeyboardEnabled: true;
	readonly LastInputTypeChanged: RBXScriptSignal<[lastInputType: string]>;
	readonly MouseEnabled: true;
	readonly MouseIconEnabled: true;
	readonly Name: "UserInputService";
	readonly TextBoxFocusReleased: RBXScriptSignal<
		[element: HTMLElement | undefined]
	>;
	readonly TextBoxFocused: RBXScriptSignal<[element: HTMLElement | undefined]>;
	readonly TouchEnabled: false;
	readonly VREnabled: false;
	GetFocusedTextBox(): HTMLElement | undefined;
	GetFullName(): string;
	GetLastInputType(): string;
	IsA(name: string): boolean;
}

export interface PreviewGuiService {
	readonly ClassName: "GuiService";
	SelectedObject: PreviewGuiHitObject | undefined;
	readonly Name: "GuiService";
	GetFullName(): string;
	GetGuiInset(): readonly [{ X: 0; Y: 0 }, { X: 0; Y: 0 }];
	IsA(name: string): boolean;
	IsTenFootInterface(): false;
}

export interface PreviewTween {
	readonly Completed: RBXScriptSignal<[playbackState: unknown]>;
	readonly Instance: unknown;
	readonly PlaybackState: unknown;
	readonly TweenInfo: TweenInfo;
	Cancel(): void;
	Destroy(): void;
	Pause(): void;
	Play(): void;
}

export interface PreviewTweenService {
	readonly ClassName: "TweenService";
	readonly Name: "TweenService";
	Create(
		instance: unknown,
		tweenInfo: TweenInfo,
		goal: Record<string, unknown>,
	): PreviewTween;
	GetFullName(): string;
	IsA(name: string): boolean;
}

class SignalConnection<TArgs extends readonly unknown[]>
	implements RBXScriptConnection
{
	public Connected = true;

	public constructor(
		private readonly signal: Signal<TArgs>,
		private readonly listener: (...args: TArgs) => void,
	) {}

	public Disconnect() {
		if (!this.Connected) {
			return;
		}

		this.Connected = false;
		this.signal.disconnect(this);
	}

	public invoke(...args: TArgs) {
		if (!this.Connected) {
			return;
		}

		this.listener(...args);
	}
}

class Signal<TArgs extends readonly unknown[]>
	implements RBXScriptSignal<TArgs>
{
	private readonly connections = new Set<SignalConnection<TArgs>>();

	public Connect(listener: (...args: TArgs) => void) {
		const connection = new SignalConnection(this, listener);
		this.connections.add(connection);
		return connection;
	}

	public disconnect(connection: SignalConnection<TArgs>) {
		this.connections.delete(connection);
	}

	public fire(...args: TArgs) {
		for (const connection of [...this.connections]) {
			try {
				connection.invoke(...args);
			} catch (error) {
				publishPreviewRuntimeIssue(
					normalizePreviewRuntimeError(
						{
							code: "PREVIEW_SIGNAL_CALLBACK_ERROR",
							details: "preview services",
							kind: "RuntimeMockError",
							phase: "runtime",
							summary: `Preview service callback failed: ${error instanceof Error ? error.message : String(error)}`,
						},
						error,
					),
				);
			}
		}
	}
}

function withRobloxFallback<T extends object>(target: T): T {
	return new Proxy(target, {
		get(currentTarget, property, receiver) {
			if (Reflect.has(currentTarget, property)) {
				return Reflect.get(currentTarget, property, receiver);
			}

			if (typeof property === "string") {
				return robloxMockRecord[property];
			}

			return undefined;
		},
		getOwnPropertyDescriptor(currentTarget, property) {
			const descriptor = Reflect.getOwnPropertyDescriptor(
				currentTarget,
				property,
			);
			if (descriptor) {
				return descriptor;
			}

			if (typeof property !== "string") {
				return undefined;
			}

			return {
				configurable: true,
				enumerable: false,
				value: robloxMockRecord[property],
				writable: false,
			};
		},
		has(currentTarget, property) {
			return (
				Reflect.has(currentTarget, property) || typeof property === "string"
			);
		},
	});
}

function defineOwnPropertyIfMissing<T extends object>(
	target: T,
	property: PropertyKey,
	descriptor: PropertyDescriptor,
) {
	const existingDescriptor = Object.getOwnPropertyDescriptor(target, property);
	if (existingDescriptor) {
		return existingDescriptor;
	}

	Object.defineProperty(target, property, descriptor);
	return descriptor;
}

function isPlayerGuiTypeName(typeName: string) {
	return (
		runtimeOnlyTypeNames.includes(typeName) ||
		typeName === "BasePlayerGui" ||
		typeName === "LayerCollector" ||
		typeName === "Instance"
	);
}

function createServiceBase(name: PreviewServiceName | "game") {
	return {
		GetFullName() {
			return name === "game" ? "game" : `game.${name}`;
		},
		IsA(typeName: string) {
			if (name === "game") {
				return (
					typeName === "DataModel" ||
					typeName === "ServiceProvider" ||
					typeName === "Instance"
				);
			}

			return (
				typeName === name || typeName === "Service" || typeName === "Instance"
			);
		},
	};
}

const previewGuiObjectHosts = new Set([
	"canvasgroup",
	"frame",
	"imagebutton",
	"imagelabel",
	"scrollingframe",
	"textbox",
	"textbutton",
	"textlabel",
	"videoframe",
	"viewportframe",
]);

const previewGuiObjectClassNames = new Map<string, string>([
	["canvasgroup", "CanvasGroup"],
	["frame", "Frame"],
	["imagebutton", "ImageButton"],
	["imagelabel", "ImageLabel"],
	["scrollingframe", "ScrollingFrame"],
	["textbox", "TextBox"],
	["textbutton", "TextButton"],
	["textlabel", "TextLabel"],
	["videoframe", "VideoFrame"],
	["viewportframe", "ViewportFrame"],
]);

const guiServiceState = {
	selectedObject: undefined as PreviewGuiHitObject | undefined,
};

function getDomElement(value: unknown): HTMLElement | undefined {
	if (typeof HTMLElement !== "undefined" && value instanceof HTMLElement) {
		return value;
	}

	if (typeof value === "object" && value !== null) {
		const record = value as { element?: unknown };
		if (
			typeof HTMLElement !== "undefined" &&
			record.element instanceof HTMLElement
		) {
			return record.element;
		}
	}

	return undefined;
}

function isPreviewGuiObjectHandle(
	value: unknown,
): value is PreviewGuiHitObject {
	return (
		typeof value === "object" &&
		value !== null &&
		typeof (value as PreviewGuiHitObject).GetFullName === "function" &&
		typeof (value as PreviewGuiHitObject).IsA === "function" &&
		typeof (value as PreviewGuiHitObject).IsDescendantOf === "function"
	);
}

function getPreviewGuiObjectFromElement(
	element: HTMLElement,
): PreviewGuiHitObject | undefined {
	const host = element.getAttribute(PREVIEW_HOST_DATA_ATTRIBUTE);
	if (!host || !isPreviewGuiObjectHost(host)) {
		return undefined;
	}

	return createPreviewGuiObjectHandle(element, host);
}

function normalizePreviewGuiObject(
	value: unknown,
): PreviewGuiHitObject | undefined {
	if (isPreviewGuiObjectHandle(value)) {
		return value;
	}

	const element = getDomElement(value);
	if (!element) {
		return undefined;
	}

	return getPreviewGuiObjectFromElement(element);
}

function isPreviewGuiObjectHost(host: string) {
	return previewGuiObjectHosts.has(host);
}

function getPreviewGuiObjectClassName(host: string) {
	return previewGuiObjectClassNames.get(host) ?? host;
}

function isPreviewVector2(value: unknown): value is { X: number; Y: number } {
	return (
		typeof value === "object" &&
		value !== null &&
		typeof (value as { X?: unknown }).X === "number" &&
		typeof (value as { Y?: unknown }).Y === "number" &&
		Number.isFinite((value as { X: number }).X) &&
		Number.isFinite((value as { Y: number }).Y)
	);
}

function createPreviewGuiObjectHandle(
	element: HTMLElement,
	host: string,
): PreviewGuiHitObject {
	const className = getPreviewGuiObjectClassName(host);
	const name =
		element.getAttribute("data-preview-node-id") ??
		element.getAttribute("aria-label") ??
		className;
	const rect = element.getBoundingClientRect();
	const bridgedAbsolutePosition = isPreviewVector2(
		(element as HTMLElement & { AbsolutePosition?: unknown }).AbsolutePosition,
	)
		? (
				element as HTMLElement & {
					AbsolutePosition: { X: number; Y: number };
				}
			).AbsolutePosition
		: undefined;
	const bridgedAbsoluteSize = isPreviewVector2(
		(element as HTMLElement & { AbsoluteSize?: unknown }).AbsoluteSize,
	)
		? (
				element as HTMLElement & {
					AbsoluteSize: { X: number; Y: number };
				}
			).AbsoluteSize
		: undefined;
	const bridgedAbsoluteWindowSize = isPreviewVector2(
		(element as HTMLElement & { AbsoluteWindowSize?: unknown })
			.AbsoluteWindowSize,
	)
		? (
				element as HTMLElement & {
					AbsoluteWindowSize: { X: number; Y: number };
				}
			).AbsoluteWindowSize
		: undefined;
	const handle = {
		ClassName: className,
		Name: name,
		Parent: mockScreenGui,
		GetFullName() {
			return `Players.LocalPlayer.PlayerGui.${name}`;
		},
		IsA(typeName: string) {
			if (typeName === className || typeName === "Instance") {
				return true;
			}

			if (typeName === "GuiObject") {
				return isPreviewGuiObjectHost(host);
			}

			if (host === "textbutton" || host === "imagebutton") {
				return typeName === "GuiButton";
			}

			if (host === "textlabel" || host === "imagelabel") {
				return typeName === "GuiLabel";
			}

			return false;
		},
		IsDescendantOf(ancestor: unknown) {
			if (ancestor === mockScreenGui) {
				return true;
			}

			const domAncestor = getDomElement(ancestor);
			return domAncestor ? domAncestor.contains(element) : false;
		},
		FindFirstAncestorOfClass(className: string) {
			return findMockAncestorOfClass(handle, className);
		},
		FindFirstAncestorWhichIsA(className: string) {
			return findMockAncestorWhichIsA(handle, className);
		},
	};

	Object.defineProperties(handle, {
		AbsolutePosition: {
			configurable: false,
			enumerable: false,
			value: createMockVector2(
				bridgedAbsolutePosition?.X ?? rect.left,
				bridgedAbsolutePosition?.Y ?? rect.top,
			),
			writable: false,
		},
		AbsoluteSize: {
			configurable: false,
			enumerable: false,
			value: createMockVector2(
				bridgedAbsoluteSize?.X ?? rect.width,
				bridgedAbsoluteSize?.Y ?? rect.height,
			),
			writable: false,
		},
		AbsoluteWindowSize: {
			configurable: false,
			enumerable: false,
			value: createMockVector2(
				bridgedAbsoluteWindowSize?.X ?? 0,
				bridgedAbsoluteWindowSize?.Y ?? 0,
			),
			writable: false,
		},
		CanvasSize: {
			configurable: false,
			enumerable: false,
			value: createMockUDim2(),
			writable: false,
		},
		GetPropertyChangedSignal: {
			configurable: false,
			enumerable: false,
			value() {
				return createMockSignal();
			},
			writable: false,
		},
		TextBounds: {
			configurable: false,
			enumerable: false,
			value: createMockVector2(0, 0),
			writable: false,
		},
	});

	Object.defineProperty(handle, "element", {
		configurable: false,
		enumerable: false,
		value: element,
		writable: false,
	});

	return handle;
}

function createPlayerGui(): PreviewPlayerGui {
	const globalRecord = globalThis as typeof globalThis & {
		[PLAYER_GUI_KEY]?: PreviewPlayerGui;
	};

	if (globalRecord[PLAYER_GUI_KEY]) {
		const existing = globalRecord[PLAYER_GUI_KEY];
		if (
			typeof document !== "undefined" &&
			typeof document.body !== "undefined" &&
			existing instanceof HTMLElement &&
			!existing.isConnected
		) {
			document.body.appendChild(existing);
		}

		return existing;
	}

	if (
		typeof document === "undefined" ||
		typeof HTMLElement === "undefined" ||
		typeof document.createElement !== "function"
	) {
		const fallback = withRobloxFallback({
			AbsolutePosition: createMockVector2(0, 0),
			AbsoluteSize: createMockVector2(1000, 1000),
			AbsoluteWindowSize: createMockVector2(0, 0),
			CanvasSize: createMockUDim2(),
			ClassName: "PlayerGui" as const,
			FindFirstAncestorOfClass(
				className: string,
			): MockInstanceLike | undefined {
				return findMockAncestorOfClass(this, className);
			},
			FindFirstAncestorWhichIsA(
				className: string,
			): MockInstanceLike | undefined {
				return findMockAncestorWhichIsA(this, className);
			},
			FindFirstChild(name: string) {
				return name === "PlayerGui"
					? (fallback as PreviewPlayerGui)
					: undefined;
			},
			GetFullName() {
				return "Players.LocalPlayer.PlayerGui";
			},
			GetGuiObjectsAtPosition() {
				return [];
			},
			GetPropertyChangedSignal() {
				return createMockSignal();
			},
			IsA(typeName: string) {
				return isPlayerGuiTypeName(typeName);
			},
			IsDescendantOf() {
				return false;
			},
			Name: "PlayerGui" as const,
			Parent: mockScreenGui,
			TextBounds: createMockVector2(0, 0),
			WaitForChild(name: string) {
				return name === "PlayerGui"
					? (fallback as PreviewPlayerGui)
					: (robloxMockRecord[name] as PreviewPlayerGui);
			},
		}) as PreviewPlayerGui;

		globalRecord[PLAYER_GUI_KEY] = fallback;
		return fallback;
	}

	const element = document.createElement("div") as unknown as HTMLElement &
		PreviewPlayerGui & {
			[key: string]: unknown;
		};
	element.ClassName = "PlayerGui";
	element.Name = "PlayerGui";
	element.Parent = mockScreenGui;
	element.AbsolutePosition = createMockVector2(0, 0);
	element.AbsoluteSize = createMockVector2(1000, 1000);
	element.AbsoluteWindowSize = createMockVector2(0, 0);
	element.CanvasSize = createMockUDim2();
	element.GetPropertyChangedSignal = () => createMockSignal();
	element.TextBounds = createMockVector2(0, 0);
	element.dataset.previewPlayerGui = "true";
	element.style.position = "absolute";
	element.style.inset = "0";
	element.style.overflow = "hidden";
	// Keep the PlayerGui container itself transparent to hit-testing so it does
	// not block unrelated UI outside the preview surface. Interactive preview
	// hosts still receive events through their own DOM nodes.
	element.style.pointerEvents = "none";
	element.GetFullName = () => "Players.LocalPlayer.PlayerGui";
	element.FindFirstAncestorOfClass = (
		className: string,
	): MockInstanceLike | undefined => {
		return findMockAncestorOfClass(element, className);
	};
	element.FindFirstAncestorWhichIsA = (
		className: string,
	): MockInstanceLike | undefined => {
		return findMockAncestorWhichIsA(element, className);
	};
	element.FindFirstChild = (name: string) => {
		return name === "PlayerGui" ? element : undefined;
	};
	element.GetGuiObjectsAtPosition = (x: number, y: number) => {
		if (typeof document.elementsFromPoint !== "function") {
			return [];
		}

		const hitElements = document.elementsFromPoint(x, y);
		const guiObjects: PreviewGuiHitObject[] = [];
		for (const hitElement of hitElements) {
			if (!(hitElement instanceof HTMLElement)) {
				continue;
			}

			if (!element.contains(hitElement)) {
				continue;
			}

			const host = hitElement.getAttribute(PREVIEW_HOST_DATA_ATTRIBUTE);
			if (!host || !isPreviewGuiObjectHost(host)) {
				continue;
			}

			guiObjects.push(createPreviewGuiObjectHandle(hitElement, host));
		}

		return guiObjects;
	};
	element.IsA = (typeName: string) => {
		return isPlayerGuiTypeName(typeName);
	};
	element.IsDescendantOf = (ancestor: unknown) => {
		const domAncestor = getDomElement(ancestor);
		return domAncestor ? domAncestor.contains(element) : false;
	};
	element.WaitForChild = (name: string) => {
		return name === "PlayerGui"
			? element
			: (robloxMockRecord[name] as PreviewPlayerGui);
	};

	globalRecord[PLAYER_GUI_KEY] = element;
	const domElement = element as unknown as HTMLElement;
	if (document.body && !domElement.isConnected) {
		document.body.appendChild(domElement);
	}

	return element;
}

function createLocalPlayer(): PreviewPlayer {
	const playerGui = createPlayerGui();
	return withRobloxFallback({
		ClassName: "Player" as const,
		DisplayName: "LocalPlayer" as const,
		Name: "LocalPlayer" as const,
		PlayerGui: playerGui,
		UserId: 0 as const,
		...createServiceBase("Players"),
		FindFirstChild(name: string) {
			return name === "PlayerGui" ? playerGui : undefined;
		},
		GetFullName() {
			return "Players.LocalPlayer";
		},
		IsA(typeName: string) {
			return typeName === "Player" || typeName === "Instance";
		},
		WaitForChild(name: string) {
			return name === "PlayerGui"
				? playerGui
				: (robloxMockRecord[name] as PreviewPlayerGui);
		},
	});
}

function getUserInputTracker() {
	const globalRecord = globalThis as typeof globalThis & {
		[USER_INPUT_TRACKER_KEY]?: InputTracker;
	};

	if (!globalRecord[USER_INPUT_TRACKER_KEY]) {
		globalRecord[USER_INPUT_TRACKER_KEY] = {
			current: "MouseButton1",
			installed: false,
			signal: new Signal<[lastInputType: string]>(),
		};
	}

	const tracker = globalRecord[USER_INPUT_TRACKER_KEY];
	if (!tracker.installed && typeof globalThis.addEventListener === "function") {
		const updateLastInputType = (nextType: string) => {
			if (tracker.current === nextType) {
				return;
			}

			tracker.current = nextType;
			tracker.signal.fire(nextType);
		};

		globalThis.addEventListener("keydown", () =>
			updateLastInputType("Keyboard"),
		);
		globalThis.addEventListener("mousemove", () =>
			updateLastInputType("MouseMovement"),
		);
		globalThis.addEventListener("mousedown", (event) => {
			const mouseEvent = event as MouseEvent;
			if (mouseEvent.button === 1) {
				updateLastInputType("MouseButton3");
				return;
			}

			if (mouseEvent.button === 2) {
				updateLastInputType("MouseButton2");
				return;
			}

			updateLastInputType("MouseButton1");
		});
		globalThis.addEventListener("touchstart", () =>
			updateLastInputType("Touch"),
		);
		tracker.installed = true;
	}

	return tracker;
}

function getFocusedTextBox() {
	if (typeof document === "undefined") {
		return undefined;
	}

	const activeElement = document.activeElement;
	return isTextBoxElement(activeElement) ? activeElement : undefined;
}

function isTextBoxElement(value: unknown): value is HTMLElement {
	return (
		typeof HTMLElement !== "undefined" &&
		value instanceof HTMLElement &&
		(value.dataset.previewHost === "textbox" ||
			value.tagName === "INPUT" ||
			value.tagName === "TEXTAREA")
	);
}

function getTextBoxFromEventTarget(target: EventTarget | null) {
	return isTextBoxElement(target) ? target : undefined;
}

function getSelectedGuiObjectFromEvent(event: Event) {
	const path =
		typeof event.composedPath === "function"
			? event.composedPath()
			: [event.target];

	for (const entry of path) {
		if (typeof HTMLElement === "undefined" || !(entry instanceof HTMLElement)) {
			continue;
		}

		const host = entry.getAttribute(PREVIEW_HOST_DATA_ATTRIBUTE);
		if (host && isPreviewGuiObjectHost(host)) {
			return getPreviewGuiObjectFromElement(entry);
		}
	}

	return undefined;
}

function createPlayersService(
	localPlayer: PreviewPlayer,
): PreviewPlayersService {
	const playerAdded = new Signal<[player: PreviewPlayer]>();
	const playerRemoving = new Signal<[player: PreviewPlayer]>();

	return withRobloxFallback({
		ClassName: "Players" as const,
		LocalPlayer: localPlayer,
		Name: "Players" as const,
		PlayerAdded: playerAdded,
		PlayerRemoving: playerRemoving,
		...createServiceBase("Players"),
		FindFirstChild(name: string) {
			return name === localPlayer.Name ? localPlayer : undefined;
		},
		GetPlayers() {
			return [localPlayer];
		},
	});
}

function createUserInputService(): PreviewUserInputService {
	const tracker = getUserInputTracker();
	const inputBegan = new Signal<[event: Event]>();
	const inputChanged = new Signal<[event: Event]>();
	const inputEnded = new Signal<[event: Event]>();
	const textBoxFocused = new Signal<[element: HTMLElement | undefined]>();
	const textBoxFocusReleased = new Signal<[element: HTMLElement | undefined]>();
	let focusedTextBox = getFocusedTextBox();

	if (typeof globalThis.addEventListener === "function") {
		globalThis.addEventListener("focusin", (event) => {
			const nextFocusedTextBox =
				getTextBoxFromEventTarget(event.target) ?? getFocusedTextBox();
			if (nextFocusedTextBox === focusedTextBox) {
				return;
			}

			focusedTextBox = nextFocusedTextBox;
			textBoxFocused.fire(focusedTextBox);
		});
		globalThis.addEventListener("focusout", (event) => {
			const releasedTextBox = getTextBoxFromEventTarget(event.target);
			if (releasedTextBox === undefined) {
				focusedTextBox = getFocusedTextBox();
				return;
			}

			focusedTextBox = undefined;
			textBoxFocusReleased.fire(releasedTextBox);
		});
		globalThis.addEventListener("keydown", (event) => {
			inputBegan.fire(event);
		});
		globalThis.addEventListener("keyup", (event) => {
			inputEnded.fire(event);
		});
		globalThis.addEventListener("mousemove", (event) => {
			inputChanged.fire(event);
		});
		globalThis.addEventListener("mousedown", (event) => {
			inputBegan.fire(event);
		});
		globalThis.addEventListener("mouseup", (event) => {
			inputEnded.fire(event);
		});
		globalThis.addEventListener("touchstart", (event) => {
			inputBegan.fire(event);
		});
		globalThis.addEventListener("touchmove", (event) => {
			inputChanged.fire(event);
		});
		globalThis.addEventListener("touchend", (event) => {
			inputEnded.fire(event);
		});
	}

	return withRobloxFallback({
		ClassName: "UserInputService" as const,
		GamepadEnabled: false as const,
		InputBegan: inputBegan,
		InputChanged: inputChanged,
		InputEnded: inputEnded,
		KeyboardEnabled: true as const,
		LastInputTypeChanged: tracker.signal,
		MouseEnabled: true as const,
		MouseIconEnabled: true as const,
		Name: "UserInputService" as const,
		TextBoxFocusReleased: textBoxFocusReleased,
		TextBoxFocused: textBoxFocused,
		TouchEnabled: false as const,
		VREnabled: false as const,
		...createServiceBase("UserInputService"),
		GetFocusedTextBox: getFocusedTextBox,
		GetLastInputType() {
			return tracker.current;
		},
	});
}

function createGuiService(): PreviewGuiService {
	const zeroVector = Object.freeze({ X: 0 as const, Y: 0 as const });

	if (typeof globalThis.addEventListener === "function") {
		const updateSelectedObject = (event: Event) => {
			guiServiceState.selectedObject = getSelectedGuiObjectFromEvent(event);
		};

		globalThis.addEventListener("focusin", updateSelectedObject);
		globalThis.addEventListener("pointerdown", updateSelectedObject);
		globalThis.addEventListener("mousedown", updateSelectedObject);
	}

	const guiServiceBase: Partial<PreviewGuiService> = {
		ClassName: "GuiService" as const,
		Name: "GuiService" as const,
		...createServiceBase("GuiService"),
		GetGuiInset() {
			return [zeroVector, zeroVector] as const;
		},
		IsTenFootInterface() {
			return false as const;
		},
	};

	defineOwnPropertyIfMissing(guiServiceBase, "SelectedObject", {
		configurable: true,
		enumerable: false,
		get() {
			return guiServiceState.selectedObject;
		},
		set(value: unknown) {
			guiServiceState.selectedObject = normalizePreviewGuiObject(value);
		},
	});

	return withRobloxFallback(guiServiceBase as PreviewGuiService);
}

export function resetPreviewRuntimeServiceState() {
	guiServiceState.selectedObject = undefined;
}

function createWorkspaceService(): PreviewWorkspace {
	return withRobloxFallback({
		ClassName: "Workspace" as const,
		Name: "Workspace" as const,
		GetFullName() {
			return "Workspace";
		},
		IsA(typeName: string) {
			return (
				typeName === "Workspace" ||
				typeName === "WorldRoot" ||
				typeName === "Model" ||
				typeName === "Instance"
			);
		},
	});
}

function createTween(
	instance: unknown,
	tweenInfo: TweenInfo,
	goal: Record<string, unknown>,
): PreviewTween {
	const completed = new Signal<[playbackState: unknown]>();
	const controller = createPreviewTweenController({
		goal,
		instance,
		onCompleted(playbackState) {
			completed.fire(playbackState);
		},
		playbackStates: {
			Begin: previewEnum.PlaybackState.Begin,
			Cancelled: previewEnum.PlaybackState.Cancelled,
			Completed: previewEnum.PlaybackState.Completed,
			Delayed: previewEnum.PlaybackState.Delayed,
			Paused: previewEnum.PlaybackState.Paused,
			Playing: previewEnum.PlaybackState.Playing,
		},
		tweenInfo,
	});

	return withRobloxFallback({
		Completed: completed,
		Instance: instance,
		get PlaybackState() {
			return controller.playbackState;
		},
		TweenInfo: tweenInfo,
		Cancel() {
			controller.cancel();
		},
		Destroy() {
			controller.destroy();
		},
		Pause() {
			controller.pause();
		},
		Play() {
			controller.play();
		},
	});
}

function createTweenService(): PreviewTweenService {
	return withRobloxFallback({
		ClassName: "TweenService" as const,
		Name: "TweenService" as const,
		...createServiceBase("TweenService"),
		Create(
			instance: unknown,
			tweenInfo: TweenInfo,
			goal: Record<string, unknown>,
		) {
			return createTween(instance, tweenInfo, goal);
		},
	});
}

function createUnknownService(name: string) {
	return withRobloxFallback({
		ClassName: name,
		Name: name,
		GetFullName() {
			return `game.${name}`;
		},
		IsA(typeName: string) {
			return (
				typeName === name || typeName === "Service" || typeName === "Instance"
			);
		},
	});
}

function createGameServiceRegistry(): PreviewServiceRegistry {
	const services = new Map<string, unknown>();
	const playerGui = createPlayerGui();
	const localPlayer = createLocalPlayer();
	const workspace = createWorkspaceService();

	services.set("RunService", RunService);
	services.set("Players", createPlayersService(localPlayer));
	services.set("UserInputService", createUserInputService());
	services.set("GuiService", createGuiService());
	services.set("TweenService", createTweenService());
	services.set("Workspace", workspace);

	const gameBase = {
		ClassName: "DataModel" as const,
		Name: "game" as const,
		...createServiceBase("game"),
		FindService(name: string) {
			return services.get(name) ?? null;
		},
		GetService(name: string) {
			const existing = services.get(name);
			if (existing !== undefined) {
				return existing;
			}

			const fallback = createUnknownService(name);
			services.set(name, fallback);
			return fallback;
		},
	};

	for (const serviceName of services.keys()) {
		Object.defineProperty(gameBase, serviceName, {
			configurable: true,
			enumerable: true,
			get() {
				return services.get(serviceName);
			},
		});
	}

	const game = withRobloxFallback(gameBase) as PreviewGame;

	return {
		game,
		services,
		playerGui,
		tweenInfo: TweenInfo,
		workspace,
	};
}

type GlobalPreviewServices = typeof globalThis & {
	[SERVICES_KEY]?: PreviewServiceRegistry;
	[TWEEN_INFO_KEY]?: typeof TweenInfo;
};

export class TweenInfo {
	readonly DelayTime: number;
	readonly EasingDirection: unknown;
	readonly EasingStyle: unknown;
	readonly RepeatCount: number;
	readonly Reverses: boolean;
	readonly Time: number;

	constructor(
		time = 0,
		easingStyle: unknown = previewEnum.EasingStyle.Quad,
		easingDirection: unknown = previewEnum.EasingDirection.Out,
		repeatCount = 0,
		reverses = false,
		delayTime = 0,
	) {
		this.Time = time;
		this.EasingStyle = easingStyle;
		this.EasingDirection = easingDirection;
		this.RepeatCount = repeatCount;
		this.Reverses = reverses;
		this.DelayTime = delayTime;
	}
}

function getPreviewServiceRegistry() {
	const globalRecord = globalThis as GlobalPreviewServices;
	if (!globalRecord[SERVICES_KEY]) {
		globalRecord[SERVICES_KEY] = createGameServiceRegistry();
	}

	return globalRecord[SERVICES_KEY];
}

export function getGame() {
	return getPreviewServiceRegistry().game;
}

export function getWorkspace() {
	return getPreviewServiceRegistry().workspace;
}

export function getTweenInfoConstructor() {
	const globalRecord = globalThis as GlobalPreviewServices;
	if (!globalRecord[TWEEN_INFO_KEY]) {
		globalRecord[TWEEN_INFO_KEY] = getPreviewServiceRegistry().tweenInfo;
	}

	return globalRecord[TWEEN_INFO_KEY];
}

export const game: PreviewGame = getGame();
export const workspace: PreviewWorkspace = getWorkspace();
