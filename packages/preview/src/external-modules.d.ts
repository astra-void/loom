declare module "@loom-dev/layout-engine" {
	export type LayoutEngineModuleOrPath =
		| string
		| URL
		| Request
		| Response
		| Blob
		| BufferSource
		| WebAssembly.Module;

	export type LayoutEngineInitInput =
		| {
				module_or_path?:
					| LayoutEngineModuleOrPath
					| Promise<LayoutEngineModuleOrPath>;
		  }
		| LayoutEngineModuleOrPath
		| Promise<LayoutEngineModuleOrPath>
		| undefined;

	export default function initLayoutEngine(
		input?: LayoutEngineInitInput,
	): Promise<void>;

	export class LayoutSession {
		applyNodes(nodes: unknown[]): void;
		computeDirty(): unknown;
		dispose(): void;
		removeNodes(nodeIds: string[]): void;
		setViewport(viewport: { height: number; width: number }): void;
	}

	export function createLayoutSession(): LayoutSession;
	export function compute_layout(
		raw_tree: unknown,
		viewport_width: number,
		viewport_height: number,
	): unknown;
}

declare module "@loom-dev/preview-runtime" {
	import type * as ReactTypes from "react";

	type PreviewHostComponent = ReactTypes.ComponentType<Record<string, unknown>>;
	type PreviewSerializedAxis = {
		Offset: number;
		Scale: number;
	};
	type PreviewPortalContextValue = {
		container?: HTMLElement | null;
		displayOrderBase: number;
	};
	type PreviewPresenceRenderState = {
		isPresent: boolean;
		onExitComplete: () => void;
	};
	type PreviewPresenceRender = (
		state: PreviewPresenceRenderState,
	) => ReactTypes.ReactElement | undefined;
	type PreviewRuntimeErrorOptions = PreviewRuntimeIssueContext & {
		cause?: unknown;
		summary: string;
	};
	type PreviewLayoutEngineModuleOrPath =
		| ArrayBuffer
		| Promise<ArrayBuffer | Uint8Array | URL | WebAssembly.Module | string>
		| Uint8Array
		| URL
		| WebAssembly.Module
		| string;
	type RobloxLayoutRegistrationInput = {
		anchorPoint?: {
			x?: number;
			y?: number;
			X?: number;
			Y?: number;
		};
		canMeasure?: boolean;
		debugLabel?: string;
		hostMetadata?: PreviewLayoutHostMetadata;
		id: string;
		intrinsicSize?: {
			height: number;
			width: number;
		} | null;
		kind?: PreviewLayoutNodeKind;
		layoutModifiers?: Record<string, unknown>;
		layoutOrder?: number;
		measure?: () => { height: number; width: number } | null;
		measurementVersion?: number;
		name?: string;
		nodeType: string;
		parentId?: string;
		position?: unknown;
		size?: unknown;
		sourceOrder?: number;
		styleHints?: {
			height?: string;
			width?: string;
		};
	};
	type PreviewWorkspace = {
		readonly ClassName: "Workspace";
		readonly Name: "Workspace";
		GetFullName(): string;
		IsA(name: string): boolean;
	};
	type PreviewStringLibrary = {
		find(
			value: string,
			pattern: string,
			init?: number,
			plain?: boolean,
		): readonly [number, number] | undefined;
		gsub(
			value: string,
			pattern: string,
			replacement: string | ((match: string, ...captures: string[]) => unknown),
		): readonly [string, number];
		lower(value: string): string;
		sub(value: string, start?: number, finish?: number): string;
		upper(value: string): string;
	};
	type PreviewOsLibrary = {
		clock(): number;
	};

