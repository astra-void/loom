declare module "@loom-dev/compiler" {
	export type PreviewTransformMode =
		| "strict-fidelity"
		| "compatibility"
		| "mocked"
		| "design-time";
	export type PreviewTransformSeverity = "error" | "info" | "warning";

	export type UnsupportedPatternError = {
		code: string;
		message: string;
		file: string;
		line: number;
		column: number;
		symbol?: string;
		target: string;
	};

	export type TransformPreviewSourceOptions = {
		filePath: string;
		mode?: PreviewTransformMode;
		runtimeModule: string;
		target: string;
	};

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

	export type TransformPreviewSourceResult = {
		code: string | null;
		errors: UnsupportedPatternError[];
		diagnostics: PreviewTransformDiagnostic[];
		outcome: PreviewTransformOutcome;
	};

	export function transformPreviewSource(
		code: string,
		options: TransformPreviewSourceOptions,
	): TransformPreviewSourceResult;

	export function compile_tsx(code: string): string;
}

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
	import type * as React from "react";

	type PreviewSerializedAxis = {
		Offset: number;
		Scale: number;
	};
	type PreviewUDim2Value = {
		X: PreviewSerializedAxis;
		Y: PreviewSerializedAxis;
		add(other: unknown): PreviewUDim2Value;
		sub(other: unknown): PreviewUDim2Value;
	};

	export const BillboardGui: React.ComponentType<Record<string, unknown>>;
	export const CanvasGroup: React.ComponentType<Record<string, unknown>>;
	export const Frame: React.ComponentType<Record<string, unknown>>;
	export const ImageButton: React.ComponentType<Record<string, unknown>>;
	export const ScreenGui: React.ComponentType<Record<string, unknown>>;
	export const Slot: React.ComponentType<Record<string, unknown>>;
	export const SurfaceGui: React.ComponentType<Record<string, unknown>>;
	export const TextLabel: React.ComponentType<Record<string, unknown>>;
	export const UICorner: React.ComponentType<Record<string, unknown>>;
	export const UIListLayout: React.ComponentType<Record<string, unknown>>;
	export const UIPadding: React.ComponentType<Record<string, unknown>>;
	export const UIScale: React.ComponentType<Record<string, unknown>>;
	export const UIStroke: React.ComponentType<Record<string, unknown>>;
	export const VideoFrame: React.ComponentType<Record<string, unknown>>;
	export const ViewportFrame: React.ComponentType<Record<string, unknown>>;
	export const Color3: {
		fromRGB(r: number, g: number, b: number): unknown;
	};
	export const UDim2: {
		new (
			xScale: number,
			xOffset: number,
			yScale: number,
			yOffset: number,
		): PreviewUDim2Value;
		fromOffset(x: number, y: number): PreviewUDim2Value;
		fromScale(x: number, y: number): PreviewUDim2Value;
	};
	export function isPreviewElement(value: unknown, typeName: string): boolean;

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
		nodeType: string;
		parentId?: string;
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
		viewport: {
			height: number;
			width: number;
		};
		viewportReady: boolean;
	};
	export type PreviewLayoutEngineLoader = () =>
		| ArrayBuffer
		| Promise<ArrayBuffer | Uint8Array | URL | WebAssembly.Module | string>
		| Uint8Array
		| URL
		| WebAssembly.Module
		| string;
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
	export function clearPreviewRuntimeIssues(): void;
	export const AutoMockProvider: React.ComponentType<Record<string, unknown>>;
	export function areViewportsEqual(
		left: ViewportSize | null | undefined,
		right: ViewportSize | null | undefined,
	): boolean;
	export function createViewportSize(
		width?: number | null,
		height?: number | null,
	): ViewportSize;
	export function createWindowViewport(): ViewportSize;
	export function getPreviewLayoutProbeSnapshot(): PreviewLayoutProbeSnapshot;
	export function getPreviewRuntimeIssues(): PreviewRuntimeIssue[];
	export function getPreviewRuntimeReporter(): PreviewRuntimeReporter;
	export function installPreviewRuntimePolyfills(target?: object): object;
	export function isViewportLargeEnough(
		viewport: ViewportSize | null | undefined,
	): boolean;
	export const LayoutProvider: React.ComponentType<Record<string, unknown>>;
	export function measureElementViewport(element: Element): ViewportSize | null;
	export function normalizePreviewRuntimeError(
		context: PreviewRuntimeIssueContext,
		error: unknown,
	): PreviewRuntimeIssue;
	export function pickViewport(
		candidates: Array<ViewportSize | null | undefined>,
		fallback: ViewportSize,
	): ViewportSize;
	export function publishPreviewRuntimeIssue(
		issueOrError: PreviewRuntimeIssue | unknown,
		context?: PreviewRuntimeIssueContext,
	): PreviewRuntimeIssue;
	export const robloxMock: Record<PropertyKey, unknown>;
	export const robloxModuleMock: Record<PropertyKey, unknown>;
	export function createUniversalRobloxMock(): Record<PropertyKey, unknown>;
	export function createUniversalRobloxModuleMock(): Record<
		PropertyKey,
		unknown
	>;
	export function setupRobloxEnvironment(target?: object): object;
	export function setPreviewRuntimeIssueContext(
		context: PreviewRuntimeIssueContext | null,
	): void;
	export function setPreviewLayoutEngineLoader(
		loader: PreviewLayoutEngineLoader | null,
	): void;
	export function subscribePreviewRuntimeIssues(
		listener: (issues: PreviewRuntimeIssue[]) => void,
	): () => void;
	export function subscribePreviewLayoutProbe(
		listener: (snapshot: PreviewLayoutProbeSnapshot) => void,
	): () => void;
	export function usePreviewLayoutProbeSnapshot(): PreviewLayoutProbeSnapshot;
	export type PreviewRuntime = {
		hosts: Record<string, unknown>;
		helpers: Record<string, unknown>;
		primitives: Record<string, unknown>;
	};
	export const previewRuntime: PreviewRuntime;
}

