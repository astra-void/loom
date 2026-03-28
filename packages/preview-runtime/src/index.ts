import * as React from "react";
import {
	BillboardGui,
	CanvasGroup,
	Frame,
	ImageButton,
	ImageLabel,
	ScreenGui,
	ScrollingFrame,
	SurfaceGui,
	TextBox,
	TextButton,
	TextLabel,
	UIAspectRatioConstraint,
	UICorner,
	UIFlexItem,
	UIGradient,
	UIGridLayout,
	UIListLayout,
	UIPadding,
	UIPageLayout,
	UIScale,
	UISizeConstraint,
	UIStroke,
	UITableLayout,
	UITextSizeConstraint,
	VideoFrame,
	ViewportFrame,
} from "./hosts";
import {
	LayoutProvider,
	useLayoutEngineStatus,
	useRobloxLayout,
} from "./layout";
import {
	createStrictContext,
	DismissableLayer,
	FocusScope,
	Portal,
	PortalProvider,
	Presence,
	Slot,
	useControllableState,
} from "./react";
import {
	__previewGlobal,
	Color3,
	error,
	game,
	installPreviewRuntimeGlobals,
	isPreviewElement,
	math,
	next,
	type PreviewRuntimeGlobalTarget,
	pairs,
	previewRuntimeGlobalValues,
	TweenInfo,
	typeIs,
	UDim,
	UDim2,
	Vector2,
	Vector3,
	warn,
	workspace,
} from "./runtime";

export type SetupRobloxEnvironmentTarget = PreviewRuntimeGlobalTarget;

const PREVIEW_INTRINSIC_HOSTS_SYMBOL = Symbol.for(
	"loom-dev.preview-runtime.intrinsic-hosts",
);

/**
 * Vite alias note:
 * - Alias broad packages such as `@rbxts/services` or `@flamework/core` to small local shim files.
 * - Re-export only the browser-safe members you need from this package in those shims.
 * - See `README.md` for concrete examples.
 */
export function setupRobloxEnvironment(
	target: SetupRobloxEnvironmentTarget = globalThis as SetupRobloxEnvironmentTarget,
) {
	const initializedTarget = installPreviewRuntimeGlobals(target);
	(
		initializedTarget as SetupRobloxEnvironmentTarget & {
			[PREVIEW_INTRINSIC_HOSTS_SYMBOL]?: typeof previewRuntimeIntrinsicHosts;
		}
	)[PREVIEW_INTRINSIC_HOSTS_SYMBOL] = previewRuntimeIntrinsicHosts;

	if (typeof window !== "undefined" && window !== target) {
		installPreviewRuntimeGlobals(
			window as Window & SetupRobloxEnvironmentTarget,
		);
		(
			window as Window &
				SetupRobloxEnvironmentTarget & {
					[PREVIEW_INTRINSIC_HOSTS_SYMBOL]?: typeof previewRuntimeIntrinsicHosts;
				}
		)[PREVIEW_INTRINSIC_HOSTS_SYMBOL] = previewRuntimeIntrinsicHosts;
	}

	return initializedTarget;
}

const previewRuntimeHosts = {
	BillboardGui,
	CanvasGroup,
	Frame,
	ImageLabel,
	ImageButton,
	ScreenGui,
	ScrollingFrame,
	SurfaceGui,
	TextBox,
	TextButton,
	TextLabel,
	UIAspectRatioConstraint,
	UICorner,
	UIFlexItem,
	UIGradient,
	UIGridLayout,
	UIListLayout,
	UIPageLayout,
	UIPadding,
	UIScale,
	UISizeConstraint,
	UIStroke,
	UITableLayout,
	UITextSizeConstraint,
	VideoFrame,
	ViewportFrame,
};

const previewRuntimeIntrinsicHosts = {
	billboardgui: BillboardGui,
	canvasgroup: CanvasGroup,
	frame: Frame,
	imagebutton: ImageButton,
	imagelabel: ImageLabel,
	scrollingframe: ScrollingFrame,
	screengui: ScreenGui,
	surfacegui: SurfaceGui,
	textbox: TextBox,
	textbutton: TextButton,
	textlabel: TextLabel,
	videoframe: VideoFrame,
	viewportframe: ViewportFrame,
} as const;

if (typeof globalThis !== "undefined") {
	(
		globalThis as typeof globalThis & {
			[PREVIEW_INTRINSIC_HOSTS_SYMBOL]?: typeof previewRuntimeIntrinsicHosts;
		}
	)[PREVIEW_INTRINSIC_HOSTS_SYMBOL] = previewRuntimeIntrinsicHosts;
}

const previewRuntimeHelpers = {
	__previewGlobal,
	isPreviewElement,
	...previewRuntimeGlobalValues,
};