	export type PreviewExecutionMode =
		| "strict-fidelity"
		| "compatibility"
		| "mocked"
		| "design-time";
	export type PreviewPropKind =
		| "array"
		| "bigint"
		| "boolean"
		| "function"
		| "literal"
		| "number"
		| "object"
		| "react-element"
		| "react-node"
		| "string"
		| "union"
		| "unknown";
	export type PreviewPropMetadata = {
		elementType?: PreviewPropMetadata;
		kind: PreviewPropKind;
		literal?: boolean | number | string | null;
		properties?: Record<string, PreviewPropMetadata>;
		required: boolean;
		type: string;
		unionTypes?: PreviewPropMetadata[];
	};
	export type PreviewComponentPropsMetadata = {
		componentName: string;
		props: Record<string, PreviewPropMetadata>;
	};
	export type ViewportSize = {
		height: number;
		width: number;
	};
	export type ComputedRect = {
		height: number;
		width: number;
		x: number;
		y: number;
	};
	export type PreviewLayoutHostMetadata = {
		degraded: boolean;
		fullSizeDefault: boolean;
		placeholderBehavior: "none" | "container" | "opaque";
	};
	export type PreviewLayoutNodeKind = "host" | "layout" | "root";
	export type PreviewLayoutSizeResolution = {
		hadExplicitSize: boolean;
		intrinsicSizeAvailable: boolean;
		reason:
			| "explicit-size"
			| "full-size-default"
			| "intrinsic-measurement"
			| "intrinsic-empty"
			| "root-default";
	};
	export type PreviewLayoutNode = {
		debugLabel?: string;
		hostMetadata?: PreviewLayoutHostMetadata;
		id: string;
		intrinsicSize?: {
			height: number;
			width: number;
		} | null;
		kind: PreviewLayoutNodeKind;
		layout: {
			anchorPoint: {
				x: number;
				y: number;
			};
			constraints?: {
				height?: {
					max?: number;
					min?: number;
				};
				width?: {
					max?: number;
					min?: number;
				};
			};
			position: {
				x: {
					offset: number;
					scale: number;
				};
				y: {
					offset: number;
					scale: number;
				};
			};
			positionMode: "absolute";
			size?: {
				x: {
					offset: number;
					scale: number;
				};
				y: {
					offset: number;
					scale: number;
				};
			};
		};
		layoutModifiers?: Record<string, unknown>;
		layoutOrder?: number;
		name?: string;
		nodeType: string;
		parentId?: string;
		sourceOrder?: number;
		styleHints?: {
			height?: string;
			width?: string;
		};
	};
	export type PreviewLayoutDebugNode = {
		children: PreviewLayoutDebugNode[];
		debugLabel?: string;
		hostPolicy: PreviewLayoutHostMetadata;
		id: string;
		intrinsicSize: {
			height: number;
			width: number;
		} | null;
		kind: PreviewLayoutNodeKind;
		layoutSource:
			| "explicit-size"
			| "full-size-default"
			| "intrinsic-size"
			| "root-default";
		nodeType: string;
		parentConstraints: ComputedRect | null;
		parentId?: string;
		provenance: {
			detail: string;
			source: "fallback" | "wasm";
		};
		rect: ComputedRect | null;
		sizeResolution: PreviewLayoutSizeResolution;
		styleHints?: {
			height?: string;
			width?: string;
		};
	};
	export type PreviewLayoutDebugPayload = {
		dirtyNodeIds: string[];
		roots: PreviewLayoutDebugNode[];
		viewport: {
			height: number;
			width: number;
		};
	};
	export type PreviewLayoutProbeSnapshot = {
		debug: PreviewLayoutDebugPayload;
		error: string | null;
		isReady: boolean;
		revision: number;
		viewport: ViewportSize;
		viewportReady: boolean;
	};
	export type PreviewLayoutEngineInitOptions = {
		module_or_path?: PreviewLayoutEngineModuleOrPath;
	};
	export type PreviewLayoutEngineLoader = () => PreviewLayoutEngineModuleOrPath;

	export type PreviewRuntimeIssueKind =
		| "ModuleLoadError"
		| "TransformExecutionError"
		| "TransformValidationError"
		| "UnsupportedPatternError"
		| "RuntimeMockError"
		| "LayoutExecutionError"
		| "LayoutValidationError";
	export type PreviewRuntimeIssuePhase = "transform" | "runtime" | "layout";
	export type PreviewRuntimeIssueSeverity = "error" | "info" | "warning";
	export type PreviewRuntimeIssue = {
		blocking?: boolean;
		code: string;
		entryId: string;
		file: string;
		kind: PreviewRuntimeIssueKind;
		phase: PreviewRuntimeIssuePhase;
		relativeFile: string;
		severity?: PreviewRuntimeIssueSeverity;
		summary: string;
		target: string;
		codeFrame?: string;
		details?: string;
		importChain?: string[];
		symbol?: string;
	};
	export type PreviewRuntimeIssueContext = Partial<
		Omit<PreviewRuntimeIssue, "kind" | "phase" | "summary">
	> & {
		kind?: PreviewRuntimeIssueKind;
		phase?: PreviewRuntimeIssuePhase;
		summary?: string;
	};

	export interface PreviewRuntimeReporter {
		clear(): void;
		getIssues(): PreviewRuntimeIssue[];
		publish(issue: PreviewRuntimeIssue): void;
		setContext(context: PreviewRuntimeIssueContext | null): void;
		subscribe(listener: (issues: PreviewRuntimeIssue[]) => void): () => void;
	}

