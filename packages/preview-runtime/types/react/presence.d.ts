import * as React from "react";
export type PresenceRenderState = {
    isPresent: boolean;
    onExitComplete: () => void;
};
export type PresenceRender = (state: PresenceRenderState) => React.ReactElement | undefined;
type PresenceProps = {
    children?: PresenceRender;
    render?: PresenceRender;
    present: boolean;
    exitFallbackMs?: number;
    onExitComplete?: () => void;
};
export declare function Presence(props: PresenceProps): React.ReactElement<unknown, string | React.JSXElementConstructor<any>> | undefined;
export {};
