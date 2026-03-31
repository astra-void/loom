import type { PreviewEntryDescriptor } from "@loom-dev/preview-engine";
import {
	normalizePreviewRuntimeError,
	type PreviewRuntimeIssueContext,
} from "@loom-dev/preview-runtime";

export type CapturedRenderError = {
	componentStack?: string | null;
	error: unknown;
};

type ClassificationContext = {
	componentStack?: string | null;
	error: unknown;
	message: string;
	stack?: string;
};

type ExtractedFrame = {
	isEntry: boolean;
	isLoom: boolean;
	isProject: boolean;
	raw: string;
};

function extractErrorProperties(
	rawError: unknown | CapturedRenderError,
): ClassificationContext {
	const isCaptured =
		typeof rawError === "object" && rawError !== null && "error" in rawError;

	const error = isCaptured ? (rawError as CapturedRenderError).error : rawError;
	const componentStack = isCaptured
		? (rawError as CapturedRenderError).componentStack
		: undefined;

	const message = error instanceof Error ? error.message : String(error);
	const stack = error instanceof Error ? error.stack : undefined;

	return { componentStack, error, message, stack };
}

function parseStackLines(
	stack?: string,
	componentStack?: string | null,
): string[] {
	const lines: string[] = [];
	if (stack) {
		lines.push(...stack.split(/\r?\n/u));
	}
	if (componentStack) {
		lines.push(...componentStack.split(/\r?\n/u));
	}
	return lines;
}

function extractBestFrame(
	lines: string[],
	entry: PreviewEntryDescriptor,
): ExtractedFrame | null {
	const parsedFrames = lines
		.filter((line) => line.trim().startsWith("at "))
		.map((line) => {
			const trimmed = line.trim();
			const isLoom =
				trimmed.includes("/packages/") ||
				trimmed.includes("/apps/") ||
				trimmed.includes("/tests/");
			const isEntry =
				!!entry.sourceFilePath && trimmed.includes(entry.sourceFilePath);
			const isNodeModules = trimmed.includes("node_modules");
			const isReactInternal =
				trimmed.includes("react-dom") ||
				trimmed.includes("scheduler") ||
				trimmed.includes("react");
			const isProject = !isNodeModules && !isReactInternal;

			return {
				isEntry,
				isLoom,
				isProject,
				raw: trimmed,
			};
		});

	if (parsedFrames.length === 0) {
		return null;
	}

	const loomFrame = parsedFrames.find((f) => f.isLoom);
	if (loomFrame) return loomFrame;

	const entryFrame = parsedFrames.find((f) => f.isEntry);
	if (entryFrame) return entryFrame;

	const projectFrame = parsedFrames.find((f) => f.isProject);
	if (projectFrame) return projectFrame;

	return parsedFrames[0];
}

type ClassifierResult = {
	code: string;
	detailsTemplate: (
		frame: ExtractedFrame | null,
		componentStack?: string | null,
	) => string;
	summaryTemplate: (frame: ExtractedFrame | null) => string;
};

