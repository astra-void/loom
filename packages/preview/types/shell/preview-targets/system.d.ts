import React from "react";
import { type PreviewResolvedTheme, type PreviewThemeMode } from "../theme";
export type PreviewSystemDensity = "comfortable" | "compact";
type PreviewSystemContextValue = {
	density: PreviewSystemDensity;
	mode: PreviewThemeMode;
	resolvedTheme: PreviewResolvedTheme;
	setDensity: React.Dispatch<React.SetStateAction<PreviewSystemDensity>>;
	setMode: React.Dispatch<React.SetStateAction<PreviewThemeMode>>;
};
export declare function SystemProvider(props: {
	children: React.ReactNode;
}): import("react/jsx-runtime").JSX.Element;
export declare function useSystem(): PreviewSystemContextValue;
