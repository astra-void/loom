import ReactDOM from "react-dom/client";
import { installPreviewBrowserGlobals } from "./installPreviewBrowserGlobals";
import { PreviewWorkspaceApp } from "./PreviewWorkspaceApp";
import { PreviewTargetShell } from "./preview-targets/PreviewTargetShell";
import { WasmTestApp } from "./WasmTestApp";

installPreviewBrowserGlobals();

const rootElement = document.getElementById("root");

if (!rootElement) {
	throw new Error("Preview root element is missing.");
}

const searchParams =
	typeof window !== "undefined"
		? new URLSearchParams(window.location.search)
		: undefined;
const shouldRenderWasmTest = searchParams?.get("mode") === "wasm";
const ShellApp = shouldRenderWasmTest ? WasmTestApp : PreviewWorkspaceApp;

ReactDOM.createRoot(rootElement).render(
	<PreviewTargetShell>
		<ShellApp />
	</PreviewTargetShell>,
);
