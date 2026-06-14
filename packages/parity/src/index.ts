/**
 * `@loom-dev/parity` — a 1:1 geometry + visual parity harness that compares
 * Loom's preview output against real Roblox.
 *
 * - {@link diffSnapshots} aligns two {@link ParitySnapshot}s by Name path and
 *   reports per-instance position/size/visual divergence with severity.
 * - {@link normalizeLoomDebugPayload} adapts a Loom layout-debug payload into a
 *   snapshot.
 * - {@link renderHtmlReport} / {@link renderTextReport} render a report.
 *
 * The in-browser Loom capture (which also reads visual properties) lives in the
 * separate `@loom-dev/parity/capture` entry so this module stays dependency-free
 * and usable from plain Node tooling.
 */

export type { DiffOptions } from "./diff";
export { DEFAULT_TOLERANCE, diffSnapshots } from "./diff";
export type { NormalizeOptions } from "./normalize";
export { normalizeLoomDebugPayload } from "./normalize";
export { renderHtmlReport, renderTextReport } from "./report";
export type {
	ParityColor3,
	ParityFieldDiff,
	ParityNode,
	ParityNodeDiff,
	ParityNodeStatus,
	ParityReport,
	ParitySeverity,
	ParitySnapshot,
	ParityTolerance,
	ParityVec2,
	ParityVisualProps,
} from "./types";
