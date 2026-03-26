import { usePreviewTheme } from "../theme";
import { PreviewTargetShell } from "./PreviewTargetShell";

function PreviewShellCardScene() {
	const { mode, resolvedTheme } = usePreviewTheme();

	return (
		<frame BackgroundTransparency={1}>
			<textlabel Text="Loom Preview Shell" />
			<textlabel Text={`Theme mode: ${mode}`} />
			<textlabel Text={`Resolved theme: ${resolvedTheme}`} />
			<textlabel Text="Preview-safe shell target" />
		</frame>
	);
}

export function PreviewShellCard() {
	return (
		<PreviewTargetShell>
			<PreviewShellCardScene />
		</PreviewTargetShell>
	);
}
