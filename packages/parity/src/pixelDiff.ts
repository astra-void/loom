/**
 * Pixel-level parity: compare a Loom screenshot against a Roblox screenshot.
 *
 * This is the layer that catches pure-rendering divergences a geometry/property
 * diff cannot — UIStroke drawn inside vs. outside, ImageLabel ScaleType,
 * UIGradient multiply, ImageColor3 tint, font rendering, etc.
 *
 * It decodes both PNGs, compares the overlapping top-left region with
 * `pixelmatch`, and produces a diff image plus a side-by-side composite
 * (loom | roblox | diff) for at-a-glance inspection.
 */

import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

export interface PixelDiffOptions {
	/** Matching threshold, 0..1 (smaller = stricter). Default 0.1. */
	threshold?: number;
	/** Count anti-aliased pixels as differences. Default false. */
	includeAA?: boolean;
	/** Gap (px) between panes in the composite. Default 8. */
	compositeGap?: number;
}

export interface PixelDiffResult {
	/** The compared (overlapping) region. */
	width: number;
	height: number;
	mismatched: number;
	total: number;
	/** mismatched / total, 0..1. */
	ratio: number;
	/** Set when the two screenshots are not the same size. */
	sizeMismatch: {
		loom: { width: number; height: number };
		roblox: { width: number; height: number };
	} | null;
	/** PNG of the diff over the compared region. */
	diffPng: Buffer;
	/** PNG: loom | roblox | diff, side by side. */
	compositePng: Buffer;
}

/** Copy the top-left w×h RGBA region out of a decoded PNG. */
function cropRgba(png: PNG, width: number, height: number): Buffer {
	if (png.width === width && png.height === height) {
		return png.data;
	}
	const out = Buffer.alloc(width * height * 4);
	for (let y = 0; y < height; y += 1) {
		const srcStart = y * png.width * 4;
		png.data.copy(out, y * width * 4, srcStart, srcStart + width * 4);
	}
	return out;
}

/** Blit a w×h RGBA buffer into `target` at the given x offset. */
function blit(
	target: PNG,
	src: Buffer,
	width: number,
	height: number,
	xOffset: number,
): void {
	for (let y = 0; y < height; y += 1) {
		const srcStart = y * width * 4;
		src.copy(
			target.data,
			(y * target.width + xOffset) * 4,
			srcStart,
			srcStart + width * 4,
		);
	}
}

function makeComposite(
	loom: Buffer,
	roblox: Buffer,
	diff: Buffer,
	width: number,
	height: number,
	gap: number,
): Buffer {
	const compositeWidth = width * 3 + gap * 2;
	const out = new PNG({ width: compositeWidth, height });
	out.data.fill(0);
	blit(out, loom, width, height, 0);
	blit(out, roblox, width, height, width + gap);
	blit(out, diff, width, height, (width + gap) * 2);
	return PNG.sync.write(out);
}

export function pixelDiff(
	loomPng: Buffer,
	robloxPng: Buffer,
	options: PixelDiffOptions = {},
): PixelDiffResult {
	const loom = PNG.sync.read(loomPng);
	const roblox = PNG.sync.read(robloxPng);

	const width = Math.min(loom.width, roblox.width);
	const height = Math.min(loom.height, roblox.height);
	const sizeMismatch =
		loom.width !== roblox.width || loom.height !== roblox.height
			? {
					loom: { width: loom.width, height: loom.height },
					roblox: { width: roblox.width, height: roblox.height },
				}
			: null;

	const loomRegion = cropRgba(loom, width, height);
	const robloxRegion = cropRgba(roblox, width, height);
	const diff = new PNG({ width, height });

	const mismatched = pixelmatch(
		loomRegion,
		robloxRegion,
		diff.data,
		width,
		height,
		{
			threshold: options.threshold ?? 0.1,
			includeAA: options.includeAA ?? false,
		},
	);

	const total = width * height;
	return {
		width,
		height,
		mismatched,
		total,
		ratio: total === 0 ? 0 : mismatched / total,
		sizeMismatch,
		diffPng: PNG.sync.write(diff),
		compositePng: makeComposite(
			loomRegion,
			robloxRegion,
			diff.data,
			width,
			height,
			options.compositeGap ?? 8,
		),
	};
}
