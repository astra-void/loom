import * as React from "react";
type PortalContextValue = {
    container?: HTMLElement | null;
    displayOrderBase: number;
};
type PortalProviderProps = {
    children?: React.ReactNode;
    container?: HTMLElement | null;
    displayOrderBase?: number;
};
export declare function PortalProvider(props: PortalProviderProps): import("react/jsx-runtime").JSX.Element;
type PortalProps = {
    children?: React.ReactNode;
    container?: HTMLElement | null;
};
export declare function Portal(props: PortalProps): React.ReactPortal | null;
export declare function usePortalContext(): PortalContextValue;
export {};
