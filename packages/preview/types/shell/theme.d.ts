import React from "react";
export type PreviewThemeMode = "system" | "light" | "dark";
export type PreviewResolvedTheme = "light" | "dark";
type PreviewThemeContextValue = {
	mode: PreviewThemeMode;
	resolvedTheme: PreviewResolvedTheme;
	setMode: React.Dispatch<React.SetStateAction<PreviewThemeMode>>;
};
export declare function PreviewThemeProvider(props: {
	children: React.ReactNode;
}): import("react/jsx-runtime").JSX.Element;
export declare function usePreviewTheme(): PreviewThemeContextValue;
export declare function PreviewThemeControl(): import("react/jsx-runtime").JSX.Element;
