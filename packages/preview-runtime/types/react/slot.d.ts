import * as React from "react";
import type { PreviewDomProps } from "../hosts/types";
type SlotProps = PreviewDomProps & {
	children?: React.ReactNode;
};
export declare const Slot: React.ForwardRefExoticComponent<
	Omit<SlotProps, "ref"> & React.RefAttributes<HTMLElement>
>;
