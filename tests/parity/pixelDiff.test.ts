// @vitest-environment node

import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import { pixelDiff } from "../../packages/parity/src/pixelDiff";

type Rgb = [number, number, number];

function solidPng(width: number, height: number, [r, g, b]: Rgb): Buffer {
	const png = new PNG({ width, height });
	for (let i = 0; i < width * height; i += 1) {
		const o = i * 4;
		png.data[o] = r;
		png.data[o + 1] = g;
		png.data[o + 2] = b;
		png.data[o + 3] = 255;
	}
	return PNG.sync.write(png);
}

/** A solid `base` image with a `cw`×`ch` top-left corner painted `corner`. */
function cornerPng(
	width: number,
	height: number,
	base: Rgb,
	corner: Rgb,
	cw: number,
	ch: number,
): Buffer {
	const png = new PNG({ width, height });
	for (let y = 0; y < height; y += 1) {
		for (let x = 0; x < width; x += 1) {
			const o = (y * width + x) * 4;
			const c = x < cw && y < ch ? corner : base;
			png.data[o] = c[0];
			png.data[o + 1] = c[1];
			png.data[o + 2] = c[2];
			png.data[o + 3] = 255;
		}
	}
	return PNG.sync.write(png);
}

const RED: Rgb = [220, 40, 40];
const BLUE: Rgb = [40, 60, 220];

describe("pixelDiff", () => {
	it("reports zero mismatch for identical images", () => {
		const a = solidPng(20, 20, RED);
		const result = pixelDiff(a, solidPng(20, 20, RED));
		expect(result.mismatched).toBe(0);
		expect(result.ratio).toBe(0);
		expect(result.sizeMismatch).toBeNull();
		expect(result.width).toBe(20);
		expect(result.height).toBe(20);
	});

	it("reports full mismatch for entirely different images", () => {
		const result = pixelDiff(solidPng(20, 20, RED), solidPng(20, 20, BLUE));
		expect(result.mismatched).toBeGreaterThan(390); // ~all 400 px
		expect(result.ratio).toBeGreaterThan(0.95);
	});

	it("reports partial mismatch for a localized difference", () => {
		const a = solidPng(20, 20, RED);
		const b = cornerPng(20, 20, RED, BLUE, 5, 5);
		const result = pixelDiff(a, b);
		expect(result.mismatched).toBeGreaterThan(0);
		expect(result.mismatched).toBeLessThan(result.total);
		expect(result.total).toBe(400);
	});

	it("compares the overlapping region and flags size mismatches", () => {
		const result = pixelDiff(solidPng(20, 20, RED), solidPng(30, 30, RED));
		expect(result.sizeMismatch).toEqual({
			loom: { width: 20, height: 20 },
			roblox: { width: 30, height: 30 },
		});
		expect(result.width).toBe(20);
		expect(result.height).toBe(20);
		expect(result.mismatched).toBe(0); // overlapping region is identical
	});

	it("produces a valid diff PNG and a 3-pane composite", () => {
		const result = pixelDiff(
			solidPng(20, 20, RED),
			cornerPng(20, 20, RED, BLUE, 5, 5),
			{ compositeGap: 8 },
		);
		const diff = PNG.sync.read(result.diffPng);
		expect(diff.width).toBe(20);
		expect(diff.height).toBe(20);

		const composite = PNG.sync.read(result.compositePng);
		expect(composite.width).toBe(20 * 3 + 8 * 2);
		expect(composite.height).toBe(20);
	});
});
