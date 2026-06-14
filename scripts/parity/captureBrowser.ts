/**
 * Capture a full ParitySnapshot (geometry + visual props) from a REAL,
 * browser-rendered Loom preview — i.e. compiler-transformed source such as the
 * lattice-ui playground, not hand-authored fixtures.
 *
 * It drives the running preview with Playwright and walks the live preview host
 * bridge in-page (the same walk as `captureFromHostTree`, validated in jsdom).
 * Unlike `parity:from-snapshot` (geometry only), this carries visual properties.
 *
 *   pnpm exec playwright install chromium                 # one-time
 *   pnpm exec tsx scripts/parity/captureBrowser.ts http://localhost:5173 \
 *     [--out parity-out/loom] [--name scene] [--width 1280] [--height 720] \
 *     [--selector "[data-preview-layout-provider]"] [--wait 500]
 */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { ParitySnapshot } from "../../packages/parity/src/types";

interface CaptureBrowserConfig {
	url: string;
	outDir: string;
	name: string;
	width: number;
	height: number;
	selector?: string;
	waitMs: number;
}

function parseArgs(): CaptureBrowserConfig | null {
	const args = process.argv.slice(2);
	const positionals: string[] = [];
	let outDir = path.resolve(process.cwd(), "parity-out/loom");
	let name = "browser-capture";
	let width = 1280;
	let height = 720;
	let selector: string | undefined;
	let waitMs = 300;

	for (let i = 0; i < args.length; i += 1) {
		const arg = args[i];
		if (arg === "--out") {
			i += 1;
			outDir = path.resolve(args[i]);
		} else if (arg === "--name") {
			i += 1;
			name = args[i];
		} else if (arg === "--width") {
			i += 1;
			width = Number(args[i]);
		} else if (arg === "--height") {
			i += 1;
			height = Number(args[i]);
		} else if (arg === "--selector") {
			i += 1;
			selector = args[i];
		} else if (arg === "--wait") {
			i += 1;
			waitMs = Number(args[i]);
		} else {
			positionals.push(arg);
		}
	}

	if (positionals.length < 1) {
		console.error(
			"usage: tsx scripts/parity/captureBrowser.ts <url> [--out dir] [--name scene] [--width N] [--height N] [--selector S] [--wait ms]",
		);
		return null;
	}
	return { url: positionals[0], outDir, name, width, height, selector, waitMs };
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

/**
 * Walk the live preview host bridge in the page. Mirrors `captureFromHostTree`
 * (packages/parity/src/captureLoom.tsx); kept self-contained so Playwright can
 * serialise it into the browser context.
 */
function walkHostBridge(selector: string | null) {
	const scope =
		(selector ? document.querySelector(selector) : null) ?? document.body;
	const hosts = Array.from(
		scope.querySelectorAll("[data-preview-host]"),
	) as HTMLElement[];

	const hostParent = (el: Element): Element | null => {
		const parent = el.parentElement?.closest("[data-preview-host]") ?? null;
		return parent && scope.contains(parent) ? parent : null;
	};

	type Channel = { R?: number; G?: number; B?: number };
	const color = (value: unknown) => {
		const c = value as Channel | null;
		return c &&
			typeof c.R === "number" &&
			typeof c.G === "number" &&
			typeof c.B === "number"
			? { r: c.R, g: c.G, b: c.B }
			: undefined;
	};
	const num = (value: unknown) =>
		typeof value === "number" && Number.isFinite(value) ? value : undefined;

	const readVisual = (el: HTMLElement) => {
		const h = el as unknown as Record<string, unknown>;
		const v: Record<string, unknown> = {};
		const bg = color(h.BackgroundColor3);
		if (bg) v.backgroundColor3 = bg;
		const ic = color(h.ImageColor3);
		if (ic) v.imageColor3 = ic;
		const tc = color(h.TextColor3);
		if (tc) v.textColor3 = tc;
		const bt = num(h.BackgroundTransparency);
		if (bt !== undefined) v.backgroundTransparency = bt;
		const itr = num(h.ImageTransparency);
		if (itr !== undefined) v.imageTransparency = itr;
		const ttr = num(h.TextTransparency);
		if (ttr !== undefined) v.textTransparency = ttr;
		const rot = num(h.Rotation);
		if (rot !== undefined) v.rotation = rot;
		const tsz = num(h.TextSize);
		if (tsz !== undefined) v.textSize = tsz;
		if (typeof h.Text === "string") v.text = h.Text;
		if (typeof h.Visible === "boolean") v.visible = h.Visible;
		return Object.keys(v).length > 0 ? v : undefined;
	};

	const toNode = (el: HTMLElement): unknown => {
		const h = el as unknown as Record<string, unknown>;
		const pos = h.AbsolutePosition as { X?: number; Y?: number } | undefined;
		const size = h.AbsoluteSize as { X?: number; Y?: number } | undefined;
		const fallback = el.getAttribute("data-preview-host") ?? "host";
		return {
			name: typeof h.Name === "string" ? h.Name : fallback,
			className: typeof h.ClassName === "string" ? h.ClassName : fallback,
			absolutePosition: { x: pos?.X ?? 0, y: pos?.Y ?? 0 },
			absoluteSize: { x: size?.X ?? 0, y: size?.Y ?? 0 },
			zIndex: num(h.ZIndex),
			visual: readVisual(el),
			children: hosts.filter((c) => hostParent(c) === el).map(toNode),
		};
	};

	return {
		viewport: { x: window.innerWidth, y: window.innerHeight },
		roots: hosts.filter((el) => hostParent(el) === null).map(toNode),
	};
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
		await page.waitForSelector("[data-preview-host]", { timeout: 15000 });
		if (config.waitMs > 0) {
			await page.waitForTimeout(config.waitMs);
		}

		const walked = (await page.evaluate(
			walkHostBridge,
			config.selector ?? null,
		)) as {
			viewport: { x: number; y: number };
			roots: ParitySnapshot["roots"];
		};

		const snapshot: ParitySnapshot = {
			source: "loom",
			scene: config.name,
			viewport: walked.viewport,
			roots: walked.roots,
		};
		mkdirSync(config.outDir, { recursive: true });
		const file = path.join(config.outDir, `${config.name}.json`);
		writeFileSync(file, `${JSON.stringify(snapshot, null, 2)}\n`);
		console.log(
			`[parity] captured '${config.name}' (${walked.roots.length} root(s), viewport ${walked.viewport.x}×${walked.viewport.y}) -> ${file}`,
		);
	} finally {
		await browser.close();
	}
}

main().catch((error) => {
	console.error("[parity] browser capture failed:", error);
	process.exit(1);
});
