import type React from "react";
import { SystemProvider } from "../../../packages/preview/src/shell/preview-targets/system";

type PreviewSceneShellProps = {
	children: React.ReactNode;
};

export function PreviewSceneShell(props: PreviewSceneShellProps) {
	return <SystemProvider>{props.children}</SystemProvider>;
}
