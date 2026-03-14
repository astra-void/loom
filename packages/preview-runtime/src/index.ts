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
	type Enum,
	error,
	game,
	installPreviewRuntimeGlobals,
	isPreviewElement,
	pairs,
	type RunService,
	TweenInfo,
	type task,
	typeIs,
	UDim,
	UDim2,
	Vector2,
	workspace,
} from "./runtime";

export interface SetupRobloxEnvironmentTarget {
	Color3?: typeof Color3;
	Enum?: typeof Enum;
	RunService?: typeof RunService;
	TweenInfo?: typeof TweenInfo;
	game?: typeof game;
	print?: (...args: unknown[]) => void;
	task?: typeof task;
	tostring?: (value: unknown) => string;
	workspace?: typeof workspace;
}

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

	if (typeof window !== "undefined" && window !== target) {
		installPreviewRuntimeGlobals(
			window as Window & SetupRobloxEnvironmentTarget,
		);
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

const previewRuntimeHelpers = {
	__previewGlobal,
	Color3,
	UDim,
	UDim2,
	Vector2,
	error,
	game,
	isPreviewElement,
	pairs,
	TweenInfo,
	typeIs,
	workspace,
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
	AutoMockProvider,
	buildAutoMockProps,
	type PreviewAutoMockableComponent,
	withAutoMockedProps,
} from "./preview";
export type {
	PreviewEnumCategory,
	PreviewEnumItem,
	PreviewEnumRoot,
	PreviewExecutionMode,
	PreviewGame,
	PreviewGuiService,
	PreviewPlayer,
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
	normalizePreviewRuntimeError,
	publishPreviewRuntimeIssue,
	RunService,
	setPreviewRuntimeIssueContext,
	subscribePreviewRuntimeIssues,
	task,
} from "./runtime";

export { React };
export { createStrictContext, useControllableState, Slot };
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
export {
	DismissableLayer,
	FocusScope,
	Portal,
	PortalProvider,
	Presence,
	usePortalContext,
} from "./react";
export {
	__previewGlobal,
	Color3,
	UDim,
	UDim2,
	Vector2,
	typeIs,
	pairs,
	error,
	game,
	isPreviewElement,
	TweenInfo,
	workspace,
};
export type {
	PreviewLayoutDebugNode,
	PreviewLayoutDebugPayload,
	PreviewLayoutHostMetadata,
	PreviewLayoutNode,
} from "./layout";
export type {
	PreviewComponentPropsMetadata,
	PreviewPropMetadata,
} from "./preview";
export type { LayerInteractEvent } from "./react";
export {
	createUniversalRobloxMock,
	createUniversalRobloxModuleMock,
	LayoutExecutionError,
	LayoutValidationError,
	ModuleLoadError,
	PreviewRuntimeError,
	RuntimeMockError,
	robloxMock,
	robloxModuleMock,
	TransformExecutionError,
	TransformValidationError,
	UnsupportedPatternError,
} from "./runtime";
export { __rbxStyle, Box, Text } from "./style/index";

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
