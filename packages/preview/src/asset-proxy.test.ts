/**
 * The dev-server asset route: path matching against the configured base, the
 * thumbnail lookup, and the cache that keeps a repaint off the network.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
	assetIdFromPath,
	clearAssetCache,
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
			resolveAssetUrl("1818", "420x420", () =>
				Promise.resolve({
					ok: false,
					status: 429,
					statusText: "Too Many Requests",
				} as Response),
			),
		).rejects.toThrow("429");
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
