/**
 * `rbxassetid://` resolution for the preview, as a same-origin dev-server route.
 *
 * A browser cannot resolve an asset id by itself: Roblox's thumbnail API sends
 * no `Access-Control-Allow-Origin`, so the JSON read is blocked cross-origin.
 * The *image* it points at needs no CORS at all — an `<img>` loads any origin —
 * so only the id → URL hop has to happen server-side. This plugin does that hop
 * in the dev server and answers with a redirect, which keeps the browser half
 * synchronous: the client resolver just points `<img src>` at this route.
 *
 * Scope: the dev server (`loom preview`, the embedded server, Next dev). A
 * static gallery build has no server to ask, so asset ids do not resolve there
 * — a build that needs them should pass real URLs, or install its own
 * `setImageResolver`.
 */
import type { Plugin, ViteDevServer } from "vite";

/** Route the client resolver points at, appended to the configured base. */
export const ASSET_ROUTE = "__loom/asset/";

/** How long a resolved CDN URL stays good enough to hand out again. */
const CACHE_TTL_MS = 10 * 60 * 1000;

interface CacheEntry {
	url: string;
	expires: number;
}

const cache = new Map<string, CacheEntry>();

/** Exposed for tests; the dev server never needs to clear this itself. */
export function clearAssetCache(): void {
	cache.clear();
}

/**
 * `assetId` → CDN image URL via Roblox's thumbnail API. Throws with a readable
 * message on anything the caller should see as a 502.
 */
export async function resolveAssetUrl(
	assetId: string,
	size = "420x420",
	fetchImpl: typeof fetch = fetch,
): Promise<string> {
	const key = `${assetId}@${size}`;
	const hit = cache.get(key);
	if (hit && hit.expires > Date.now()) return hit.url;

	const endpoint = new URL("https://thumbnails.roblox.com/v1/assets");
	endpoint.searchParams.set("assetIds", assetId);
	endpoint.searchParams.set("size", size);
	endpoint.searchParams.set("format", "Png");
	endpoint.searchParams.set("isCircular", "false");

	const response = await fetchImpl(endpoint);
	if (!response.ok) {
		throw new Error(
			`thumbnail lookup failed (${response.status} ${response.statusText})`,
		);
	}
	const body = (await response.json()) as {
		data?: Array<{ state?: string; imageUrl?: string }>;
	};
	const thumbnail = body.data?.[0];
	if (!thumbnail?.imageUrl || thumbnail.state !== "Completed") {
		throw new Error(
			`no thumbnail for asset ${assetId} (state: ${thumbnail?.state ?? "missing"})`,
		);
	}
	cache.set(key, {
		url: thumbnail.imageUrl,
		expires: Date.now() + CACHE_TTL_MS,
	});
	return thumbnail.imageUrl;
}

/** `/__loom/asset/12345` → `"12345"`; undefined when the path is not ours. */
export function assetIdFromPath(
	path: string,
	base: string,
): string | undefined {
	const route = `${base}${ASSET_ROUTE}`;
	if (!path.startsWith(route)) return undefined;
	const id = path.slice(route.length);
	return /^\d+$/.test(id) ? id : undefined;
}

/**
 * Serve `<base>__loom/asset/<id>` as a 302 to the asset's CDN image, so an
 * `<img>` pointed at this route paints the Roblox asset.
 */
export function loomAssetProxy(): Plugin {
	let base = "/";
	return {
		name: "loom:asset-proxy",
		configResolved(config) {
			base = config.base;
		},
		configureServer(server: ViteDevServer) {
			server.middlewares.use((req, res, next) => {
				const path = (req.url ?? "/").split("?")[0] ?? "/";
				const assetId = assetIdFromPath(path, base);
				if (assetId === undefined) return next();
				resolveAssetUrl(assetId)
					.then((url) => {
						res.statusCode = 302;
						res.setHeader("Location", url);
						// The CDN URL is signed and expires; let the browser reuse this
						// redirect for a while but never bake it into a build cache.
						res.setHeader("Cache-Control", "private, max-age=300");
						res.end();
					})
					.catch((err: unknown) => {
						const message = err instanceof Error ? err.message : String(err);
						console.warn(`[loom] asset ${assetId}: ${message}`);
						res.statusCode = 502;
						res.setHeader("Content-Type", "text/plain");
						res.end(`could not resolve asset ${assetId}: ${message}`);
					});
			});
		},
	};
}
