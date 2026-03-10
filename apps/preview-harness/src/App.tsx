import { PreviewWorkspaceApp } from "../../../packages/preview/src/shell/PreviewWorkspaceApp";
import { WasmTestApp } from "../../../packages/preview/src/shell/WasmTestApp";

export function App() {
  const searchParams = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : undefined;
  const shouldRenderWasmTest = searchParams?.get("mode") === "wasm";

  return shouldRenderWasmTest ? <WasmTestApp /> : <PreviewWorkspaceApp />;
}
