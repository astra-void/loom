import { normalizePreviewNodeId } from "../internal/robloxValues";
import {
	areNodesEqual,
	createEmptyLayoutResult,
	type PreviewLayoutDebugNode,
	type PreviewLayoutNode,
	type PreviewLayoutResult,
	resolveNodeHostPolicy,
	resolveNodeSize,
} from "./model";

export type LayoutSessionViewport = {
	height: number;
	width: number;
};

export interface LayoutSessionLike {
	applyNodes(nodes: PreviewLayoutNode[]): void;
	computeDirty(): PreviewLayoutResult;
	dispose(): void;
	removeNodes(nodeIds: string[]): void;
	setViewport(viewport: LayoutSessionViewport): void;
}

type LayoutControllerOptions = {
	sessionFactory?: () => LayoutSessionLike;
};

type LayoutCapability =
	| "aspect-ratio-constraint"
	| "flex-item"
	| "grid"
	| "list"
	| "padding"
	| "size-constraint"
	| "text-size-constraint";

const SUPPORTED_WASM_LAYOUT_CAPABILITIES = new Set<LayoutCapability>([
	"aspect-ratio-constraint",
	"flex-item",
	"grid",
	"list",
	"padding",
	"size-constraint",
	"text-size-constraint",
]);

function compareIds(left: string, right: string) {
	return left.localeCompare(right);
}

function cloneViewport(viewport: LayoutSessionViewport): LayoutSessionViewport {
	return {
		height: viewport.height,
		width: viewport.width,
	};
}

function resolveAxisValue(
	axis:
		| {
				offset: number;
				scale: number;
		  }
		| {
				Offset: number;
				Scale: number;
		  },
	parentSize: number,
) {
	return (
		parentSize * ("scale" in axis ? axis.scale : axis.Scale) +
		("offset" in axis ? axis.offset : axis.Offset)
	);
}

function resolveSizeConstraintMode(
	value: unknown,
): "RelativeXX" | "RelativeXY" | "RelativeYY" {
	if (typeof value !== "string") {
		return "RelativeXY";
	}

	switch (value.trim().toLowerCase()) {
		case "relativexx":
			return "RelativeXX";
		case "relativeyy":
			return "RelativeYY";
		default:
			return "RelativeXY";
	}
}

function resolveAxisValueForSizeConstraintMode(
	axis:
		| {
				offset: number;
				scale: number;
		  }
		| {
				Offset: number;
				Scale: number;
		  },
	parentRect: { height: number; width: number; x: number; y: number },
	mode: "RelativeXX" | "RelativeXY" | "RelativeYY",
	isX: boolean,
) {
	const parentSize =
		mode === "RelativeXX"
			? parentRect.width
			: mode === "RelativeYY"
				? parentRect.height
				: isX
					? parentRect.width
					: parentRect.height;

	return resolveAxisValue(axis, parentSize);
}

function applyAnchorPoint(
	x: number,
	y: number,
	width: number,
	height: number,
	anchorX: number,
	anchorY: number,
) {
	return {
		height,
		width,
		x: x - anchorX * width,
		y: y - anchorY * height,
	};
}

