import * as React from "react";
import {
	LayoutContext,
	LayoutNodeParentProvider,
	PortalRootContext,
	useLayoutDebugState,
	useRobloxLayout,
} from "../layout/context";
import type { ComputedRect, PreviewLayoutNode } from "../layout/model";
import {
	findMockAncestorOfClass,
	findMockAncestorWhichIsA,
	type MockInstanceLike,
} from "../runtime/mockInstance";
import {
	normalizePreviewRuntimeError,
	publishPreviewRuntimeIssue,
} from "../runtime/runtimeError";
import {
	domPresentationAdapter,
	type LayoutDebugState,
	type PreviewHostNode,
	patchPreviewHostNodeDomProps,
} from "./domAdapter";
import {
	bridgedPreviewHostProperties,
	cleanupPreviewHostBridge,
	installPreviewHostPropertyBridge,
	notifyPreviewHostPropertyChanged,
	usePreviewHostOverrides,
} from "./hostOverrides";
import { isDegradedPreviewHost } from "./metadata";
import type { LayoutHostName, PreviewDomProps } from "./types";

const PREVIEW_NODE_ID_SEQUENCE_PATTERN = /(?:^|:)(preview-node-(\d+))$/;
const PREVIEW_NODE_ID_COUNTER_KEY = Symbol.for(
	"loom-dev.preview-runtime.previewNodeIdCounter",
);
const LayoutChildOrderContext = React.createContext<{
	nextOrder(): number;
	passId: number;
} | null>(null);

type PreviewNodeCounterGlobal = typeof globalThis & {
	[PREVIEW_NODE_ID_COUNTER_KEY]?: number;
};

function createZeroVector2() {
	return { X: 0, Y: 0 };
}

function createVector2(x: number, y: number) {
	return { X: x, Y: y };
}

