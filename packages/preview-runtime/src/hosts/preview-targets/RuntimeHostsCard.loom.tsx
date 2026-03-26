import { Portal, usePortalContext } from "../../react";
import { PreviewTargetShell } from "./PreviewTargetShell";

function RuntimeHostsCardScene() {
	const { container } = usePortalContext();

	if (!container) {
		throw new Error("Runtime host preview requires a portal container.");
	}

	return (
		<Portal>
			<frame BackgroundTransparency={1}>
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
