import * as React from "react";
import type { PreviewDomProps } from "../../hosts/types";
type BoxProps = PreviewDomProps & {
    asChild?: boolean;
};
export declare const Box: React.ForwardRefExoticComponent<Omit<BoxProps, "ref"> & React.RefAttributes<HTMLElement>>;
export {};
