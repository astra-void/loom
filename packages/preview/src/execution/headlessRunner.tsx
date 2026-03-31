import { readFile } from "node:fs/promises";
import path from "node:path";
import type { PreviewEntryDescriptor } from "@loom-dev/preview-engine";
import type {
	PreviewLayoutDebugPayload,
	PreviewRuntimeIssue,
} from "@loom-dev/preview-runtime";
import { JSDOM } from "jsdom";
import { installPreviewBrowserGlobals } from "../shell/installPreviewBrowserGlobals";
import React from "../source/react-shims/react.js";
import {
	createRoot,
	type Root,
} from "../source/react-shims/react-dom-client.js";
import type { PreviewDevServer } from "../source/viteTypes";
import {
	createDefaultHeadlessViewport,
	type PreviewHeadlessEntryRenderResult,
	type PreviewHeadlessEntryViewport,
} from "./headlessTypes";
import {
	createPreviewLoadIssue,
	createPreviewRenderIssue,
	createPreviewRenderNode,
	type PreviewModule,
} from "./shared";

const { act } = React;

type HeadlessCollectedEntryExecution = {
	issues: PreviewRuntimeIssue[];
	layoutDebug: PreviewLayoutDebugPayload | null;
	loadIssue: PreviewRuntimeIssue | null;
	render: PreviewHeadlessEntryRenderResult;
	renderIssue: PreviewRuntimeIssue | null;
	viewport: PreviewHeadlessEntryViewport;
};

type GlobalRestoreEntry = {
	descriptor?: PropertyDescriptor;
	hadOwnProperty: boolean;
	key: string;
};

type HeadlessRenderBoundaryProps = {
	children: React.ReactNode;
	onError: (error: unknown) => void;
};

type HeadlessRenderBoundaryState = {
	hasError: boolean;
};

type HeadlessEntryRendererProps = {
	entry: PreviewEntryDescriptor;
	module: PreviewModule;
	onRenderError: (error: unknown | null) => void;
};

type HeadlessLayoutProbeObserverProps = {
	onSnapshot: (snapshot: HeadlessLayoutProbeSnapshot) => void;
	previewRuntime: HeadlessPreviewRuntimeModule;
};

type HeadlessPreviewRuntimeModule = {
	LayoutProvider: React.ComponentType<{
		children?: React.ReactNode;
		viewportHeight?: number;
		viewportWidth?: number;
	}>;
	clearPreviewRuntimeIssues(): void;
	createWindowViewport(): {
		height: number;
		width: number;
	};
	getPreviewLayoutProbeSnapshot(): {
		debug: PreviewLayoutDebugPayload;
		revision: number;
		viewportReady: boolean;
	};
	setPreviewLayoutEngineLoader(
		loader: (() => Promise<Uint8Array>) | null,
	): void;
	setPreviewRuntimeIssueContext(
		context: {
			entryId: string;
			file: string;
			relativeFile: string;
			target: string;
		} | null,
	): void;
	usePreviewLayoutProbeSnapshot(): HeadlessLayoutProbeSnapshot;
	subscribePreviewLayoutProbe(
		listener: (snapshot: HeadlessLayoutProbeSnapshot) => void,
	): () => void;
	subscribePreviewRuntimeIssues(
		listener: (issues: PreviewRuntimeIssue[]) => void,
	): () => void;
};

type HeadlessLayoutProbeSnapshot = {
	debug: PreviewLayoutDebugPayload | string;
	error?: string | null;
	isReady?: boolean;
	revision: number;
	viewport?: {
		height: number;
		width: number;
	};
	viewportReady: boolean | string;
};

type HeadlessLayoutProbeStore = {
	getSnapshot(): HeadlessLayoutProbeSnapshot;
};

type ResolvedHeadlessLayoutProbeSnapshot = {
	debug: PreviewLayoutDebugPayload | null;
	revision: number;
	viewportReady: boolean;
};

type HeadlessDomLayoutFallback = {
	debug: PreviewLayoutDebugPayload | null;
	viewportReady: boolean;
};

