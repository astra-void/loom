/**
 * Compare a Loom capture against a Roblox capture and emit a parity report
 * (JSON + standalone HTML) plus a console summary.
 *
 *   pnpm exec tsx scripts/parity/compare.ts <loom.json> <roblox.json> \
 *     [--out <dir>] [--position-px N] [--size-px N] [--fail-on high|medium|none]
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	type DiffOptions,
	diffSnapshots,
	renderHtmlReport,
	renderTextReport,
} from "../../packages/parity/src/index";
import type {
	ParityReport,
	ParitySnapshot,
} from "../../packages/parity/src/types";

function loadSnapshot(
	file: string,
	expected: "loom" | "roblox",
): ParitySnapshot {
	const snapshot = JSON.parse(readFileSync(file, "utf8")) as ParitySnapshot;
	if (!Array.isArray(snapshot.roots)) {
		throw new Error(`${file} is not a ParitySnapshot (missing roots[])`);
	}
	if (snapshot.source !== expected) {
		console.warn(
			`[parity] warning: ${file} has source="${snapshot.source}", expected "${expected}"`,
		);
	}
	return snapshot;
}

export interface CompareFilesOptions extends DiffOptions {
	outDir?: string;
	reportName?: string;
	quiet?: boolean;
}

export function compareFiles(
	loomPath: string,
	robloxPath: string,
	options: CompareFilesOptions = {},
): ParityReport {
	const loom = loadSnapshot(loomPath, "loom");
	const roblox = loadSnapshot(robloxPath, "roblox");

	const report = diffSnapshots(loom, roblox, options);
	report.generatedAt = new Date().toISOString();

	const outDir =
		options.outDir ?? path.resolve(process.cwd(), "parity-out/report");
	const name = options.reportName ?? report.scene ?? "report";
	mkdirSync(outDir, { recursive: true });
	writeFileSync(
		path.join(outDir, `${name}.json`),
		`${JSON.stringify(report, null, 2)}\n`,
	);
	writeFileSync(path.join(outDir, `${name}.html`), renderHtmlReport(report));

	if (!options.quiet) {
		console.log(renderTextReport(report));
		console.log(`\n[parity] report: ${path.join(outDir, `${name}.html`)}`);
	}

	return report;
}

/** Exit non-zero when divergences at/above the threshold severity are present. */
function shouldFail(report: ParityReport, failOn: string): boolean {
	const { bySeverity, missingInLoom, missingInRoblox } = report.summary;
	const missing = missingInLoom + missingInRoblox;
	switch (failOn) {
		case "none":
			return false;
		case "medium":
			return bySeverity.high + bySeverity.medium + missing > 0;
		default:
			return bySeverity.high + missing > 0;
	}
}

function main(): void {
	const args = process.argv.slice(2);
	const positionals: string[] = [];
	const options: CompareFilesOptions = {};
	let failOn = "high";

	for (let i = 0; i < args.length; i += 1) {
		const arg = args[i];
		if (arg === "--out") {
			i += 1;
			options.outDir = path.resolve(args[i]);
		} else if (arg === "--position-px") {
			i += 1;
			options.tolerance = { ...options.tolerance, positionPx: Number(args[i]) };
		} else if (arg === "--size-px") {
			i += 1;
			options.tolerance = { ...options.tolerance, sizePx: Number(args[i]) };
		} else if (arg === "--fail-on") {
			i += 1;
			failOn = args[i];
		} else {
			positionals.push(arg);
		}
	}

	if (positionals.length < 2) {
		console.error(
			"usage: tsx scripts/parity/compare.ts <loom.json> <roblox.json> [--out dir] [--position-px N] [--size-px N] [--fail-on high|medium|none]",
		);
		process.exit(2);
	}

	const report = compareFiles(positionals[0], positionals[1], options);
	process.exitCode = shouldFail(report, failOn) ? 1 : 0;
}

const invokedDirectly =
	process.argv[1] !== undefined &&
	fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) {
	main();
}