const previewRuntimePrimitives = {
	DismissableLayer,
	FocusScope,
	LayoutProvider,
	Portal,
	PortalProvider,
	Presence,
	Slot,
	createStrictContext,
	useControllableState,
	useLayoutEngineStatus,
	useRobloxLayout,
};

export {
	BillboardGui,
	CanvasGroup,
	Frame,
	ImageButton,
	ImageLabel,
	ScreenGui,
	ScrollingFrame,
	SurfaceGui,
	TextBox,
	TextButton,
	TextLabel,
	UIAspectRatioConstraint,
	UICorner,
	UIFlexItem,
	UIGradient,
	UIGridLayout,
	UIListLayout,
	UIPadding,
	UIPageLayout,
	UIScale,
	UISizeConstraint,
	UIStroke,
	UITableLayout,
	UITextSizeConstraint,
	VideoFrame,
	ViewportFrame,
} from "./hosts";
export { PreviewTargetShell } from "./hosts/preview-targets/PreviewTargetShell";
export type {
	PreviewLayoutDebugNode,
	PreviewLayoutDebugPayload,
	PreviewLayoutHostMetadata,
	PreviewLayoutNode,
} from "./layout";
export {
	areViewportsEqual,
	createViewportSize,
	createWindowViewport,
	getPreviewLayoutProbeSnapshot,
	initializeLayoutEngine,
	isViewportLargeEnough,
	LayoutProvider,
	loadPreviewLayoutEngineWasmBytes,
	measureElementViewport,
	type PreviewLayoutEngineInitOptions,
	type PreviewLayoutEngineLoader,
	type PreviewLayoutEngineModuleOrPath,
	type PreviewLayoutProbeSnapshot,
	pickViewport,
	setPreviewLayoutEngineLoader,
	subscribePreviewLayoutProbe,
	useLayoutEngineStatus,
	usePreviewLayoutProbeSnapshot,
	useRobloxLayout,
	type ViewportSize,
} from "./layout";
export type {
	PreviewComponentPropsMetadata,
	PreviewPropMetadata,
} from "./preview";
export {
	AutoMockProvider,
	buildAutoMockProps,
	type PreviewAutoMockableComponent,
	withAutoMockedProps,
} from "./preview";
export type { LayerInteractEvent } from "./react";
export {
	DismissableLayer,
	FocusScope,
	Portal,
	PortalProvider,
	Presence,
	usePortalContext,
} from "./react";
export type {
	PreviewEnumCategory,
	PreviewEnumItem,
	PreviewEnumRoot,
	PreviewExecutionMode,
	PreviewGame,
	PreviewGuiHitObject,
	PreviewGuiService,
	PreviewPlayer,
	PreviewPlayerGui,
	PreviewPlayersService,
	PreviewPolyfillTarget,
	PreviewRunService,
	PreviewRuntimeIssue,
	PreviewRuntimeIssueContext,
	PreviewRuntimeIssueKind,
	PreviewRuntimeIssuePhase,
	PreviewRuntimeIssueSeverity,
	PreviewRuntimeReporter,
	PreviewTween,
	PreviewTweenService,
	PreviewUserInputService,
	RBXScriptConnection,
	RBXScriptSignal,
	TaskCallback,
	TaskLibrary,
} from "./runtime";
export {
	clearPreviewRuntimeIssues,
	Enum,
	getPreviewRuntimeIssues,
	getPreviewRuntimeReporter,
	installPreviewRuntimeGlobals,
	installPreviewRuntimePolyfills,
	LayoutExecutionError,
	LayoutValidationError,
	ModuleLoadError,
	normalizePreviewRuntimeError,
	os,
	PreviewRuntimeError,
	previewRuntimeGlobalNames,
	previewRuntimeGlobalValues,
	print,
	publishPreviewRuntimeIssue,
	RunService,
	RuntimeMockError,
	setPreviewRuntimeIssueContext,
	string,
	subscribePreviewRuntimeIssues,
	TransformExecutionError,
	TransformValidationError,
	task,
	UnsupportedPatternError,
} from "./runtime";
export {
	createUniversalRobloxMock,
	createUniversalRobloxModuleMock,
	robloxMock,
	robloxModuleMock,
} from "./runtime/robloxMock";
export { __rbxStyle, Box, Text } from "./style/index";
export {
	__previewGlobal,
	Color3,
	createStrictContext,
	error,
	game,
	isPreviewElement,
	math,
	next,
	pairs,
	React,
	Slot,
	TweenInfo,
	typeIs,
	UDim,
	UDim2,
	useControllableState,
	Vector2,
	Vector3,
	warn,
	workspace,
};

export type PreviewRuntime = {
	hosts: typeof previewRuntimeHosts;
	helpers: typeof previewRuntimeHelpers;
	primitives: typeof previewRuntimePrimitives;
};

export const previewRuntime: PreviewRuntime = {
	helpers: previewRuntimeHelpers,
	hosts: previewRuntimeHosts,
	primitives: previewRuntimePrimitives,
};
