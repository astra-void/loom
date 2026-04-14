// @vitest-environment node

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LayoutController } from "../../packages/preview-runtime/src/layout/controller";
import type {
	PreviewLayoutDebugNode,
	PreviewLayoutNode,
} from "../../packages/preview-runtime/src/layout/model";
import {
	createWasmLayoutSession,
	initializeLayoutEngine,
	setPreviewLayoutEngineLoader,
} from "../../packages/preview-runtime/src/layout/wasm";

function axis(scale: number, offset: number) {
	return { offset, scale };
}

function size(
	xScale: number,
	xOffset: number,
	yScale: number,
	yOffset: number,
) {
	return {
		x: axis(xScale, xOffset),
		y: axis(yScale, yOffset),
	};
}

function rootNode(id: string): PreviewLayoutNode {
	return {
		id,
		kind: "root",
		layout: {
			anchorPoint: { x: 0, y: 0 },
			position: size(0, 0, 0, 0),
			positionMode: "absolute",
			sizeConstraintMode: "RelativeXY",
			size: size(1, 0, 1, 0),
		},
		name: id,
		nodeType: "ScreenGui",
		sourceOrder: 0,
	};
}

function hostNode(
	id: string,
	parentId: string,
	overrides: Omit<Partial<PreviewLayoutNode>, "layout"> & {
		layout?: Partial<PreviewLayoutNode["layout"]>;
	} = {},
): PreviewLayoutNode {
	const { layout: layoutOverrides, ...rest } = overrides;
	return {
		id,
		kind: "host",
		layout: {
			anchorPoint: { x: 0, y: 0 },
			position: size(0, 0, 0, 0),
			positionMode: "absolute",
			sizeConstraintMode: "RelativeXY",
			size: size(0, 100, 0, 40),
			...layoutOverrides,
		},
		name: id,
		nodeType: "Frame",
		parentId,
		...rest,
	};
}

function roundLayoutNumber(value: number) {
	return Number(value.toFixed(5));
}

function normalizeRect(
	rect: {
		height: number;
		width: number;
		x: number;
		y: number;
	} | null,
) {
	if (!rect) {
		return null;
	}

	return {
		height: roundLayoutNumber(rect.height),
		width: roundLayoutNumber(rect.width),
		x: roundLayoutNumber(rect.x),
		y: roundLayoutNumber(rect.y),
	};
}

function normalizeRectMap(
	rects: Record<
		string,
		{ height: number; width: number; x: number; y: number }
	>,
) {
	return Object.fromEntries(
		Object.entries(rects).map(([nodeId, rect]) => [
			nodeId,
			normalizeRect(rect),
		]),
	);
}

function normalizeDebugNode(node: PreviewLayoutDebugNode) {
	return {
		children: node.children.map(normalizeDebugNode),
		debugLabel: node.debugLabel,
		hostPolicy: node.hostPolicy,
		id: node.id,
		intrinsicSize: node.intrinsicSize,
		kind: node.kind,
		layoutSource: node.layoutSource,
		nodeType: node.nodeType,
		parentConstraints: normalizeRect(node.parentConstraints),
		parentId: node.parentId,
		rect: normalizeRect(node.rect),
		sizeResolution: node.sizeResolution,
		styleHints: node.styleHints,
	};
}

function assertParity(
	nodes: PreviewLayoutNode[],
	viewport: { height: number; width: number },
) {
	const fallback = new LayoutController();
	const wasm = new LayoutController({
		sessionFactory: () => createWasmLayoutSession(),
	});

	for (const node of nodes) {
		fallback.upsertNode(node);
		wasm.upsertNode(node);
	}

	fallback.setViewport(viewport);
	wasm.setViewport(viewport);

	const fallbackResult = (
		fallback as unknown as { computeFallback: () => PreviewLayoutResult }
	).computeFallback();
	const wasmResult = wasm.compute();

	expect(wasmResult.dirtyNodeIds).toEqual(fallbackResult.dirtyNodeIds);
	expect(normalizeRectMap(wasmResult.rects)).toEqual(
		normalizeRectMap(fallbackResult.rects),
	);
	expect(wasmResult.debug.viewport).toEqual(fallbackResult.debug.viewport);
	expect(wasmResult.debug.roots.map(normalizeDebugNode)).toEqual(
		fallbackResult.debug.roots.map(normalizeDebugNode),
	);
}

