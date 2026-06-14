/**
 * Convert a `loom snapshot` JSON dump into per-entry parity snapshots, so the
 * parity harness can run against a REAL preview project (compiler-transformed
 * source), not just hand-authored fixtures.
 *
 *   loom snapshot --out snap.json          # in your playground project
 *   pnpm exec tsx scripts/parity/fromSnapshot.ts snap.json [--out parity-out/loom]
 *
 * The headless snapshot carries geometry only (`layoutDebug`); visual properties
 * are not included, so reports from this path compare position/size/structure.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeLoomDebugPayload } from "../../packages/parity/src/index";
import type {
	ParityNode,
	ParitySnapshot,
} from "../../packages/parity/src/types";

interface LoomSnapshotEntryExecution {
	layoutDebug?: unknown;
}

interface LoomSnapshotEnvelope {
	execution?: { entries?: Record<string, LoomSnapshotEntryExecution> };
	workspaceIndex?: {
		entries?: Array<{ id: string; sourceFilePath?: string }>;
	};
}

function slug(value: string): string {
	return (
		value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "entry"
	);
}

/** A readable scene name from the entry's source file, falling back to its id. */
function entryName(id: string, envelope: LoomSnapshotEnvelope): string {
	const descriptor = envelope.workspaceIndex?.entries?.find(
		(entry) => entry.id === id,
	);
	const source = descriptor?.sourceFilePath;
	if (source) {
		const base = path.basename(source).replace(/\.(loom\.)?(tsx?|jsx?)$/i, "");
		return slug(base);
	}
	return slug(id);
}

function isLayoutDebugPayload(
	value: unknown,
): value is Parameters<typeof normalizeLoomDebugPayload>[0] {
	return (
		typeof value === "object" &&
		value !== null &&
		Array.isArray((value as { roots?: unknown }).roots)
	);
}

function countNodes(nodes: ParityNode[]): number {
	return nodes.reduce(
		(total, node) => total + 1 + countNodes(node.children),
		0,
	);
}

export interface FromSnapshotResult {
	scene: string;
	file: string;
	nodes: number;
}

export function fromSnapshot(
	snapshotPath: string,
	outDir: string,
): FromSnapshotResult[] {
	const envelope = JSON.parse(
		readFileSync(snapshotPath, "utf8"),
	) as LoomSnapshotEnvelope;
	const entries = envelope.execution?.entries ?? {};
	mkdirSync(outDir, { recursive: true });

	const written: FromSnapshotResult[] = [];
	for (const [id, execution] of Object.entries(entries)) {
		if (!isLayoutDebugPayload(execution?.layoutDebug)) {
			console.warn(
				`[parity] skip '${id}': no layoutDebug (render failed or skipped)`,
			);
			continue;
		}
		const scene = entryName(id, envelope);
		const snapshot: ParitySnapshot = normalizeLoomDebugPayload(
			execution.layoutDebug,
			{ scene },
		);
		const file = path.join(outDir, `${scene}.json`);
		writeFileSync(file, `${JSON.stringify(snapshot, null, 2)}\n`);
		written.push({ scene, file, nodes: countNodes(snapshot.roots) });
	}

	return written;
}

function main(): void {
	const args = process.argv.slice(2);
	const positionals: string[] = [];
	let outDir = path.resolve(process.cwd(), "parity-out/loom");
	for (let i = 0; i < args.length; i += 1) {
		const arg = args[i];
		if (arg === "--out") {
			i += 1;
			outDir = path.resolve(args[i]);
		} else {
			positionals.push(arg);
		}
	}

	if (positionals.length < 1) {
		console.error(
			"usage: tsx scripts/parity/fromSnapshot.ts <loom-snapshot.json> [--out dir]",
		);
		process.exit(2);
	}

	const written = fromSnapshot(positionals[0], outDir);
	if (written.length === 0) {
		console.warn("[parity] no entries with geometry were found.");
		process.exitCode = 1;
		return;
	}
	for (const entry of written) {
		console.log(
			`[parity] ${entry.scene}: ${entry.nodes} nodes -> ${entry.file}`,
		);
	}
	console.log(
		`\n[parity] converted ${written.length} entr${written.length === 1 ? "y" : "ies"} to ${outDir}`,
	);
}

const invokedDirectly =
	process.argv[1] !== undefined &&
	fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) {
	main();
}
