import {
	createViewportSize,
	LayoutProvider,
	measureElementViewport,
	PortalProvider,
	ScreenGui,
	UDim2,
	type ViewportSize,
} from "@loom-dev/preview-runtime";
import * as React from "react";
import { SystemProvider } from "../shell/preview-targets/system";

export type PreviewTargetShellProps = {
	children: React.ReactNode;
};

function createDefaultViewport(): ViewportSize {
	if (typeof window === "undefined") {
		return {
			height: 600,
			width: 800,
		};
	}

	return {
		height: Math.max(0, Math.floor(window.innerHeight || 600)),
		width: Math.max(0, Math.floor(window.innerWidth || 800)),
	};
}

function RuntimePreviewTargetShell(props: PreviewTargetShellProps) {
	const [portalContainer, setPortalContainer] =
		React.useState<HTMLElement | null>(null);
	const [viewport, setViewport] = React.useState<ViewportSize>(() =>
		createDefaultViewport(),
	);

	React.useEffect(() => {
		if (!portalContainer) {
			return;
		}

		const updateViewport = (nextViewport?: ViewportSize | null) => {
			const resolvedViewport =
				nextViewport ?? measureElementViewport(portalContainer);
			if (
				!resolvedViewport ||
				resolvedViewport.width <= 0 ||
				resolvedViewport.height <= 0
			) {
				return;
			}

			setViewport((previousViewport) =>
				previousViewport.width === resolvedViewport.width &&
				previousViewport.height === resolvedViewport.height
					? previousViewport
					: resolvedViewport,
			);
		};

		updateViewport();

		if (typeof ResizeObserver !== "undefined") {
			const observer = new ResizeObserver((entries) => {
				const firstEntry = entries[0];
				updateViewport(
					firstEntry
						? createViewportSize(
								firstEntry.contentRect.width,
								firstEntry.contentRect.height,
							)
						: null,
				);
			});
			observer.observe(portalContainer);
			return () => {
				observer.disconnect();
			};
		}

		const onWindowResize = () => {
			updateViewport();
		};
		window.addEventListener("resize", onWindowResize);
		return () => {
			window.removeEventListener("resize", onWindowResize);
		};
	}, [portalContainer]);

	const shellChildren = portalContainer ? (
		<PortalProvider container={portalContainer}>
			{props.children}
		</PortalProvider>
	) : (
		props.children
	);
	const shellSize = React.useMemo(
		() => UDim2.fromOffset(viewport.width, viewport.height),
		[viewport.height, viewport.width],
	);

	return (
		<LayoutProvider
			viewportHeight={viewport.height}
			viewportWidth={viewport.width}
		>
			<ScreenGui Active={true} ref={setPortalContainer} Size={shellSize}>
				{shellChildren}
			</ScreenGui>
		</LayoutProvider>
	);
}

export function PreviewTargetShell(props: PreviewTargetShellProps) {
	return (
		<SystemProvider>
			<RuntimePreviewTargetShell>{props.children}</RuntimePreviewTargetShell>
		</SystemProvider>
	);
}
