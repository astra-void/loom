/**
 * In-browser (jsdom) Loom capture. Renders a preview scene under a
 * `LayoutProvider`, then serialises the rendered tree into a {@link ParitySnapshot}
 * carrying both geometry (from the layout-debug tree) and visual properties
 * (read off the DOM host property bridge).
 *
 * This entry pulls in React + Testing Library, so it is intentionally separate
 * from the dependency-free diff core in `@loom-dev/parity`.
 */

import {
	getPreviewLayoutProbeSnapshot,
	LayoutProvider,
	type PreviewLayoutDebugNode,
	type PreviewLayoutDebugPayload,
} from "@loom-dev/preview-runtime";
import { render, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import type {
	ParityColor3,
	ParityNode,
	ParitySnapshot,
	ParityVec2,
	ParityVisualProps,
} from "./types";

export {
	installNodeLayoutEngine,
	resolveDefaultWasmPath,
} from "./nodeLayoutEngine";

function readColor3(value: unknown): ParityColor3 | undefined {
	if (value && typeof value === "object") {
		const color = value as { R?: unknown; G?: unknown; B?: unknown };
		if (
			typeof color.R === "number" &&
			typeof color.G === "number" &&
			typeof color.B === "number"
		) {
			return { r: color.R, g: color.G, b: color.B };
		}
	}
	return undefined;
}

function readNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value)
		? value
		: undefined;
}

/** Read visual properties off a bridged DOM host element. */
function readVisual(
	el: Element | null | undefined,
): ParityVisualProps | undefined {
	if (!el) {
		return undefined;
	}
	const host = el as unknown as Record<string, unknown>;
	const visual: ParityVisualProps = {};

	const backgroundColor3 = readColor3(host.BackgroundColor3);
	if (backgroundColor3) {
		visual.backgroundColor3 = backgroundColor3;
	}
	const imageColor3 = readColor3(host.ImageColor3);
	if (imageColor3) {
		visual.imageColor3 = imageColor3;
	}
	const textColor3 = readColor3(host.TextColor3);
	if (textColor3) {
		visual.textColor3 = textColor3;
	}

	const backgroundTransparency = readNumber(host.BackgroundTransparency);
	if (backgroundTransparency !== undefined) {
		visual.backgroundTransparency = backgroundTransparency;
	}
	const imageTransparency = readNumber(host.ImageTransparency);
	if (imageTransparency !== undefined) {
		visual.imageTransparency = imageTransparency;
	}
	const textTransparency = readNumber(host.TextTransparency);
	if (textTransparency !== undefined) {
		visual.textTransparency = textTransparency;
	}
	const rotation = readNumber(host.Rotation);
	if (rotation !== undefined) {
		visual.rotation = rotation;
	}
	const textSize = readNumber(host.TextSize);
	if (textSize !== undefined) {
		visual.textSize = textSize;
	}
	if (typeof host.Text === "string") {
		visual.text = host.Text;
	}
	if (typeof host.Visible === "boolean") {
		visual.visible = host.Visible;
	}

	return Object.keys(visual).length > 0 ? visual : undefined;
}

function walk(node: PreviewLayoutDebugNode, container: ParentNode): ParityNode {
	const rect = node.rect ?? { x: 0, y: 0, width: 0, height: 0 };
	const el = container.querySelector(`[data-preview-node-id="${node.id}"]`);
	return {
		name: node.debugLabel ?? node.id,
		className: node.nodeType,
		absolutePosition: { x: rect.x, y: rect.y },
		absoluteSize: { x: rect.width, y: rect.height },
		zIndex: node.zIndex,
		visual: readVisual(el),
		children: node.children.map((child) => walk(child, container)),
	};
}

export interface CaptureFromDomOptions {
	scene?: string;
	capturedAt?: string;
}

/**
 * Build a {@link ParitySnapshot} from an already-rendered container and its
 * layout-debug payload. Geometry/structure come from `debug`; visual properties
 * are read off the DOM bridge, correlated by `data-preview-node-id`.
 */
