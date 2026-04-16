import { Portal, usePortalContext } from "../../react";
import { UDim2 } from "../../runtime/helpers";
import { PreviewTargetShell } from "./PreviewTargetShell";

function RuntimeHostsCardScene() {
	const { container } = usePortalContext();

	if (!container) {
		throw new Error("Runtime host preview requires a portal container.");
	}

	return (
		<Portal>
			<frame BackgroundTransparency={1} Size={UDim2.fromScale(1, 1)}>
				<textlabel Text="Runtime Hosts" />
				<textlabel Text="Portal context ready" />
				<textlabel Text="Preview-safe hosts target" />
			</frame>
		</Portal>
	);
}

export function RuntimeHostsCard() {
	return (
		<PreviewTargetShell>
			<RuntimeHostsCardScene />
		</PreviewTargetShell>
	);
}