const HEADLESS_SETTLE_POLL_MS = 10;
const HEADLESS_SETTLE_STABLE_PASSES = 3;
const HEADLESS_SETTLE_TIMEOUT_MS = 500;
const HEADLESS_WINDOW_WIDTH = 800;
const HEADLESS_WINDOW_HEIGHT = 600;
const BOUND_WINDOW_FUNCTION_KEYS = new Set([
	"cancelAnimationFrame",
	"getComputedStyle",
	"requestAnimationFrame",
]);
const HEADLESS_LAYOUT_ENGINE_WASM_PATH = path.resolve(
	__dirname,
	"../../../layout-engine/pkg/layout_engine_bg.wasm",
);
let layoutEngineWasmBytesPromise: Promise<Uint8Array> | null = null;
const DOM_GLOBAL_KEYS = [
	"CustomEvent",
	"Document",
	"DocumentFragment",
	"DOMRect",
	"Element",
	"Event",
	"EventTarget",
	"HTMLElement",
	"getComputedStyle",
	"history",
	"HTMLButtonElement",
	"HTMLDivElement",
	"HTMLImageElement",
	"HTMLInputElement",
	"HTMLSpanElement",
	"HTMLTextAreaElement",
	"location",
	"MutationObserver",
	"navigator",
	"Node",
	"ResizeObserver",
	"requestAnimationFrame",
	"cancelAnimationFrame",
	"self",
	"SVGElement",
	"window",
	"document",
] as const;

class HeadlessRenderBoundary extends React.Component<
	HeadlessRenderBoundaryProps,
	HeadlessRenderBoundaryState
> {
	public constructor(props: HeadlessRenderBoundaryProps) {
		super(props);
		this.state = {
			hasError: false,
		};
	}

	public static getDerivedStateFromError(): HeadlessRenderBoundaryState {
		return {
			hasError: true,
		};
	}

	public componentDidCatch(error: unknown, errorInfo: React.ErrorInfo) {
		this.props.onError({ error, componentStack: errorInfo.componentStack });
	}

	public render() {
		if (this.state.hasError) {
			return null;
		}

		return this.props.children;
	}
}
function sleep(ms: number) {
	return new Promise<void>((resolve) => {
		globalThis.setTimeout(resolve, ms);
	});
}

function getRuntimeIssueFingerprint(issue: PreviewRuntimeIssue) {
	return [
		issue.entryId,
		issue.code,
		issue.kind,
		issue.phase,
		issue.relativeFile,
		issue.summary,
		issue.stack ?? "",
		issue.details ?? "",
		issue.symbol ?? "",
		issue.codeFrame ?? "",
		issue.importChain?.join(">") ?? "",
	].join("::");
}

function dedupeRuntimeIssues(issues: PreviewRuntimeIssue[]) {
	const issuesByFingerprint = new Map<string, PreviewRuntimeIssue>();

	for (const issue of issues) {
		issuesByFingerprint.set(getRuntimeIssueFingerprint(issue), issue);
	}

	return [...issuesByFingerprint.values()].sort((left, right) => {
		if (left.phase !== right.phase) {
			return left.phase.localeCompare(right.phase);
		}

		if (left.code !== right.code) {
			return left.code.localeCompare(right.code);
		}

		if ((left.stack ?? "") !== (right.stack ?? "")) {
			return (left.stack ?? "").localeCompare(right.stack ?? "");
		}

		return left.summary.localeCompare(right.summary);
	});
}

function setWindowViewportSize(window: Window) {
	Object.defineProperty(window, "innerHeight", {
		configurable: true,
		value: HEADLESS_WINDOW_HEIGHT,
	});
	Object.defineProperty(window, "innerWidth", {
		configurable: true,
		value: HEADLESS_WINDOW_WIDTH,
	});
}

function installDomGlobals(window: Window) {
	const globalRecord = globalThis as Record<string, unknown>;
	const restoreEntries: GlobalRestoreEntry[] = [];

	for (const key of DOM_GLOBAL_KEYS) {
		const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
		restoreEntries.push({
			descriptor,
			hadOwnProperty: descriptor !== undefined,
			key,
		});

		Object.defineProperty(globalThis, key, {
			configurable: true,
			value:
				BOUND_WINDOW_FUNCTION_KEYS.has(key) &&
				typeof (window as unknown as Record<string, unknown>)[key] ===
					"function"
					? (
							(window as unknown as Record<string, unknown>)[key] as (
								...args: unknown[]
							) => unknown
						).bind(window)
					: (window as unknown as Record<string, unknown>)[key],
			writable: true,
		});
	}

	return () => {
		for (const entry of restoreEntries.reverse()) {
			if (!entry.hadOwnProperty) {
				delete globalRecord[entry.key];
				continue;
			}

			if (entry.descriptor) {
				Object.defineProperty(globalThis, entry.key, entry.descriptor);
			}
		}
	};
}

