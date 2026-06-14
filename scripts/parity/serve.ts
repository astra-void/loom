/**
 * Local receiver for the Roblox Studio dump plugin (LoomParityDump.lua).
 *
 * Listens for `POST /dump` ParitySnapshot bodies, writes each to
 * `<roblox>/<scene>.json`, and — when a matching Loom capture exists — runs the
 * diff and writes a report immediately.
 *
 *   pnpm exec tsx scripts/parity/serve.ts \
 *     [--port 7878] [--loom dir] [--roblox dir] [--report dir]
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import type { ParitySnapshot } from "../../packages/parity/src/types";
import { compareFiles } from "./compare";

function slug(value: string): string {
	return (
		value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "scene"
	);
}

interface ServeConfig {
	port: number;
	loomDir: string;
	robloxDir: string;
	reportDir: string;
}

function parseArgs(): ServeConfig {
	const args = process.argv.slice(2);
	const config: ServeConfig = {
		port: 7878,
		loomDir: path.resolve(process.cwd(), "parity-out/loom"),
		robloxDir: path.resolve(process.cwd(), "parity-out/roblox"),
		reportDir: path.resolve(process.cwd(), "parity-out/report"),
	};
	for (let i = 0; i < args.length; i += 1) {
		const arg = args[i];
		if (arg === "--port") {
			i += 1;
			config.port = Number(args[i]);
		} else if (arg === "--loom") {
			i += 1;
			config.loomDir = path.resolve(args[i]);
		} else if (arg === "--roblox") {
			i += 1;
			config.robloxDir = path.resolve(args[i]);
		} else if (arg === "--report") {
			i += 1;
			config.reportDir = path.resolve(args[i]);
		}
	}
	return config;
}

function handleDump(
	config: ServeConfig,
	body: string,
): {
	scene: string;
	compared: boolean;
} {
	const snapshot = JSON.parse(body) as ParitySnapshot;
	if (!Array.isArray(snapshot.roots)) {
		throw new Error("payload is not a ParitySnapshot (missing roots[])");
	}
	const scene = slug(snapshot.scene ?? "scene");
	mkdirSync(config.robloxDir, { recursive: true });
	const robloxPath = path.join(config.robloxDir, `${scene}.json`);
	writeFileSync(robloxPath, `${JSON.stringify(snapshot, null, 2)}\n`);
	console.log(
		`\n[parity] received Roblox dump '${snapshot.scene}' (viewport ${snapshot.viewport.x}x${snapshot.viewport.y}) -> ${robloxPath}`,
	);

	const loomPath = path.join(config.loomDir, `${scene}.json`);
	if (existsSync(loomPath)) {
		compareFiles(loomPath, robloxPath, {
			outDir: config.reportDir,
			reportName: scene,
		});
		return { scene, compared: true };
	}

	console.log(
		`[parity] no matching Loom capture at ${loomPath}.\n` +
			`         capture Loom (pnpm parity:capture) or rename so the scene keys match, then:\n` +
			`         pnpm exec tsx scripts/parity/compare.ts <loom.json> ${robloxPath}`,
	);
	return { scene, compared: false };
}

function main(): void {
	const config = parseArgs();
	mkdirSync(config.robloxDir, { recursive: true });

	const server = createServer((req, res) => {
		if (req.method === "GET") {
			res.writeHead(200, { "content-type": "text/plain" });
			res.end(
				`Loom parity runner\nPOST a Roblox dump to /dump\n  loom:   ${config.loomDir}\n  roblox: ${config.robloxDir}\n  report: ${config.reportDir}\n`,
			);
			return;
		}

		if (req.method === "POST") {
			let body = "";
			req.on("data", (chunk) => {
				body += chunk;
			});
			req.on("end", () => {
				try {
					const result = handleDump(config, body);
					res.writeHead(200, { "content-type": "application/json" });
					res.end(JSON.stringify({ ok: true, ...result }));
				} catch (error) {
					console.error("[parity] bad dump:", error);
					res.writeHead(400, { "content-type": "application/json" });
					res.end(JSON.stringify({ ok: false, error: String(error) }));
				}
			});
			return;
		}

		res.writeHead(404);
		res.end();
	});

	server.listen(config.port, () => {
		console.log(
			`[parity] listening on http://localhost:${config.port}  (POST /dump)`,
		);
		console.log(`[parity] loom:   ${config.loomDir}`);
		console.log(`[parity] roblox: ${config.robloxDir}`);
		console.log(`[parity] report: ${config.reportDir}`);
		console.log(
			"[parity] waiting for the Studio plugin to dump… (Ctrl+C to stop)",
		);
	});
}

main();