	export type PreviewPolyfillTarget = typeof globalThis & {
		print?: (...args: unknown[]) => void;
		tostring?: (value: unknown) => string;
	};
	export interface PreviewEnumItem {
		readonly [key: string]: unknown;
		readonly EnumType: PreviewEnumCategory;
		readonly Name: string;
		readonly Value: number;
		IsA(name: string): boolean;
	}
	export interface PreviewEnumCategory {
		readonly [key: string]: unknown;
		readonly Name: string;
		GetEnumItems(): PreviewEnumItem[];
		FromName(name: string): PreviewEnumItem;
		FromValue(value: number): PreviewEnumItem;
	}
	export interface PreviewEnumRoot {
		readonly [key: string]: unknown;
		GetEnums(): PreviewEnumCategory[];
	}
	export interface RBXScriptConnection {
		readonly Connected: boolean;
		Disconnect(): void;
	}
	export interface RBXScriptSignal<
		TArgs extends readonly unknown[] = readonly unknown[],
	> {
		Connect(listener: (...args: TArgs) => void): RBXScriptConnection;
	}
	export type TaskCallback<
		TArgs extends readonly unknown[] = readonly unknown[],
	> = (...args: TArgs) => void;
	export interface TaskLibrary {
		readonly cancel: (handle: unknown) => void;
		readonly defer: <TArgs extends readonly unknown[]>(
			callback: TaskCallback<TArgs>,
			...args: TArgs
		) => void;
		readonly delay: <TArgs extends readonly unknown[]>(
			seconds: number,
			callback: TaskCallback<TArgs>,
			...args: TArgs
		) => ReturnType<typeof globalThis.setTimeout>;
		readonly spawn: <TArgs extends readonly unknown[], TResult>(
			callback: (...args: TArgs) => TResult,
			...args: TArgs
		) => TResult | undefined;
		readonly wait: (seconds?: number) => Promise<number>;
	}
	export interface PreviewRunService {
		readonly Heartbeat: RBXScriptSignal<[deltaTime: number]>;
		readonly RenderStepped: RBXScriptSignal<[deltaTime: number]>;
		readonly Stepped: RBXScriptSignal<[time: number, deltaTime: number]>;
		IsClient(): true;
		IsServer(): false;
	}
	export interface PreviewGame {
		readonly ClassName: "DataModel";
		readonly Name: "game";
		readonly Workspace: PreviewWorkspace;
		FindService(name: string): unknown;
		GetFullName(): string;
		GetService(name: string): unknown;
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
		readonly TextBoxFocusReleased: RBXScriptSignal<
			[element: HTMLElement | null]
		>;
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
	export class TweenInfo {
		readonly DelayTime: number;
		readonly EasingDirection: unknown;
		readonly EasingStyle: unknown;
		readonly RepeatCount: number;
		readonly Reverses: boolean;
		readonly Time: number;
		constructor(
			time?: number,
			easingStyle?: unknown,
			easingDirection?: unknown,
			repeatCount?: number,
			reverses?: boolean,
			delayTime?: number,
		);
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
	export type PreviewRuntimeGlobalValues = {
		Color3: typeof Color3;
		error: typeof error;
		Enum: PreviewEnumRoot;
		RunService: PreviewRunService;
		TweenInfo: typeof TweenInfo;
		UDim: typeof UDim;
		UDim2: typeof UDim2;
		Vector2: typeof Vector2;
		Vector3: typeof Vector3;
		game: PreviewGame;
		math: typeof math;
		next: typeof next;
		os: PreviewOsLibrary;
		pairs: typeof pairs;
		print: (...args: unknown[]) => void;
		string: PreviewStringLibrary;
		task: TaskLibrary;
		tostring: (value: unknown) => string;
		typeIs: typeof typeIs;
		warn: typeof warn;
		workspace: PreviewWorkspace;
	};
	export type SetupRobloxEnvironmentTarget = {
		-readonly [K in keyof PreviewRuntimeGlobalValues]?: PreviewRuntimeGlobalValues[K];
	};
	export type PreviewAutoMockableComponent<
		Props extends Record<string, unknown> = Record<string, unknown>,
	> = ReactTypes.ComponentType<Props> & {
		__previewProps?: PreviewComponentPropsMetadata;
	};
	export type LayerInteractEvent = {
		defaultPrevented: boolean;
		originalEvent: Event;
		preventDefault: () => void;
	};

	export const React: typeof import("react");

	export const BillboardGui: PreviewHostComponent;
	export const CanvasGroup: PreviewHostComponent;
	export const Frame: PreviewHostComponent;
	export const ImageButton: PreviewHostComponent;
	export const ImageLabel: PreviewHostComponent;
	export const ScreenGui: PreviewHostComponent;
	export const ScrollingFrame: PreviewHostComponent;
	export const SurfaceGui: PreviewHostComponent;
	export const TextBox: PreviewHostComponent;
	export const TextButton: PreviewHostComponent;
	export const TextLabel: PreviewHostComponent;
	export const UIAspectRatioConstraint: PreviewHostComponent;
	export const UICorner: PreviewHostComponent;
	export const UIFlexItem: PreviewHostComponent;
	export const UIGradient: PreviewHostComponent;
	export const UIGridLayout: PreviewHostComponent;
	export const UIListLayout: PreviewHostComponent;
	export const UIPageLayout: PreviewHostComponent;
	export const UIPadding: PreviewHostComponent;
	export const UIScale: PreviewHostComponent;
	export const UISizeConstraint: PreviewHostComponent;
	export const UIStroke: PreviewHostComponent;
	export const UITableLayout: PreviewHostComponent;
	export const UITextSizeConstraint: PreviewHostComponent;
	export const VideoFrame: PreviewHostComponent;
	export const ViewportFrame: PreviewHostComponent;

