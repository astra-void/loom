import * as React from "react";
import {
  Frame,
  ImageLabel,
  ScreenGui,
  ScrollingFrame,
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
} from "./hosts";
import { LayoutProvider, useLayoutEngineStatus, useRobloxLayout } from "./layout";
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
  Enum,
  error,
  installPreviewRuntimeGlobals,
  isPreviewElement,
  pairs,
  RunService,
  task,
  typeIs,
  UDim,
  UDim2,
  Vector2,
} from "./runtime";

export interface SetupRobloxEnvironmentTarget {
  Enum?: typeof Enum;
  RunService?: typeof RunService;
  print?: (...args: unknown[]) => void;
  task?: typeof task;
  tostring?: (value: unknown) => string;
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
    installPreviewRuntimeGlobals(window as Window & SetupRobloxEnvironmentTarget);
  }

  return initializedTarget;
}

const previewRuntimeHosts = {
  Frame,
  ImageLabel,
  ScreenGui,
  ScrollingFrame,
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
};

const previewRuntimeHelpers = {
  __previewGlobal,
  Color3,
  UDim,
  UDim2,
  Vector2,
  error,
  isPreviewElement,
  pairs,
  typeIs,
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
  PreviewPolyfillTarget,
  PreviewRunService,
  PreviewRuntimeIssue,
  PreviewRuntimeIssueContext,
  PreviewRuntimeIssueKind,
  PreviewRuntimeIssuePhase,
  PreviewRuntimeReporter,
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
  Frame,
  ImageLabel,
  ScreenGui,
  ScrollingFrame,
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
} from "./hosts";
export {
  areViewportsEqual,
  createViewportSize,
  createWindowViewport,
  isViewportLargeEnough,
  LayoutProvider,
  measureElementViewport,
  pickViewport,
  useLayoutEngineStatus,
  useRobloxLayout,
  type ViewportSize,
} from "./layout";
export { DismissableLayer, FocusScope, Portal, PortalProvider, Presence, usePortalContext } from "./react";
export { __previewGlobal, Color3, UDim, UDim2, Vector2, typeIs, pairs, error, isPreviewElement };
export type { PreviewLayoutDebugNode, PreviewLayoutDebugPayload } from "./layout";
export type { PreviewComponentPropsMetadata, PreviewPropMetadata } from "./preview";
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
