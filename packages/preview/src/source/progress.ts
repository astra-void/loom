export type PreviewProgressWriter = {
	write(chunk: string): unknown;
	isTTY?: boolean;
	getColorDepth?: () => number;
};

const PREVIEW_TIMING_ENABLED = process.env.LOOM_PREVIEW_TIMINGS === "1";
const ANSI = {
	blue: "\u001b[34m",
	bold: "\u001b[1m",
	cyan: "\u001b[36m",
	gray: "\u001b[90m",
	green: "\u001b[32m",
	reset: "\u001b[0m",
};

export type PreviewProgressScope = "client" | "server";

export type PreviewProgressWriteOptions = {
	scope?: PreviewProgressScope;
};

function supportsPreviewColors(writer?: PreviewProgressWriter) {
	if (writer?.isTTY !== undefined) {
		return writer.isTTY;
	}

	if (writer?.getColorDepth && writer.getColorDepth() > 1) {
		return true;
	}

	return Boolean(process.stderr.isTTY || process.stdout.isTTY);
}

function colorize(value: string, color: string, enabled: boolean) {
	return enabled ? `${color}${value}${ANSI.reset}` : value;
}

function formatTimestamp() {
	return new Intl.DateTimeFormat("en-US", {
		hour: "numeric",
		hour12: true,
		minute: "2-digit",
		second: "2-digit",
	}).format(new Date());
}

function formatPrefix(
	writer: PreviewProgressWriter | undefined,
	scope: PreviewProgressScope,
) {
	const useColors = supportsPreviewColors(writer);
	const timestamp = colorize(formatTimestamp(), ANSI.gray, useColors);
	const tag = colorize("[preview]", `${ANSI.bold}${ANSI.cyan}`, useColors);
	const scopeLabel = colorize(`(${scope})`, ANSI.blue, useColors);

	return `${timestamp} ${tag} ${scopeLabel}`;
}

export function writePreviewProgress(
	writer: PreviewProgressWriter | undefined,
	message: string,
	options: PreviewProgressWriteOptions = {},
) {
	const scope = options.scope ?? "server";
	writer?.write(`${formatPrefix(writer, scope)} ${message}\n`);
}

export function writePreviewTiming(
	writer: PreviewProgressWriter | undefined,
	label: string,
	startedAt: number,
	options: PreviewProgressWriteOptions = {},
) {
	const scope = options.scope ?? "server";
	const elapsed = `${Date.now() - startedAt}ms`;
	const useColors = supportsPreviewColors(writer);
	const message = `${formatPrefix(writer, scope)} ${label} in ${colorize(elapsed, ANSI.green, useColors)}`;

	if (writer) {
		writer.write(`${message}\n`);
		return;
	}

	if (PREVIEW_TIMING_ENABLED) {
		console.info(`${message}\n`);
	}
}
