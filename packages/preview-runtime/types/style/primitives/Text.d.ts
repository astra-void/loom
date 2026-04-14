import * as React from "react";
import type { PreviewDomProps } from "../../hosts/types";
type TextProps = PreviewDomProps & {
    asChild?: boolean;
};
export declare const Text: React.ForwardRefExoticComponent<Omit<TextProps, "ref"> & React.RefAttributes<HTMLElement>>;
export {};