function createHeadlessViewport(): PreviewHeadlessEntryViewport {
	const viewport = {
		height: HEADLESS_WINDOW_HEIGHT,
		width: HEADLESS_WINDOW_WIDTH,
	};
	return {
		height: viewport.height,
		ready: viewport.width > 0 && viewport.height > 0,
		source: "window-fallback",
		width: viewport.width,
	};
}

function readBooleanAttribute(
	element: Element | null,
	name: string,
): boolean | null {
	const value = element?.getAttribute(name);
	if (value === "true") {
		return true;
	}

	if (value === "false") {
		return false;
	}

	return null;
}

function readNumberAttribute(element: Element | null, name: string) {
	const value = element?.getAttribute(name);
	if (!value) {
		return null;
	}

	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : null;
}

function readStylePixelValue(
	element: HTMLElement | null,
	property: "height" | "left" | "top" | "width",
) {
	const value = element?.style[property];
	if (!value) {
		return null;
	}

	const parsed = Number.parseFloat(value);
	return Number.isFinite(parsed) ? parsed : null;
}

function collectChildPreviewNodes(element: Element): HTMLElement[] {
	const childPreviewNodes: HTMLElement[] = [];

	for (const child of element.children) {
		if (!(child instanceof HTMLElement)) {
			continue;
		}

		if (child.hasAttribute("data-preview-node-id")) {
			childPreviewNodes.push(child);
			continue;
		}

		childPreviewNodes.push(...collectChildPreviewNodes(child));
	}

	return childPreviewNodes;
}

function buildDomDebugNode(
	element: HTMLElement,
	parentConstraints: {
		height: number;
		width: number;
		x: number;
		y: number;
	} | null,
	parentId?: string,
): PreviewLayoutDebugPayload["roots"][number] {
	const computedHeight =
		readNumberAttribute(element, "data-layout-computed-height") ??
		readStylePixelValue(element, "height") ??
		0;
	const computedWidth =
		readNumberAttribute(element, "data-layout-computed-width") ??
		readStylePixelValue(element, "width") ??
		0;
	const localX = readStylePixelValue(element, "left") ?? 0;
	const localY = readStylePixelValue(element, "top") ?? 0;
	const rect = {
		height: computedHeight,
		width: computedWidth,
		x: localX,
		y: localY,
	};
	const nodeId =
		element.getAttribute("data-preview-node-id") ??
		element.id ??
		element.tagName;
	const children = collectChildPreviewNodes(element).map((child) =>
		buildDomDebugNode(child, rect, nodeId),
	);
	const layoutSourceAttribute = element.getAttribute(
		"data-layout-layout-source",
	);
	const layoutSource =
		layoutSourceAttribute === "explicit-size" ||
		layoutSourceAttribute === "full-size-default" ||
		layoutSourceAttribute === "intrinsic-size" ||
		layoutSourceAttribute === "root-default"
			? layoutSourceAttribute
			: parentId
				? "intrinsic-size"
				: "root-default";
	const sizeReasonAttribute = element.getAttribute("data-layout-size-reason");
	const sizeReason =
		sizeReasonAttribute === "explicit-size" ||
		sizeReasonAttribute === "full-size-default" ||
		sizeReasonAttribute === "intrinsic-measurement" ||
		sizeReasonAttribute === "intrinsic-empty" ||
		sizeReasonAttribute === "root-default"
			? sizeReasonAttribute
			: parentId
				? "intrinsic-empty"
				: "root-default";

	return {
		children,
		debugLabel: nodeId,
		hostPolicy: {
			degraded:
				readBooleanAttribute(element, "data-layout-host-degraded") ??
				readBooleanAttribute(element, "data-preview-degraded") ??
				false,
			fullSizeDefault:
				readBooleanAttribute(element, "data-layout-host-full-size-default") ??
				false,
			placeholderBehavior:
				element.getAttribute("data-layout-placeholder-behavior") ===
					"container" ||
				element.getAttribute("data-layout-placeholder-behavior") === "opaque"
					? (element.getAttribute("data-layout-placeholder-behavior") as
							| "container"
							| "opaque")
					: "none",
		},
		id: nodeId,
		intrinsicSize: null,
		kind: parentId ? "host" : "root",
		layoutSource,
		nodeType:
			element.getAttribute("data-preview-host") ??
			element.getAttribute("data-preview-degraded-label") ??
			element.tagName.toLowerCase(),
		parentConstraints,
		parentId,
		provenance: {
			detail: "Derived from rendered DOM diagnostics.",
			source: "fallback",
		},
		rect,
		sizeResolution: {
			hadExplicitSize:
				readBooleanAttribute(element, "data-layout-had-explicit-size") ?? false,
			intrinsicSizeAvailable:
				readBooleanAttribute(element, "data-layout-intrinsic-size-available") ??
				false,
			reason: sizeReason,
		},
		styleHints: {
			height: element.getAttribute("data-layout-style-height") ?? undefined,
			width: element.getAttribute("data-layout-style-width") ?? undefined,
		},
	};
}

