import React from "react";
import {
	type PreviewResolvedTheme,
	type PreviewThemeMode,
	PreviewThemeProvider,
	usePreviewTheme,
} from "../theme";

export type PreviewSystemDensity = "comfortable" | "compact";

type PreviewSystemContextValue = {
	density: PreviewSystemDensity;
	mode: PreviewThemeMode;
	resolvedTheme: PreviewResolvedTheme;
	setDensity: React.Dispatch<React.SetStateAction<PreviewSystemDensity>>;
	setMode: React.Dispatch<React.SetStateAction<PreviewThemeMode>>;
};

const PreviewSystemContext =
	React.createContext<PreviewSystemContextValue | null>(null);

function syncDocumentDensity(density: PreviewSystemDensity) {
	if (typeof document === "undefined") {
		return;
	}

	document.documentElement.dataset.density = density;
}

function PreviewSystemProviderBridge(props: { children: React.ReactNode }) {
	const { mode, resolvedTheme, setMode } = usePreviewTheme();
	const [density, setDensity] =
		React.useState<PreviewSystemDensity>("comfortable");

	React.useLayoutEffect(() => {
		syncDocumentDensity(density);
	}, [density]);

	return (
		<PreviewSystemContext.Provider
			value={{
				density,
				mode,
				resolvedTheme,
				setDensity,
				setMode,
			}}
		>
			{props.children}
		</PreviewSystemContext.Provider>
	);
}

export function SystemProvider(props: { children: React.ReactNode }) {
	return (
		<PreviewThemeProvider>
			<PreviewSystemProviderBridge>
				{props.children}
			</PreviewSystemProviderBridge>
		</PreviewThemeProvider>
	);
}

export function useSystem() {
	const context = React.useContext(PreviewSystemContext);
	if (!context) {
		throw new Error("useSystem must be used within SystemProvider.");
	}

	return context;
}
