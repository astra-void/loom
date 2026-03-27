import type React from "react";
import { PreviewWorkspaceApp } from "../../../packages/preview/src/shell/PreviewWorkspaceApp";
import { PreviewTargetShell } from "../../../packages/preview/src/shell/preview-targets/PreviewTargetShell";
import { WasmTestApp } from "../../../packages/preview/src/shell/WasmTestApp";

export function App() {
	const searchParams =
		typeof window !== "undefined"
			? new URLSearchParams(window.location.search)
			: undefined;
	const shouldRenderWasmTest = searchParams?.get("mode") === "wasm";

	const ShellContent: React.ReactElement = shouldRenderWasmTest ? (
		<WasmTestApp />
	) : (
		<PreviewWorkspaceApp />
	);

	return <PreviewTargetShell>{ShellContent}</PreviewTargetShell>;
}
