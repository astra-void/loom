/**
 * CLI-side gallery glue: turning `--targets` / `--port` flags and an optional
 * `loom.config.ts` into a decision the `loom preview` command can act on, plus
 * the workspace-root probe its `fs.allow` needs.
 *
 * Discovery, codegen and the gallery plugins themselves live in
 * `@loom-dev/preview/gallery` — the Vite plugin owns gallery mode so a plain
 * `vite.config.ts` (`loomPreview({ targets })`) gets exactly what the CLI does.
 * They are re-exported here for the CLI's own consumers (`loom-dev/embed`).
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { normalizeTargetsPatterns } from "@loom-dev/preview/gallery";

export {
	DEFAULT_TARGETS_GLOB,
	DEFAULT_TARGETS_GLOBS,
	findLoomTargets,
	type GalleryParams,
	normalizeTargetsPatterns,
	parseBackgroundColor,
	parseGalleryParams,
	type TargetsInput,
} from "@loom-dev/preview/gallery";

export const DEFAULT_PORT = 5173;

/** Minimal loom.config.ts shape the CLI understands. */
export interface LoomFileConfig {
	targets?: string | string[];
	port?: number;
	/**
	 * Package redirects for packages loom can't run in the browser — see
	 * `LoomPreviewOptions.shims`. Paths are relative to the project dir (the one
	 * holding this `loom.config.ts`).
	 */
	shims?: Record<string, string>;
}

export interface GalleryDecision {
	/** Discovery globs (relative to the project dir); undefined = no gallery mode. */
	patterns?: string[];
	port: number;
	/** The config's `shims`, when it declared a usable one. */
	shims?: Record<string, string>;
	/** Console hint to print (e.g. a legacy config was found and skipped). */
	hint?: string;
}

/** A `shims` field is usable only if it is a flat record of non-empty strings. */
function validShims(value: unknown): Record<string, string> | undefined {
	if (typeof value !== "object" || value === null || Array.isArray(value))
		return undefined;
	const entries = Object.entries(value);
	if (entries.length === 0) return undefined;
	if (!entries.every(([k, v]) => typeof v === "string" && k !== "" && v !== ""))
		return undefined;
	return value as Record<string, string>;
}

/**
 * Decide gallery mode from CLI flags + an optional loom.config.ts default
 * export. CLI flags win; the config's `targets`/`port`/`shims` fill in when
 * flags are absent; a config with none of those fields (e.g. the legacy lattice
 * shape) is skipped entirely, with a hint.
 *
 * `shims` alone counts as a usable config: a project can preview a single
 * client entry — no gallery at all — and still need a package redirect.
 */
export function resolveGalleryOptions(input: {
	cliTargets?: string | true;
	cliPort?: number;
	configPresent?: boolean;
	config?: unknown;
}): GalleryDecision {
	const cfg =
		typeof input.config === "object" && input.config !== null
			? (input.config as Record<string, unknown>)
			: undefined;
	const cfgTargets = cfg?.targets;
	const validCfgTargets =
		typeof cfgTargets === "string" ||
		(Array.isArray(cfgTargets) &&
			cfgTargets.length > 0 &&
			cfgTargets.every((t) => typeof t === "string"))
			? (cfgTargets as string | string[])
			: undefined;
	const cfgShims = validShims(cfg?.shims);
	const usableConfig = validCfgTargets !== undefined || cfgShims !== undefined;

	let patterns: string[] | undefined;
	let hint: string | undefined;
	if (input.cliTargets !== undefined) {
		patterns = normalizeTargetsPatterns(input.cliTargets);
	} else if (validCfgTargets !== undefined) {
		patterns = normalizeTargetsPatterns(validCfgTargets);
	} else if (input.configPresent && !usableConfig) {
		hint =
			"loom: loom.config.ts found, but its default export has no `targets` or " +
			"`shims` field — skipping it (legacy config?). Use `--targets [glob]` or " +
			"export `{ targets?: string | string[], port?: number, shims?: Record<string, string> }`.";
	}

	// Config port/shims only apply when the config itself is a usable new-style
	// config — a skipped legacy config is skipped whole.
	const cfgPort =
		usableConfig && typeof cfg?.port === "number" ? cfg.port : undefined;
	const port = input.cliPort ?? cfgPort ?? DEFAULT_PORT;

	return { patterns, port, hint, ...(cfgShims ? { shims: cfgShims } : {}) };
}

/**
 * The pnpm workspace root above a project, if any, so a dev server can read
 * shared workspace assets. Keyed on `pnpm-workspace.yaml` only — `.git` alone is
 * not a signal (it would over-widen `fs.allow` to e.g. a home-dir git repo).
 */
export function findWorkspaceRoot(start: string): string | undefined {
	let dir = start;
	for (let i = 0; i < 24; i++) {
		if (existsSync(resolve(dir, "pnpm-workspace.yaml"))) return dir;
		const parent = resolve(dir, "..");
		if (parent === dir) break;
		dir = parent;
	}
	return undefined;
}
