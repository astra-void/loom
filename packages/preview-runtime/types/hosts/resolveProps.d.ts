import type * as React from "react";
import type { ComputedRect } from "../layout/model";
import type { ForwardedDomProps, HostName, PreviewDomProps } from "./types";
export type ResolveOptions = {
	applyComputedLayout?: boolean;
	computed: ComputedRect | null;
	host: HostName;
	nodeId: string;
};
export type ResolvedPreviewDomProps = {
	children: React.ReactNode;
	disabled: boolean;
	domProps: ForwardedDomProps & Record<string, unknown>;
	image: unknown;
	imageColor3: unknown;
	imageTransparency: number | undefined;
	text: string | undefined;
};
export declare function applyComputedLayoutStyle(
	style: React.CSSProperties,
	computed: ComputedRect | null,
	parentRect?: ComputedRect | null,
): void;
export declare function resolvePreviewDomProps(
	props: PreviewDomProps,
	options: ResolveOptions,
): ResolvedPreviewDomProps;
