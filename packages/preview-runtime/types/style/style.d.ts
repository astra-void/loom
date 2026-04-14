import type * as React from "react";
import { type UDim2Like } from "../internal/robloxValues";
import type { Color3Value } from "../runtime/helpers";
type Color3Like = Color3Value;
type RobloxStyleProps = Record<string, unknown> & {
    Size?: UDim2Like;
    BackgroundColor3?: Color3Like;
    BackgroundTransparency?: number;
    Visible?: boolean;
};
export declare function __rbxStyle(props: RobloxStyleProps): React.CSSProperties;
export {};
