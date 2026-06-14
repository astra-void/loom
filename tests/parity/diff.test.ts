// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
	diffSnapshots,
	renderHtmlReport,
	renderTextReport,
} from "../../packages/parity/src/index";
import type {
	ParityNode,
	ParitySnapshot,
} from "../../packages/parity/src/types";

function node(overrides: Partial<ParityNode> & { name: string }): ParityNode {
	return {
		className: "Frame",
		absolutePosition: { x: 0, y: 0 },
		absoluteSize: { x: 100, y: 100 },
		children: [],
		...overrides,
	};
}

function snapshot(
	source: "loom" | "roblox",
	roots: ParityNode[],
	viewport = { x: 800, y: 600 },
): ParitySnapshot {
	return { source, viewport, roots };
}

/** A small two-level tree shared by both sides as the baseline. */
function baselineRoots(): ParityNode[] {
	return [
		node({
			name: "Root",
			absolutePosition: { x: 0, y: 0 },
			absoluteSize: { x: 800, y: 600 },
			children: [
				node({
					name: "Card",
					className: "Frame",
					absolutePosition: { x: 40, y: 40 },
					absoluteSize: { x: 200, y: 120 },
					visual: {
						backgroundColor3: { r: 0.1, g: 0.1, b: 0.1 },
						backgroundTransparency: 0,
					},
					children: [
						node({
							name: "Title",
							className: "TextLabel",
							absolutePosition: { x: 48, y: 48 },
							absoluteSize: { x: 184, y: 24 },
							visual: { text: "Hello", textColor3: { r: 1, g: 1, b: 1 } },
						}),
					],
				}),
			],
		}),
	];
}

