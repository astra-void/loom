import * as React from "react";
type FocusScopeProps = {
	active?: boolean;
	asChild?: boolean;
	trapped?: boolean;
	restoreFocus?: boolean;
	children?: React.ReactNode;
};
export declare function FocusScope(
	props: FocusScopeProps,
): import("react/jsx-runtime").JSX.Element;
