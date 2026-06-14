/**
 * Capture a Loom screenshot for pixel parity by navigating a real headless
 * browser to a URL (e.g. a running `loom preview` / `pnpm dev` server) and
 * screenshotting it at a controlled viewport.
 *
 *   pnpm exec tsx scripts/parity/shot.ts <url> <out.png> \
 *     [--width 1280] [--height 720] [--selector "[data-preview-layout-provider]"] [--wait 500]
 *
 * One-time browser setup:  pnpm exec playwright install chromium
 *
 * Capturing only the GUI region (via --selector) at the same viewport as the
 * Roblox dump keeps the two screenshots aligned for `parity:pixel`.
 */

import path from "node:path";

interface ShotConfig {
	url: string;
	out: string;
	width: number;
	height: number;
	selector?: string;
	waitMs: number;
	fullPage: boolean;
}

function parseArgs(): ShotConfig | null {
	const args = process.argv.slice(2);
	const positionals: string[] = [];
	const config: Omit<ShotConfig, "url" | "out"> = {
		width: 1280,
		height: 720,
		waitMs: 0,
		fullPage: false,
	};
	for (let i = 0; i < args.length; i += 1) {
		const arg = args[i];
		if (arg === "--width") {
			i += 1;
			config.width = Number(args[i]);
		} else if (arg === "--height") {
			i += 1;
			config.height = Number(args[i]);
		} else if (arg === "--selector") {
			i += 1;
			config.selector = args[i];
		} else if (arg === "--wait") {
			i += 1;
			config.waitMs = Number(args[i]);
		} else if (arg === "--full-page") {
			config.fullPage = true;
		} else {
			positionals.push(arg);
		}
	}
	if (positionals.length < 2) {
		console.error(
			"usage: tsx scripts/parity/shot.ts <url> <out.png> [--width N] [--height N] [--selector S] [--wait ms] [--full-page]",
		);
		return null;
	}
	return { ...config, url: positionals[0], out: path.resolve(positionals[1]) };
}

async function loadChromium() {
	try {
		const playwright = await import("playwright");
		return playwright.chromium;
	} catch {
		console.error(
			"[parity] playwright is not installed.\n" +
				"  pnpm add -Dw playwright && pnpm exec playwright install chromium",
		);
		return null;
	}
}

async function main(): Promise<void> {
	const config = parseArgs();
	if (!config) {
		process.exit(2);
	}

	const chromium = await loadChromium();
	if (!chromium) {
		process.exit(2);
	}

	let browser: Awaited<ReturnType<typeof chromium.launch>>;
	try {
		browser = await chromium.launch();
	} catch (error) {
		console.error(
			"[parity] could not launch Chromium — install it once:\n" +
				"  pnpm exec playwright install chromium\n" +
				String(error),
		);
		process.exit(2);
	}

	try {
		const page = await browser.newPage({
			viewport: { width: config.width, height: config.height },
			deviceScaleFactor: 1,
		});
		await page.goto(config.url, { waitUntil: "networkidle" });
		if (config.waitMs > 0) {
			await page.waitForTimeout(config.waitMs);
		}
		if (config.selector) {
			await page
				.locator(config.selector)
				.first()
				.screenshot({ path: config.out });
		} else {
			await page.screenshot({ path: config.out, fullPage: config.fullPage });
		}
		console.log(
			`[parity] screenshot (${config.width}×${config.height}) -> ${config.out}`,
		);
	} finally {
		await browser.close();
	}
}

main().catch((error) => {
	console.error("[parity] shot failed:", error);
	process.exit(1);
});
