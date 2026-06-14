// @vitest-environment jsdom

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
	getPreviewLayoutProbeSnapshot,
	LayoutProvider,
} from "@loom-dev/preview-runtime";
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
	captureFromHostTree,
	installNodeLayoutEngine,
	renderAndCaptureLoom,
} from "../../packages/parity/src/captureLoom";
import { parityScenes } from "../../packages/parity/src/fixtures/scenes";
import {
	diffSnapshots,
	normalizeLoomDebugPayload,
} from "../../packages/parity/src/index";
import type {
	ParityNode,
	ParitySnapshot,
	ParityVec2,
} from "../../packages/parity/src/types";

/** Optional `WxH` viewport override (to match a Roblox dump's viewport). */
function viewportOverride(): ParityVec2 | undefined {
	const raw = process.env.LOOM_PARITY_VIEWPORT;
	if (!raw) {
		return undefined;
	}
	const match = /^(\d+)\s*[x×]\s*(\d+)$/.exec(raw.trim());
	return match ? { x: Number(match[1]), y: Number(match[2]) } : undefined;
}

beforeAll(async () => {
	// Force the real WASM engine instead of the silent TS fallback.
	await installNodeLayoutEngine();
});

afterEach(() => {
	cleanup();
});

function findNode(roots: ParityNode[], name: string): ParityNode | undefined {
	for (const node of roots) {
		if (node.name === name) {
			return node;
		}
		const found = findNode(node.children, name);
		if (found) {
			return found;
		}
	}
	return undefined;
}

function captureScene(name: string): Promise<ParitySnapshot> {
	const scene = parityScenes.find((entry) => entry.name === name);
	if (!scene) {
		throw new Error(`unknown scene: ${name}`);
	}
	return renderAndCaptureLoom(scene.element, {
		viewport: scene.viewport,
		scene: scene.name,
	});
}