describe("preview runtime Wasm layout parity", () => {
	beforeAll(async () => {
		const wasmBytes = readFileSync(
			fileURLToPath(
				new URL(
					"../../packages/layout-engine/pkg/layout_engine_bg.wasm",
					import.meta.url,
				),
			),
		);
		setPreviewLayoutEngineLoader(() => new Uint8Array(wasmBytes));
		await initializeLayoutEngine();
	});

	afterAll(() => {
		setPreviewLayoutEngineLoader(null);
	});

	it("matches fallback for padding and list ordering semantics", () => {
		assertParity(
			[
				rootNode("screen"),
				hostNode("frame", "screen", {
					layout: {
						anchorPoint: { x: 0, y: 0 },
						position: size(0, 0, 0, 0),
						positionMode: "absolute",
						size: size(0, 200, 0, 120),
					},
					layoutModifiers: {
						list: {
							fillDirection: "vertical",
							horizontalAlignment: "center",
							padding: { Offset: 8, Scale: 0 },
							sortOrder: "name",
							verticalAlignment: "center",
							wraps: false,
						},
						padding: {
							bottom: { Offset: 10, Scale: 0 },
							left: { Offset: 10, Scale: 0 },
							right: { Offset: 10, Scale: 0 },
							top: { Offset: 10, Scale: 0 },
						},
					},
					name: "Container",
					sourceOrder: 0,
				}),
				hostNode("label-beta", "frame", {
					layout: {
						anchorPoint: { x: 0, y: 0 },
						position: size(0, 0, 0, 0),
						positionMode: "absolute",
						size: size(0, 40, 0, 20),
					},
					layoutOrder: 2,
					name: "Beta",
					nodeType: "TextLabel",
					sourceOrder: 0,
				}),
				hostNode("label-alpha", "frame", {
					layout: {
						anchorPoint: { x: 0, y: 0 },
						position: size(0, 0, 0, 0),
						positionMode: "absolute",
						size: size(0, 60, 0, 30),
					},
					layoutOrder: 1,
					name: "Alpha",
					nodeType: "TextLabel",
					sourceOrder: 1,
				}),
			],
			{ height: 200, width: 300 },
		);
	});

	it("matches fallback for grid placement semantics", () => {
		assertParity(
			[
				rootNode("screen"),
				hostNode("frame", "screen", {
					layout: {
						anchorPoint: { x: 0, y: 0 },
						position: size(0, 0, 0, 0),
						positionMode: "absolute",
						size: size(0, 220, 0, 140),
					},
					layoutModifiers: {
						grid: {
							cellPadding: {
								X: { Offset: 10, Scale: 0 },
								Y: { Offset: 5, Scale: 0 },
							},
							cellSize: {
								X: { Offset: 50, Scale: 0 },
								Y: { Offset: 20, Scale: 0 },
							},
							fillDirection: "horizontal",
							fillDirectionMaxCells: 3,
							horizontalAlignment: "center",
							sortOrder: "source",
							startCorner: "top-left",
							verticalAlignment: "center",
						},
					},
				}),
				hostNode("grid-1", "frame", {
					layout: {
						anchorPoint: { x: 0, y: 0 },
						position: size(0, 0, 0, 0),
						positionMode: "absolute",
						size: size(0, 50, 0, 20),
					},
					sourceOrder: 0,
				}),
				hostNode("grid-2", "frame", { sourceOrder: 1 }),
				hostNode("grid-3", "frame", { sourceOrder: 2 }),
				hostNode("grid-4", "frame", { sourceOrder: 3 }),
			],
			{ height: 200, width: 300 },
		);
	});

	it("matches fallback for size and aspect constraints", () => {
		assertParity(
			[
				rootNode("screen"),
				hostNode("frame", "screen", {
					layout: {
						anchorPoint: { x: 0, y: 0 },
						position: size(0, 0, 0, 0),
						positionMode: "absolute",
						size: size(0, 200, 0, 120),
					},
				}),
				hostNode("box", "frame", {
					layout: {
						anchorPoint: { x: 0, y: 0 },
						position: size(0, 0, 0, 0),
						positionMode: "absolute",
						size: size(0, 50, 0, 80),
					},
					layoutModifiers: {
						aspectRatioConstraint: {
							aspectRatio: 2,
							dominantAxis: "width",
						},
						sizeConstraint: {
							maxSize: { X: 160, Y: 120 },
							minSize: { X: 100, Y: 40 },
						},
					},
				}),
			],
			{ height: 240, width: 320 },
		);
	});

	it("matches fallback for text-size contract acceptance", () => {
		assertParity(
			[
				rootNode("screen"),
				hostNode("label", "screen", {
					layout: {
						anchorPoint: { x: 0, y: 0 },
						position: size(0, 0, 0, 0),
						positionMode: "absolute",
						size: size(0, 120, 0, 20),
					},
					layoutModifiers: {
						textSizeConstraint: {
							maxTextSize: 18,
							minTextSize: 16,
						},
					},
					nodeType: "TextLabel",
					styleHints: {
						height: "20px",
						width: "120px",
					},
				}),
			],
			{ height: 240, width: 320 },
		);
	});

	it("matches fallback for flex grow ratios", () => {
		assertParity(
			[
				rootNode("screen"),
				hostNode("frame", "screen", {
					layout: {
						anchorPoint: { x: 0, y: 0 },
						position: size(0, 0, 0, 0),
						positionMode: "absolute",
						size: size(0, 120, 0, 100),
					},
					layoutModifiers: {
						list: {
							fillDirection: "vertical",
							horizontalAlignment: "left",
							padding: { Offset: 0, Scale: 0 },
							sortOrder: "source",
							verticalAlignment: "top",
							verticalFlex: "fill",
							wraps: false,
						},
					},
				}),
				hostNode("first", "frame", {
					layout: {
						anchorPoint: { x: 0, y: 0 },
						position: size(0, 0, 0, 0),
						positionMode: "absolute",
						size: size(0, 120, 0, 20),
					},
					layoutModifiers: {
						flexItem: {
							flexMode: "grow",
							growRatio: 1,
						},
					},
					sourceOrder: 0,
				}),
				hostNode("second", "frame", {
					layout: {
						anchorPoint: { x: 0, y: 0 },
						position: size(0, 0, 0, 0),
						positionMode: "absolute",
						size: size(0, 120, 0, 20),
					},
					layoutModifiers: {
						flexItem: {
							flexMode: "grow",
							growRatio: 2,
						},
					},
					sourceOrder: 1,
				}),
			],
			{ height: 240, width: 320 },
		);
	});

	it("matches fallback for size-constraint modes", () => {
		assertParity(
			[
				rootNode("screen"),
				hostNode("xy", "screen", {
					layout: {
						anchorPoint: { x: 0, y: 0 },
						position: size(0, 0, 0, 0),
						positionMode: "absolute",
						sizeConstraintMode: "RelativeXY",
						size: size(0.5, 10, 0.5, 20),
					},
				}),
				hostNode("xx", "screen", {
					layout: {
						anchorPoint: { x: 0, y: 0 },
						position: size(0, 0, 0, 0),
						positionMode: "absolute",
						sizeConstraintMode: "RelativeXX",
						size: size(0.5, 10, 0.5, 20),
					},
				}),
				hostNode("yy", "screen", {
					layout: {
						anchorPoint: { x: 0, y: 0 },
						position: size(0, 0, 0, 0),
						positionMode: "absolute",
						sizeConstraintMode: "RelativeYY",
						size: size(0.5, 10, 0.5, 20),
					},
				}),
			],
			{ height: 300, width: 400 },
		);
	});

	it("matches fallback for automatic-size with anchor-aware rect updates", () => {
		assertParity(
			[
				rootNode("screen"),
				hostNode("auto-parent", "screen", {
					layout: {
						automaticSize: "xy",
						anchorPoint: { x: 0.5, y: 0.5 },
						position: size(0.5, 0, 0.5, 0),
						positionMode: "absolute",
						sizeConstraintMode: "RelativeXY",
						size: size(0, 300, 0, 200),
					},
				}),
				hostNode("auto-child", "auto-parent", {
					layout: {
						anchorPoint: { x: 0, y: 0 },
						position: size(0, 0, 0, 0),
						positionMode: "absolute",
						sizeConstraintMode: "RelativeXY",
						size: size(0, 120, 0, 40),
					},
				}),
			],
			{ height: 300, width: 400 },
		);
	});

	it("matches fallback for nested automatic-size with padding and list layout", () => {
		assertParity(
			[
				rootNode("screen"),
				hostNode("outer", "screen", {
					layout: {
						automaticSize: "xy",
						anchorPoint: { x: 0, y: 0 },
						position: size(0, 0, 0, 0),
						positionMode: "absolute",
						sizeConstraintMode: "RelativeXY",
						size: size(0, 100, 0, 80),
					},
					layoutModifiers: {
						list: {
							fillDirection: "vertical",
							horizontalAlignment: "left",
							padding: { Offset: 6, Scale: 0 },
							sortOrder: "source",
							verticalAlignment: "top",
							wraps: false,
						},
						padding: {
							bottom: { Offset: 4, Scale: 0 },
							left: { Offset: 0, Scale: 0.1 },
							right: { Offset: 0, Scale: 0.1 },
							top: { Offset: 4, Scale: 0 },
						},
					},
				}),
				hostNode("inner", "outer", {
					layout: {
						automaticSize: "xy",
						anchorPoint: { x: 0, y: 0 },
						position: size(0, 0, 0, 0),
						positionMode: "absolute",
						sizeConstraintMode: "RelativeXY",
						size: size(0, 80, 0, 40),
					},
					layoutModifiers: {
						list: {
							fillDirection: "vertical",
							horizontalAlignment: "left",
							padding: { Offset: 4, Scale: 0 },
							sortOrder: "source",
							verticalAlignment: "top",
							wraps: false,
						},
						padding: {
							bottom: { Offset: 0, Scale: 0 },
							left: { Offset: 0, Scale: 0.1 },
							right: { Offset: 0, Scale: 0.1 },
							top: { Offset: 0, Scale: 0 },
						},
					},
				}),
				hostNode("inner-first", "inner", {
					layout: {
						anchorPoint: { x: 0, y: 0 },
						position: size(0, 0, 0, 0),
						positionMode: "absolute",
						sizeConstraintMode: "RelativeXY",
						size: size(0, 50, 0, 18),
					},
					sourceOrder: 0,
				}),
				hostNode("inner-second", "inner", {
					layout: {
						anchorPoint: { x: 0, y: 0 },
						position: size(0, 0, 0, 0),
						positionMode: "absolute",
						sizeConstraintMode: "RelativeXY",
						size: size(0, 30, 0, 12),
					},
					sourceOrder: 1,
				}),
			],
			{ height: 320, width: 420 },
		);
	});

	it("matches fallback for non-zero anchor points inside list and grid layouts", () => {
		assertParity(
			[
				rootNode("screen"),
				hostNode("list-parent", "screen", {
					layout: {
						anchorPoint: { x: 0, y: 0 },
						position: size(0, 0, 0, 0),
						positionMode: "absolute",
						sizeConstraintMode: "RelativeXY",
						size: size(0, 200, 0, 100),
					},
					layoutModifiers: {
						list: {
							fillDirection: "vertical",
							horizontalAlignment: "left",
							padding: { Offset: 0, Scale: 0 },
							sortOrder: "source",
							verticalAlignment: "top",
							wraps: false,
						},
					},
				}),
				hostNode("list-child", "list-parent", {
					layout: {
						anchorPoint: { x: 0.5, y: 0.5 },
						position: size(0, 30, 0, 40),
						positionMode: "absolute",
						sizeConstraintMode: "RelativeXY",
						size: size(0, 100, 0, 20),
					},
				}),
				hostNode("grid-parent", "screen", {
					layout: {
						anchorPoint: { x: 0, y: 0 },
						position: size(0, 0, 0, 0),
						positionMode: "absolute",
						sizeConstraintMode: "RelativeXY",
						size: size(0, 200, 0, 100),
					},
					layoutModifiers: {
						grid: {
							cellPadding: { X: axis(0, 0), Y: axis(0, 0) },
							cellSize: { X: axis(0, 100), Y: axis(0, 50) },
							fillDirection: "horizontal",
							fillDirectionMaxCells: 1,
							horizontalAlignment: "left",
							sortOrder: "source",
							startCorner: "top-left",
							verticalAlignment: "top",
						},
					},
				}),
				hostNode("grid-child", "grid-parent", {
					layout: {
						anchorPoint: { x: 0.5, y: 0.5 },
						position: size(0, 20, 0, 15),
						positionMode: "absolute",
						sizeConstraintMode: "RelativeXY",
						size: size(0, 50, 0, 20),
					},
				}),
			],
			{ height: 300, width: 400 },
		);
	});
});
