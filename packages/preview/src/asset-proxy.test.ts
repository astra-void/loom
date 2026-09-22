/**
 * The dev-server asset route: path matching against the configured base, the
 * thumbnail lookup, and the cache that keeps a repaint off the network — plus
 * the build-time bake that gives a static page its images.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
	type AssetBundleOptions,
	assetIdFromPath,
	assetIdsIn,
	clearAssetCache,
	composesAssetIds,
	loomAssetBundle,
	resolveAssetUrl,
} from "./asset-proxy.ts";

function okThumbnail(imageUrl: string, state = "Completed") {
	return () =>
		Promise.resolve({
			ok: true,
			status: 200,
			statusText: "OK",
			json: () => Promise.resolve({ data: [{ state, imageUrl }] }),
		} as Response);
}

describe("assetIdFromPath", () => {
	it("matches the route under the configured base", () => {
		expect(assetIdFromPath("/__loom/asset/1818", "/")).toBe("1818");
		expect(assetIdFromPath("/preview/__loom/asset/1818", "/preview/")).toBe(
			"1818",
		);
	});

	it("ignores paths that are not the route", () => {
		expect(assetIdFromPath("/index.html", "/")).toBeUndefined();
		// Right route, wrong base: an embedded gallery must not answer for it.
		expect(assetIdFromPath("/__loom/asset/1818", "/preview/")).toBeUndefined();
	});

	it("rejects a non-numeric id rather than forwarding it", () => {
		expect(assetIdFromPath("/__loom/asset/../../etc", "/")).toBeUndefined();
		expect(assetIdFromPath("/__loom/asset/", "/")).toBeUndefined();
	});
});

describe("resolveAssetUrl", () => {
	beforeEach(() => {
		clearAssetCache();
	});

	it("returns the thumbnail's image URL", async () => {
		const url = await resolveAssetUrl(
			"1818",
			"420x420",
			okThumbnail("https://tr.rbxcdn.test/abc"),
		);
		expect(url).toBe("https://tr.rbxcdn.test/abc");
	});

	it("asks Roblox for the requested asset and size", async () => {
		let requested: string | undefined;
		await resolveAssetUrl("1818", "150x150", (input) => {
			requested = String(input);
			return okThumbnail("https://tr.rbxcdn.test/abc")();
		});
		expect(requested).toContain("assetIds=1818");
		expect(requested).toContain("size=150x150");
	});

	it("serves a repeat lookup from cache", async () => {
		let calls = 0;
		const fetchImpl = () => {
			calls += 1;
			return okThumbnail("https://tr.rbxcdn.test/abc")();
		};
		await resolveAssetUrl("1818", "420x420", fetchImpl);
		await resolveAssetUrl("1818", "420x420", fetchImpl);
		expect(calls).toBe(1);
	});

	it("throws when the lookup fails", async () => {
		await expect(
			resolveAssetUrl(
				"1818",
				"420x420",
				() =>
					Promise.resolve({
						ok: false,
						status: 429,
						statusText: "Too Many Requests",
					} as Response),
				{ retryDelays: [] },
			),
		).rejects.toThrow("429");
	});

	it("retries a throttled lookup instead of failing it", async () => {
		let calls = 0;
		const fetchImpl = (() => {
			calls += 1;
			if (calls === 1) {
				return Promise.resolve({
					ok: false,
					status: 429,
					statusText: "Too Many Requests",
					headers: new Headers(),
				} as Response);
			}
			return okThumbnail("https://tr.rbxcdn.test/abc")();
		}) as typeof fetch;
		const url = await resolveAssetUrl("1818", "420x420", fetchImpl, {
			retryDelays: [0],
		});
		expect(url).toBe("https://tr.rbxcdn.test/abc");
		expect(calls).toBe(2);
	});

	it("asks for lookups made together in one request", async () => {
		const requested: string[] = [];
		const fetchImpl = ((input: RequestInfo | URL) => {
			const url = new URL(String(input));
			requested.push(url.searchParams.get("assetIds") ?? "");
			const ids = (url.searchParams.get("assetIds") ?? "").split(",");
			return Promise.resolve({
				ok: true,
				status: 200,
				statusText: "OK",
				json: () =>
					Promise.resolve({
						data: ids.map((id) => ({
							targetId: Number(id),
							state: "Completed",
							imageUrl: `https://cdn.test/${id}`,
						})),
					}),
			} as Response);
		}) as typeof fetch;
		const urls = await Promise.all(
			["1", "2", "3"].map((id) => resolveAssetUrl(id, "420x420", fetchImpl)),
		);
		expect(urls).toEqual([
			"https://cdn.test/1",
			"https://cdn.test/2",
			"https://cdn.test/3",
		]);
		expect(requested).toEqual(["1,2,3"]);
	});

	it("throws when the thumbnail is not ready", async () => {
		await expect(
			resolveAssetUrl(
				"1818",
				"420x420",
				okThumbnail("https://tr.rbxcdn.test/abc", "Pending"),
			),
		).rejects.toThrow("no thumbnail");
	});
});

describe("assetIdsIn", () => {
	it("finds every id a bundle spells out, once each", () => {
		const ids = assetIdsIn(
			'const a = "rbxassetid://1818"; const b = "rbxassetid://99";\n' +
				'const c = "rbxassetid://1818";',
		);
		expect([...ids].sort()).toEqual(["1818", "99"]);
	});

	it("ignores an id that is not spelled out", () => {
		// The documented limit: a runtime-assembled id is not in the output to find.
		expect([...assetIdsIn('"rbxassetid://" + id')]).toEqual([]);
	});
});

describe("loomAssetBundle", () => {
	beforeEach(() => {
		clearAssetCache();
	});

	/** A fetch that answers the thumbnail lookup, then the CDN download. */
	function fakeCdn(bytes = new Uint8Array([1, 2, 3])) {
		return ((input: RequestInfo | URL) => {
			const url = String(input);
			if (url.startsWith("https://thumbnails.roblox.com")) {
				const ids = (new URL(url).searchParams.get("assetIds") ?? "").split(
					",",
				);
				return Promise.resolve({
					ok: true,
					status: 200,
					statusText: "OK",
					json: () =>
						Promise.resolve({
							data: ids.map((id) => ({
								targetId: Number(id),
								state: "Completed",
								imageUrl: `https://cdn.test/${id}`,
							})),
						}),
				} as Response);
			}
			return Promise.resolve({
				ok: true,
				status: 200,
				statusText: "OK",
				headers: new Headers({ "content-type": "image/png" }),
				arrayBuffer: () => Promise.resolve(bytes.buffer),
			} as unknown as Response);
		}) as typeof fetch;
	}

	/** Run the plugin's generateBundle over a fake bundle, collecting emits. */
	async function bake(
		bundle: Record<string, unknown>,
		fetchImpl = fakeCdn(),
		discover?: AssetBundleOptions["discover"],
	): Promise<{ emitted: Record<string, unknown>; warnings: string[] }> {
		const plugin = loomAssetBundle({
			fetchImpl,
			...(discover ? { discover } : {}),
		});
		const emitted: Record<string, unknown> = {};
		const warnings: string[] = [];
		const context = {
			emitFile: (file: { fileName: string; source: unknown }) => {
				emitted[file.fileName] = file.source;
			},
			warn: (message: string) => warnings.push(message),
		};
		const hook = plugin.generateBundle;
		const handler = typeof hook === "function" ? hook : hook?.handler;
		await handler?.call(
			context as never,
			{} as never,
			bundle as never,
			false as never,
		);
		return { emitted, warnings };
	}

	it("downloads every id in the bundle and writes a manifest", async () => {
		const { emitted } = await bake({
			"index.js": { type: "chunk", code: 'x("rbxassetid://1818")' },
			"style.css": { type: "asset", source: "a{--i:url(rbxassetid://99)}" },
		});
		expect(Object.keys(emitted).sort()).toEqual([
			"__loom/asset/1818.png",
			"__loom/asset/99.png",
			"__loom/assets.json",
		]);
		expect(JSON.parse(emitted["__loom/assets.json"] as string)).toEqual({
			"1818": "__loom/asset/1818.png",
			"99": "__loom/asset/99.png",
		});
	});

	it("emits nothing at all when the bundle mentions no assets", async () => {
		const { emitted } = await bake({
			"index.js": { type: "chunk", code: "console.log(1)" },
		});
		expect(emitted).toEqual({});
	});

	it("warns and skips an id that will not resolve, instead of failing the build", async () => {
		const failing = ((input: RequestInfo | URL) =>
			String(input).startsWith("https://thumbnails.roblox.com")
				? Promise.resolve({
						ok: false,
						status: 404,
						statusText: "Not Found",
					} as Response)
				: Promise.reject(new Error("unreachable"))) as typeof fetch;
		const { emitted, warnings } = await bake(
			{ "index.js": { type: "chunk", code: '"rbxassetid://1818"' } },
			failing,
		);
		expect(warnings.join()).toContain("asset 1818");
		// The manifest is still written — just without the id that failed.
		expect(JSON.parse(emitted["__loom/assets.json"] as string)).toEqual({});
	});

	it("names the file after what the CDN served", async () => {
		const jpeg = ((input: RequestInfo | URL) =>
			String(input).startsWith("https://thumbnails.roblox.com")
				? fakeCdn()(input)
				: Promise.resolve({
						ok: true,
						status: 200,
						statusText: "OK",
						headers: new Headers({ "content-type": "image/jpeg" }),
						arrayBuffer: () => Promise.resolve(new Uint8Array([1]).buffer),
					} as unknown as Response)) as typeof fetch;
		const { emitted } = await bake(
			{ "index.js": { type: "chunk", code: '"rbxassetid://7"' } },
			jpeg,
		);
		expect(Object.keys(emitted)).toContain("__loom/asset/7.jpg");
	});

	// The bundle a component library produces: the prefix is there, the id is a
	// bare number somewhere else entirely. Only the prerender can answer.
	const COMPOSED = { "index.js": { type: "chunk", code: '"rbxassetid://"+n' } };

	it("bakes an id only the prerender could have found", async () => {
		const { emitted } = await bake({ ...COMPOSED }, fakeCdn(), async () => [
			"rbxassetid://424242",
			// A plain URL among them: the renderer loads it as-is, so it is not an
			// id and must not become a manifest entry.
			"https://cdn.test/plain.png",
		]);
		expect(JSON.parse(emitted["__loom/assets.json"] as string)).toEqual({
			"424242": "__loom/asset/424242.png",
		});
	});

	it("says so when composition is all that is left", async () => {
		const { emitted, warnings } = await bake(
			{ ...COMPOSED },
			fakeCdn(),
			async () => [],
		);
		expect(warnings.join()).toContain(
			"composes `rbxassetid://` ids at runtime",
		);
		expect(emitted).toEqual({});
	});

	it("stays quiet when the prerender covered the composed ids", async () => {
		const { warnings } = await bake({ ...COMPOSED }, fakeCdn(), async () => [
			"rbxassetid://424242",
		]);
		expect(warnings).toEqual([]);
	});

	// Issue #13: the prerender died before it reached a scene — an installed
	// layout handed its reconciler the host app's React — and took the whole
	// `next build` with it.
	it("survives a prerender that will not even start", async () => {
		const { emitted, warnings } = await bake(
			{
				"index.js": {
					type: "chunk",
					code: '"rbxassetid://"+n;"rbxassetid://1818"',
				},
			},
			fakeCdn(),
			async () => {
				throw new TypeError(
					"Cannot read properties of undefined (reading 'ReactCurrentBatchConfig')",
				);
			},
		);
		expect(warnings.join()).toContain(
			"could not prerender the gallery targets",
		);
		expect(warnings.join()).toContain("ReactCurrentBatchConfig");
		// And the literal ids the scan read are baked regardless — a build that
		// loses its composed icons must not lose the spelled-out ones too.
		expect(JSON.parse(emitted["__loom/assets.json"] as string)).toEqual({
			"1818": "__loom/asset/1818.png",
		});
	});

	it("does not prerender a build that composes nothing", async () => {
		const prerendered: string[] = [];
		const spy = async () => {
			prerendered.push("ran");
			return [];
		};
		// No images at all…
		await bake(
			{ "index.js": { type: "chunk", code: "console.log(1)" } },
			fakeCdn(),
			spy,
		);
		// …and every id spelled out, which the scan already has in full.
		await bake(
			{ "index.js": { type: "chunk", code: '"rbxassetid://1818"' } },
			fakeCdn(),
			spy,
		);
		expect(prerendered).toEqual([]);
	});
});

describe("composesAssetIds", () => {
	it("spots an id built at runtime", () => {
		expect(composesAssetIds('"rbxassetid://"+n')).toBe(true);
		expect(composesAssetIds(`\`rbxassetid://\${id}\``)).toBe(true);
	});

	it("leaves a spelled-out id alone — the scan already has it", () => {
		expect(composesAssetIds('"rbxassetid://1818"')).toBe(false);
		expect(composesAssetIds("nothing to see")).toBe(false);
	});
});