describe("Loom capture", () => {
	it("captures geometry for explicitly-sized instances", async () => {
		const snapshot = await captureScene("styled-card");
		const card = findNode(snapshot.roots, "Card");
		expect(card).toBeDefined();
		expect(card?.className).toBe("Frame");
		expect(card?.absolutePosition.x).toBeCloseTo(80, 0);
		expect(card?.absolutePosition.y).toBeCloseTo(80, 0);
		expect(card?.absoluteSize.x).toBeCloseTo(240, 0);
		expect(card?.absoluteSize.y).toBeCloseTo(120, 0);
	});

	it("captures visual properties (colour + text) off the DOM bridge", async () => {
		const snapshot = await captureScene("styled-card");
		const card = findNode(snapshot.roots, "Card");
		expect(card?.visual?.backgroundColor3?.r).toBeCloseTo(40 / 255, 2);
		expect(card?.visual?.backgroundColor3?.g).toBeCloseTo(44 / 255, 2);
		expect(card?.visual?.backgroundColor3?.b).toBeCloseTo(52 / 255, 2);

		const title = findNode(snapshot.roots, "Title");
		expect(title?.className).toBe("TextLabel");
		expect(title?.visual?.text).toBe("Parity Card");
		expect(title?.visual?.textColor3?.r).toBeCloseTo(235 / 255, 2);
	});

	it("lays a vertical list out with accumulating offsets", async () => {
		const snapshot = await captureScene("vertical-list");
		const rows = ["RowA", "RowB", "RowC"].map((name) =>
			findNode(snapshot.roots, name),
		);
		expect(rows.every(Boolean)).toBe(true);
		const ys = rows.map((row) => row?.absolutePosition.y ?? 0);
		// Strictly increasing, equal 40px rows + 8px gap => ~48px step.
		expect(ys[1] - ys[0]).toBeCloseTo(48, 0);
		expect(ys[2] - ys[1]).toBeCloseTo(48, 0);
		for (const row of rows) {
			expect(row?.absoluteSize.y).toBeCloseTo(40, 0);
		}
	});

	it("self-diffs to zero (capture is internally consistent)", async () => {
		const loom = await captureScene("vertical-list");
		const asRoblox: ParitySnapshot = { ...loom, source: "roblox" };
		const report = diffSnapshots(loom, asRoblox);
		expect(report.summary.nodesWithDiffs).toBe(0);
		expect(report.summary.missingInLoom).toBe(0);
		expect(report.summary.missingInRoblox).toBe(0);
	});

	it("normalizeLoomDebugPayload matches geometry on a real WASM payload", async () => {
		// Exercises the same headless/`loom snapshot` path used for real source:
		// a genuine WASM-produced layoutDebug, normalised to a ParitySnapshot.
		const scene = parityScenes.find((entry) => entry.name === "styled-card");
		if (!scene) {
			throw new Error("missing styled-card scene");
		}
		const result = render(
			<LayoutProvider debounceMs={0} viewportHeight={600} viewportWidth={800}>
				{scene.element}
			</LayoutProvider>,
		);
		try {
			await waitFor(() => {
				const root = getPreviewLayoutProbeSnapshot().debug.roots[0];
				if (!root?.rect || root.rect.width <= 0) {
					throw new Error("not laid out yet");
				}
			});
			const debug = getPreviewLayoutProbeSnapshot().debug;
			const snapshot = normalizeLoomDebugPayload(debug, {
				scene: "styled-card",
			});
			expect(snapshot.viewport).toEqual({ x: 800, y: 600 });
			const card = findNode(snapshot.roots, "Card");
			expect(card?.className).toBe("Frame");
			expect(card?.absolutePosition.x).toBeCloseTo(80, 0);
			expect(card?.absolutePosition.y).toBeCloseTo(80, 0);
			expect(card?.absoluteSize.x).toBeCloseTo(240, 0);
			expect(card?.absoluteSize.y).toBeCloseTo(120, 0);
		} finally {
			result.unmount();
		}
	});

	it("captureFromHostTree reads geometry + visuals straight off the DOM bridge", async () => {
		// This is the walk used for browser capture (real, compiler-transformed
		// source); validate it produces correct geometry AND visuals in jsdom.
		const scene = parityScenes.find((entry) => entry.name === "styled-card");
		if (!scene) {
			throw new Error("missing styled-card scene");
		}
		const result = render(
			<LayoutProvider debounceMs={0} viewportHeight={600} viewportWidth={800}>
				{scene.element}
			</LayoutProvider>,
		);
		try {
			await waitFor(() => {
				const root = getPreviewLayoutProbeSnapshot().debug.roots[0];
				if (!root?.rect || root.rect.width <= 0) {
					throw new Error("not laid out yet");
				}
			});
			const snapshot = captureFromHostTree(
				result.container,
				{ x: 800, y: 600 },
				{ scene: "styled-card" },
			);
			const card = findNode(snapshot.roots, "Card");
			expect(card?.className).toBe("Frame");
			expect(card?.absolutePosition.x).toBeCloseTo(80, 0);
			expect(card?.absoluteSize.x).toBeCloseTo(240, 0);
			expect(card?.visual?.backgroundColor3?.r).toBeCloseTo(40 / 255, 2);
			const title = findNode(snapshot.roots, "Title");
			expect(title?.visual?.text).toBe("Parity Card");
		} finally {
			result.unmount();
		}
	});

	it("captures every fixture scene (and writes artifacts when LOOM_PARITY_OUT is set)", async () => {
		const outDir = process.env.LOOM_PARITY_OUT;
		if (outDir) {
			mkdirSync(outDir, { recursive: true });
		}
		const override = viewportOverride();
		for (const scene of parityScenes) {
			const snapshot = await renderAndCaptureLoom(scene.element, {
				viewport: override ?? scene.viewport,
				scene: scene.name,
			});
			expect(snapshot.roots.length).toBeGreaterThan(0);
			if (outDir) {
				writeFileSync(
					path.join(outDir, `${scene.name}.json`),
					`${JSON.stringify(snapshot, null, 2)}\n`,
				);
			}
		}
	});
});
