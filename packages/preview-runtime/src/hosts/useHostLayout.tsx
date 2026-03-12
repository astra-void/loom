import * as React from "react";
import { normalizePreviewNodeId } from "../internal/robloxValues";
import {
	LayoutNodeParentProvider,
	useLayoutDebugState,
	useRobloxLayout,
} from "../layout/context";
import type { ComputedRect, PreviewLayoutNode } from "../layout/model";
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
	cleanupPreviewHostBridge,
	installPreviewHostPropertyBridge,
	usePreviewHostOverrides,
} from "./hostOverrides";
import { isDegradedPreviewHost } from "./metadata";
import type { LayoutHostName, PreviewDomProps } from "./types";

let previewNodeIdCounter = 0;
const LayoutChildOrderContext = React.createContext<{
	nextOrder(): number;
	passId: number;
} | null>(null);

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

function useGeneratedPreviewNodeId(): string {
	const idRef = React.useRef<string | null>(null);
	if (idRef.current === null) {
		previewNodeIdCounter += 1;
		idRef.current = `preview-node-${previewNodeIdCounter}`;
	}

	return idRef.current;
}

function resolveNodeId(generatedId: string, props: PreviewDomProps): string {
	const source = props as Record<string, unknown>;
	const explicitId = getStringValue(source.Id ?? source.id);
	return normalizePreviewNodeId(explicitId) ?? generatedId;
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

	const rect = element.getBoundingClientRect();
	if (!Number.isFinite(rect.width) || !Number.isFinite(rect.height)) {
		return null;
	}

	return {
		height: Math.max(0, rect.height),
		width: Math.max(0, rect.width),
	};
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
	const generatedId = useGeneratedPreviewNodeId();
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
	const normalizedParentId = React.useMemo(
		() => normalizePreviewNodeId(getLayoutParentId(props)),
		[props],
	);
	const sourceOrder = useSourceOrder();

	const normalizedNode = React.useMemo(
		() =>
			domPresentationAdapter.normalize({
				host,
				nodeId,
				parentId: normalizedParentId,
				props: mergedProps,
				sourceOrder,
			}),
		[host, mergedProps, nodeId, normalizedParentId, sourceOrder],
	);

	React.useLayoutEffect(() => {
		const element = elementRef.current;
		if (!element) {
			return;
		}

		installPreviewHostPropertyBridge(element, nodeId, (property) => {
			return (basePropsRef.current as Record<string, unknown>)[property];
		});

		return () => {
			cleanupPreviewHostBridge(element, nodeId);
		};
	}, [nodeId]);

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
		}),
		[intrinsicSize, normalizedNode],
	);

	const computed = useRobloxLayout(layoutNode);
	const diagnostics = useLayoutDebugState(nodeId) as LayoutDebugState;

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
			<LayoutNodeParentProvider nodeId={nodeId} rect={contentRect ?? rect}>
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