	export class UDim {
		readonly Offset: number;
		readonly Scale: number;
		constructor(scale: number, offset: number);
		add(other: UDim): UDim;
		sub(other: UDim): UDim;
	}
	export class Vector2 {
		readonly X: number;
		readonly Y: number;
		constructor(x: number, y: number);
	}
	export class UDim2 {
		readonly X: UDim;
		readonly Y: UDim;
		constructor(
			xScale: number,
			xOffset: number,
			yScale: number,
			yOffset: number,
		);
		static fromOffset(x: number, y: number): UDim2;
		static fromScale(x: number, y: number): UDim2;
		add(other: { X: PreviewSerializedAxis; Y: PreviewSerializedAxis }): UDim2;
		sub(other: { X: PreviewSerializedAxis; Y: PreviewSerializedAxis }): UDim2;
	}
	export class Color3 {
		readonly B: number;
		readonly G: number;
		readonly R: number;
		constructor(r: number, g: number, b: number);
		static fromRGB(r: number, g: number, b: number): Color3;
	}
	export type Color3Value = Color3;
	export const Enum: PreviewEnumRoot;
	export const RunService: PreviewRunService;
	export const game: PreviewGame;
	export const math: typeof math;
	export const os: PreviewOsLibrary;
	export const print: (...args: unknown[]) => void;
	export const string: PreviewStringLibrary;
	export const task: TaskLibrary;
	export const tostring: (value: unknown) => string;
	export const warn: typeof warn;
	export const workspace: PreviewWorkspace;
	export const robloxMock: Record<PropertyKey, unknown>;
	export const robloxModuleMock: Record<PropertyKey, unknown>;
	export const previewRuntimeGlobalNames: ReadonlyArray<
		keyof PreviewRuntimeGlobalValues
	>;
	export const previewRuntimeGlobalValues: PreviewRuntimeGlobalValues;

