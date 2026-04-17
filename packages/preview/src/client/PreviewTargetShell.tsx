import { PreviewTargetShell as RuntimePreviewTargetShell } from "@loom-dev/preview-runtime";
import type React from "react";
import { SystemProvider } from "../shell/preview-targets/system";

export type PreviewTargetShellProps = {
	children: React.ReactNode;
};

export function PreviewTargetShell(props: PreviewTargetShellProps) {
	return (
		<SystemProvider>
			<RuntimePreviewTargetShell>{props.children}</RuntimePreviewTargetShell>
		</SystemProvider>
	);
}