function collectDomLayoutFallback(
	container: HTMLElement,
): HeadlessDomLayoutFallback {
	const provider = container.querySelector("[data-preview-layout-provider]");
	const viewportWidth =
		readNumberAttribute(provider, "data-preview-viewport-width") ??
		readNumberAttribute(
			container.querySelector("[data-layout-viewport-width]"),
			"data-layout-viewport-width",
		) ??
		HEADLESS_WINDOW_WIDTH;
	const viewportHeight =
		readNumberAttribute(provider, "data-preview-viewport-height") ??
		readNumberAttribute(
			container.querySelector("[data-layout-viewport-height]"),
			"data-layout-viewport-height",
		) ??
		HEADLESS_WINDOW_HEIGHT;
	const viewportReady =
		readBooleanAttribute(provider, "data-preview-viewport-ready") ??
		readBooleanAttribute(
			container.querySelector("[data-layout-viewport-ready]"),
			"data-layout-viewport-ready",
		) ??
		(viewportWidth > 0 && viewportHeight > 0);
	const rootsSource = provider instanceof HTMLElement ? provider : container;
	const roots = collectChildPreviewNodes(rootsSource).map((child) =>
		buildDomDebugNode(child, null),
	);

	return {
		debug:
			roots.length > 0
				? {
						dirtyNodeIds: roots.map((root) => root.id),
						roots,
						viewport: {
							height: viewportHeight,
							width: viewportWidth,
						},
					}
				: null,
		viewportReady,
	};
}

function isLayoutProbePlaceholder(value: unknown): value is string {
	return (
		typeof value === "string" &&
		value.startsWith("__loom_preview_layout_probe_store__.getSnapshot.")
	);
}

function coerceHeadlessLayoutProbeSnapshot(
	snapshot: HeadlessLayoutProbeSnapshot | null | undefined,
): ResolvedHeadlessLayoutProbeSnapshot | null {
	if (!snapshot) {
		return null;
	}

	if (
		isLayoutProbePlaceholder(snapshot.debug) ||
		isLayoutProbePlaceholder(snapshot.viewportReady)
	) {
		return null;
	}

	if (
		snapshot.debug == null ||
		typeof snapshot.debug !== "object" ||
		typeof snapshot.viewportReady !== "boolean"
	) {
		return null;
	}

	return {
		debug: snapshot.debug,
		revision: snapshot.revision,
		viewportReady: snapshot.viewportReady,
	};
}

function readHeadlessLayoutProbeSnapshot(
	previewRuntime: HeadlessPreviewRuntimeModule,
): ResolvedHeadlessLayoutProbeSnapshot {
	const globalRecord = globalThis as typeof globalThis & {
		__loom_preview_layout_probe_store__?: HeadlessLayoutProbeStore;
	};
	const snapshots = [
		coerceHeadlessLayoutProbeSnapshot(
			globalRecord.__loom_preview_layout_probe_store__?.getSnapshot(),
		),
		coerceHeadlessLayoutProbeSnapshot(
			previewRuntime.getPreviewLayoutProbeSnapshot(),
		),
	];

	for (const snapshot of snapshots) {
		if (snapshot) {
			return snapshot;
		}
	}

	return {
		debug: null,
		revision: 0,
		viewportReady: false,
	};
}

function getEntryModuleId(entryId: string) {
	return `virtual:loom-preview-entry:${encodeURIComponent(entryId)}`;
}

function loadHeadlessLayoutEngineWasm() {
	if (!layoutEngineWasmBytesPromise) {
		layoutEngineWasmBytesPromise = readFile(
			HEADLESS_LAYOUT_ENGINE_WASM_PATH,
		).then((bytes) => new Uint8Array(bytes));
	}

	return layoutEngineWasmBytesPromise;
}

function hasHeadlessLayoutDebugTree(
	debug: PreviewLayoutDebugPayload | null | undefined,
) {
	return Array.isArray(debug?.roots) && debug.roots.length > 0;
}

