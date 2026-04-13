import * as React from "react";
import { Frame } from "../../hosts/components";
import type { PreviewDomProps } from "../../hosts/types";
import { Slot } from "../../react/slot";

type BoxProps = PreviewDomProps & {
	asChild?: boolean;
};

function omitPreviewIdentityProps(props: PreviewDomProps): PreviewDomProps {
	const sanitized = {
		...props,
	} as Record<string, unknown>;

	delete sanitized.Id;
	delete sanitized.ParentId;
	delete sanitized.id;
	delete sanitized.parentId;

	return sanitized as PreviewDomProps;
}

export const Box = React.forwardRef<HTMLElement, BoxProps>((props, ref) => {
	const { asChild = false, Id, ParentId, ...restProps } = props;
	const hostProps = restProps as PreviewDomProps;

	if (asChild) {
		return <Slot ref={ref} {...omitPreviewIdentityProps(hostProps)} />;
	}

	return <Frame ref={ref} Id={Id} ParentId={ParentId} {...hostProps} />;
});

Box.displayName = "PreviewBox";
