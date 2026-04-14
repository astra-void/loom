import type { PreviewEntryDescriptor } from "@loom-dev/preview-engine";
import type * as React from "react";
import { type PreviewModule } from "./render";
export type PreviewClientModule = PreviewModule;
type PreviewRenderInput = {
	entry: PreviewEntryDescriptor;
	module: PreviewClientModule;
};
export type CreatePreviewElementOptions = PreviewRenderInput & {
	wrapInShell?: boolean;
};
export type MountPreviewOptions = CreatePreviewElementOptions & {
	autoInstallGlobals?: boolean;
	container: Element | DocumentFragment;
};
export type HydratePreviewOptions = CreatePreviewElementOptions & {
	autoInstallGlobals?: boolean;
	container: Element | Document;
};
export type RenderPreviewToStringOptions = CreatePreviewElementOptions & {
	autoInstallGlobals?: boolean;
};
export type PreviewMountedHandle = {
	dispose(): void;
	unmount(): void;
};
export declare function createPreviewElement(
	options: CreatePreviewElementOptions,
): React.ReactElement;
export declare function mountPreview(
	options: MountPreviewOptions,
): PreviewMountedHandle;
export declare function hydratePreview(
	options: HydratePreviewOptions,
): PreviewMountedHandle;
export declare function renderPreviewToString(
	options: RenderPreviewToStringOptions,
): string;
export declare function renderPreviewToStaticMarkup(
	options: RenderPreviewToStringOptions,
): string;
export { installPreviewBrowserGlobals } from "../shell/installPreviewBrowserGlobals";
export type { PreviewTargetShellProps } from "./PreviewTargetShell";
export { PreviewTargetShell } from "./PreviewTargetShell";
export type { PreviewModule } from "./render";
export { createPreviewRenderNode, readPreviewDefinition } from "./render";