async function waitForHeadlessSettled(readSignature: () => string) {
	const timeoutAt = Date.now() + HEADLESS_SETTLE_TIMEOUT_MS;
	let previousSignature = "";
	let stablePasses = 0;

	while (Date.now() <= timeoutAt) {
		await act(async () => {
			await Promise.resolve();
			await sleep(HEADLESS_SETTLE_POLL_MS);
		});
		const nextSignature = readSignature();

		if (nextSignature === previousSignature) {
			stablePasses += 1;
			if (stablePasses >= HEADLESS_SETTLE_STABLE_PASSES) {
				return;
			}
		} else {
			previousSignature = nextSignature;
			stablePasses = 0;
		}
	}
}

function createSkippedEntryExecution(): HeadlessCollectedEntryExecution {
	return {
		issues: [],
		layoutDebug: null,
		loadIssue: null,
		render: {
			status: "skipped",
		},
		renderIssue: null,
		viewport: createDefaultHeadlessViewport(),
	};
}

function HeadlessEntryRenderer(props: HeadlessEntryRendererProps) {
	return (
		<React.Fragment>
			<HeadlessRenderBoundary
				onError={(error) => {
					props.onRenderError(error);
				}}
			>
				{createPreviewRenderNode(props.entry, props.module)}
			</HeadlessRenderBoundary>
		</React.Fragment>
	);
}

function HeadlessLayoutProbeObserver(props: HeadlessLayoutProbeObserverProps) {
	const snapshot = props.previewRuntime.usePreviewLayoutProbeSnapshot();

	React.useEffect(() => {
		props.onSnapshot(snapshot);
	}, [props.onSnapshot, snapshot]);

	return null;
}

