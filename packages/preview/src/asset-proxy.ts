/**
 * `rbxassetid://` resolution for the preview: a dev-server route, and a
 * build-time bake for the static output that has no server to ask.
 *
 * A browser cannot resolve an asset id by itself: Roblox's thumbnail API sends
 * no `Access-Control-Allow-Origin`, so the JSON read is blocked cross-origin.
 * The *image* it points at needs no CORS at all — a browser loads any origin —
 * so only the id → URL hop has to happen server-side.
 *
 * - **Dev** ({@link loomAssetProxy}): the server does that hop and answers with
 *   a redirect, which keeps the browser half synchronous — the client resolver
 *   just points the layer at this route.
 * - **Build** ({@link loomAssetBundle}): there is no server later, so the ids
 *   the build can account for — read out of the emitted output, plus whatever
 *   prerendering the targets turned up (`./prerender.ts`) — are resolved *now*,
 *   the images are downloaded into the output, and a manifest maps each id to
 *   its emitted file. The page then needs nothing but its own origin.
 */
import type { Plugin, ViteDevServer } from "vite";

/** Route the client resolver points at, appended to the configured base. */
export const ASSET_ROUTE = "__loom/asset/";

/**
 * Batch lookup route for the dev server: `<base>__loom/assets?ids=1,2,3`
 * answers `{ "1": url | null, … }`. The page asks it for every id a render
 * turned up at once — a browser holds only six connections to one host, so
 * one redirect per `<img>` reaches the server six ids at a time and a page of
 * icons becomes dozens of thumbnail requests and a rate limit. `./globals.ts`
 * spells the path out again, being page code.
 */
export const ASSET_BATCH_ROUTE = "__loom/assets";

/**
 * Where the baked manifest lands in a build, appended to the configured base.
 * `./globals.ts` spells this out again rather than importing it: that module is
 * bundled into the page, and this one is server code.
 */
export const ASSET_MANIFEST = "__loom/assets.json";

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
	inflight.clear();
}

/** How long lookups wait for company before going out as one request. */
const BATCH_WINDOW_MS = 10;

/** The most ids the thumbnail endpoint takes in one `assetIds` list. */
const BATCH_LIMIT = 100;

/**
 * Pauses between attempts when the thumbnail API answers 429 or 5xx. A page
 * of icons asks for dozens of ids at once, and one request per id is exactly
 * what trips Roblox's rate limit — so lookups are batched below, and the ones
 * that still get throttled wait and try again instead of leaving a hole where
 * the image should be for the rest of the session.
 */
const DEFAULT_RETRY_DELAYS_MS = [500, 1000, 2000, 4000];

export interface ResolveAssetOptions {
	/** Pauses between retries of a throttled lookup; `[]` fails on the first. */
	retryDelays?: readonly number[];
}

interface Waiter {
	resolve: (url: string) => void;
	reject: (err: Error) => void;
}

interface Batch {
	ids: Map<string, Waiter[]>;
	timer: ReturnType<typeof setTimeout> | undefined;
	retryDelays: readonly number[];
}

/** Open batches, per fetch implementation and thumbnail size. */
const batches = new Map<typeof fetch, Map<string, Batch>>();

/** Lookups already on their way, so a repeat joins instead of re-asking. */
const inflight = new Map<string, Promise<string>>();

const sleep = (ms: number): Promise<void> =>
	new Promise((resolve) => setTimeout(resolve, ms));

/**
 * At most this many thumbnail requests in the air at once. A page of several
 * hundred icons is still several full batches, and sending them all together
 * is its own burst — the rate limit counts requests, not ids.
 */
const MAX_CONCURRENT_LOOKUPS = 2;
let activeLookups = 0;
const lookupQueue: Array<() => void> = [];

/** Run `task` once a lookup slot is free. */
async function withLookupSlot<T>(task: () => Promise<T>): Promise<T> {
	if (activeLookups >= MAX_CONCURRENT_LOOKUPS) {
		// The finishing lookup hands its slot straight over, so the count holds.
		await new Promise<void>((resolve) => lookupQueue.push(resolve));
	} else {
		activeLookups += 1;
	}
	try {
		return await task();
	} finally {
		const next = lookupQueue.shift();
		if (next) next();
		else activeLookups -= 1;
	}
}