const CLASSIFIERS: Array<{
	match: (message: string, stack?: string) => boolean;
	result: ClassifierResult;
}> = [
	{
		match: (message) => message.includes("Maximum update depth exceeded"),
		result: {
			code: "REACT_MAX_UPDATE_DEPTH",
			detailsTemplate: (frame, componentStack) =>
				[
					frame
						? `Suspected frame:\n${frame.raw}`
						: "Could not determine exact project frame.",
					"",
					"This error typically means a layout effect, measured size, text scaling, or controllable state feedback loop is triggering infinite updates in the preview runtime.",
					componentStack ? `\nComponent Stack:\n${componentStack}` : "",
				]
					.filter(Boolean)
					.join("\n"),
			summaryTemplate: (frame) =>
				`React render loop detected.${
					frame ? ` First Loom frame: ${frame.raw.replace(/^at\s+/, "")}` : ""
				}`,
		},
	},
	{
		match: (message) => message.includes("Too many re-renders"),
		result: {
			code: "REACT_TOO_MANY_RERENDERS",
			detailsTemplate: (frame, componentStack) =>
				[
					frame
						? `Suspected frame:\n${frame.raw}`
						: "Could not determine exact project frame.",
					"",
					"React limits the number of renders to prevent an infinite loop. This often occurs when calling state-setters directly in the render body.",
					componentStack ? `\nComponent Stack:\n${componentStack}` : "",
				]
					.filter(Boolean)
					.join("\n"),
			summaryTemplate: (frame) =>
				`React re-render loop detected.${
					frame
						? ` First project frame: ${frame.raw.replace(/^at\s+/, "")}`
						: ""
				}`,
		},
	},
	{
		match: (message) =>
			message.includes("Invalid hook call") ||
			message.includes("Rendered more hooks than during the previous render") ||
			message.includes("Rendered fewer hooks than expected"),
		result: {
			code: "REACT_INVALID_HOOK_CALL",
			detailsTemplate: (frame, componentStack) =>
				[
					frame
						? `Suspected frame:\n${frame.raw}`
						: "Could not determine exact project frame.",
					"",
					"Hooks must be called in the exact same order in every component render. Do not call hooks inside loops, conditions, or nested functions.",
					componentStack ? `\nComponent Stack:\n${componentStack}` : "",
				]
					.filter(Boolean)
					.join("\n"),
			summaryTemplate: (frame) =>
				`Invalid hook call or hook order issue.${
					frame
						? ` First project frame: ${frame.raw.replace(/^at\s+/, "")}`
						: ""
				}`,
		},
	},
	{
		match: (message) =>
			message.includes("is not defined") &&
			(message.includes("window") ||
				message.includes("document") ||
				message.includes("navigator") ||
				message.includes("self")),
		result: {
			code: "PREVIEW_MISSING_GLOBAL",
			detailsTemplate: (frame, componentStack) =>
				[
					frame
						? `Suspected frame:\n${frame.raw}`
						: "Could not determine exact project frame.",
					"",
					"This module attempted to use a browser global (e.g. window, document) that is either not fully mocked or not available in the headless preview runner environment.",
					componentStack ? `\nComponent Stack:\n${componentStack}` : "",
				]
					.filter(Boolean)
					.join("\n"),
			summaryTemplate: (frame) =>
				`Missing browser global accessed during preview.${
					frame
						? ` First project frame: ${frame.raw.replace(/^at\s+/, "")}`
						: ""
				}`,
		},
	},
];

export function analyzePreviewRuntimeError(
	entry: PreviewEntryDescriptor,
	rawError: unknown | CapturedRenderError,
	defaultContext: PreviewRuntimeIssueContext,
) {
	const { componentStack, error, message, stack } =
		extractErrorProperties(rawError);

	const lines = parseStackLines(stack, componentStack);
	const bestFrame = extractBestFrame(lines, entry);

	let matchResult: ClassifierResult | null = null;
	for (const classifier of CLASSIFIERS) {
		if (classifier.match(message, stack)) {
			matchResult = classifier.result;
			break;
		}
	}

	const symbol = bestFrame ? bestFrame.raw.replace(/^at\s+/, "") : undefined;
	let code = defaultContext.code ?? "RENDER_ERROR";
	let summary = defaultContext.summary ?? message;
	let details = defaultContext.details;
	const codeFrame = componentStack ?? (bestFrame ? bestFrame.raw : undefined);

	if (matchResult) {
		code = matchResult.code;
		summary = matchResult.summaryTemplate(bestFrame);
		details = matchResult.detailsTemplate(bestFrame, componentStack);
	} else {
		if (bestFrame) {
			details = [
				"An unknown error occurred during render.",
				`Suspected project frame:\n${bestFrame.raw}`,
				componentStack ? `\nComponent Stack:\n${componentStack}` : "",
			]
				.filter(Boolean)
				.join("\n");
		} else if (componentStack) {
			details = `Component Stack:\n${componentStack}`;
		}
	}

	return normalizePreviewRuntimeError(
		{
			...defaultContext,
			code,
			codeFrame,
			details,
			stack: stack ?? String(error),
			summary,
			symbol,
		},
		error,
	);
}
