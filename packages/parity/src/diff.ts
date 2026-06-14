import type {
	ParityColor3,
	ParityFieldDiff,
	ParityNode,
	ParityNodeDiff,
	ParityReport,
	ParitySeverity,
	ParitySnapshot,
	ParityTolerance,
	ParityVisualProps,
} from "./types";

export const DEFAULT_TOLERANCE: ParityTolerance = {
	positionPx: 0.5,
	sizePx: 0.5,
	rotationDeg: 0.5,
	// Roughly one 8-bit colour step, doubled to absorb sRGB rounding both ways.
	color: 2 / 255,
	transparency: 0.01,
};

export interface DiffOptions {
	tolerance?: Partial<ParityTolerance>;
	/**
	 * Threshold (px) above which a position/size divergence is escalated from
	 * "medium" to "high". Defaults to 8px or 16x the axis tolerance, whichever
	 * is larger.
	 */
	highDeltaPx?: number;
}

const SEVERITY_RANK: Record<ParitySeverity, number> = {
	low: 0,
	medium: 1,
	high: 2,
};

function maxSeverity(
	a: ParitySeverity | null,
	b: ParitySeverity | null,
): ParitySeverity | null {
	if (a === null) {
		return b;
	}
	if (b === null) {
		return a;
	}
	return SEVERITY_RANK[a] >= SEVERITY_RANK[b] ? a : b;
}

/**
 * Flatten a tree into a map keyed by a stable, disambiguated Name path so the
 * two sides can be matched position-for-position. Sibling instances that share
 * a Name (legal in Roblox) get a `[index]` suffix assigned in child order, so
 * both sides agree as long as their child ordering agrees.
 */
function buildKeyedMap(roots: ParityNode[]): Map<string, ParityNode> {
	const map = new Map<string, ParityNode>();

	const visit = (nodes: ParityNode[], parentKey: string) => {
		const total = new Map<string, number>();
		for (const node of nodes) {
			total.set(node.name, (total.get(node.name) ?? 0) + 1);
		}

		const seen = new Map<string, number>();
		for (const node of nodes) {
			const duplicated = (total.get(node.name) ?? 0) > 1;
			let key: string;
			if (duplicated) {
				const index = seen.get(node.name) ?? 0;
				seen.set(node.name, index + 1);
				key = `${parentKey}/${node.name}[${index}]`;
			} else {
				key = `${parentKey}/${node.name}`;
			}
			map.set(key, node);
			visit(node.children, key);
		}
	};

	visit(roots, "");
	return map;
}

function axisDelta(a: number, b: number): number {
	return Math.abs(a - b);
}

function colorChannelDelta(a: ParityColor3, b: ParityColor3): number {
	return Math.max(
		Math.abs(a.r - b.r),
		Math.abs(a.g - b.g),
		Math.abs(a.b - b.b),
	);
}

function positionSeverity(delta: number, highDeltaPx: number): ParitySeverity {
	return delta >= highDeltaPx ? "high" : "medium";
}

function pushVec2Diff(
	fields: ParityFieldDiff[],
	field: string,
	loom: { x: number; y: number },
	roblox: { x: number; y: number },
	tolerance: number,
	highDeltaPx: number,
): void {
	const dx = axisDelta(loom.x, roblox.x);
	const dy = axisDelta(loom.y, roblox.y);
	const delta = Math.max(dx, dy);
	if (delta > tolerance) {
		fields.push({
			field,
			loom,
			roblox,
			delta,
			severity: positionSeverity(delta, highDeltaPx),
		});
	}
}

function pushColorDiff(
	fields: ParityFieldDiff[],
	field: string,
	loom: ParityColor3 | undefined,
	roblox: ParityColor3 | undefined,
	tolerance: number,
): void {
	if (loom === undefined || roblox === undefined) {
		return;
	}
	const delta = colorChannelDelta(loom, roblox);
	if (delta > tolerance) {
		fields.push({ field, loom, roblox, delta, severity: "medium" });
	}
}

function pushScalarDiff(
	fields: ParityFieldDiff[],
	field: string,
	loom: number | undefined,
	roblox: number | undefined,
	tolerance: number,
	severity: ParitySeverity = "medium",
): void {
	if (loom === undefined || roblox === undefined) {
		return;
	}
	const delta = Math.abs(loom - roblox);
	if (delta > tolerance) {
		fields.push({ field, loom, roblox, delta, severity });
	}
}

function compareVisual(
	fields: ParityFieldDiff[],
	loom: ParityVisualProps | undefined,
	roblox: ParityVisualProps | undefined,
	tol: ParityTolerance,
): void {
	if (!loom || !roblox) {
		return;
	}

	pushColorDiff(
		fields,
		"backgroundColor3",
		loom.backgroundColor3,
		roblox.backgroundColor3,
		tol.color,
	);
	pushColorDiff(
		fields,
		"imageColor3",
		loom.imageColor3,
		roblox.imageColor3,
		tol.color,
	);
	pushColorDiff(
		fields,
		"textColor3",
		loom.textColor3,
		roblox.textColor3,
		tol.color,
	);
	pushScalarDiff(
		fields,
		"backgroundTransparency",
		loom.backgroundTransparency,
		roblox.backgroundTransparency,
		tol.transparency,
	);
	pushScalarDiff(
		fields,
		"imageTransparency",
		loom.imageTransparency,
		roblox.imageTransparency,
		tol.transparency,
	);
	pushScalarDiff(
		fields,
		"textTransparency",
		loom.textTransparency,
		roblox.textTransparency,
		tol.transparency,
	);
	pushScalarDiff(
		fields,
		"rotation",
		loom.rotation,
		roblox.rotation,
		tol.rotationDeg,
	);

	if (
		loom.text !== undefined &&
		roblox.text !== undefined &&
		loom.text !== roblox.text
	) {
		fields.push({
			field: "text",
			loom: loom.text,
			roblox: roblox.text,
			severity: "medium",
		});
	}

	if (
		loom.visible !== undefined &&
		roblox.visible !== undefined &&
		loom.visible !== roblox.visible
	) {
		// Shown-vs-hidden is one of the most visible possible divergences.
		fields.push({
			field: "visible",
			loom: loom.visible,
			roblox: roblox.visible,
			severity: "high",
		});
	}
}