/** `Retry-After` in milliseconds, when the response carries a usable one. */
function retryAfterMs(response: Response): number | undefined {
	const raw = response.headers?.get?.("retry-after");
	if (!raw) return undefined;
	const seconds = Number(raw);
	return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : undefined;
}

/** The thumbnail endpoint, retried while it says to come back later. */
async function fetchThumbnails(
	ids: readonly string[],
	size: string,
	fetchImpl: typeof fetch,
	retryDelays: readonly number[],
): Promise<Array<{ targetId?: number; state?: string; imageUrl?: string }>> {
	const endpoint = new URL("https://thumbnails.roblox.com/v1/assets");
	endpoint.searchParams.set("assetIds", ids.join(","));
	endpoint.searchParams.set("size", size);
	endpoint.searchParams.set("format", "Png");
	endpoint.searchParams.set("isCircular", "false");

	for (let attempt = 0; ; attempt++) {
		const response = await fetchImpl(endpoint);
		if (response.ok) {
			const body = (await response.json()) as {
				data?: Array<{ targetId?: number; state?: string; imageUrl?: string }>;
			};
			return body.data ?? [];
		}
		const throttled = response.status === 429 || response.status >= 500;
		const delay = retryDelays[attempt];
		if (!throttled || delay === undefined) {
			throw new Error(
				`thumbnail lookup failed (${response.status} ${response.statusText})`,
			);
		}
		await sleep(retryAfterMs(response) ?? delay);
	}
}

/** Send one batch and settle every lookup waiting on it. */
async function flushBatch(
	batch: Batch,
	size: string,
	fetchImpl: typeof fetch,
): Promise<void> {
	const ids = [...batch.ids.keys()];
	try {
		const data = await withLookupSlot(() =>
			fetchThumbnails(ids, size, fetchImpl, batch.retryDelays),
		);
		for (const id of ids) {
			// Matched by `targetId`; a lone id can only be the one entry there is.
			const thumbnail =
				data.find((entry) => String(entry.targetId) === id) ??
				(ids.length === 1 ? data[0] : undefined);
			const waiters = batch.ids.get(id) ?? [];
			if (thumbnail?.imageUrl && thumbnail.state === "Completed") {
				cache.set(`${id}@${size}`, {
					url: thumbnail.imageUrl,
					expires: Date.now() + CACHE_TTL_MS,
				});
				for (const waiter of waiters) waiter.resolve(thumbnail.imageUrl);
			} else {
				const err = new Error(
					`no thumbnail for asset ${id} (state: ${thumbnail?.state ?? "missing"})`,
				);
				for (const waiter of waiters) waiter.reject(err);
			}
		}
	} catch (err) {
		const error = err instanceof Error ? err : new Error(String(err));
		for (const waiters of batch.ids.values()) {
			for (const waiter of waiters) waiter.reject(error);
		}
	}
}

/** Queue `assetId` on the open batch for its size, opening one if needed. */
function enqueue(
	assetId: string,
	size: string,
	fetchImpl: typeof fetch,
	retryDelays: readonly number[],
): Promise<string> {
	let bySize = batches.get(fetchImpl);
	if (!bySize) {
		bySize = new Map();
		batches.set(fetchImpl, bySize);
	}
	let batch = bySize.get(size);
	if (!batch) {
		batch = { ids: new Map(), timer: undefined, retryDelays };
		bySize.set(size, batch);
	}
	const open = batch;
	const send = (): void => {
		if (open.timer !== undefined) clearTimeout(open.timer);
		if (bySize.get(size) === open) bySize.delete(size);
		if (bySize.size === 0) batches.delete(fetchImpl);
		void flushBatch(open, size, fetchImpl);
	};
	const promise = new Promise<string>((resolve, reject) => {
		const waiters = open.ids.get(assetId) ?? [];
		waiters.push({ resolve, reject });
		open.ids.set(assetId, waiters);
	});
	if (open.ids.size >= BATCH_LIMIT) send();
	else if (open.timer === undefined)
		open.timer = setTimeout(send, BATCH_WINDOW_MS);
	return promise;
}