	export function __previewGlobal(name: string): unknown;
	export function error(message: string): never;
	export function next(
		value: unknown,
		index?: PropertyKey | null,
	): readonly [PropertyKey | undefined, unknown | undefined];
	export function typeIs(
		value: unknown,
		typeName: "string" | "number" | "boolean" | "function" | "table",
	): boolean;
	export function pairs(
		value: unknown,
	): IterableIterator<readonly [PropertyKey, unknown]>;
	export function isPreviewElement(
		value: unknown,
		typeName: string,
	): value is HTMLElement;
	export function installPreviewRuntimePolyfills(
		target?: PreviewPolyfillTarget,
	): PreviewPolyfillTarget;
	export function installPreviewRuntimeGlobals(
		target?: SetupRobloxEnvironmentTarget,
	): SetupRobloxEnvironmentTarget;
	export function setupRobloxEnvironment(
		target?: SetupRobloxEnvironmentTarget,
	): SetupRobloxEnvironmentTarget;
	export function clearPreviewRuntimeIssues(): void;
	export function getPreviewRuntimeIssues(): PreviewRuntimeIssue[];
	export function getPreviewRuntimeReporter(): PreviewRuntimeReporter;
	export function normalizePreviewRuntimeError(
		context: PreviewRuntimeIssueContext,
		error: unknown,
	): PreviewRuntimeIssue;
	export function publishPreviewRuntimeIssue(
		issueOrError: PreviewRuntimeIssue | unknown,
		context?: PreviewRuntimeIssueContext,
	): PreviewRuntimeIssue;
	export function setPreviewRuntimeIssueContext(
		context: PreviewRuntimeIssueContext | null,
	): void;
	export function subscribePreviewRuntimeIssues(
		listener: (issues: PreviewRuntimeIssue[]) => void,
	): () => void;
	export function createUniversalRobloxMock(): Record<PropertyKey, unknown>;
	export function createUniversalRobloxModuleMock(): Record<
		PropertyKey,
		unknown
	>;
	export function areViewportsEqual(
		left: ViewportSize | null | undefined,
		right: ViewportSize | null | undefined,
	): boolean;
	export function createViewportSize(
		width: unknown,
		height: unknown,
	): ViewportSize | null;
	export function createWindowViewport(): ViewportSize;
	export function getPreviewLayoutProbeSnapshot(): PreviewLayoutProbeSnapshot;
	export function initializeLayoutEngine(
		options?: PreviewLayoutEngineInitOptions,
	): Promise<void>;
	export function loadPreviewLayoutEngineWasmBytes(): Promise<Uint8Array>;
	export function isViewportLargeEnough(
		viewport: ViewportSize | null | undefined,
		minDimension?: number,
	): viewport is ViewportSize;
	export function measureElementViewport(
		element: Element | null,
	): ViewportSize | null;
	export function pickViewport(
		candidates: Array<ViewportSize | null | undefined>,
		fallback: ViewportSize,
	): ViewportSize;
	export function setPreviewLayoutEngineLoader(
		loader: PreviewLayoutEngineLoader | null,
	): void;
	export function subscribePreviewLayoutProbe(
		listener: (snapshot: PreviewLayoutProbeSnapshot) => void,
	): () => void;
	export function usePreviewLayoutProbeSnapshot(): PreviewLayoutProbeSnapshot;
	export function buildAutoMockProps<Props extends Record<string, unknown>>(
		component: PreviewAutoMockableComponent<Props>,
		explicitProps?: Partial<Props> | Record<string, unknown>,
	): Props;
	export function withAutoMockedProps<Props extends Record<string, unknown>>(
		component: PreviewAutoMockableComponent<Props>,
	): ReactTypes.ComponentType<Partial<Props>>;
	export function AutoMockProvider<
		Props extends Record<string, unknown>,
	>(props: {
		component: PreviewAutoMockableComponent<Props>;
		props?: Partial<Props> | Record<string, unknown>;
	}): ReactTypes.ReactElement | null;
	export function LayoutProvider(props: {
		children: ReactTypes.ReactNode;
		debounceMs?: number;
		viewportHeight?: number;
		viewportWidth?: number;
	}): ReactTypes.ReactElement | null;
	export function useLayoutEngineStatus(): {
		error: string | null;
		isReady: boolean;
	};
	export function useRobloxLayout(
		input: PreviewLayoutNode | RobloxLayoutRegistrationInput,
	): ComputedRect | null;
	export function createStrictContext<T>(
		name: string,
	): readonly [ReactTypes.Provider<T | undefined>, () => T];
	export function useControllableState<T>(options: {
		defaultValue: T;
		onChange?: (next: T) => void;
		value?: T;
	}): readonly [T, (next: T | ((previous: T) => T)) => void];
	export const Slot: PreviewHostComponent;
	export function DismissableLayer(props: {
		children?: ReactTypes.ReactNode;
		disableOutsidePointerEvents?: boolean;
		enabled?: boolean;
		modal?: boolean;
		onDismiss?: () => void;
		onEscapeKeyDown?: (event: LayerInteractEvent) => void;
		onInteractOutside?: (event: LayerInteractEvent) => void;
		onPointerDownOutside?: (event: LayerInteractEvent) => void;
	}): ReactTypes.ReactElement | null;
	export function FocusScope(props: {
		active?: boolean;
		asChild?: boolean;
		children?: ReactTypes.ReactNode;
		restoreFocus?: boolean;
		trapped?: boolean;
	}): ReactTypes.ReactElement | null;
	export function PortalProvider(props: {
		children?: ReactTypes.ReactNode;
		container?: HTMLElement | null;
		displayOrderBase?: number;
	}): ReactTypes.ReactElement | null;
	export function Portal(props: {
		children?: ReactTypes.ReactNode;
		container?: HTMLElement | null;
	}): ReactTypes.ReactPortal | null;
	export function usePortalContext(): PreviewPortalContextValue;
	export function Presence(props: {
		children?: PreviewPresenceRender;
		exitFallbackMs?: number;
		onExitComplete?: () => void;
		present: boolean;
		render?: PreviewPresenceRender;
	}): ReactTypes.ReactElement | undefined;
	export class PreviewRuntimeError extends Error {
		readonly blocking: boolean;
		readonly code: string;
		readonly codeFrame?: string;
		readonly details?: string;
		readonly entryId?: string;
		readonly file?: string;
		readonly importChain?: string[];
		readonly kind: PreviewRuntimeIssueKind;
		readonly phase: PreviewRuntimeIssuePhase;
		readonly relativeFile?: string;
		readonly severity: PreviewRuntimeIssueSeverity;
		readonly summary: string;
		readonly symbol?: string;
		readonly target?: string;
		constructor(
			kind: PreviewRuntimeIssueKind,
			options: PreviewRuntimeErrorOptions,
		);
		toIssue(context?: PreviewRuntimeIssueContext | null): PreviewRuntimeIssue;
	}
	export class ModuleLoadError extends PreviewRuntimeError {
		constructor(options: PreviewRuntimeErrorOptions);
	}
	export class TransformExecutionError extends PreviewRuntimeError {
		constructor(options: PreviewRuntimeErrorOptions);
	}
	export class TransformValidationError extends PreviewRuntimeError {
		constructor(options: PreviewRuntimeErrorOptions);
	}
	export class UnsupportedPatternError extends PreviewRuntimeError {
		constructor(options: PreviewRuntimeErrorOptions);
	}
	export class RuntimeMockError extends PreviewRuntimeError {
		constructor(options: PreviewRuntimeErrorOptions);
	}
	export class LayoutExecutionError extends PreviewRuntimeError {
		constructor(options: PreviewRuntimeErrorOptions);
	}
	export class LayoutValidationError extends PreviewRuntimeError {
		constructor(options: PreviewRuntimeErrorOptions);
	}
	export function __rbxStyle(
		props: Record<string, unknown>,
	): ReactTypes.CSSProperties;
	export const Box: PreviewHostComponent;
	export const Text: PreviewHostComponent;

