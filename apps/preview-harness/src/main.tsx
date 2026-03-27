import ReactDOM from "react-dom/client";
import "../../../packages/preview/src/shell/styles.css";

const rootElement = document.getElementById("root");

if (!rootElement) {
	throw new Error("Preview root element is missing.");
}

const previewRootElement = rootElement;

function renderBootstrapError(error: unknown) {
	const message =
		error instanceof Error ? (error.stack ?? error.message) : String(error);
	previewRootElement.innerHTML = `
		<main style="padding:24px;font-family:system-ui,sans-serif;white-space:pre-wrap;">
			<h1 style="margin:0 0 12px;font-size:20px;">Preview boot failed</h1>
			<pre style="margin:0;padding:16px;background:#1f1f1f;color:#f5f5f5;border-radius:12px;overflow:auto;">${message
				.replaceAll("&", "&amp;")
				.replaceAll("<", "&lt;")
				.replaceAll(">", "&gt;")}</pre>
		</main>
	`;
}

void (async () => {
	try {
		const [{ installPreviewBrowserGlobals }, { App }] = await Promise.all([
			import(
				"../../../packages/preview/src/shell/installPreviewBrowserGlobals"
			),
			import("./App"),
		]);

		installPreviewBrowserGlobals();
		ReactDOM.createRoot(previewRootElement).render(<App />);
	} catch (error) {
		console.error("[preview-harness] boot failed", error);
		renderBootstrapError(error);
	}
})();
