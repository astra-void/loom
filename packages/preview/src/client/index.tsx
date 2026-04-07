import type { PreviewEntryDescriptor } from "@loom-dev/preview-engine";
import type * as React from "react";
import type { Root } from "react-dom/client";
import { createRoot, hydrateRoot } from "react-dom/client";
import { renderToStaticMarkup, renderToString } from "react-dom/server";
import { installPreviewBrowserGlobals } from "../shell/installPreviewBrowserGlobals";
import { PreviewTargetShell } from "./PreviewTargetShell";
import { createPreviewRenderNode, type PreviewModule } from "./render";

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

function createManagedUnmountHandle(
	root: Pick<Root, "unmount">,
	restoreGlobals?: (() => void) | undefined,
): PreviewMountedHandle {
	let disposed = false;

	const dispose = () => {
		if (disposed) {
			return;
		}

		disposed = true;
		try {
			root.unmount();
		} finally {
			restoreGlobals?.();
		}
	};

	return {
		dispose,
		unmount: dispose,
	};
}

function withManagedPreviewGlobals<TResult>(
	autoInstallGlobals: boolean | undefined,
	render: () => TResult,
): TResult {
	const restoreGlobals =
		autoInstallGlobals === false ? undefined : installPreviewBrowserGlobals();

	try {
		return render();
	} finally {
		restoreGlobals?.();
	}
}

export function createPreviewElement(
	options: CreatePreviewElementOptions,
): React.ReactElement {
	const renderNode = createPreviewRenderNode(options.entry, options.module);

	if (options.wrapInShell === false) {
		return <>{renderNode}</>;
	}

	return <PreviewTargetShell>{renderNode}</PreviewTargetShell>;
}

export function mountPreview(
	options: MountPreviewOptions,
): PreviewMountedHandle {
	const restoreGlobals =
		options.autoInstallGlobals === false
			? undefined
			: installPreviewBrowserGlobals();
	const root = createRoot(options.container);
	root.render(createPreviewElement(options));

	return createManagedUnmountHandle(root, restoreGlobals);
}

export function hydratePreview(
	options: HydratePreviewOptions,
): PreviewMountedHandle {
	const restoreGlobals =
		options.autoInstallGlobals === false
			? undefined
			: installPreviewBrowserGlobals();
	const root = hydrateRoot(options.container, createPreviewElement(options));

	return createManagedUnmountHandle(root, restoreGlobals);
}

export function renderPreviewToString(
	options: RenderPreviewToStringOptions,
): string {
	return withManagedPreviewGlobals(options.autoInstallGlobals, () =>
		renderToString(createPreviewElement(options)),
	);
}

export function renderPreviewToStaticMarkup(
	options: RenderPreviewToStringOptions,
): string {
	return withManagedPreviewGlobals(options.autoInstallGlobals, () =>
		renderToStaticMarkup(createPreviewElement(options)),
	);
}

export { installPreviewBrowserGlobals } from "../shell/installPreviewBrowserGlobals";
export type { PreviewTargetShellProps } from "./PreviewTargetShell";
export { PreviewTargetShell } from "./PreviewTargetShell";
export type { PreviewModule } from "./render";
export { createPreviewRenderNode, readPreviewDefinition } from "./render";
