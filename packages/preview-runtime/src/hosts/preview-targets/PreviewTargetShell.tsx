import * as React from "react";
import { LayoutProvider } from "../../layout";
import {
	createWindowViewport,
	measureElementViewport,
} from "../../layout/viewport";
import { PortalProvider } from "../../react";
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

		if (typeof ResizeObserver !== "undefined") {
			const observer = new ResizeObserver(() => {
				const size = measureElementViewport(portalContainer);
				if (size) {
					setViewport(size);
				}
			});

			observer.observe(portalContainer);

			const initialSize = measureElementViewport(portalContainer);
			if (initialSize) {
				setViewport(initialSize);
			}

			return () => observer.disconnect();
		}
	}, [portalContainer]);

	return (
		<LayoutProvider
			viewportHeight={viewport.height}
			viewportWidth={viewport.width}
		>
			<RuntimeScreenGui ref={handleRootRef}>
				{portalContainer ? (
					<PortalProvider container={portalContainer}>
						{props.children}
					</PortalProvider>
				) : null}
			</RuntimeScreenGui>
		</LayoutProvider>
	);
}
