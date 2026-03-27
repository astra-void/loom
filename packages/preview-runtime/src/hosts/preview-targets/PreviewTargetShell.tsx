import * as React from "react";
import { LayoutProvider } from "../../layout";
import { createWindowViewport } from "../../layout/viewport";
import { PortalProvider } from "../../react";
import { ScreenGui as RuntimeScreenGui } from "../components";

export type PreviewTargetShellProps = {
	children: React.ReactNode;
};

export function PreviewTargetShell(props: PreviewTargetShellProps) {
	const [portalContainer, setPortalContainer] =
		React.useState<HTMLElement | null>(null);
	const viewport = React.useMemo(() => createWindowViewport(), []);

	const handleRootRef = React.useCallback((node: HTMLElement | null) => {
		setPortalContainer(node);
	}, []);

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
