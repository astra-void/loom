// @vitest-environment node

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ParitySnapshot } from "../../packages/parity/src/types";
import { fromSnapshot } from "../../scripts/parity/fromSnapshot";

/** A minimal `loom snapshot` envelope with one rendered entry and one failed. */
function makeSnapshotEnvelope() {
	return {
		protocolVersion: 1,
		workspaceIndex: {
			entries: [
				{ id: "entry-1", sourceFilePath: "src/components/Button.loom.tsx" },
				{ id: "entry-2", sourceFilePath: "src/components/Broken.loom.tsx" },
			],
		},
		execution: {
			entries: {
				"entry-1": {
					layoutDebug: {
						dirtyNodeIds: [],
						viewport: { width: 1280, height: 720 },
						roots: [
							{
								id: "n1",
								nodeType: "ScreenGui",
								debugLabel: "Screen",
								kind: "root",
								rect: { x: 0, y: 0, width: 1280, height: 720 },
								children: [
									{
										id: "n2",
										nodeType: "Frame",
										debugLabel: "Card",
										kind: "host",
										rect: { x: 80, y: 80, width: 240, height: 120 },
										zIndex: 2,
										children: [],
									},
								],
							},
						],
					},
				},
				// Render failed -> no geometry; must be skipped, not crash.
				"entry-2": { layoutDebug: null },
			},
		},
	};
}

describe("fromSnapshot adapter", () => {
	let workDir: string;

	beforeAll(() => {
		workDir = mkdtempSync(path.join(tmpdir(), "parity-from-snapshot-"));
	});

	afterAll(() => {
		rmSync(workDir, { force: true, recursive: true });
	});

	it("converts rendered entries and skips failed ones", () => {
		const snapPath = path.join(workDir, "snap.json");
		const outDir = path.join(workDir, "loom");
		writeFileSync(snapPath, JSON.stringify(makeSnapshotEnvelope()));

		const written = fromSnapshot(snapPath, outDir);

		// entry-2 (null layoutDebug) is skipped.
		expect(written).toHaveLength(1);
		// Scene name is derived from the source file basename (sans .loom.tsx).
		expect(written[0].scene).toBe("Button");
		expect(written[0].nodes).toBe(2);

		const snapshot = JSON.parse(
			readFileSync(written[0].file, "utf8"),
		) as ParitySnapshot;
		expect(snapshot.source).toBe("loom");
		expect(snapshot.scene).toBe("Button");
		expect(snapshot.viewport).toEqual({ x: 1280, y: 720 });

		const screen = snapshot.roots[0];
		expect(screen.name).toBe("Screen");
		expect(screen.className).toBe("ScreenGui");

		const card = screen.children[0];
		expect(card.name).toBe("Card");
		expect(card.className).toBe("Frame");
		expect(card.absolutePosition).toEqual({ x: 80, y: 80 });
		expect(card.absoluteSize).toEqual({ x: 240, y: 120 });
		expect(card.zIndex).toBe(2);
	});

	it("falls back to the entry id when no source file is known", () => {
		const envelope = makeSnapshotEnvelope();
		envelope.workspaceIndex.entries = [];
		const snapPath = path.join(workDir, "snap2.json");
		const outDir = path.join(workDir, "loom2");
		writeFileSync(snapPath, JSON.stringify(envelope));

		const written = fromSnapshot(snapPath, outDir);
		expect(written).toHaveLength(1);
		expect(written[0].scene).toBe("entry-1");
	});
});
