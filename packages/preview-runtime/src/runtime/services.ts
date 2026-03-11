import { Enum } from "./Enum";
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

const SERVICES_KEY = Symbol.for("loom-dev.preview-runtime.services");
const TWEEN_INFO_KEY = Symbol.for("loom-dev.preview-runtime.TweenInfo");
const USER_INPUT_TRACKER_KEY = Symbol.for(
	"loom-dev.preview-runtime.userInputTracker",
);

const robloxMockRecord = robloxMock as unknown as Record<PropertyKey, unknown>;
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
	readonly UserId: 0;
	GetFullName(): string;
	IsA(name: string): boolean;
}

export interface PreviewPlayersService {
	readonly ClassName: "Players";
	readonly LocalPlayer: PreviewPlayer;
	readonly Name: "Players";
	readonly PlayerAdded: RBXScriptSignal<[player: PreviewPlayer]>;
	readonly PlayerRemoving: RBXScriptSignal<[player: PreviewPlayer]>;
	FindFirstChild(name: string): PreviewPlayer | null;
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
	readonly TextBoxFocusReleased: RBXScriptSignal<[element: HTMLElement | null]>;
	readonly TextBoxFocused: RBXScriptSignal<[element: HTMLElement | null]>;
	readonly TouchEnabled: false;
	readonly VREnabled: false;
	GetFocusedTextBox(): HTMLElement | null;
	GetFullName(): string;
	GetLastInputType(): string;
	IsA(name: string): boolean;
}

export interface PreviewGuiService {
	readonly ClassName: "GuiService";
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

function createLocalPlayer(): PreviewPlayer {
	return withRobloxFallback({
		ClassName: "Player" as const,
		DisplayName: "LocalPlayer" as const,
		Name: "LocalPlayer" as const,
		UserId: 0 as const,
		...createServiceBase("Players"),
		GetFullName() {
			return "Players.LocalPlayer";
		},
		IsA(typeName: string) {
			return typeName === "Player" || typeName === "Instance";
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
		return null;
	}

	const activeElement = document.activeElement;
	return isTextBoxElement(activeElement) ? activeElement : null;
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
	return isTextBoxElement(target) ? target : null;
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
			return name === localPlayer.Name ? localPlayer : null;
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
	const textBoxFocused = new Signal<[element: HTMLElement | null]>();
	const textBoxFocusReleased = new Signal<[element: HTMLElement | null]>();
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
			if (releasedTextBox === null) {
				focusedTextBox = getFocusedTextBox();
				return;
			}

			focusedTextBox = null;
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

	return withRobloxFallback({
		ClassName: "GuiService" as const,
		Name: "GuiService" as const,
		...createServiceBase("GuiService"),
		GetGuiInset() {
			return [zeroVector, zeroVector] as const;
		},
		IsTenFootInterface() {
			return false as const;
		},
	});
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

function applyTweenGoal(target: unknown, goal: Record<string, unknown>) {
	if (!target || typeof target !== "object") {
		return;
	}

	const record = target as Record<string, unknown>;
	for (const [key, value] of Object.entries(goal)) {
		record[key] = value;
	}
}

function createTween(
	instance: unknown,
	tweenInfo: TweenInfo,
	goal: Record<string, unknown>,
): PreviewTween {
	const completed = new Signal<[playbackState: unknown]>();
	let playbackState = previewEnum.PlaybackState.Begin;
	let destroyed = false;

	return withRobloxFallback({
		Completed: completed,
		Instance: instance,
		get PlaybackState() {
			return playbackState;
		},
		TweenInfo: tweenInfo,
		Cancel() {
			if (
				destroyed ||
				playbackState === previewEnum.PlaybackState.Cancelled ||
				playbackState === previewEnum.PlaybackState.Completed
			) {
				return;
			}

			playbackState = previewEnum.PlaybackState.Cancelled;
		},
		Destroy() {
			if (destroyed) {
				return;
			}

			destroyed = true;
			if (playbackState !== previewEnum.PlaybackState.Completed) {
				playbackState = previewEnum.PlaybackState.Cancelled;
			}
		},
		Pause() {
			if (
				destroyed ||
				playbackState === previewEnum.PlaybackState.Cancelled ||
				playbackState === previewEnum.PlaybackState.Completed
			) {
				return;
			}

			playbackState = previewEnum.PlaybackState.Paused;
		},
		Play() {
			if (destroyed || playbackState === previewEnum.PlaybackState.Completed) {
				return;
			}

			if (playbackState === previewEnum.PlaybackState.Cancelled) {
				return;
			}

			applyTweenGoal(instance, goal);
			playbackState = previewEnum.PlaybackState.Completed;
			completed.fire(previewEnum.PlaybackState.Completed);
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
