import React from "react";
import type { PreviewComponentPropsMetadata } from "./previewTypes";
export type PreviewAutoMockableComponent<
	Props extends Record<string, unknown> = Record<string, unknown>,
> = React.ComponentType<Props> & {
	__previewProps?: PreviewComponentPropsMetadata;
};
type AutoMockProviderProps<Props extends Record<string, unknown>> = {
	component: PreviewAutoMockableComponent<Props>;
	props?: Partial<Props> | Record<string, unknown>;
};
export declare function buildAutoMockProps<
	Props extends Record<string, unknown>,
>(
	component: PreviewAutoMockableComponent<Props>,
	explicitProps?: Partial<Props> | Record<string, unknown>,
): Props;
export declare function withAutoMockedProps<
	Props extends Record<string, unknown>,
>(
	component: PreviewAutoMockableComponent<Props>,
): {
	(props: Partial<Props>): React.ReactElement<Props>;
	displayName: string;
};
export declare function AutoMockProvider<Props extends Record<string, unknown>>(
	props: AutoMockProviderProps<Props>,
): React.ReactElement<Props>;