	export type PreviewRuntime = {
		helpers: PreviewRuntimeGlobalValues & {
			__previewGlobal: typeof __previewGlobal;
			isPreviewElement: typeof isPreviewElement;
		};
		hosts: {
			BillboardGui: typeof BillboardGui;
			CanvasGroup: typeof CanvasGroup;
			Frame: typeof Frame;
			ImageButton: typeof ImageButton;
			ImageLabel: typeof ImageLabel;
			ScreenGui: typeof ScreenGui;
			ScrollingFrame: typeof ScrollingFrame;
			SurfaceGui: typeof SurfaceGui;
			TextBox: typeof TextBox;
			TextButton: typeof TextButton;
			TextLabel: typeof TextLabel;
			UIAspectRatioConstraint: typeof UIAspectRatioConstraint;
			UICorner: typeof UICorner;
			UIFlexItem: typeof UIFlexItem;
			UIGradient: typeof UIGradient;
			UIGridLayout: typeof UIGridLayout;
			UIListLayout: typeof UIListLayout;
			UIPageLayout: typeof UIPageLayout;
			UIPadding: typeof UIPadding;
			UIScale: typeof UIScale;
			UISizeConstraint: typeof UISizeConstraint;
			UIStroke: typeof UIStroke;
			UITableLayout: typeof UITableLayout;
			UITextSizeConstraint: typeof UITextSizeConstraint;
			VideoFrame: typeof VideoFrame;
			ViewportFrame: typeof ViewportFrame;
		};
		primitives: {
			DismissableLayer: typeof DismissableLayer;
			FocusScope: typeof FocusScope;
			LayoutProvider: typeof LayoutProvider;
			Portal: typeof Portal;
			PortalProvider: typeof PortalProvider;
			Presence: typeof Presence;
			Slot: typeof Slot;
			createStrictContext: typeof createStrictContext;
			useControllableState: typeof useControllableState;
			useLayoutEngineStatus: typeof useLayoutEngineStatus;
			useRobloxLayout: typeof useRobloxLayout;
		};
	};

	export const previewRuntime: PreviewRuntime;
}

declare module "@loom-dev/preview-engine" {
	import type { ComponentType } from "react";
	import type { PreviewRuntimeIssue } from "@loom-dev/preview-runtime";

	type TransformPreviewSourceResult =
		import("@loom-dev/compiler").TransformPreviewSourceResult & {
			diagnostics?: PreviewTransformDiagnostic[];
			outcome?: PreviewTransformOutcome;
		};
	type NormalizedTransformPreviewSourceResult = {
		code?: string;
		diagnostics: PreviewTransformDiagnostic[];
		outcome: PreviewTransformOutcome;
	};

