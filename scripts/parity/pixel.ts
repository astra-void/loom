/**
 * Pixel parity: compare a Loom screenshot against a Roblox screenshot and emit a
 * diff image, a side-by-side composite, and a self-contained HTML report.
 *
 *   pnpm exec tsx scripts/parity/pixel.ts <loom.png> <roblox.png> \
 *     [--out dir] [--name scene] [--threshold 0.1] [--fail-on-ratio 0.02]
 *
 * Capture both screenshots at the SAME viewport with the GUI in the same place
 * (a full-screen ScreenGui makes this easy); see scripts/parity/shot.ts for the
 * Loom side.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	type PixelDiffResult,
	pixelDiff,
} from "../../packages/parity/src/pixelDiff";

type Severity = "high" | "medium" | "low";

function severityFor(ratio: number): Severity {
	if (ratio >= 0.05) {
		return "high";
	}
	if (ratio >= 0.005) {
		return "medium";
	}
	return "low";
}

const SEVERITY_COLOR: Record<Severity, string> = {
	high: "#dc2626",
	medium: "#d97706",
	low: "#16a34a",
};

function dataUri(png: Buffer): string {
	return `data:image/png;base64,${png.toString("base64")}`;
}

function renderHtml(
	name: string,
	loomPng: Buffer,
	robloxPng: Buffer,
	result: PixelDiffResult,
): string {
	const pct = (result.ratio * 100).toFixed(2);
	const severity = severityFor(result.ratio);
	const warn = result.sizeMismatch
		? `<p class="warn">⚠ Size mismatch — Loom ${result.sizeMismatch.loom.width}×${result.sizeMismatch.loom.height}, Roblox ${result.sizeMismatch.roblox.width}×${result.sizeMismatch.roblox.height}. Compared the overlapping ${result.width}×${result.height} region; capture both at the same viewport for an exact diff.</p>`
		: "";
	return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<title>Loom ↔ Roblox pixel parity — ${name}</title>
<style>
	body { font: 13px/1.5 ui-monospace, Menlo, monospace; margin: 24px; background: #111; color: #eee; }
	h1 { font-size: 18px; }
	.stat { font-size: 28px; font-weight: 700; color: ${SEVERITY_COLOR[severity]}; }
	.warn { color: #f59e0b; font-weight: 600; }
	.grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-top: 16px; }
	figure { margin: 0; }
	figcaption { opacity: 0.7; margin-bottom: 6px; }
	img { width: 100%; image-rendering: pixelated; background:
		repeating-conic-gradient(#222 0% 25%, #2a2a2a 0% 50%) 50% / 16px 16px; border: 1px solid #333; }
</style></head>
<body>
<h1>Pixel parity — ${name}</h1>
<p class="stat">${pct}% different</p>
<p>${result.mismatched.toLocaleString()} / ${result.total.toLocaleString()} px · severity ${severity}</p>
${warn}
<div class="grid">
	<figure><figcaption>Loom</figcaption><img alt="Loom" src="${dataUri(loomPng)}" /></figure>
	<figure><figcaption>Roblox</figcaption><img alt="Roblox" src="${dataUri(robloxPng)}" /></figure>
	<figure><figcaption>Diff</figcaption><img alt="Diff" src="${dataUri(result.diffPng)}" /></figure>
</div>
</body></html>
`;
}

export interface ComparePixelsOptions {
	outDir?: string;
	name?: string;
	threshold?: number;
	quiet?: boolean;
}

export function comparePixels(
	loomPath: string,
	robloxPath: string,
	options: ComparePixelsOptions = {},
): PixelDiffResult {
	const loomPng = readFileSync(loomPath);
	const robloxPng = readFileSync(robloxPath);
	const result = pixelDiff(loomPng, robloxPng, {
		threshold: options.threshold,
	});

	const outDir =
		options.outDir ?? path.resolve(process.cwd(), "parity-out/pixel");
	const name = options.name ?? path.basename(loomPath).replace(/\.png$/i, "");
	mkdirSync(outDir, { recursive: true });
	writeFileSync(path.join(outDir, `${name}.diff.png`), result.diffPng);
	writeFileSync(
		path.join(outDir, `${name}.composite.png`),
		result.compositePng,
	);
	writeFileSync(
		path.join(outDir, `${name}.html`),
		renderHtml(name, loomPng, robloxPng, result),
	);

	if (!options.quiet) {
		const pct = (result.ratio * 100).toFixed(2);
		console.log(
			`[parity] pixel '${name}': ${pct}% different (${result.mismatched}/${result.total} px, severity ${severityFor(result.ratio)})`,
		);
		if (result.sizeMismatch) {
			console.warn(
				`[parity] ⚠ size mismatch: Loom ${result.sizeMismatch.loom.width}×${result.sizeMismatch.loom.height} vs Roblox ${result.sizeMismatch.roblox.width}×${result.sizeMismatch.roblox.height} (compared ${result.width}×${result.height})`,
			);
		}
		console.log(`[parity] report: ${path.join(outDir, `${name}.html`)}`);
	}
	return result;
}

function main(): void {
	const args = process.argv.slice(2);
	const positionals: string[] = [];
	const options: ComparePixelsOptions = {};
	let failOnRatio = Number.POSITIVE_INFINITY;

	for (let i = 0; i < args.length; i += 1) {
		const arg = args[i];
		if (arg === "--out") {
			i += 1;
			options.outDir = path.resolve(args[i]);
		} else if (arg === "--name") {
			i += 1;
			options.name = args[i];
		} else if (arg === "--threshold") {
			i += 1;
			options.threshold = Number(args[i]);
		} else if (arg === "--fail-on-ratio") {
			i += 1;
			failOnRatio = Number(args[i]);
		} else {
			positionals.push(arg);
		}
	}

	if (positionals.length < 2) {
		console.error(
			"usage: tsx scripts/parity/pixel.ts <loom.png> <roblox.png> [--out dir] [--name scene] [--threshold N] [--fail-on-ratio R]",
		);
		process.exit(2);
	}

	const result = comparePixels(positionals[0], positionals[1], options);
	process.exitCode = result.ratio > failOnRatio ? 1 : 0;
}

const invokedDirectly =
	process.argv[1] !== undefined &&
	fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) {
	main();
}
