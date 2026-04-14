import type {
	PreviewDefinition,
	PreviewEntryDescriptor,
} from "@loom-dev/preview-engine";
export type PreviewModule = Record<string, unknown> & {
	__previewRuntimeModule?: unknown;
	default?: unknown;
	preview?: PreviewDefinition;
};
export declare function readPreviewDefinition(
	module: PreviewModule,
): PreviewDefinition | undefined;
export declare function createPreviewRenderNode(
	entry: PreviewEntryDescriptor,
	module: PreviewModule,
): import("react/jsx-runtime").JSX.Element | null;
