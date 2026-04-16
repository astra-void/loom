import * as React from "react";
import { LayoutProvider } from "../../layout";
import {
	createWindowViewport,
	measureElementViewport,
} from "../../layout/viewport";
import { PortalProvider } from "../../react";
import { UDim2 } from "../../runtime/helpers";
import { ScreenGui as RuntimeScreenGui } from "../components";

export type PreviewTargetShellProps = {
	children: React.ReactNode;
};

export function PreviewTargetShell(props: PreviewTargetShellProps) {
	const [portalContainer, setPortalContainer] =
		React.useState<HTMLElement | null>(null);
	const [viewport, setViewport] = React.useState(() => createWindowViewport());

	const handleRootRef = React.useCallback((node: HTMLElement | null) => {
		setPortalContainer(node);
	}, []);

	React.useEffect(() => {
		if (!portalContainer) return;

		const updateViewport = (nextViewport?: typeof viewport | null) => {
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

		if (typeof ResizeObserver !== "undefined") {
			const observer = new ResizeObserver(() => {
				updateViewport();
			});

			observer.observe(portalContainer);

			updateViewport();

			return () => observer.disconnect();
		}
	}, [portalContainer]);

	const shellSize = React.useMemo(
		() => UDim2.fromOffset(viewport.width, viewport.height),
		[viewport.height, viewport.width],
	);

	return (
		<LayoutProvider
			viewportHeight={viewport.height}
			viewportWidth={viewport.width}
		>
			<RuntimeScreenGui Active={true} ref={handleRootRef} Size={shellSize}>
				{portalContainer ? (
					<PortalProvider container={portalContainer}>
						{props.children}
					</PortalProvider>
				) : null}
			</RuntimeScreenGui>
		</LayoutProvider>
	);
}