describe("diffSnapshots", () => {
	it("reports no field diffs for identical trees", () => {
		const report = diffSnapshots(
			snapshot("loom", baselineRoots()),
			snapshot("roblox", baselineRoots()),
		);
		expect(report.summary.matched).toBe(3);
		expect(report.summary.nodesWithDiffs).toBe(0);
		expect(report.summary.missingInLoom).toBe(0);
		expect(report.summary.missingInRoblox).toBe(0);
		expect(report.nodes).toHaveLength(0);
	});

	it("flags a sub-pixel position drift beyond tolerance as medium", () => {
		const loom = baselineRoots();
		loom[0].children[0].absolutePosition = { x: 42, y: 40 }; // +2px x on Card
		const report = diffSnapshots(
			snapshot("loom", loom),
			snapshot("roblox", baselineRoots()),
		);
		expect(report.summary.nodesWithDiffs).toBe(1);
		const card = report.nodes.find((n) => n.key === "/Root/Card");
		expect(card?.fields[0].field).toBe("absolutePosition");
		expect(card?.fields[0].delta).toBe(2);
		expect(card?.maxSeverity).toBe("medium");
	});

	it("escalates a large size divergence to high", () => {
		const loom = baselineRoots();
		loom[0].children[0].absoluteSize = { x: 260, y: 120 }; // +60px wide
		const report = diffSnapshots(
			snapshot("loom", loom),
			snapshot("roblox", baselineRoots()),
		);
		const card = report.nodes.find((n) => n.key === "/Root/Card");
		expect(card?.maxSeverity).toBe("high");
		expect(report.summary.bySeverity.high).toBe(1);
	});

	it("detects a node missing on each side", () => {
		const robloxOnly = baselineRoots();
		robloxOnly[0].children[0].children.push(
			node({ name: "Badge", className: "ImageLabel" }),
		);
		const report = diffSnapshots(
			snapshot("loom", baselineRoots()),
			snapshot("roblox", robloxOnly),
		);
		expect(report.summary.missingInLoom).toBe(1);
		const badge = report.nodes.find((n) => n.key === "/Root/Card/Badge");
		expect(badge?.status).toBe("missing-in-loom");
		expect(badge?.maxSeverity).toBe("high");
	});

	it("flags a className mismatch as high (structural)", () => {
		const loom = baselineRoots();
		loom[0].children[0].className = "ScrollingFrame";
		const report = diffSnapshots(
			snapshot("loom", loom),
			snapshot("roblox", baselineRoots()),
		);
		const card = report.nodes.find((n) => n.key === "/Root/Card");
		expect(card?.fields.some((f) => f.field === "className")).toBe(true);
		expect(card?.maxSeverity).toBe("high");
	});

	it("flags a background colour divergence as medium", () => {
		const loom = baselineRoots();
		loom[0].children[0].visual = {
			backgroundColor3: { r: 0.5, g: 0.1, b: 0.1 },
		};
		const report = diffSnapshots(
			snapshot("loom", loom),
			snapshot("roblox", baselineRoots()),
		);
		const card = report.nodes.find((n) => n.key === "/Root/Card");
		expect(card?.fields.some((f) => f.field === "backgroundColor3")).toBe(true);
	});

	it("treats a visible flip as high", () => {
		const loom = baselineRoots();
		loom[0].children[0].children[0].visual = { visible: false };
		const roblox = baselineRoots();
		roblox[0].children[0].children[0].visual = { visible: true };
		const report = diffSnapshots(
			snapshot("loom", loom),
			snapshot("roblox", roblox),
		);
		const title = report.nodes.find((n) => n.key === "/Root/Card/Title");
		expect(title?.fields[0].field).toBe("visible");
		expect(title?.maxSeverity).toBe("high");
	});

	it("ignores divergences within tolerance", () => {
		const loom = baselineRoots();
		loom[0].children[0].absolutePosition = { x: 40.3, y: 40 }; // within 0.5px
		const report = diffSnapshots(
			snapshot("loom", loom),
			snapshot("roblox", baselineRoots()),
		);
		expect(report.summary.nodesWithDiffs).toBe(0);
	});

	it("matches duplicate sibling names by child order", () => {
		const make = () => [
			node({
				name: "List",
				children: [
					node({ name: "Item", absolutePosition: { x: 0, y: 0 } }),
					node({ name: "Item", absolutePosition: { x: 0, y: 40 } }),
				],
			}),
		];
		const loom = make();
		loom[0].children[1].absolutePosition = { x: 0, y: 80 }; // second Item drifts
		const report = diffSnapshots(
			snapshot("loom", loom),
			snapshot("roblox", make()),
		);
		expect(report.summary.nodesWithDiffs).toBe(1);
		expect(report.nodes[0].key).toBe("/List/Item[1]");
	});

	it("flags a viewport mismatch (scale sizes would diverge)", () => {
		const report = diffSnapshots(
			snapshot("loom", baselineRoots(), { x: 1280, y: 720 }),
			snapshot("roblox", baselineRoots(), { x: 800, y: 600 }),
		);
		expect(report.viewport.mismatch).toBe(true);
	});

	it("honours a tighter custom tolerance", () => {
		const loom = baselineRoots();
		loom[0].children[0].absolutePosition = { x: 40.3, y: 40 };
		const report = diffSnapshots(
			snapshot("loom", loom),
			snapshot("roblox", baselineRoots()),
			{ tolerance: { positionPx: 0.1 } },
		);
		expect(report.summary.nodesWithDiffs).toBe(1);
	});
});

describe("report rendering", () => {
	it("renders a text report containing the diverging node", () => {
		const loom = baselineRoots();
		loom[0].children[0].absolutePosition = { x: 60, y: 40 };
		const report = diffSnapshots(
			snapshot("loom", loom),
			snapshot("roblox", baselineRoots()),
		);
		const text = renderTextReport(report);
		expect(text).toContain("/Root/Card");
		expect(text).toContain("absolutePosition");
	});

	it("renders self-contained HTML", () => {
		const loom = baselineRoots();
		loom[0].children[0].visual = {
			backgroundColor3: { r: 0.9, g: 0.1, b: 0.1 },
		};
		const report = diffSnapshots(
			snapshot("loom", loom),
			snapshot("roblox", baselineRoots()),
		);
		const html = renderHtmlReport(report);
		expect(html.startsWith("<!doctype html>")).toBe(true);
		expect(html).toContain("backgroundColor3");
		expect(html).toContain("swatch");
	});
});
