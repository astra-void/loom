import type {
	PreviewDefinition,
	PreviewEntryDescriptor,
} from "@loom-dev/preview-engine";
import { AutoMockProvider } from "@loom-dev/preview-runtime";
import type * as React from "react";

export type PreviewModule = Record<string, unknown> & {
	__previewRuntimeModule?: unknown;
	default?: unknown;
	preview?: PreviewDefinition;
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

export function readPreviewDefinition(module: PreviewModule) {
	const preview = module.preview;

	if (!preview || typeof preview !== "object") {
		return undefined;
	}

	return preview;
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
