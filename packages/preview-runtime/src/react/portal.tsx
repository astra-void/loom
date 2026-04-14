import * as React from "react";
import { createPortal } from "react-dom";
import { LayoutViewportPortalBoundary } from "../layout/context";

type PortalContextValue = {
	container?: HTMLElement | null;
	displayOrderBase: number;
};

const PortalContext = React.createContext<PortalContextValue>({
	container: undefined,
	displayOrderBase: 0,
});

type PortalProviderProps = {
	children?: React.ReactNode;
	container?: HTMLElement | null;
	displayOrderBase?: number;
};

export function PortalProvider(props: PortalProviderProps) {
	const value = React.useMemo<PortalContextValue>(
		() => ({
			container: props.container,
			displayOrderBase: props.displayOrderBase ?? 0,
		}),
		[props.container, props.displayOrderBase],
	);

	return (
		<PortalContext.Provider value={value}>
			{props.children}
		</PortalContext.Provider>
	);
}

type PortalProps = {
	children?: React.ReactNode;
	container?: HTMLElement | null;
};

export function Portal(props: PortalProps) {
	const portalContext = React.useContext(PortalContext);
	const container =
		props.container ??
		portalContext.container ??
		(typeof document !== "undefined" ? document.body : null);
	if (!container) {
		return null;
	}

	const children = isViewportScopedPortalContainer(container) ? (
		<LayoutViewportPortalBoundary container={container}>
			{props.children}
		</LayoutViewportPortalBoundary>
	) : (
		props.children
	);

	return createPortal(children, container);
}

export function usePortalContext() {
	return React.useContext(PortalContext);
}

function isViewportScopedPortalContainer(container: HTMLElement) {
	return (
		container.dataset.previewPlayerGui === "true" ||
		container.closest('[data-preview-player-gui="true"]') !== null
	);
}
