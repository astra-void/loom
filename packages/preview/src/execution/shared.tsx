import type {
	PreviewDefinition,
	PreviewDiagnostic,
	PreviewEntryDescriptor,
} from "@loom-dev/preview-engine";
import {
	AutoMockProvider,
	normalizePreviewRuntimeError,
	type PreviewRuntimeIssue,
} from "@loom-dev/preview-runtime";
import type React from "react";

export type PreviewModule = Record<string, unknown> & {
	__previewRuntimeModule?: unknown;
	default?: unknown;
	preview?: PreviewDefinition;
};

export type PreviewReadyWarningState = {
	degradedTargets: string[];
	fidelity: "degraded" | "preserved" | null;
	warningCodes: string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function readNestedExport(
	container: unknown,
	exportName: string,
	visited = new Set<unknown>(),
): unknown {
	if (!isRecord(container) || visited.has(container)) {
		return undefined;
	}

	visited.add(container);
	return exportName in container ? container[exportName] : undefined;
}

function readModuleExport(
	module: PreviewModule,
	exportName: "default" | string,
) {
	if (exportName === "default") {
		return module.default;
	}

	return readNestedExport(module, exportName);
}

function isRenderableComponentExport(value: unknown): boolean {
	return (
		typeof value === "function" || (isRecord(value) && "$$typeof" in value)
	);
}

function describeValue(value: unknown) {
	if (value === undefined) {
		return "undefined";
	}

	if (value === null) {
		return "null";
	}

	if (typeof value === "function") {
		return value.name ? `function ${value.name}` : "function";
	}

	if (Array.isArray(value)) {
		return "array";
	}

	if (isRecord(value)) {
		const keys = Object.keys(value).sort();
		return keys.length > 0 ? `object with keys [${keys.join(", ")}]` : "object";
	}

	return typeof value;
}

function describeModuleExports(module: PreviewModule) {
	const keys = Object.keys(module).sort();
	return `module: [${keys.join(", ") || "(none)"}]`;
}

function uniqueSorted(values: Iterable<string>) {
	return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

export function readPreviewDefinition(module: PreviewModule) {
	const preview = module.preview;

	if (!preview || typeof preview !== "object") {
		return undefined;
	}

	return preview;
}

export function isPreviewBlockingIssue(
	issue:
		| Pick<PreviewDiagnostic, "blocking" | "severity">
		| Pick<PreviewRuntimeIssue, "blocking" | "severity">,
) {
	return issue.blocking ?? issue.severity !== "warning";
}

export function getPreviewReadyWarningState(
	statusDetails: PreviewEntryDescriptor["statusDetails"] | undefined,
	diagnostics: PreviewDiagnostic[],
	runtimeIssues: PreviewRuntimeIssue[],
): PreviewReadyWarningState {
	const payloadWarningCodes =
		statusDetails?.kind === "ready" ? (statusDetails.warningCodes ?? []) : [];
	const payloadDegradedTargets =
		statusDetails?.kind === "ready"
			? (statusDetails.degradedTargets ?? [])
			: [];
	const fidelity =
		statusDetails?.kind === "ready" ? (statusDetails.fidelity ?? null) : null;
	const warningDiagnostics = diagnostics.filter(
		(diagnostic) => !isPreviewBlockingIssue(diagnostic),
	);
	const warningRuntimeIssues = runtimeIssues.filter(
		(issue) => !isPreviewBlockingIssue(issue),
	);
	const degradedTargets = uniqueSorted([
		...payloadDegradedTargets,
		...warningRuntimeIssues
			.filter((issue) => issue.code === "DEGRADED_HOST_RENDER")
			.map((issue) => issue.target),
	]);

	return {
		degradedTargets,
		fidelity: fidelity ?? (degradedTargets.length > 0 ? "degraded" : null),
		warningCodes: uniqueSorted([
			...payloadWarningCodes,
			...warningDiagnostics.map((diagnostic) => diagnostic.code),
			...warningRuntimeIssues.map((issue) => issue.code),
		]),
	};
}

export function describePreviewWarningState(
	warningState: PreviewReadyWarningState,
) {
	if (warningState.degradedTargets.length > 0) {
		return `Degraded placeholders: ${warningState.degradedTargets.join(", ")}.`;
	}

	if (warningState.warningCodes.length > 0) {
		return `Warnings: ${warningState.warningCodes.join(", ")}.`;
	}

	return "This preview stays renderable, but fidelity is reduced.";
}

export function createPreviewRenderNode(
	entry: PreviewEntryDescriptor,
	module: PreviewModule,
) {
	const preview = readPreviewDefinition(module);

	if (entry.renderTarget.kind === "harness") {
		if (!preview?.render || typeof preview.render !== "function") {
			throw new Error(
				"This entry is marked as preview.render but the module does not export a callable preview.render.",
			);
		}

		const Harness = preview.render as React.ComponentType;
		return <Harness />;
	}

	if (entry.renderTarget.kind === "component") {
		const exportValue = readModuleExport(module, entry.renderTarget.exportName);
		if (!isRenderableComponentExport(exportValue)) {
			throw new Error(
				`Expected \`${entry.renderTarget.exportName}\` to be a component export, received ${describeValue(exportValue)}. ` +
					`Available exports: ${describeModuleExports(module)}.`,
			);
		}

		const props =
			entry.renderTarget.usesPreviewProps &&
			preview?.props &&
			typeof preview.props === "object"
				? preview.props
				: undefined;

		return (
			<AutoMockProvider
				component={exportValue as React.ComponentType<Record<string, unknown>>}
				props={props}
			/>
		);
	}

	return null;
}

function getRuntimeIssueContext(entry: PreviewEntryDescriptor) {
	return {
		entryId: entry.id,
		file: entry.sourceFilePath,
		relativeFile: entry.relativePath,
		target: entry.targetName,
	};
}

export function createPreviewLoadIssue(
	entry: PreviewEntryDescriptor,
	error: unknown,
) {
	return normalizePreviewRuntimeError(
		{
			...getRuntimeIssueContext(entry),
			code: "MODULE_LOAD_ERROR",
			kind: "ModuleLoadError",
			phase: "runtime",
			summary: `Preview module failed to load: ${error instanceof Error ? error.message : String(error)}`,
		},
		error,
	);
}

export function createPreviewRenderIssue(
	entry: PreviewEntryDescriptor,
	error: unknown,
) {
	return normalizePreviewRuntimeError(
		{
			...getRuntimeIssueContext(entry),
			code: "RENDER_ERROR",
			kind: "TransformExecutionError",
			phase: "runtime",
			summary: error instanceof Error ? error.message : String(error),
		},
		error,
	);
}
