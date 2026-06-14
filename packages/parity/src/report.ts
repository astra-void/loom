import type { ParityFieldDiff, ParityReport, ParitySeverity } from "./types";

function formatValue(value: unknown): string {
	if (value === null || value === undefined) {
		return "—";
	}
	if (typeof value === "number") {
		return Number.isInteger(value) ? String(value) : value.toFixed(2);
	}
	if (typeof value === "boolean" || typeof value === "string") {
		return String(value);
	}
	const record = value as Record<string, unknown>;
	if (typeof record.x === "number" && typeof record.y === "number") {
		return `(${formatValue(record.x)}, ${formatValue(record.y)})`;
	}
	if (typeof record.r === "number" && typeof record.g === "number") {
		const to255 = (c: number) => Math.round(c * 255);
		return `rgb(${to255(record.r as number)}, ${to255(
			record.g as number,
		)}, ${to255(record.b as number)})`;
	}
	return JSON.stringify(value);
}

function formatDelta(field: ParityFieldDiff): string {
	return field.delta === undefined ? "" : formatValue(field.delta);
}

const SEVERITY_ICON: Record<ParitySeverity, string> = {
	high: "●",
	medium: "◐",
	low: "○",
};

/** A compact, colourless console summary suitable for CI logs. */
export function renderTextReport(report: ParityReport): string {
	const lines: string[] = [];
	const { summary } = report;
	const scene = report.scene ? ` [${report.scene}]` : "";
	lines.push(`Loom ↔ Roblox parity${scene}`);
	lines.push(
		`  viewport: loom ${formatValue(report.viewport.loom)} vs roblox ${formatValue(
			report.viewport.roblox,
		)}${report.viewport.mismatch ? "  ⚠ MISMATCH (scale sizes will diverge)" : ""}`,
	);
	lines.push(
		`  nodes: ${summary.matched} matched · ${summary.nodesWithDiffs} differ · ` +
			`${summary.missingInLoom} missing-in-loom · ${summary.missingInRoblox} missing-in-roblox`,
	);
	lines.push(
		`  severity: ${summary.bySeverity.high} high · ${summary.bySeverity.medium} medium · ${summary.bySeverity.low} low`,
	);

	for (const node of report.nodes) {
		const icon = node.maxSeverity ? SEVERITY_ICON[node.maxSeverity] : " ";
		if (node.status !== "matched") {
			lines.push(`  ${icon} ${node.key}  (${node.className})  ${node.status}`);
			continue;
		}
		lines.push(`  ${icon} ${node.key}  (${node.className})`);
		for (const field of node.fields) {
			const delta = formatDelta(field);
			lines.push(
				`      ${field.field}: loom ${formatValue(field.loom)} ≠ roblox ${formatValue(
					field.roblox,
				)}${delta ? `  Δ${delta}` : ""}  [${field.severity}]`,
			);
		}
	}

	return lines.join("\n");
}

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

function colorSwatch(value: unknown): string {
	const record = value as Record<string, unknown> | null;
	if (
		record &&
		typeof record.r === "number" &&
		typeof record.g === "number" &&
		typeof record.b === "number"
	) {
		const to255 = (c: number) => Math.round(c * 255);
		const css = `rgb(${to255(record.r)}, ${to255(record.g)}, ${to255(
			record.b,
		)})`;
		return `<span class="swatch" style="background:${css}"></span>${escapeHtml(
			formatValue(value),
		)}`;
	}
	return escapeHtml(formatValue(value));
}

/** A standalone, self-contained HTML report (no external assets). */
export function renderHtmlReport(report: ParityReport): string {
	const { summary } = report;
	const rows = report.nodes
		.map((node) => {
			const sev = node.maxSeverity ?? "low";
			if (node.status !== "matched") {
				return `<tr class="sev-${sev} status-row">
	<td>${SEVERITY_ICON[sev]}</td>
	<td class="key">${escapeHtml(node.key)}</td>
	<td>${escapeHtml(node.className)}</td>
	<td colspan="4" class="status">${escapeHtml(node.status)}</td>
</tr>`;
			}
			return node.fields
				.map(
					(field, index) => `<tr class="sev-${field.severity}">
	<td>${index === 0 ? SEVERITY_ICON[sev] : ""}</td>
	<td class="key">${index === 0 ? escapeHtml(node.key) : ""}</td>
	<td>${index === 0 ? escapeHtml(node.className) : ""}</td>
	<td class="field">${escapeHtml(field.field)}</td>
	<td class="loom">${colorSwatch(field.loom)}</td>
	<td class="roblox">${colorSwatch(field.roblox)}</td>
	<td class="delta">${field.delta === undefined ? "" : escapeHtml(formatValue(field.delta))}</td>
</tr>`,
				)
				.join("\n");
		})
		.join("\n");

	const warn = report.viewport.mismatch
		? `<p class="warn">⚠ Viewport mismatch: Loom ${formatValue(
				report.viewport.loom,
			)} vs Roblox ${formatValue(
				report.viewport.roblox,
			)} — scale-based sizes will diverge. Render Loom at the Roblox viewport.</p>`
		: "";

	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Loom ↔ Roblox parity${report.scene ? ` — ${escapeHtml(report.scene)}` : ""}</title>
<style>
	:root { color-scheme: light dark; }
	body { font: 13px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; margin: 24px; }
	h1 { font-size: 18px; margin: 0 0 4px; }
	.sub { opacity: 0.7; margin: 0 0 16px; }
	.cards { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 16px; }
	.card { border: 1px solid currentColor; border-radius: 8px; padding: 8px 14px; opacity: 0.9; }
	.card b { font-size: 20px; display: block; }
	.warn { color: #b45309; font-weight: 600; }
	table { border-collapse: collapse; width: 100%; }
	th, td { text-align: left; padding: 4px 10px; border-bottom: 1px solid rgba(128,128,128,0.25); vertical-align: top; }
	th { position: sticky; top: 0; background: Canvas; }
	.key { font-weight: 600; }
	.field { opacity: 0.85; }
	.delta { text-align: right; font-variant-numeric: tabular-nums; }
	.status { font-weight: 600; }
	.swatch { display: inline-block; width: 11px; height: 11px; border: 1px solid rgba(128,128,128,0.6); border-radius: 2px; margin-right: 5px; vertical-align: -1px; }
	tr.sev-high td:first-child { color: #dc2626; }
	tr.sev-medium td:first-child { color: #d97706; }
	tr.sev-low td:first-child { color: #6b7280; }
	tr.status-row { background: rgba(220,38,38,0.08); }
</style>
</head>
<body>
<h1>Loom ↔ Roblox parity${report.scene ? ` — ${escapeHtml(report.scene)}` : ""}</h1>
<p class="sub">${report.generatedAt ? escapeHtml(report.generatedAt) : ""}</p>
${warn}
<div class="cards">
	<div class="card"><b>${summary.matched}</b>matched</div>
	<div class="card"><b>${summary.nodesWithDiffs}</b>differ</div>
	<div class="card"><b>${summary.bySeverity.high}</b>high</div>
	<div class="card"><b>${summary.bySeverity.medium}</b>medium</div>
	<div class="card"><b>${summary.missingInLoom + summary.missingInRoblox}</b>missing</div>
</div>
<table>
<thead>
	<tr><th></th><th>node</th><th>class</th><th>field</th><th>Loom</th><th>Roblox</th><th>Δ</th></tr>
</thead>
<tbody>
${rows || '<tr><td colspan="7">No divergences within tolerance. 🎉</td></tr>'}
</tbody>
</table>
</body>
</html>
`;
}