export async function executeHeadlessEntry(
	server: PreviewDevServer,
	entry: PreviewEntryDescriptor,
	runtimeModuleId: string,
): Promise<HeadlessCollectedEntryExecution> {
	if (entry.status !== "ready") {
		return createSkippedEntryExecution();
	}

	const dom = new JSDOM(
		'<!doctype html><html><body><div id="root"></div></body></html>',
		{
			pretendToBeVisual: true,
			url: "http://localhost/",
		},
	);
	setWindowViewportSize(dom.window);
	const restoreGlobals = installDomGlobals(dom.window);
	let root: Root | null = null;
	let previewRuntime: HeadlessPreviewRuntimeModule | null = null;
	let unsubscribeLayoutProbe: (() => void) | null = null;
	let unsubscribeRuntimeIssues: (() => void) | null = null;
	let restorePreviewBrowserGlobals: (() => void) | null = null;
	const previousActEnvironment = (
		globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
	).IS_REACT_ACT_ENVIRONMENT;

	try {
		(
			globalThis as typeof globalThis & {
				IS_REACT_ACT_ENVIRONMENT?: boolean;
			}
		).IS_REACT_ACT_ENVIRONMENT = true;
		restorePreviewBrowserGlobals = installPreviewBrowserGlobals();

		let runtimeIssues: PreviewRuntimeIssue[] = [];
		let runtimeVersion = 0;
		let renderIssue: PreviewRuntimeIssue | null = null;
		let latestLayoutProbeSnapshot: ResolvedHeadlessLayoutProbeSnapshot = {
			debug: null,
			revision: 0,
			viewportReady: false,
		};

		const container = dom.window.document.getElementById("root");
		if (!container) {
			throw new Error("Headless preview root element is missing.");
		}

		let module: PreviewModule;
		try {
			module = (await server.ssrLoadModule(
				getEntryModuleId(entry.id),
			)) as PreviewModule;
		} catch (error) {
			const loadIssue = createPreviewLoadIssue(entry, error);
			return {
				issues: [loadIssue],
				layoutDebug: null,
				loadIssue,
				render: {
					status: "load_failed",
				},
				renderIssue: null,
				viewport: createHeadlessViewport(),
			};
		}

		previewRuntime =
			(module.__previewRuntimeModule as
				| HeadlessPreviewRuntimeModule
				| undefined) ??
			((await server.ssrLoadModule(
				runtimeModuleId,
			)) as HeadlessPreviewRuntimeModule);
		const runtimeModule = previewRuntime;
		const LayoutProvider = runtimeModule.LayoutProvider;

		runtimeModule.setPreviewLayoutEngineLoader(loadHeadlessLayoutEngineWasm);
		runtimeModule.clearPreviewRuntimeIssues();
		runtimeModule.setPreviewRuntimeIssueContext({
			entryId: entry.id,
			file: entry.sourceFilePath,
			relativeFile: entry.relativePath,
			target: entry.targetName,
		});
		unsubscribeRuntimeIssues = runtimeModule.subscribePreviewRuntimeIssues(
			(issues) => {
				runtimeIssues = issues.filter((issue) => issue.entryId === entry.id);
				runtimeVersion += 1;
			},
		);
		unsubscribeLayoutProbe = runtimeModule.subscribePreviewLayoutProbe(
			(snapshot) => {
				const nextSnapshot = coerceHeadlessLayoutProbeSnapshot(snapshot);
				if (!nextSnapshot) {
					return;
				}

				latestLayoutProbeSnapshot = nextSnapshot;
			},
		);

		root = createRoot(container);
		await act(async () => {
			root?.render(
				<React.Fragment>
					<LayoutProvider
						viewportHeight={HEADLESS_WINDOW_HEIGHT}
						viewportWidth={HEADLESS_WINDOW_WIDTH}
					>
						<HeadlessLayoutProbeObserver
							onSnapshot={(snapshot) => {
								const nextSnapshot =
									coerceHeadlessLayoutProbeSnapshot(snapshot);
								if (!nextSnapshot) {
									return;
								}

								latestLayoutProbeSnapshot = nextSnapshot;
							}}
							previewRuntime={runtimeModule}
						/>
						<HeadlessEntryRenderer
							entry={entry}
							module={module}
							onRenderError={(error) => {
								renderIssue =
									error == null ? null : createPreviewRenderIssue(entry, error);
							}}
						/>
					</LayoutProvider>
				</React.Fragment>,
			);
		});

		await waitForHeadlessSettled(() =>
			JSON.stringify({
				html: container.innerHTML,
				layoutRevision: latestLayoutProbeSnapshot.revision,
				renderIssue: renderIssue?.summary ?? "",
				runtimeVersion,
			}),
		);

		const currentLayoutProbeSnapshot =
			readHeadlessLayoutProbeSnapshot(previewRuntime);
		const layoutProbeSnapshot =
			currentLayoutProbeSnapshot.revision >= latestLayoutProbeSnapshot.revision
				? currentLayoutProbeSnapshot
				: latestLayoutProbeSnapshot;
		const domLayoutFallback = collectDomLayoutFallback(container);
		const layoutDebug =
			hasHeadlessLayoutDebugTree(layoutProbeSnapshot.debug) ||
			!hasHeadlessLayoutDebugTree(domLayoutFallback.debug)
				? (layoutProbeSnapshot.debug ?? domLayoutFallback.debug)
				: domLayoutFallback.debug;
		const combinedIssues = dedupeRuntimeIssues([
			...runtimeIssues,
			...(renderIssue ? [renderIssue] : []),
		]);

		return {
			issues: combinedIssues,
			layoutDebug,
			loadIssue: null,
			render: {
				status: renderIssue ? "render_failed" : "rendered",
			},
			renderIssue,
			viewport: {
				...createHeadlessViewport(),
				ready:
					layoutProbeSnapshot.viewportReady || domLayoutFallback.viewportReady,
			},
		};
	} finally {
		try {
			unsubscribeLayoutProbe?.();
		} catch {
			// Ignore subscription teardown errors after collection is complete.
		}
		try {
			unsubscribeRuntimeIssues?.();
		} catch {
			// Ignore subscription teardown errors after collection is complete.
		}
		if (root) {
			try {
				await act(async () => {
					root?.unmount();
				});
			} catch {
				// Ignore teardown-only React flush errors after the snapshot is collected.
			}
		}
		try {
			previewRuntime?.setPreviewLayoutEngineLoader(null);
		} catch {
			// Ignore module-runner teardown errors after the snapshot is collected.
		}
		try {
			previewRuntime?.clearPreviewRuntimeIssues();
		} catch {
			// Ignore module-runner teardown errors after the snapshot is collected.
		}
		try {
			previewRuntime?.setPreviewRuntimeIssueContext(null);
		} catch {
			// Ignore module-runner teardown errors after the snapshot is collected.
		}
		try {
			restorePreviewBrowserGlobals?.();
		} catch {
			// Ignore preview global restoration errors during teardown.
		}
		(
			globalThis as typeof globalThis & {
				IS_REACT_ACT_ENVIRONMENT?: boolean;
			}
		).IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
		try {
			restoreGlobals();
		} catch {
			// Ignore DOM global restoration errors during teardown.
		}
		try {
			dom.window.close();
		} catch {
			// Ignore JSDOM teardown errors during teardown.
		}
	}
}
