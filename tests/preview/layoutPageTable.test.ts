// @vitest-environment node

import { describe, expect, it } from "vitest";
import { LayoutController } from "../../packages/preview-runtime/src/layout/controller";
import type { PreviewLayoutNode } from "../../packages/preview-runtime/src/layout/model";

function axis(scale: number, offset: number) {
	return { offset, scale };
}

// SerializedUDim shape (capitalised) used by padding insets.
function udim(scale: number, offset: number) {
	return { Offset: offset, Scale: scale };
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

function roundRect(rect: {
	height: number;
	width: number;
	x: number;
	y: number;
}) {
	return {
		height: Number(rect.height.toFixed(5)),
		width: Number(rect.width.toFixed(5)),
		x: Number(rect.x.toFixed(5)),
		y: Number(rect.y.toFixed(5)),
	};
}

function computeFallbackRects(
	nodes: PreviewLayoutNode[],
	viewport: { height: number; width: number },
) {
	const controller = new LayoutController();
	for (const node of nodes) {
		controller.upsertNode(node);
	}
	controller.setViewport(viewport);
	// isReady:false forces the pure-TS fallback path, where UIPageLayout and
	// UITableLayout are implemented (they are intentionally unsupported by WASM).
	const result = controller.compute({ isReady: false });
	return Object.fromEntries(
		Object.entries(result.rects).map(([id, rect]) => [id, roundRect(rect)]),
	);
}

describe("UIPageLayout fallback layout", () => {
	it("stacks full-size pages along the fill direction with padding", () => {
		const rects = computeFallbackRects(
			[
				rootNode("screen"),
				hostNode("frame", "screen", {
					layout: { size: size(0, 300, 0, 200) },
					layoutModifiers: {
						page: {
							fillDirection: "horizontal",
							horizontalAlignment: "left",
							padding: { Offset: 10, Scale: 0 },
							sortOrder: "source",
							verticalAlignment: "top",
						},
					},
				}),
				hostNode("pageA", "frame", { sourceOrder: 0 }),
				hostNode("pageB", "frame", { sourceOrder: 1 }),
				hostNode("pageC", "frame", { sourceOrder: 2 }),
			],
			{ height: 200, width: 300 },
		);

		expect(rects.pageA).toEqual({ height: 200, width: 300, x: 0, y: 0 });
		expect(rects.pageB).toEqual({ height: 200, width: 300, x: 310, y: 0 });
		expect(rects.pageC).toEqual({ height: 200, width: 300, x: 620, y: 0 });
	});

	it("stacks vertically when fill direction is vertical", () => {
		const rects = computeFallbackRects(
			[
				rootNode("screen"),
				hostNode("frame", "screen", {
					layout: { size: size(0, 300, 0, 200) },
					layoutModifiers: {
						page: {
							fillDirection: "vertical",
							horizontalAlignment: "left",
							padding: { Offset: 0, Scale: 0 },
							sortOrder: "source",
							verticalAlignment: "top",
						},
					},
				}),
				hostNode("pageA", "frame", { sourceOrder: 0 }),
				hostNode("pageB", "frame", { sourceOrder: 1 }),
			],
			{ height: 200, width: 300 },
		);

		expect(rects.pageA).toEqual({ height: 200, width: 300, x: 0, y: 0 });
		expect(rects.pageB).toEqual({ height: 200, width: 300, x: 0, y: 200 });
	});
});

describe("UITableLayout fallback layout", () => {
	const tableNodes: PreviewLayoutNode[] = [
		rootNode("screen"),
		hostNode("frame", "screen", {
			layout: { size: size(0, 300, 0, 200) },
			layoutModifiers: {
				table: {
					fillEmptySpaceColumns: false,
					fillEmptySpaceRows: false,
					horizontalAlignment: "left",
					padding: { X: udim(0, 10), Y: udim(0, 5) },
					sortOrder: "source",
					verticalAlignment: "top",
				},
			},
		}),
		hostNode("row1", "frame", { sourceOrder: 0 }),
		hostNode("row2", "frame", { sourceOrder: 1 }),
		hostNode("c11", "row1", {
			sourceOrder: 0,
			layout: { size: size(0, 50, 0, 30) },
		}),
		hostNode("c12", "row1", {
			sourceOrder: 1,
			layout: { size: size(0, 80, 0, 20) },
		}),
		hostNode("c21", "row2", {
			sourceOrder: 0,
			layout: { size: size(0, 40, 0, 25) },
		}),
		hostNode("c22", "row2", {
			sourceOrder: 1,
			layout: { size: size(0, 60, 0, 40) },
		}),
	];

	it("sizes columns to the widest cell and rows to the tallest cell", () => {
		const rects = computeFallbackRects(tableNodes, { height: 200, width: 300 });

		// Column widths: max(50,40)=50, max(80,60)=80. Row heights: 30 then 40.
		// Row 0 cells.
		expect(rects.c11).toEqual({ height: 30, width: 50, x: 0, y: 0 });
		expect(rects.c12).toEqual({ height: 30, width: 80, x: 60, y: 0 });
		// Row 1 cells, offset down by row0 height (30) + Y padding (5) = 35.
		expect(rects.c21).toEqual({ height: 40, width: 50, x: 0, y: 35 });
		expect(rects.c22).toEqual({ height: 40, width: 80, x: 60, y: 35 });
		// Row bands span the full table width (50 + 10 + 80 = 140).
		expect(rects.row1).toEqual({ height: 30, width: 140, x: 0, y: 0 });
		expect(rects.row2).toEqual({ height: 40, width: 140, x: 0, y: 35 });
	});

	it("expands columns to fill empty space when requested", () => {
		const nodes = tableNodes.map((node) =>
			node.id === "frame"
				? {
						...node,
						layoutModifiers: {
							table: {
								fillEmptySpaceColumns: true,
								fillEmptySpaceRows: false,
								horizontalAlignment: "left" as const,
								padding: { X: udim(0, 10), Y: udim(0, 5) },
								sortOrder: "source" as const,
								verticalAlignment: "top" as const,
							},
						},
					}
				: node,
		);

		const rects = computeFallbackRects(nodes, { height: 200, width: 300 });

		// Natural table width = 140; leftover 160 split across 2 columns (+80 each).
		// Column widths become 130 and 160.
		expect(rects.c11.width).toBe(130);
		expect(rects.c12.width).toBe(160);
		expect(rects.c12.x).toBe(140);
		expect(rects.c21.width).toBe(130);
		expect(rects.c22.width).toBe(160);
	});
});
