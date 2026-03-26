import type React from "react";
import { PreviewWorkspaceApp } from "../../../packages/preview/src/shell/PreviewWorkspaceApp";
import { WasmTestApp } from "../../../packages/preview/src/shell/WasmTestApp";
import { PreviewSceneShell } from "./PreviewSceneShell";

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

	return <PreviewSceneShell>{ShellContent}</PreviewSceneShell>;
}
