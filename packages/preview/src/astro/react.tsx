import type { PreviewEntryDescriptor } from "@loom-dev/preview-engine";
import * as React from "react";
import { mountPreview, type PreviewMountedHandle } from "../client";

export type LoomPreviewProps = {
	/** Preview entry id, as listed in `previewWorkspaceIndex.entries`. */
	entry: string;
	className?: string;
	style?: React.CSSProperties;
};

type LoomPreviewEntryModule = Record<string, unknown> & {
	__previewEntryPayload?: {
		descriptor: PreviewEntryDescriptor;
	};
};

/**
 * Resolved lazily via a dynamic import so the virtual module always flows
 * through Vite's plugin pipeline (resolveId/load) instead of being required as
 * a CommonJS dependency, and so it only ever loads in the browser.
 */
async function loadWorkspaceIndex() {
	return import("virtual:loom-preview-workspace-index");
}

/**
 * Client-only island that mounts a Loom preview entry into the DOM.
 *
 * Must be rendered with `client:only="react"` — the Roblox browser globals and
 * the layout-engine Wasm are browser-only, so there is no SSR/hydration path.
 * `mountPreview` installs the preview globals automatically.
 */
export function LoomPreview({ entry, className, style }: LoomPreviewProps) {
	const containerRef = React.useRef<HTMLDivElement>(null);
	const [error, setError] = React.useState<string | null>(null);

	React.useEffect(() => {
		let disposed = false;
		let handle: PreviewMountedHandle | undefined;
		setError(null);

		void loadWorkspaceIndex()
			.then(async ({ previewImporters, previewWorkspaceIndex }) => {
				const importer = previewImporters[entry];
				if (!importer) {
					const ids = previewWorkspaceIndex.entries.map(
						(candidate) => candidate.id,
					);
					throw new Error(
						`Unknown Loom preview entry "${entry}". Available: ${ids.join(", ") || "(none)"}`,
					);
				}

				const module = (await importer()) as LoomPreviewEntryModule;
				if (disposed || !containerRef.current) {
					return;
				}

				const payload = module.__previewEntryPayload;
				if (!payload) {
					throw new Error(
						`Loom preview entry "${entry}" is missing __previewEntryPayload.`,
					);
				}

				if (payload.descriptor.status !== "ready") {
					throw new Error(
						`Loom preview entry "${entry}" is not ready (status: ${payload.descriptor.status}).`,
					);
				}

				handle = mountPreview({
					container: containerRef.current,
					entry: payload.descriptor,
					module,
				});
			})
			.catch((cause: unknown) => {
				if (!disposed) {
					setError(cause instanceof Error ? cause.message : String(cause));
				}
			});

		return () => {
			disposed = true;
			handle?.dispose();
		};
	}, [entry]);

	if (error) {
		return (
			<div className={className} style={style} data-loom-preview-error>
				{error}
			</div>
		);
	}

	return <div ref={containerRef} className={className} style={style} />;
}

export default LoomPreview;