	export type PreviewTransformMode =
		| "strict-fidelity"
		| "compatibility"
		| "mocked"
		| "design-time";
	export type PreviewTransformSeverity = "error" | "info" | "warning";
	export type PreviewTransformDiagnostic = {
		blocking: boolean;
		code: string;
		details?: string;
		file: string;
		line: number;
		column: number;
		severity: PreviewTransformSeverity;
		summary: string;
		symbol?: string;
		target: string;
	};
	export type PreviewTransformOutcome = {
		fidelity: "preserved" | "degraded" | "metadata-only";
		kind: "ready" | "compatibility" | "mocked" | "blocked" | "design-time";
	};
	export type PreviewExecutionMode = PreviewTransformMode;
	export type PreviewPropKind =
		| "array"
		| "bigint"
		| "boolean"
		| "function"
		| "literal"
		| "number"
		| "object"
		| "react-element"
		| "react-node"
		| "string"
		| "union"
		| "unknown";
	export type PreviewPropMetadata = {
		elementType?: PreviewPropMetadata;
		kind: PreviewPropKind;
		literal?: boolean | number | string | undefined;
		properties?: Record<string, PreviewPropMetadata>;
		required: boolean;
		type: string;
		unionTypes?: PreviewPropMetadata[];
	};
	export type PreviewComponentPropsMetadata = {
		componentName: string;
		props: Record<string, PreviewPropMetadata>;
	};
	export type PreviewDefinition<Props = Record<string, unknown>> = {
		entry?: ComponentType<Props>;
		props?: Props;
		render?: () => unknown;
		title?: string;
	};
	export type PreviewSourceTarget = {
		exclude?: string[];
		include?: string[];
		name: string;
		packageName?: string;
		packageRoot: string;
		sourceRoot: string;
	};
	export type WorkspaceGraphService = {
		collectTransitiveDependencyPaths(filePath: string): string[];
		getFileContext(filePath: string): {
			packageName?: string;
			packageRoot: string;
			project?: {
				configDir: string;
				configPath: string;
			};
		};
		getWorkspaceProjects(): Array<{
			configDir: string;
			configPath: string;
			filePaths: Set<string>;
			outDir?: string;
			packageName?: string;
			packageRoot: string;
			rootDir: string;
		}>;
		listTargetSourceFiles(
			target: Pick<PreviewSourceTarget, "exclude" | "include" | "sourceRoot">,
		): string[];
		resolveImport(options: {
			importerFilePath: string;
			specifier: string;
		}): { followedFilePath?: string } | undefined;
		workspaceRoot: string;
	};
	export type PreviewEntryStatus =
		| "ready"
		| "needs_harness"
		| "ambiguous"
		| "blocked_by_transform"
		| "blocked_by_runtime"
		| "blocked_by_layout";
	export type PreviewEntryStatusDetails =
		| {
				degradedTargets?: string[];
				fidelity?: "degraded" | "preserved";
				kind: "ready";
				warningCodes?: string[];
		  }
		| {
				candidates?: string[];
				kind: "needs_harness";
				reason: "missing-explicit-contract" | "no-component-export";
		  }
		| {
				candidates: string[];
				kind: "ambiguous";
				reason: "ambiguous-exports";
		  }
		| {
				blockingCodes: string[];
				kind: "blocked_by_transform";
				reason: "transform-diagnostics";
		  }
		| {
				issueCodes: string[];
				kind: "blocked_by_runtime";
				reason: "runtime-issues";
		  }
		| {
				issueCodes: string[];
				kind: "blocked_by_layout";
				reason: "layout-issues";
		  };
	export type PreviewDiagnosticPhase =
		| "discovery"
		| "layout"
		| "runtime"
		| "transform";
	export type PreviewDiagnosticSeverity = "error" | "info" | "warning";
	export type PreviewDiscoveryDiagnosticCode =
		| "AMBIGUOUS_COMPONENT_EXPORTS"
		| "DECLARATION_ONLY_BOUNDARY"
		| "GRAPH_CYCLE_DETECTED"
		| "MISSING_EXPLICIT_PREVIEW_CONTRACT"
		| "NO_COMPONENT_EXPORTS"
		| "PREVIEW_RENDER_MISSING"
		| "UNRESOLVED_IMPORT";
	export type PreviewGraphStopReason =
		| "declaration-only-boundary"
		| "external-dependency"
		| "graph-cycle"
		| "unresolved-import";
	export type PreviewEntryCapabilities = {
		supportsHotUpdate: boolean;
		supportsLayoutDebug: boolean;
		supportsPropsEditing: boolean;
		supportsRuntimeMock: boolean;
	};
	export type PreviewDiagnosticsSummary = {
		byPhase: Record<PreviewDiagnosticPhase, number>;
		hasBlocking: boolean;
		total: number;
	};
	export type PreviewDiagnostic = {
		blocking?: boolean;
		code:
			| PreviewDiscoveryDiagnosticCode
			| PreviewTransformDiagnostic["code"]
			| string;
		details?: string;
		entryId: string;
		file: string;
		importChain?: string[];
		phase: PreviewDiagnosticPhase;
		relativeFile: string;
		severity: PreviewDiagnosticSeverity;
		summary: string;
		symbol?: string;
		target: string;
	};
	export type PreviewRenderTarget =
		| {
				exportName: "default" | string;
				kind: "component";
				usesPreviewProps: boolean;
		  }
		| {
				contract: "preview.render";
				kind: "harness";
		  }
		| {
				candidates?: string[];
				kind: "none";
				reason:
					| "ambiguous-exports"
					| "missing-explicit-contract"
					| "no-component-export";
		  };
	export type PreviewSelection =
		| {
				contract: "preview.entry" | "preview.render";
				kind: "explicit";
		  }
		| {
				kind: "unresolved";
				reason:
					| "ambiguous-exports"
					| "missing-explicit-contract"
					| "no-component-export";
		  };
	export type PreviewGraphImportEdge = {
		crossesPackageBoundary: boolean;
		importerFile: string;
		importerProjectConfigPath?: string;
		originalResolvedFile?: string;
		resolution: "resolved" | "stopped";
		resolutionKind?:
			| "declaration-file"
			| "external-dependency"
			| "project-reference-source"
			| "source-file"
			| "workspace-package";
		resolvedFile?: string;
		resolvedProjectConfigPath?: string;
		specifier: string;
		stopReason?: PreviewGraphStopReason;
	};
	export type PreviewSelectionTrace = {
		contract?: "preview.entry" | "preview.render";
		importChain: string[];
		requestedSymbol?: string;
		resolvedExportName?: string;
		symbolChain: string[];
	};
	export type PreviewGraphTrace = {
		boundaryHops: Array<{
			fromFile: string;
			fromPackageRoot: string;
			toFile: string;
			toPackageRoot: string;
		}>;
		imports: PreviewGraphImportEdge[];
		selection: PreviewSelectionTrace;
		stopReason?: PreviewGraphStopReason;
		traversedProjects?: Array<{
			configPath: string;
			packageName?: string;
			packageRoot: string;
		}>;
	};
	export type PreviewEntryDescriptor = {
		candidateExportNames: string[];
		capabilities: PreviewEntryCapabilities;
		diagnosticsSummary: PreviewDiagnosticsSummary;
		hasDefaultExport: boolean;
		hasPreviewExport: boolean;
		id: string;
		packageName: string;
		relativePath: string;
		renderTarget: PreviewRenderTarget;
		selection: PreviewSelection;
		sourceFilePath: string;
		status: PreviewEntryStatus;
		statusDetails: PreviewEntryStatusDetails;
		targetName: string;
		title: string;
	};
	export type PreviewRuntimeAdapter = {
		kind: "react-dom";
		moduleId: string;
	};
	export type PreviewTransformState = {
		mode: PreviewExecutionMode;
		outcome: PreviewTransformOutcome;
	};
	export type PreviewEntryPayload = {
		descriptor: PreviewEntryDescriptor;
		diagnostics: PreviewDiagnostic[];
		graphTrace: PreviewGraphTrace;
		propsMetadata?: PreviewComponentPropsMetadata;
		protocolVersion: number;
		runtimeAdapter: PreviewRuntimeAdapter;
		transform: PreviewTransformState;
	};
	export type PreviewWorkspaceIndex = {
		entries: PreviewEntryDescriptor[];
		projectName: string;
		protocolVersion: number;
		targets: PreviewSourceTarget[];
	};
	export type PreviewEngineSnapshot = {
		entries: Record<string, PreviewEntryPayload>;
		protocolVersion: number;
		workspaceIndex: PreviewWorkspaceIndex;
	};
	export type PreviewBuildArtifactKind =
		| "module"
		| "entry-metadata"
		| "layout-schema";
	export type PreviewBuildDiagnostic =
		| PreviewDiagnostic
		| PreviewTransformDiagnostic;
	export type PreviewBuiltArtifact = {
		cacheKey: string;
		diagnosticsSummary: PreviewDiagnosticsSummary;
		id: string;
		kind: PreviewBuildArtifactKind;
		materializedPath?: string;
		relativePath: string;
		reusedFromCache: boolean;
		sourceFilePath: string;
		targetName: string;
	};
	export type PreviewBuildOptions = {
		artifactKinds: PreviewBuildArtifactKind[];
		cacheDir?: string;
		concurrency?: number;
		outDir?: string;
		projectName: string;
		runtimeModule?: string;
		targets: PreviewSourceTarget[];
		transformMode?: PreviewExecutionMode;
		workspaceRoot?: string;
	};
	export type PreviewBuildResult = {
		builtArtifacts: PreviewBuiltArtifact[];
		cacheDir: string;
		diagnostics: PreviewBuildDiagnostic[];
		outDir?: string;
		removedFiles: string[];
		reusedArtifacts: PreviewBuiltArtifact[];
		writtenFiles: string[];
	};
	export type PreviewBuildOutputManifest = {
		artifactKinds: PreviewBuildArtifactKind[];
		files: Record<
			string,
			{
				cacheKey: string;
				sourceFilePath: string;
			}
		>;
		version: 2;
		workspaceRoot: string;
	};
	export type PreviewCachedArtifactMetadata = {
		artifactKind: PreviewBuildArtifactKind;
		cacheKey: string;
		createdAt: string;
		diagnostics: PreviewBuildDiagnostic[];
		engineVersion: number;
		sourceFilePath: string;
		targetName: string;
	};
	export type PreviewEngineUpdate = {
		changedEntryIds: string[];
		executionChangedEntryIds: string[];
		protocolVersion: number;
		registryChangedEntryIds: string[];
		removedEntryIds: string[];
		requiresFullReload: boolean;
		workspaceChanged: boolean;
		workspaceIndex: PreviewWorkspaceIndex;
	};
	export type CreatePreviewEngineOptions = {
		projectName: string;
		runtimeModule?: string;
		targets: PreviewSourceTarget[];
		transformMode?: PreviewExecutionMode;
	};
	export type PreviewEngineUpdateListener = (
		update: PreviewEngineUpdate,
	) => void;