function createZeroUDim2() {
	return {
		X: { Offset: 0, Scale: 0 },
		Y: { Offset: 0, Scale: 0 },
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
	AbsolutePosition: createZeroVector2(),
	AbsoluteSize: createVector2(1000, 1000),
	AbsoluteWindowSize: createZeroVector2(),
	CanvasSize: createZeroUDim2(),
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
	TextBounds: createZeroVector2(),
};

function getHostPropertyFallback(
	property: string,
	isRootNode: boolean,
	viewport?: { width: number; height: number } | null,
) {
	switch (property) {
		case "AbsolutePosition":
		case "CanvasPosition":
			return createZeroVector2();
		case "AbsoluteSize":
			return isRootNode
				? createVector2(viewport?.width ?? 1000, viewport?.height ?? 1000)
				: createZeroVector2();
		case "AbsoluteWindowSize":
			return createVector2(viewport?.width ?? 0, viewport?.height ?? 0);
		case "CanvasSize":
			return createZeroUDim2();
		case "Parent":
			return mockScreenGui;
		case "TextBounds":
			return createZeroVector2();
		default:
			return undefined;
	}
}

function PreviewLayoutChildOrderProvider(props: { children: React.ReactNode }) {
	const counterRef = React.useRef(0);
	counterRef.current = 0;
	const passIdRef = React.useRef(0);
	passIdRef.current += 1;
	const passId = passIdRef.current;
	const value = React.useMemo(
		() => ({
			nextOrder: () => counterRef.current++,
			passId,
		}),
		[passId],
	);

	return (
		<LayoutChildOrderContext.Provider value={value}>
			{props.children}
		</LayoutChildOrderContext.Provider>
	);
}

function getStringValue(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

function getLayoutParentId(props: PreviewDomProps) {
	const source = props as Record<string, unknown>;
	return getStringValue(source.ParentId ?? source.parentId);
}

function getLayoutNodeId(props: PreviewDomProps) {
	const source = props as Record<string, unknown>;
	return getStringValue(source.Id ?? source.id);
}

type PreviewHostIdentityDiagnosticsGlobal = typeof globalThis & {
	__loomPreviewHostIdentityDiagnostics?: boolean;
};

function shouldLogPreviewHostIdentityDiagnostics() {
	return (
		(globalThis as PreviewHostIdentityDiagnosticsGlobal)
			.__loomPreviewHostIdentityDiagnostics === true
	);
}

function logPreviewHostIdentityDiagnostics(input: {
	host: LayoutHostName;
	rawId?: string;
	rawParentId?: string;
	computedNodeId: string;
	computedParentId?: string;
}) {
	if (!shouldLogPreviewHostIdentityDiagnostics()) {
		return;
	}

	console.info("[preview-runtime][host-identity]", input);
}

function getPreviewNodeCounter() {
	const globalRecord = globalThis as PreviewNodeCounterGlobal;
	const current = globalRecord[PREVIEW_NODE_ID_COUNTER_KEY];
	if (typeof current !== "number" || !Number.isFinite(current)) {
		return 0;
	}

	return current;
}

function setPreviewNodeCounter(value: number) {
	const globalRecord = globalThis as PreviewNodeCounterGlobal;
	globalRecord[PREVIEW_NODE_ID_COUNTER_KEY] = value;
}

function allocatePreviewNodeSequence() {
	const nextSequence = getPreviewNodeCounter() + 1;
	setPreviewNodeCounter(nextSequence);
	return nextSequence;
}

function useGeneratedPreviewNodeId(host: LayoutHostName): string {
	const idRef = React.useRef<string | null>(null);
	if (idRef.current === null) {
		idRef.current = `${host}:preview-node-${allocatePreviewNodeSequence()}`;
	}

	return idRef.current;
}

function syncPreviewNodeCounter(nodeId: string | undefined) {
	if (!nodeId) {
		return;
	}

	const match = PREVIEW_NODE_ID_SEQUENCE_PATTERN.exec(nodeId);
	if (!match) {
		return;
	}

	const sequence = Number.parseInt(match[2] ?? "", 10);
	if (!Number.isFinite(sequence)) {
		return;
	}

	if (sequence > getPreviewNodeCounter()) {
		setPreviewNodeCounter(sequence);
	}
}

function resolveNodeId(generatedId: string, props: PreviewDomProps): string {
	const explicitId = getLayoutNodeId(props);
	if (explicitId) {
		syncPreviewNodeCounter(explicitId);
		return explicitId;
	}

	return generatedId;
}

function resolvePaddingInset(
	value: { Offset: number; Scale: number } | undefined,
	referenceSize: number,
) {
	if (!value) {
		return 0;
	}

	return Math.max(0, referenceSize * value.Scale + value.Offset);
}

function resolveContentRect(
	rect: ComputedRect | null,
	padding:
		| {
				bottom?: { Offset: number; Scale: number };
				left?: { Offset: number; Scale: number };
				right?: { Offset: number; Scale: number };
				top?: { Offset: number; Scale: number };
		  }
		| undefined,
): ComputedRect | null {
	if (!rect || !padding) {
		return rect;
	}

	const left = resolvePaddingInset(padding.left, rect.width);
	const right = resolvePaddingInset(padding.right, rect.width);
	const top = resolvePaddingInset(padding.top, rect.height);
	const bottom = resolvePaddingInset(padding.bottom, rect.height);

	return {
		height: Math.max(0, rect.height - top - bottom),
		width: Math.max(0, rect.width - left - right),
		x: rect.x + left,
		y: rect.y + top,
	};
}

function useSourceOrder() {
	const context = React.useContext(LayoutChildOrderContext);
	const orderRef = React.useRef<{ passId: number; value: number } | null>(null);

	if (context && orderRef.current?.passId !== context.passId) {
		orderRef.current = {
			passId: context.passId,
			value: context.nextOrder(),
		};
	}

	return orderRef.current?.value;
}

function areMeasuredSizesEqual(
	left: { height: number; width: number } | null,
	right: { height: number; width: number } | null,
) {
	return left?.width === right?.width && left?.height === right?.height;
}

function readIntrinsicSize(element: HTMLElement | null) {
	if (!element) {
		return null;
	}

	const width = element.offsetWidth;
	const height = element.offsetHeight;
	if (!Number.isFinite(width) || !Number.isFinite(height)) {
		return null;
	}

	return {
		height: Math.max(0, height),
		width: Math.max(0, width),
	};
}

function readTextBounds(element: HTMLElement | null) {
	if (!element) {
		return null;
	}

	const width = Math.max(element.scrollWidth, element.offsetWidth);
	const height = Math.max(element.scrollHeight, element.offsetHeight);
	if (!Number.isFinite(width) || !Number.isFinite(height)) {
		return null;
	}

	return {
		height: Math.max(0, height),
		width: Math.max(0, width),
	};
}

function normalizeBridgedValue(value: unknown) {
	if (value === null || value === undefined) {
		return value;
	}

	if (typeof value !== "object") {
		return value;
	}

	if (typeof HTMLElement !== "undefined" && value instanceof HTMLElement) {
		return value;
	}

	try {
		return JSON.stringify(value);
	} catch {
		return value;
	}
}

function areBridgedValuesEqual(left: unknown, right: unknown) {
	return Object.is(normalizeBridgedValue(left), normalizeBridgedValue(right));
}

function useObservedIntrinsicSize(
	elementRef: React.RefObject<HTMLElement | null>,
	measurementEnabled: boolean,
) {
	const [intrinsicSize, setIntrinsicSize] = React.useState<{
		height: number;
		width: number;
	} | null>(null);

	React.useLayoutEffect(() => {
		if (!measurementEnabled) {
			setIntrinsicSize((previous) => (previous === null ? previous : null));
			return;
		}

		const element = elementRef.current;
		if (!element) {
			return;
		}

		const update = () => {
			const nextSize = readIntrinsicSize(element);
			setIntrinsicSize((previous) =>
				areMeasuredSizesEqual(previous, nextSize) ? previous : nextSize,
			);
		};

		update();

		if (typeof ResizeObserver !== "undefined") {
			const observer = new ResizeObserver(() => {
				update();
			});
			observer.observe(element);
			return () => {
				observer.disconnect();
			};
		}

		const handleResize = () => {
			update();
		};

		globalThis.addEventListener?.("resize", handleResize);
		return () => {
			globalThis.removeEventListener?.("resize", handleResize);
		};
	}, [elementRef, measurementEnabled]);

	return intrinsicSize;
}

function useDegradedHostIssue(hostNode: PreviewHostNode) {
	const publishedIssueKeyRef = React.useRef<string | null>(null);

	React.useEffect(() => {
		if (!isDegradedPreviewHost(hostNode.host)) {
			return;
		}

		const issueKey = `${hostNode.host}:${hostNode.id}`;
		if (publishedIssueKeyRef.current === issueKey) {
			return;
		}

		publishedIssueKeyRef.current = issueKey;
		publishPreviewRuntimeIssue(
			normalizePreviewRuntimeError(
				{
					blocking: false,
					code: "DEGRADED_HOST_RENDER",
					details: `${hostNode.nodeType} is rendered as a degraded preview placeholder with fallback sizing.`,
					kind: "RuntimeMockError",
					phase: "runtime",
					severity: "warning",
					summary: `${hostNode.nodeType} rendered with degraded preview behavior.`,
					symbol: hostNode.id,
					target: hostNode.nodeType,
				},
				new Error(
					`${hostNode.nodeType} rendered with degraded preview behavior.`,
				),
			),
		);
	}, [hostNode.host, hostNode.id, hostNode.nodeType]);
}

export function useHostLayout(host: LayoutHostName, props: PreviewDomProps) {
	const elementRef = React.useRef<HTMLElement | null>(null);
	const basePropsRef = React.useRef(props);
	basePropsRef.current = props;
	const generatedId = useGeneratedPreviewNodeId(host);
	const nodeId = React.useMemo(
		() => resolveNodeId(generatedId, props),
		[generatedId, props],
	);
	const overrides = usePreviewHostOverrides(nodeId);
	const mergedProps = React.useMemo(
		() =>
			Object.keys(overrides).length === 0
				? props
				: ({
						...props,
						...overrides,
					} as PreviewDomProps),
		[overrides, props],
	);
	const rawNodeId = React.useMemo(
		() => getLayoutNodeId(mergedProps),
		[mergedProps],
	);
	const rawParentId = React.useMemo(
		() => getLayoutParentId(mergedProps),
		[mergedProps],
	);
	const isPortalRoot = React.useContext(PortalRootContext);
	const resolvedParentId = React.useMemo(
		() => (isPortalRoot ? undefined : getLayoutParentId(mergedProps)),
		[isPortalRoot, mergedProps],
	);
	const sourceOrder = useSourceOrder();

	const normalizedNode = React.useMemo(
		() =>
			domPresentationAdapter.normalize({
				host,
				nodeId,
				parentId: resolvedParentId,
				props: mergedProps,
				sourceOrder,
			}),
		[host, mergedProps, nodeId, resolvedParentId, sourceOrder],
	);

	React.useLayoutEffect(() => {
		logPreviewHostIdentityDiagnostics({
			computedNodeId: normalizedNode.id,
			computedParentId: normalizedNode.parentId,
			host,
			rawId: rawNodeId,
			rawParentId: rawParentId,
		});
	}, [
		host,
		normalizedNode.id,
		normalizedNode.parentId,
		rawNodeId,
		rawParentId,
	]);

	const isRootNode = normalizedNode.kind === "root";

	const layoutContext = React.useContext(LayoutContext);

	const intrinsicSize = useObservedIntrinsicSize(
		elementRef,
		normalizedNode.measurementEnabled,
	);

	const layoutNode = React.useMemo<PreviewLayoutNode>(
		() => ({
			debugLabel: normalizedNode.debugLabel,
			hostMetadata: normalizedNode.hostMetadata,
			id: normalizedNode.id,
			intrinsicSize,
			kind: normalizedNode.kind,
			layout: normalizedNode.layout,
			layoutModifiers: normalizedNode.layoutModifiers,
			layoutOrder: normalizedNode.layoutOrder,
			name: normalizedNode.name,
			nodeType: normalizedNode.nodeType,
			parentId: normalizedNode.parentId,
			sourceOrder: normalizedNode.sourceOrder,
			styleHints: normalizedNode.styleHints,
			visible: normalizedNode.visible,
		}),
		[intrinsicSize, normalizedNode],
	);

	const computed = useRobloxLayout(layoutNode);

	const resolveBridgedHostProperty = React.useCallback(
		(property: string) => {
			const element = elementRef.current;
			const currentProps = basePropsRef.current as Record<string, unknown>;
			const viewport = layoutContext?.viewport;
			if (!element) {
				return getHostPropertyFallback(property, isRootNode, viewport);
			}

			const containerRect = layoutContext?.getContainerRect?.();

			const offsetX = containerRect?.left ?? 0;
			const offsetY = containerRect?.top ?? 0;
			const scaleX =
				containerRect?.width && viewport?.width
					? containerRect.width / viewport.width
					: 1;
			const scaleY =
				containerRect?.height && viewport?.height
					? containerRect.height / viewport.height
					: 1;

			switch (property) {
				case "AbsolutePosition": {
					if (computed) {
						return createVector2(computed.x, computed.y);
					}
					const rect = element.getBoundingClientRect();
					return createVector2(
						(rect.left - offsetX) / scaleX,
						(rect.top - offsetY) / scaleY,
					);
				}
				case "AbsoluteSize": {
					if (computed) {
						return createVector2(computed.width, computed.height);
					}
					const rect = element.getBoundingClientRect();
					return createVector2(rect.width / scaleX, rect.height / scaleY);
				}
				case "AbsoluteCanvasSize": {
					if (host === "scrollingframe") {
						return createVector2(element.scrollWidth, element.scrollHeight);
					}
					if (computed) {
						return createVector2(computed.width, computed.height);
					}

					const rect = element.getBoundingClientRect();
					return createVector2(rect.width / scaleX, rect.height / scaleY);
				}
				case "AbsoluteWindowSize": {
					return createVector2(viewport?.width ?? 0, viewport?.height ?? 0);
				}
				case "CanvasPosition": {
					if (host === "scrollingframe") {
						return createVector2(element.scrollLeft, element.scrollTop);
					}

					return createZeroVector2();
				}
				case "CanvasSize":
					return (
						currentProps.CanvasSize ??
						getHostPropertyFallback(property, isRootNode, viewport)
					);
				case "Name":
					return (
						(typeof currentProps.Name === "string" &&
						currentProps.Name.length > 0
							? currentProps.Name
							: undefined) ??
						element.getAttribute("data-preview-node-id") ??
						element.getAttribute("aria-label") ??
						getHostPropertyFallback(property, isRootNode, viewport)
					);
				case "Parent":
					return (
						currentProps.Parent ??
						getHostPropertyFallback(property, isRootNode, viewport)
					);
				case "Text":
					return (
						(element instanceof HTMLInputElement ? element.value : undefined) ??
						currentProps.Text ??
						getHostPropertyFallback(property, isRootNode, viewport)
					);
				case "TextBounds":
					return (
						readTextBounds(element) ??
						getHostPropertyFallback(property, isRootNode, viewport)
					);
				default:
					return (
						currentProps[property] ??
						getHostPropertyFallback(property, isRootNode, viewport)
					);
			}
		},
		[
			host,
			isRootNode,
			layoutContext?.getContainerRect,
			layoutContext?.viewport,
			computed,
		],
	);

	const setElementRef = React.useCallback(
		(element: HTMLElement | null) => {
			const previousElement = elementRef.current;
			if (previousElement && previousElement !== element) {
				cleanupPreviewHostBridge(previousElement, nodeId);
			}

			elementRef.current = element;

			if (element) {
				installPreviewHostPropertyBridge(
					element,
					nodeId,
					resolveBridgedHostProperty,
				);
				(
					element as HTMLElement & { __previewLayoutContext?: unknown }
				).__previewLayoutContext = layoutContext;
			}
		},
		[nodeId, resolveBridgedHostProperty, layoutContext],
	);

	React.useLayoutEffect(() => {
		const element = elementRef.current;
		if (!element || host !== "scrollingframe") {
			return;
		}

		const handleScroll = () => {
			notifyPreviewHostPropertyChanged(nodeId, "CanvasPosition");
			notifyPreviewHostPropertyChanged(nodeId, "AbsoluteCanvasSize");
		};

		element.addEventListener("scroll", handleScroll);
		return () => {
			element.removeEventListener("scroll", handleScroll);
		};
	}, [host, nodeId]);

	const diagnostics = useLayoutDebugState(nodeId) as LayoutDebugState;

	const previousBridgedHostPropertySnapshotRef = React.useRef<Record<
		string,
		unknown
	> | null>(null);

	React.useLayoutEffect(() => {
		const element = elementRef.current;
		const currentProps = basePropsRef.current as Record<string, unknown>;
		const containerRect = layoutContext?.getContainerRect?.();

		const offsetX = containerRect?.left ?? 0;
		const offsetY = containerRect?.top ?? 0;
		const viewport = layoutContext?.viewport;
		const scaleX =
			containerRect?.width && viewport?.width
				? containerRect.width / viewport.width
				: 1;
		const scaleY =
			containerRect?.height && viewport?.height
				? containerRect.height / viewport.height
				: 1;

		const currentSnapshot = Object.fromEntries(
			bridgedPreviewHostProperties.map((property) => {
				if (!element) {
					return [
						property,
						currentProps[property] ??
							getHostPropertyFallback(property, isRootNode, viewport),
					];
				}

				switch (property) {
					case "AbsolutePosition": {
						if (computed) {
							return [property, createVector2(computed.x, computed.y)];
						}
						const rect = element.getBoundingClientRect();
						return [
							property,
							createVector2(
								(rect.left - offsetX) / scaleX,
								(rect.top - offsetY) / scaleY,
							),
						];
					}
					case "AbsoluteSize": {
						if (computed) {
							return [property, createVector2(computed.width, computed.height)];
						}
						const rect = element.getBoundingClientRect();
						return [
							property,
							createVector2(rect.width / scaleX, rect.height / scaleY),
						];
					}
					case "AbsoluteCanvasSize":
						return [
							property,
							host === "scrollingframe" && element
								? createVector2(element.scrollWidth, element.scrollHeight)
								: computed
									? createVector2(computed.width, computed.height)
									: createVector2(
											(element.getBoundingClientRect().width ?? 0) / scaleX,
											(element.getBoundingClientRect().height ?? 0) / scaleY,
										),
						];
					case "AbsoluteWindowSize":
						return [
							property,
							createVector2(viewport?.width ?? 0, viewport?.height ?? 0),
						];
					case "CanvasPosition":
						return [
							property,
							host === "scrollingframe" && element
								? createVector2(element.scrollLeft, element.scrollTop)
								: createZeroVector2(),
						];
					case "CanvasSize":
						return [
							property,
							currentProps.CanvasSize ??
								getHostPropertyFallback(property, isRootNode, viewport),
						];
					case "Name":
						return [
							property,
							(typeof currentProps.Name === "string" &&
							currentProps.Name.length > 0
								? currentProps.Name
								: undefined) ??
								element.getAttribute("data-preview-node-id") ??
								element.getAttribute("aria-label") ??
								getHostPropertyFallback(property, isRootNode, viewport) ??
								nodeId,
						];
					case "Parent":
						return [
							property,
							currentProps.Parent ??
								getHostPropertyFallback(property, isRootNode, viewport),
						];
					case "Text":
						return [
							property,
							(element instanceof HTMLInputElement
								? element.value
								: undefined) ??
								currentProps.Text ??
								getHostPropertyFallback(property, isRootNode, viewport),
						];
					case "TextBounds":
						return [
							property,
							readTextBounds(element) ??
								getHostPropertyFallback(property, isRootNode, viewport),
						];
					default:
						return [
							property,
							currentProps[property] ??
								getHostPropertyFallback(property, isRootNode, viewport),
						];
				}
			}),
		) as Record<string, unknown>;

		const previousSnapshot = previousBridgedHostPropertySnapshotRef.current;
		if (previousSnapshot) {
			for (const property of bridgedPreviewHostProperties) {
				if (property === "Text") {
					continue;
				}

				if (
					!areBridgedValuesEqual(
						previousSnapshot[property],
						currentSnapshot[property],
					)
				) {
					notifyPreviewHostPropertyChanged(nodeId, property);
				}
			}
		}

		previousBridgedHostPropertySnapshotRef.current = currentSnapshot;
	}, [computed, host, isRootNode, layoutContext, nodeId]);
	const hostNode = React.useMemo(
		() => ({
			...normalizedNode,
			computed,
			intrinsicSize,
			layoutDebug: diagnostics,
		}),
		[computed, diagnostics, intrinsicSize, normalizedNode],
	);

	useDegradedHostIssue(hostNode);

	return {
		computed,
		diagnostics,
		elementRef,
		hostNode,
		nodeId,
		setElementRef,
		patchDomProps: React.useCallback(
			(domProps: PreviewHostNode["presentationHints"]["domProps"]) =>
				patchPreviewHostNodeDomProps(hostNode, domProps),
			[hostNode],
		),
	};
}

export function withNodeParent(
	nodeId: string,
	rect: ReturnType<typeof useRobloxLayout>,
	contentRect: ComputedRect | null,
	children: React.ReactNode,
) {
	return (
		<PreviewLayoutChildOrderProvider>
			<LayoutNodeParentProvider
				contentRect={contentRect ?? rect}
				nodeId={nodeId}
				renderRect={rect}
			>
				{children}
			</LayoutNodeParentProvider>
		</PreviewLayoutChildOrderProvider>
	);
}

export function resolveHostContentRect(
	rect: ComputedRect | null,
	props: ReturnType<typeof useHostLayout>["hostNode"]["layoutModifiers"],
) {
	return resolveContentRect(rect, props?.padding);
}