function compareMatchedNode(
	loom: ParityNode,
	roblox: ParityNode,
	tol: ParityTolerance,
	highDeltaPx: number,
): ParityFieldDiff[] {
	const fields: ParityFieldDiff[] = [];

	if (loom.className !== roblox.className) {
		fields.push({
			field: "className",
			loom: loom.className,
			roblox: roblox.className,
			severity: "high",
		});
	}

	pushVec2Diff(
		fields,
		"absolutePosition",
		loom.absolutePosition,
		roblox.absolutePosition,
		tol.positionPx,
		highDeltaPx,
	);
	pushVec2Diff(
		fields,
		"absoluteSize",
		loom.absoluteSize,
		roblox.absoluteSize,
		tol.sizePx,
		highDeltaPx,
	);

	if (
		loom.zIndex !== undefined &&
		roblox.zIndex !== undefined &&
		loom.zIndex !== roblox.zIndex
	) {
		fields.push({
			field: "zIndex",
			loom: loom.zIndex,
			roblox: roblox.zIndex,
			delta: Math.abs(loom.zIndex - roblox.zIndex),
			severity: "medium",
		});
	}

	compareVisual(fields, loom.visual, roblox.visual, tol);

	return fields;
}

function nodeSeverity(fields: ParityFieldDiff[]): ParitySeverity | null {
	let severity: ParitySeverity | null = null;
	for (const field of fields) {
		severity = maxSeverity(severity, field.severity);
	}
	return severity;
}

/**
 * Compare a Loom capture against a Roblox capture and produce a structured
 * parity report. Nodes are matched by their disambiguated Name path; unmatched
 * nodes on either side are reported as missing.
 */
export function diffSnapshots(
	loom: ParitySnapshot,
	roblox: ParitySnapshot,
	options: DiffOptions = {},
): ParityReport {
	const tolerance: ParityTolerance = {
		...DEFAULT_TOLERANCE,
		...options.tolerance,
	};
	const highDeltaPx =
		options.highDeltaPx ??
		Math.max(8, tolerance.positionPx * 16, tolerance.sizePx * 16);

	const loomMap = buildKeyedMap(loom.roots);
	const robloxMap = buildKeyedMap(roblox.roots);

	const keys = new Set<string>([...loomMap.keys(), ...robloxMap.keys()]);
	const sortedKeys = [...keys].sort();

	const nodes: ParityNodeDiff[] = [];
	const bySeverity: Record<ParitySeverity, number> = {
		high: 0,
		medium: 0,
		low: 0,
	};
	let matched = 0;
	let nodesWithDiffs = 0;
	let missingInLoom = 0;
	let missingInRoblox = 0;

	for (const key of sortedKeys) {
		const loomNode = loomMap.get(key);
		const robloxNode = robloxMap.get(key);

		if (loomNode && !robloxNode) {
			missingInRoblox += 1;
			bySeverity.high += 1;
			nodes.push({
				key,
				name: loomNode.name,
				className: loomNode.className,
				status: "missing-in-roblox",
				fields: [],
				maxSeverity: "high",
			});
			continue;
		}

		if (!loomNode && robloxNode) {
			missingInLoom += 1;
			bySeverity.high += 1;
			nodes.push({
				key,
				name: robloxNode.name,
				className: robloxNode.className,
				status: "missing-in-loom",
				fields: [],
				maxSeverity: "high",
			});
			continue;
		}

		if (!loomNode || !robloxNode) {
			continue;
		}

		matched += 1;
		const fields = compareMatchedNode(
			loomNode,
			robloxNode,
			tolerance,
			highDeltaPx,
		);
		if (fields.length === 0) {
			continue;
		}

		nodesWithDiffs += 1;
		const severity = nodeSeverity(fields);
		if (severity) {
			bySeverity[severity] += 1;
		}
		nodes.push({
			key,
			name: loomNode.name,
			className: loomNode.className,
			status: "matched",
			fields,
			maxSeverity: severity,
		});
	}

	// Surface the worst divergences first.
	nodes.sort((a, b) => {
		const sa = a.maxSeverity ? SEVERITY_RANK[a.maxSeverity] : -1;
		const sb = b.maxSeverity ? SEVERITY_RANK[b.maxSeverity] : -1;
		if (sa !== sb) {
			return sb - sa;
		}
		return a.key.localeCompare(b.key);
	});

	const viewportMismatch =
		loom.viewport.x !== roblox.viewport.x ||
		loom.viewport.y !== roblox.viewport.y;

	return {
		scene: loom.scene ?? roblox.scene,
		viewport: {
			loom: loom.viewport,
			roblox: roblox.viewport,
			mismatch: viewportMismatch,
		},
		tolerance,
		summary: {
			totalLoom: loomMap.size,
			totalRoblox: robloxMap.size,
			matched,
			nodesWithDiffs,
			missingInLoom,
			missingInRoblox,
			bySeverity,
		},
		nodes,
	};
}