export function captureLoomFromDom(
	container: ParentNode,
	debug: PreviewLayoutDebugPayload,
	options: CaptureFromDomOptions = {},
): ParitySnapshot {
	return {
		source: "loom",
		viewport: { x: debug.viewport.width, y: debug.viewport.height },
		scene: options.scene,
		capturedAt: options.capturedAt,
		roots: debug.roots.map((root) => walk(root, container)),
	};
}

/**
 * Build a {@link ParitySnapshot} purely from the rendered DOM host tree, reading
 * BOTH geometry and visual properties off the preview host bridge (no layout
 * debug payload required). This is the walk used to capture a real,
 * browser-rendered preview — the same logic runs in-page via Playwright in
 * `scripts/parity/captureBrowser.ts`.
 */
export function captureFromHostTree(
	root: ParentNode,
	viewport: ParityVec2,
	options: CaptureFromDomOptions = {},
): ParitySnapshot {
	const hosts = Array.from(
		root.querySelectorAll("[data-preview-host]"),
	) as HTMLElement[];

	const hostParent = (el: Element): Element | null => {
		const parent = el.parentElement?.closest("[data-preview-host]") ?? null;
		return parent && root.contains(parent) ? parent : null;
	};

	const toNode = (el: HTMLElement): ParityNode => {
		const host = el as unknown as Record<string, unknown>;
		const position = host.AbsolutePosition as
			| { X?: number; Y?: number }
			| undefined;
		const size = host.AbsoluteSize as { X?: number; Y?: number } | undefined;
		const fallback = el.getAttribute("data-preview-host") ?? "host";
		return {
			name: typeof host.Name === "string" ? host.Name : fallback,
			className: typeof host.ClassName === "string" ? host.ClassName : fallback,
			absolutePosition: { x: position?.X ?? 0, y: position?.Y ?? 0 },
			absoluteSize: { x: size?.X ?? 0, y: size?.Y ?? 0 },
			zIndex: readNumber(host.ZIndex),
			visual: readVisual(el),
			children: hosts
				.filter((candidate) => hostParent(candidate) === el)
				.map(toNode),
		};
	};

	return {
		source: "loom",
		viewport,
		scene: options.scene,
		capturedAt: options.capturedAt,
		roots: hosts.filter((el) => hostParent(el) === null).map(toNode),
	};
}

export interface RenderCaptureOptions {
	/** Viewport to lay the scene out against. Match the Roblox capture. */
	viewport?: ParityVec2;
	scene?: string;
	/** How long to wait for layout to settle. */
	settleTimeoutMs?: number;
}

/**
 * Render a preview scene under a `LayoutProvider` (in jsdom), wait for layout to
 * settle, and capture it. Must run in a DOM environment (e.g. Vitest jsdom).
 */
export async function renderAndCaptureLoom(
	scene: ReactElement,
	options: RenderCaptureOptions = {},
): Promise<ParitySnapshot> {
	const viewport = options.viewport ?? { x: 800, y: 600 };
	const result = render(
		<LayoutProvider
			debounceMs={0}
			viewportHeight={viewport.y}
			viewportWidth={viewport.x}
		>
			{scene}
		</LayoutProvider>,
	);

	try {
		await waitFor(
			() => {
				const debug = getPreviewLayoutProbeSnapshot().debug;
				if (debug.roots.length === 0) {
					throw new Error("layout has no roots yet");
				}
				const first = debug.roots[0];
				if (!first.rect || first.rect.width <= 0) {
					throw new Error("layout not resolved yet");
				}
			},
			{ timeout: options.settleTimeoutMs ?? 2000 },
		);

		const debug = getPreviewLayoutProbeSnapshot().debug;
		return captureLoomFromDom(result.container, debug, {
			scene: options.scene,
		});
	} finally {
		result.unmount();
	}
}