function clampValue(value: number, min?: number, max?: number) {
	let next = value;

	if (min !== undefined) {
		next = Math.max(next, min);
	}

	if (max !== undefined) {
		next = Math.min(next, max);
	}

	return next;
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
	rect: { height: number; width: number; x: number; y: number },
	node: PreviewLayoutNode,
) {
	const padding = node.layoutModifiers?.padding;
	if (!padding) {
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

function resolveNodeName(node: PreviewLayoutNode) {
	return node.name ?? node.debugLabel ?? node.id;
}

function compareSourceOrder(left: PreviewLayoutNode, right: PreviewLayoutNode) {
	const leftOrder = left.sourceOrder ?? Number.MAX_SAFE_INTEGER;
	const rightOrder = right.sourceOrder ?? Number.MAX_SAFE_INTEGER;
	if (leftOrder !== rightOrder) {
		return leftOrder - rightOrder;
	}

	return left.id.localeCompare(right.id);
}

function sortNodesForParent(
	parentNode: PreviewLayoutNode,
	childNodes: PreviewLayoutNode[],
) {
	const sortOrder =
		parentNode.layoutModifiers?.list?.sortOrder ??
		parentNode.layoutModifiers?.grid?.sortOrder ??
		"source";

	return [...childNodes].sort((left, right) => {
		switch (sortOrder) {
			case "layout-order": {
				const leftOrder = left.layoutOrder ?? 0;
				const rightOrder = right.layoutOrder ?? 0;
				if (leftOrder !== rightOrder) {
					return leftOrder - rightOrder;
				}
				break;
			}
			case "name": {
				const compared = resolveNodeName(left).localeCompare(
					resolveNodeName(right),
				);
				if (compared !== 0) {
					return compared;
				}
				break;
			}
			default:
				break;
		}

		return compareSourceOrder(left, right);
	});
}

function resolveBaseNodeSize(
	node: PreviewLayoutNode,
	parentRect: { height: number; width: number; x: number; y: number },
) {
	const resolved = resolveNodeSize(node);
	const sizeConstraintMode = resolveSizeConstraintMode(
		(node.layout as { sizeConstraintMode?: unknown }).sizeConstraintMode,
	);
	return {
		height: resolveAxisValueForSizeConstraintMode(
			resolved.resolvedSize.y,
			parentRect,
			sizeConstraintMode,
			false,
		),
		layoutSource: resolved.layoutSource,
		width: resolveAxisValueForSizeConstraintMode(
			resolved.resolvedSize.x,
			parentRect,
			sizeConstraintMode,
			true,
		),
	};
}

function applyNodeDimensionConstraints(
	node: PreviewLayoutNode,
	width: number,
	height: number,
) {
	let nextWidth = clampValue(
		width,
		node.layout.constraints?.width?.min,
		node.layout.constraints?.width?.max,
	);
	let nextHeight = clampValue(
		height,
		node.layout.constraints?.height?.min,
		node.layout.constraints?.height?.max,
	);

	const sizeConstraint = node.layoutModifiers?.sizeConstraint;
	if (sizeConstraint?.minSize) {
		nextWidth = Math.max(nextWidth, sizeConstraint.minSize.X);
		nextHeight = Math.max(nextHeight, sizeConstraint.minSize.Y);
	}
	if (sizeConstraint?.maxSize) {
		nextWidth = Math.min(nextWidth, sizeConstraint.maxSize.X);
		nextHeight = Math.min(nextHeight, sizeConstraint.maxSize.Y);
	}

	return {
		height: Math.max(0, nextHeight),
		width: Math.max(0, nextWidth),
	};
}

function applyAspectRatioConstraint(
	node: PreviewLayoutNode,
	width: number,
	height: number,
	dominantAxisHint?: "height" | "width",
) {
	const constraint = node.layoutModifiers?.aspectRatioConstraint;
	if (!constraint || constraint.aspectRatio <= 0) {
		return { height, width };
	}

	const dominantAxis =
		dominantAxisHint ??
		(constraint.dominantAxis === "height" || constraint.dominantAxis === "width"
			? constraint.dominantAxis
			: width > 0 && height <= 0
				? "width"
				: height > 0 && width <= 0
					? "height"
					: "width");

	if (dominantAxis === "height") {
		return {
			height,
			width: height * constraint.aspectRatio,
		};
	}

	return {
		height:
			constraint.aspectRatio === 0 ? height : width / constraint.aspectRatio,
		width,
	};
}

function resolveNodeDimensions(
	node: PreviewLayoutNode,
	parentRect: { height: number; width: number; x: number; y: number },
	overrides: {
		dominantAxis?: "height" | "width";
		height?: number;
		width?: number;
	} = {},
) {
	const base = resolveBaseNodeSize(node, parentRect);
	let width = overrides.width ?? base.width;
	let height = overrides.height ?? base.height;

	({ height, width } = applyNodeDimensionConstraints(node, width, height));
	({ height, width } = applyAspectRatioConstraint(
		node,
		width,
		height,
		overrides.dominantAxis,
	));
	({ height, width } = applyNodeDimensionConstraints(node, width, height));

	return {
		height,
		layoutSource: base.layoutSource,
		width,
	};
}

function computeAbsoluteRect(
	node: PreviewLayoutNode,
	parentRect: { height: number; width: number; x: number; y: number },
) {
	if (node.kind === "root") {
		return {
			height: parentRect.height,
			width: parentRect.width,
			x: 0,
			y: 0,
		};
	}

	const dimensions = resolveNodeDimensions(node, parentRect);
	return {
		height: dimensions.height,
		width: dimensions.width,
		x:
			parentRect.x +
			resolveAxisValue(node.layout.position.x, parentRect.width) -
			node.layout.anchorPoint.x * dimensions.width,
		y:
			parentRect.y +
			resolveAxisValue(node.layout.position.y, parentRect.height) -
			node.layout.anchorPoint.y * dimensions.height,
	};
}

function alignStart(
	alignment: "bottom" | "center" | "top" | "left" | "right",
	availableSpace: number,
) {
	if (alignment === "center") {
		return availableSpace / 2;
	}

	if (alignment === "bottom" || alignment === "right") {
		return availableSpace;
	}

	return 0;
}

function advanceMainCursor(cursor: number, itemMain: number, gap: number) {
	return cursor + itemMain + gap;
}

function buildDebugNodeMap(
	nodes: PreviewLayoutDebugNode[],
	map = new Map<string, PreviewLayoutDebugNode>(),
): Map<string, PreviewLayoutDebugNode> {
	for (const node of nodes) {
		map.set(node.id, node);
		buildDebugNodeMap(node.children, map);
	}

	return map;
}

function getNodeLayoutCapabilities(
	node: PreviewLayoutNode,
): LayoutCapability[] {
	const capabilities: LayoutCapability[] = [];
	if (node.layoutModifiers?.aspectRatioConstraint) {
		capabilities.push("aspect-ratio-constraint");
	}
	if (node.layoutModifiers?.flexItem) {
		capabilities.push("flex-item");
	}
	if (node.layoutModifiers?.grid) {
		capabilities.push("grid");
	}
	if (node.layoutModifiers?.list) {
		capabilities.push("list");
	}
	if (node.layoutModifiers?.padding) {
		capabilities.push("padding");
	}
	if (node.layoutModifiers?.sizeConstraint) {
		capabilities.push("size-constraint");
	}
	if (node.layoutModifiers?.textSizeConstraint) {
		capabilities.push("text-size-constraint");
	}
	return capabilities;
}

export class LayoutController {
	private readonly childIdsByParent = new Map<string, string[]>();
	private readonly dirtyNodeIds = new Set<string>();
	private readonly dirtyRootIds = new Set<string>();
	private readonly nodes = new Map<string, PreviewLayoutNode>();
	private debugNodesById = new Map<string, PreviewLayoutDebugNode>();
	private pendingRemovedIds = new Set<string>();
	private result: PreviewLayoutResult = createEmptyLayoutResult({
		height: 0,
		width: 0,
	});
	private rootIds: string[] = [];
	private session: LayoutSessionLike | null = null;
	private viewport: LayoutSessionViewport = {
		height: 0,
		width: 0,
	};

	public constructor(private readonly options: LayoutControllerOptions = {}) {}

	public compute(): PreviewLayoutResult {
		let nextResult: PreviewLayoutResult;
		try {
			nextResult = this.computeWithSession();
		} catch {
			nextResult = this.computeFallback();
		}
		this.result = nextResult;
		this.debugNodesById = buildDebugNodeMap(nextResult.debug.roots);
		this.dirtyNodeIds.clear();
		this.dirtyRootIds.clear();
		this.pendingRemovedIds.clear();
		return nextResult;
	}

	public dispose() {
		this.session?.dispose();
		this.session = null;
		this.childIdsByParent.clear();
		this.debugNodesById.clear();
		this.dirtyNodeIds.clear();
		this.dirtyRootIds.clear();
		this.nodes.clear();
		this.pendingRemovedIds.clear();
		this.result = createEmptyLayoutResult({ height: 0, width: 0 });
		this.rootIds = [];
	}

	public getDebugNode(nodeId: string): PreviewLayoutDebugNode | null {
		const normalizedNodeId = normalizePreviewNodeId(nodeId) ?? nodeId;
		return this.debugNodesById.get(normalizedNodeId) ?? null;
	}

	public getRect(nodeId: string) {
		const normalizedNodeId = normalizePreviewNodeId(nodeId) ?? nodeId;
		return this.result.rects[normalizedNodeId] ?? null;
	}

	public hasNodes() {
		return this.nodes.size > 0;
	}

	public removeNode(nodeId: string): boolean {
		const normalizedNodeId = normalizePreviewNodeId(nodeId) ?? nodeId;
		const existingNode = this.nodes.get(normalizedNodeId);
		if (!existingNode) {
			return false;
		}

		const affectedIds = this.collectSubtreeIds(normalizedNodeId);
		this.markDirtyFromNode(normalizedNodeId);
		for (const affectedId of affectedIds) {
			this.nodes.delete(affectedId);
			this.dirtyNodeIds.add(affectedId);
			this.pendingRemovedIds.add(affectedId);
		}

		this.rebuildRelationships();
		this.session?.removeNodes(affectedIds);
		return true;
	}

	public setViewport(viewport: LayoutSessionViewport): boolean {
		if (
			this.viewport.width === viewport.width &&
			this.viewport.height === viewport.height
		) {
			return false;
		}

		this.viewport = cloneViewport(viewport);
		this.session?.setViewport(viewport);
		for (const rootId of this.rootIds) {
			this.dirtyRootIds.add(rootId);
		}
		for (const nodeId of this.nodes.keys()) {
			this.dirtyNodeIds.add(nodeId);
		}
		return true;
	}

	public upsertNode(node: PreviewLayoutNode): boolean {
		const previousNode = this.nodes.get(node.id);
		if (previousNode && areNodesEqual(previousNode, node)) {
			return false;
		}

		if (previousNode) {
			this.markDirtyFromNode(previousNode.id);
			if (previousNode.parentId && previousNode.parentId !== node.parentId) {
				this.markDirtyFromNode(previousNode.parentId);
			}
		}

		this.nodes.set(node.id, node);
		this.rebuildRelationships();
		this.markDirtyFromNode(node.id);
		this.dirtyNodeIds.add(node.id);
		this.session?.applyNodes([node]);
		return true;
	}

	private buildDebugTree(
		nodeId: string,
		parentConstraints: {
			height: number;
			width: number;
			x: number;
			y: number;
		} | null,
		provenance: "fallback" | "wasm",
	): PreviewLayoutDebugNode | null {
		const node = this.nodes.get(nodeId);
		if (!node) {
			return null;
		}

		const rect = this.result.rects[nodeId] ?? null;
		const childIds = this.childIdsByParent.get(nodeId) ?? [];
		const sizeResolution = resolveNodeSize(node);

		return {
			children: childIds
				.map((childId) => this.buildDebugTree(childId, rect, provenance))
				.filter((child): child is PreviewLayoutDebugNode => child !== null),
			debugLabel: node.debugLabel,
			hostPolicy: resolveNodeHostPolicy(node),
			id: node.id,
			intrinsicSize: node.intrinsicSize ?? null,
			kind: node.kind,
			layoutSource: sizeResolution.layoutSource,
			nodeType: node.nodeType,
			parentConstraints,
			parentId: node.parentId,
			provenance: {
				detail:
					provenance === "wasm"
						? "computed by layout-engine session"
						: "computed by preview-runtime fallback solver",
				source: provenance,
			},
			rect,
			sizeResolution: sizeResolution.sizeResolution,
			styleHints: node.styleHints,
		};
	}

	private collectSubtreeIds(
		nodeId: string,
		visited = new Set<string>(),
	): string[] {
		if (visited.has(nodeId)) {
			return [];
		}

		visited.add(nodeId);
		const childIds = this.childIdsByParent.get(nodeId) ?? [];
		const descendants = childIds.flatMap((childId) =>
			this.collectSubtreeIds(childId, visited),
		);
		return [nodeId, ...descendants];
	}

	private computeFallbackSubtreeFromRect(
		nodeId: string,
		rect: { height: number; width: number; x: number; y: number },
		output: Record<
			string,
			{ height: number; width: number; x: number; y: number }
		>,
	) {
		const node = this.nodes.get(nodeId);
		if (!node) {
			return;
		}

		output[node.id] = rect;

		const childIds = this.childIdsByParent.get(nodeId) ?? [];
		if (childIds.length === 0) {
			return;
		}

		const contentRect = resolveContentRect(rect, node);
		const childNodes = sortNodesForParent(
			node,
			childIds
				.map((childId) => this.nodes.get(childId))
				.filter((child): child is PreviewLayoutNode => child !== undefined),
		);

		if (node.layoutModifiers?.grid) {
			this.computeGridChildren(node, contentRect, childNodes, output);
			return;
		}

		if (node.layoutModifiers?.list) {
			this.computeListChildren(node, contentRect, childNodes, output);
			return;
		}

		for (const childNode of childNodes) {
			this.computeFallbackSubtree(childNode.id, contentRect, output);
		}
	}

	private computeGridChildren(
		parentNode: PreviewLayoutNode,
		contentRect: { height: number; width: number; x: number; y: number },
		childNodes: PreviewLayoutNode[],
		output: Record<
			string,
			{ height: number; width: number; x: number; y: number }
		>,
	) {
		const grid = parentNode.layoutModifiers?.grid;
		if (!grid || childNodes.length === 0) {
			return;
		}

		const cellWidth = resolveAxisValue(grid.cellSize.X, contentRect.width);
		const cellHeight = resolveAxisValue(grid.cellSize.Y, contentRect.height);
		const gapX = resolveAxisValue(grid.cellPadding.X, contentRect.width);
		const gapY = resolveAxisValue(grid.cellPadding.Y, contentRect.height);

		const columns =
			grid.fillDirection === "horizontal"
				? Math.max(
						1,
						grid.fillDirectionMaxCells && grid.fillDirectionMaxCells > 0
							? grid.fillDirectionMaxCells
							: Math.floor(
									(contentRect.width + gapX) / Math.max(1, cellWidth + gapX),
								),
					)
				: Math.max(
						1,
						Math.ceil(
							childNodes.length /
								Math.max(
									1,
									grid.fillDirectionMaxCells && grid.fillDirectionMaxCells > 0
										? grid.fillDirectionMaxCells
										: Math.floor(
												(contentRect.height + gapY) /
													Math.max(1, cellHeight + gapY),
											),
								),
						),
					);
		const rows =
			grid.fillDirection === "horizontal"
				? Math.max(1, Math.ceil(childNodes.length / columns))
				: Math.max(
						1,
						grid.fillDirectionMaxCells && grid.fillDirectionMaxCells > 0
							? grid.fillDirectionMaxCells
							: Math.floor(
									(contentRect.height + gapY) / Math.max(1, cellHeight + gapY),
								),
					);
		const gridWidth = columns * cellWidth + Math.max(0, columns - 1) * gapX;
		const gridHeight = rows * cellHeight + Math.max(0, rows - 1) * gapY;
		const startX =
			contentRect.x +
			alignStart(
				grid.horizontalAlignment,
				Math.max(0, contentRect.width - gridWidth),
			);
		const startY =
			contentRect.y +
			alignStart(
				grid.verticalAlignment,
				Math.max(0, contentRect.height - gridHeight),
			);
		const invertColumns =
			grid.startCorner === "top-right" || grid.startCorner === "bottom-right";
		const invertRows =
			grid.startCorner === "bottom-left" || grid.startCorner === "bottom-right";

		for (const [index, childNode] of childNodes.entries()) {
			const rawColumn =
				grid.fillDirection === "horizontal"
					? index % columns
					: Math.floor(index / rows);
			const rawRow =
				grid.fillDirection === "horizontal"
					? Math.floor(index / columns)
					: index % rows;
			const column = invertColumns ? columns - rawColumn - 1 : rawColumn;
			const row = invertRows ? rows - rawRow - 1 : rawRow;
			const cellX = startX + column * (cellWidth + gapX);
			const cellY = startY + row * (cellHeight + gapY);
			const dimensions = resolveNodeDimensions(
				childNode,
				{
					height: cellHeight,
					width: cellWidth,
					x: cellX,
					y: cellY,
				},
				{
					height: cellHeight,
					width: cellWidth,
				},
			);

			this.computeFallbackSubtreeFromRect(
				childNode.id,
				applyAnchorPoint(
					cellX + Math.max(0, (cellWidth - dimensions.width) / 2),
					cellY + Math.max(0, (cellHeight - dimensions.height) / 2),
					dimensions.width,
					dimensions.height,
					childNode.layout.anchorPoint.x,
					childNode.layout.anchorPoint.y,
				),
				output,
			);
		}
	}

	private computeListChildren(
		parentNode: PreviewLayoutNode,
		contentRect: { height: number; width: number; x: number; y: number },
		childNodes: PreviewLayoutNode[],
		output: Record<
			string,
			{ height: number; width: number; x: number; y: number }
		>,
	) {
		const list = parentNode.layoutModifiers?.list;
		if (!list || childNodes.length === 0) {
			return;
		}

		const horizontal = list.fillDirection === "horizontal";
		const gap = resolvePaddingInset(
			list.padding,
			horizontal ? contentRect.width : contentRect.height,
		);
		const mainAxisSize = horizontal ? contentRect.width : contentRect.height;
		const crossAxisSize = horizontal ? contentRect.height : contentRect.width;
		const mainAxisFlex = horizontal ? list.horizontalFlex : list.verticalFlex;
		const crossAxisFlex = horizontal ? list.verticalFlex : list.horizontalFlex;
		const mainAxisAlignment = horizontal
			? list.horizontalAlignment
			: list.verticalAlignment;
		const crossAxisAlignment = horizontal
			? list.verticalAlignment
			: list.horizontalAlignment;
		const items = childNodes.map((childNode) => {
			const dimensions = resolveNodeDimensions(
				childNode,
				contentRect,
				crossAxisFlex === "fill"
					? horizontal
						? { height: crossAxisSize, dominantAxis: "height" as const }
						: { width: crossAxisSize, dominantAxis: "width" as const }
					: {},
			);
			const flexItem = childNode.layoutModifiers?.flexItem;
			return {
				childNode,
				cross: horizontal ? dimensions.height : dimensions.width,
				flexItem,
				main: horizontal ? dimensions.width : dimensions.height,
			};
		});

		const lines: Array<typeof items> = [];
		let currentLine: typeof items = [];
		let currentMain = 0;
		for (const item of items) {
			const projectedMain =
				currentLine.length === 0 ? item.main : currentMain + gap + item.main;
			if (
				list.wraps &&
				currentLine.length > 0 &&
				projectedMain > mainAxisSize
			) {
				lines.push(currentLine);
				currentLine = [item];
				currentMain = item.main;
				continue;
			}

			currentLine.push(item);
			currentMain = projectedMain;
		}
		if (currentLine.length > 0) {
			lines.push(currentLine);
		}

		const lineMetrics = lines.map((line) => {
			const lineMain =
				line.reduce((sum, item) => sum + item.main, 0) +
				Math.max(0, line.length - 1) * gap;
			const lineCross = line.reduce(
				(maximum, item) => Math.max(maximum, item.cross),
				0,
			);
			return { lineCross, lineMain };
		});
		const totalCross =
			lineMetrics.reduce((sum, metric) => sum + metric.lineCross, 0) +
			Math.max(0, lineMetrics.length - 1) * gap;
		let crossCursor =
			(horizontal ? contentRect.y : contentRect.x) +
			(list.wraps
				? alignStart(
						crossAxisAlignment,
						Math.max(0, crossAxisSize - totalCross),
					)
				: 0);

		for (const [lineIndex, line] of lines.entries()) {
			const metric = lineMetrics[lineIndex];
			if (!metric) {
				continue;
			}

			const remainingMain = mainAxisSize - metric.lineMain;
			if (mainAxisFlex === "fill" && remainingMain !== 0) {
				const grow = remainingMain > 0;
				const eligible = line.filter(({ flexItem }) => {
					const mode = flexItem?.flexMode ?? "fill";
					return grow
						? mode === "fill" || mode === "grow"
						: mode === "fill" || mode === "shrink";
				});
				const totalWeight = eligible.reduce((sum, { flexItem }) => {
					const ratio = grow
						? (flexItem?.growRatio ?? 1)
						: (flexItem?.shrinkRatio ?? 1);
					return sum + Math.max(0, ratio);
				}, 0);
				if (totalWeight > 0) {
					for (const item of eligible) {
						const ratio = grow
							? (item.flexItem?.growRatio ?? 1)
							: (item.flexItem?.shrinkRatio ?? 1);
						item.main = Math.max(
							0,
							item.main + (remainingMain * Math.max(0, ratio)) / totalWeight,
						);
					}
				}
			}

			const usedMain =
				line.reduce((sum, item) => sum + item.main, 0) +
				Math.max(0, line.length - 1) * gap;
			let mainCursor =
				(horizontal ? contentRect.x : contentRect.y) +
				alignStart(mainAxisAlignment, Math.max(0, mainAxisSize - usedMain));

			for (const item of line) {
				let resolvedCross = item.cross;
				const lineAlignment =
					item.flexItem?.itemLineAlignment ?? list.itemLineAlignment ?? "start";
				if (lineAlignment === "stretch") {
					resolvedCross = metric.lineCross;
				}

				const crossOffset = list.wraps
					? alignStart(
							lineAlignment === "end"
								? horizontal
									? "bottom"
									: "right"
								: lineAlignment === "center"
									? "center"
									: "top",
							Math.max(0, metric.lineCross - resolvedCross),
						)
					: alignStart(
							crossAxisAlignment,
							Math.max(0, crossAxisSize - resolvedCross),
						);
				const width = horizontal ? item.main : resolvedCross;
				const height = horizontal ? resolvedCross : item.main;
				const x = horizontal ? mainCursor : crossCursor + crossOffset;
				const y = horizontal ? crossCursor + crossOffset : mainCursor;

				this.computeFallbackSubtreeFromRect(
					item.childNode.id,
					applyAnchorPoint(
						x,
						y,
						width,
						height,
						item.childNode.layout.anchorPoint.x,
						item.childNode.layout.anchorPoint.y,
					),
					output,
				);

				mainCursor = advanceMainCursor(mainCursor, item.main, gap);
			}

			crossCursor += metric.lineCross + gap;
		}
	}

	private computeFallbackSubtree(
		nodeId: string,
		parentRect: { height: number; width: number; x: number; y: number },
		output: Record<
			string,
			{ height: number; width: number; x: number; y: number }
		>,
	) {
		const node = this.nodes.get(nodeId);
		if (!node) {
			return;
		}

		this.computeFallbackSubtreeFromRect(
			nodeId,
			computeAbsoluteRect(node, parentRect),
			output,
		);
	}

	private computeFallback(): PreviewLayoutResult {
		const viewport = cloneViewport(this.viewport);
		const viewportRect = {
			height: viewport.height,
			width: viewport.width,
			x: 0,
			y: 0,
		};
		const rects: Record<
			string,
			{ height: number; width: number; x: number; y: number }
		> = {};
		const dirtyNodeIds = [...this.dirtyNodeIds].sort(compareIds);

		this.result = {
			debug: {
				dirtyNodeIds,
				roots: [],
				viewport,
			},
			dirtyNodeIds,
			rects,
		};

		for (const rootId of this.rootIds) {
			this.computeFallbackSubtree(rootId, viewportRect, rects);
		}

		const roots = this.rootIds
			.map((rootId) => this.buildDebugTree(rootId, viewportRect, "fallback"))
			.filter((root): root is PreviewLayoutDebugNode => root !== null);
		const nextResult: PreviewLayoutResult = {
			debug: {
				dirtyNodeIds,
				roots,
				viewport,
			},
			dirtyNodeIds,
			rects,
		};

		this.result = nextResult;
		return nextResult;
	}

	private computeWithSession(): PreviewLayoutResult {
		const unsupportedLayoutCapabilities =
			this.collectUnsupportedLayoutCapabilities();
		if (unsupportedLayoutCapabilities.length > 0) {
			throw new Error(
				`WASM layout engine does not support these layout capabilities: ${unsupportedLayoutCapabilities.join(", ")}.`,
			);
		}

		const session = this.getOrCreateSession();
		const nextResult = session.computeDirty();
		return {
			...nextResult,
			debug: {
				...nextResult.debug,
				dirtyNodeIds: [...nextResult.dirtyNodeIds].sort(compareIds),
				roots: nextResult.debug.roots,
				viewport: cloneViewport(this.viewport),
			},
			dirtyNodeIds: [...nextResult.dirtyNodeIds].sort(compareIds),
			rects: nextResult.rects,
		};
	}

	private getOrCreateSession() {
		if (!this.session) {
			const nextSession = this.options.sessionFactory?.();
			if (!nextSession) {
				throw new Error("Layout session factory did not return a session.");
			}

			this.session = nextSession;
			this.session.setViewport(this.viewport);
			if (this.nodes.size > 0) {
				this.session.applyNodes([...this.nodes.values()]);
			}
		}

		return this.session;
	}

	private markDirtyFromNode(nodeId: string) {
		const rootId = this.resolveRootId(nodeId);
		if (rootId) {
			this.dirtyRootIds.add(rootId);
		}
	}

	private rebuildRelationships() {
		this.childIdsByParent.clear();

		for (const node of this.nodes.values()) {
			if (!node.parentId) {
				continue;
			}

			const existing = this.childIdsByParent.get(node.parentId) ?? [];
			if (!existing.includes(node.id)) {
				existing.push(node.id);
				existing.sort((leftId, rightId) => {
					const leftNode = this.nodes.get(leftId);
					const rightNode = this.nodes.get(rightId);
					if (leftNode && rightNode) {
						return compareSourceOrder(leftNode, rightNode);
					}

					return leftId.localeCompare(rightId);
				});
				this.childIdsByParent.set(node.parentId, existing);
			}
		}

		this.rootIds = [...this.nodes.values()]
			.filter((node) => !node.parentId || !this.nodes.has(node.parentId))
			.map((node) => node.id)
			.sort((leftId, rightId) => {
				const leftNode = this.nodes.get(leftId);
				const rightNode = this.nodes.get(rightId);
				if (leftNode && rightNode) {
					return compareSourceOrder(leftNode, rightNode);
				}

				return leftId.localeCompare(rightId);
			});
	}

	private collectUnsupportedLayoutCapabilities() {
		const unsupportedLayoutCapabilities = new Set<string>();

		for (const node of this.nodes.values()) {
			for (const capability of getNodeLayoutCapabilities(node)) {
				if (!SUPPORTED_WASM_LAYOUT_CAPABILITIES.has(capability)) {
					unsupportedLayoutCapabilities.add(capability);
				}
			}
		}

		return [...unsupportedLayoutCapabilities].sort(compareIds);
	}

	private resolveRootId(nodeId: string) {
		let cursor: string | undefined = nodeId;
		let lastKnownId: string | undefined;
		const visited = new Set<string>();

		while (cursor) {
			if (visited.has(cursor)) {
				return lastKnownId ?? cursor;
			}

			visited.add(cursor);
			const node = this.nodes.get(cursor);
			if (!node) {
				return lastKnownId;
			}

			lastKnownId = node.id;
			cursor =
				node.parentId && this.nodes.has(node.parentId)
					? node.parentId
					: undefined;
		}

		return lastKnownId;
	}
}