/**
 * `assetId` → CDN image URL via Roblox's thumbnail API. Throws with a readable
 * message on anything the caller should see as a 502.
 *
 * Lookups made within a few milliseconds of each other share one request, and
 * a throttled request is retried (see {@link DEFAULT_RETRY_DELAYS_MS}).
 */
export async function resolveAssetUrl(
	assetId: string,
	size = "420x420",
	fetchImpl: typeof fetch = fetch,
	options: ResolveAssetOptions = {},
): Promise<string> {
	const key = `${assetId}@${size}`;
	const hit = cache.get(key);
	if (hit && hit.expires > Date.now()) return hit.url;
	const pending = inflight.get(key);
	if (pending) return pending;
	const lookup = enqueue(
		assetId,
		size,
		fetchImpl,
		options.retryDelays ?? DEFAULT_RETRY_DELAYS_MS,
	).finally(() => inflight.delete(key));
	inflight.set(key, lookup);
	return lookup;
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
				const [path = "/", query = ""] = (req.url ?? "/").split("?");
				if (path === `${base}${ASSET_BATCH_ROUTE}`) {
					const ids = (new URLSearchParams(query).get("ids") ?? "")
						.split(",")
						.filter((id) => /^\d+$/.test(id));
					void Promise.allSettled(ids.map((id) => resolveAssetUrl(id))).then(
						(results) => {
							const body: Record<string, string | null> = {};
							for (const [index, result] of results.entries()) {
								const id = ids[index] as string;
								if (result.status === "fulfilled") body[id] = result.value;
								else {
									body[id] = null;
									const reason = result.reason;
									console.warn(
										`[loom] asset ${id}: ${reason instanceof Error ? reason.message : String(reason)}`,
									);
								}
							}
							res.statusCode = 200;
							res.setHeader("Content-Type", "application/json");
							res.setHeader("Cache-Control", "no-store");
							res.end(JSON.stringify(body));
						},
					);
					return;
				}
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

// --- static build ------------------------------------------------------------

/** Every `rbxassetid://<id>` a piece of emitted output mentions. */
export function assetIdsIn(
	code: string,
	into = new Set<string>(),
): Set<string> {
	for (const match of code.matchAll(/rbxassetid:\/\/(\d+)/g)) {
		const id = match[1];
		if (id !== undefined) into.add(id);
	}
	return into;
}

/**
 * Whether the output builds an asset id at runtime — `rbxassetid://` with
 * something other than digits after it, which is what
 * `` `rbxassetid://${iconId}` `` minifies to.
 *
 * The ids behind one of these are unreadable here (after bundling they are bare
 * numbers among every other number), so the scan alone would silently bake
 * nothing. It is the reason for the prerender, and the thing to name in the
 * warning when the prerender still came back empty.
 */
export function composesAssetIds(code: string): boolean {
	return /rbxassetid:\/\/(?!\d)/.test(code);
}

/** File extension for a downloaded thumbnail, from what the CDN said it is. */
function extensionFor(contentType: string | null): string {
	if (contentType?.includes("jpeg")) return "jpg";
	if (contentType?.includes("webp")) return "webp";
	if (contentType?.includes("gif")) return "gif";
	// The thumbnail endpoint is asked for `format=Png`, so this is the answer
	// almost every time.
	return "png";
}

/** id → the bytes and the name they were served under. */
async function downloadAsset(
	assetId: string,
	fetchImpl: typeof fetch,
): Promise<{ fileName: string; source: Uint8Array }> {
	const url = await resolveAssetUrl(assetId, "420x420", fetchImpl);
	const response = await fetchImpl(url);
	if (!response.ok) {
		throw new Error(
			`download failed (${response.status} ${response.statusText})`,
		);
	}
	return {
		fileName: `${ASSET_ROUTE}${assetId}.${extensionFor(response.headers.get("content-type"))}`,
		source: new Uint8Array(await response.arrayBuffer()),
	};
}

export interface AssetBundleOptions {
	/** Injectable for tests; the build itself has no reason to pass one. */
	fetchImpl?: typeof fetch;
	/**
	 * Extra `Image` values from somewhere the emitted code cannot be read for
	 * them — `./prerender.ts` mounts the targets and reports what their trees
	 * hold, which is how a runtime-composed id gets baked. Absent, the build
	 * falls back to the literal scan alone.
	 */
	discover?: (
		root: string,
		warn: (message: string) => void,
	) => Promise<Iterable<string>>;
}

/**
 * Resolve and download every asset id the build can account for, then emit them
 * — plus a `<base>__loom/assets.json` manifest — into the build output, so a
 * static preview paints its `rbxassetid://` images with no server behind it.
 *
 * Two sources, because one is not enough. The **scan** reads the emitted output
 * for `rbxassetid://<digits>`, which finds every id a source spells out. The
 * **prerender** ({@link AssetBundleOptions.discover}) mounts the gallery
 * targets and reads their live trees, which is the only way to see an id built
 * at runtime — `` `rbxassetid://${iconId}` `` leaves nothing in the bundle to
 * match. What neither covers is an id the first render never reaches (behind a
 * hover state, or fetched later); that one stays unresolved, and the build says
 * so rather than leaving a blank image unexplained.
 *
 * Never fails the build, and that holds for the whole pass, not just the
 * downloads: an id that will not resolve (offline, deleted, or moderated) is
 * warned about and left out of the manifest, and a prerender that cannot even
 * start is warned about and skipped. Either way the output is what it would
 * have been before this plugin ran.
 */
export function loomAssetBundle(options: AssetBundleOptions = {}): Plugin {
	const fetchImpl = options.fetchImpl ?? fetch;
	let root = process.cwd();
	return {
		name: "loom:asset-bundle",
		apply: "build",
		configResolved(config) {
			root = config.root;
		},
		async generateBundle(_options, bundle) {
			const ids = new Set<string>();
			let composed = false;
			for (const file of Object.values(bundle)) {
				const code = file.type === "chunk" ? file.code : file.source;
				if (typeof code !== "string") continue;
				assetIdsIn(code, ids);
				composed ||= composesAssetIds(code);
			}
			const scanned = ids.size;
			let prerenderFailed = false;
			// Only for composition. With every id spelled out the scan already has
			// them all, and mounting the whole gallery to rediscover them would be
			// seconds spent to learn nothing.
			if (options.discover && composed) {
				try {
					for (const image of await options.discover(root, (message) => {
						this.warn(`[loom] ${message}`);
					})) {
						assetIdsIn(image, ids);
					}
				} catch (err: unknown) {
					// A *scene* that will not render is already warned about and skipped
					// inside the prerender. Reaching here means the pass itself never
					// got as far as a scene — a Vite server that would not start, a
					// module that would not load — and that is no reason to lose a build
					// over images. Fall back to the ids the scan read.
					prerenderFailed = true;
					const message = err instanceof Error ? err.message : String(err);
					this.warn(
						`[loom] could not prerender the gallery targets, so any \`rbxassetid://\` ` +
							`id this build composes at runtime stays unresolved in the static ` +
							`output: ${message}`,
					);
				}
			}
			if (composed && !prerenderFailed && ids.size === scanned) {
				this.warn(
					"[loom] this build composes `rbxassetid://` ids at runtime, and " +
						"prerendering the targets surfaced none of them — those images " +
						"will not paint in the static output. They resolve under `loom " +
						"preview`, which has a server to ask.",
				);
			}
			if (ids.size === 0) return;

			const manifest: Record<string, string> = {};
			await Promise.all(
				[...ids].map(async (assetId) => {
					try {
						const { fileName, source } = await downloadAsset(
							assetId,
							fetchImpl,
						);
						this.emitFile({ type: "asset", fileName, source });
						manifest[assetId] = fileName;
					} catch (err: unknown) {
						const message = err instanceof Error ? err.message : String(err);
						this.warn(`[loom] asset ${assetId}: ${message}`);
					}
				}),
			);
			this.emitFile({
				type: "asset",
				fileName: ASSET_MANIFEST,
				source: JSON.stringify(manifest),
			});
		},
	};
}
