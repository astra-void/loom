import { PortalProvider, ScreenGui } from "@loom-dev/preview-runtime";
import React from "react";

type PreviewRenderShellProps = {
	children: React.ReactNode;
};

const ScreenGuiWithRef =
	ScreenGui as unknown as React.ForwardRefExoticComponent<
		React.PropsWithoutRef<Record<string, unknown>> &
			React.RefAttributes<HTMLElement>
	>;

export function PreviewRenderShell(props: PreviewRenderShellProps) {
	const [portalContainer, setPortalContainer] =
		React.useState<HTMLElement | null>(null);

	return (
		<ScreenGuiWithRef ref={setPortalContainer}>
			{portalContainer ? (
				<PortalProvider container={portalContainer}>
					{props.children}
				</PortalProvider>
			) : null}
		</ScreenGuiWithRef>
	);
}