declare module "@loom-dev/preview-engine" {
	import type { ComponentType } from "react";
	import type { PreviewRuntimeIssue } from "@loom-dev/preview-runtime";

	export type PreviewExecutionMode =
		| "strict-fidelity"
		| "compatibility"
		| "mocked"
		| "design-time";
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

	export type PreviewDefinition<Props = Record<string, unknown>> = {
		entry?: ComponentType<Props>;
		props?: Props;
		render?: () => unknown;
		title?: string;
	};

	export type PreviewDiagnostic = {
		blocking?: boolean;
		code: string;
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

	export type PreviewRenderTarget =
		| {
				contract: "preview.render";
				kind: "harness";
		  }
		| {
				exportName: "default" | string;
				kind: "component";
				usesPreviewProps: boolean;
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

	export type PreviewEntryPayload = {
		descriptor: PreviewEntryDescriptor;
		diagnostics: PreviewDiagnostic[];
		graphTrace: {
			boundaryHops: unknown[];
			imports: unknown[];
			selection: {
				importChain: string[];
				symbolChain: string[];
			};
		};
		protocolVersion: number;
		runtimeAdapter: {
			kind: "react-dom";
			moduleId: string;
		};
		transform: {
			mode: PreviewExecutionMode;
			outcome: {
				fidelity: "preserved" | "degraded" | "metadata-only";
				kind: "ready" | "compatibility" | "mocked" | "blocked" | "design-time";
			};
		};
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
		| import("@loom-dev/compiler").PreviewTransformDiagnostic;
	export type PreviewBuiltArtifact = {
		cacheKey: string;
		diagnosticsSummary: {
			byPhase: Record<PreviewDiagnosticPhase, number>;
			hasBlocking: boolean;
			total: number;
		};
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

	export type PreviewSourceTarget = {
		exclude?: string[];
		include?: string[];
		name: string;
		packageName?: string;
		packageRoot: string;
		sourceRoot: string;
	};

	export const PREVIEW_ENGINE_PROTOCOL_VERSION: number;

	export interface PreviewEngine {
		dispose(): void;
		getEntryPayload(entryId: string): PreviewEntryPayload;
		getSnapshot(): PreviewEngineSnapshot;
		isTrackedSourceFile(filePath: string): boolean;
		getWorkspaceIndex(): PreviewWorkspaceIndex;
		invalidateSourceFiles(filePaths: string[]): PreviewEngineUpdate;
		onUpdate(listener: (update: PreviewEngineUpdate) => void): () => void;
		replaceRuntimeIssues(issues: PreviewRuntimeIssue[]): PreviewEngineUpdate;
	}

	export function createPreviewEngine(options: {
		projectName: string;
		runtimeModule?: string;
		targets: PreviewSourceTarget[];
		transformMode?: PreviewExecutionMode;
	}): PreviewEngine;

	export function buildPreviewArtifacts(
		options: PreviewBuildOptions,
	): Promise<PreviewBuildResult>;
}