	export const PREVIEW_ENGINE_PROTOCOL_VERSION: number;

	export interface PreviewEngine {
		dispose(): void;
		getEntryPayload(entryId: string): PreviewEntryPayload;
		getSnapshot(): PreviewEngineSnapshot;
		getWorkspaceIndex(): PreviewWorkspaceIndex;
		invalidateSourceFiles(filePaths: string[]): PreviewEngineUpdate;
		isTrackedSourceFile(filePath: string): boolean;
		onUpdate(listener: PreviewEngineUpdateListener): () => void;
		replaceRuntimeIssues(issues: PreviewRuntimeIssue[]): PreviewEngineUpdate;
	}

	export function buildPreviewArtifacts(
		options: PreviewBuildOptions,
	): Promise<PreviewBuildResult>;
	export function createPreviewEngine(
		options: CreatePreviewEngineOptions,
	): PreviewEngine;
	export function createWorkspaceGraphService(options: {
		targets: PreviewSourceTarget[];
		workspaceRoot?: string;
	}): WorkspaceGraphService;
	export function normalizeTransformPreviewSourceResult(
		result: TransformPreviewSourceResult,
		mode: PreviewTransformMode,
	): NormalizedTransformPreviewSourceResult;
	export function isTransformableSourceFile(fileName: string): boolean;
}
