import { posix } from "node:path";
import { normalizePath } from "vite";

const VITE_FS_PREFIX = "/@fs/";

/**
 * Convert an absolute filesystem path to Vite's development-only `/@fs/` URL
 * space. Normalize backslashes before calling Vite so synthetic Windows paths
 * behave the same on every host OS (Vite's `normalizePath` is host-sensitive).
 */
export function toViteFsUrl(filePath: string): string {
	const normalized = normalizePath(filePath.replaceAll("\\", "/"));
	return posix.join(VITE_FS_PREFIX, normalized);
}

/**
 * The filesystem path behind a `/@fs/` URL (the inverse of `toViteFsUrl`), or
 * `undefined` for any other URL.
 */
export function fromViteFsUrl(url: string): string | undefined {
	if (!url.startsWith(VITE_FS_PREFIX)) return undefined;
	const path = url.slice(VITE_FS_PREFIX.length - 1); // keep the leading `/`
	// `/C:/proj` is a Windows drive path; posix paths keep their `/`.
	return /^\/[A-Za-z]:\//.test(path) ? path.slice(1) : path;
}
