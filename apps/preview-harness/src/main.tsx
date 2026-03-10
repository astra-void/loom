import React from "react";
import ReactDOM from "react-dom/client";
import "../../../packages/preview/src/shell/styles.css";
import { installPreviewBrowserGlobals } from "../../../packages/preview/src/shell/installPreviewBrowserGlobals";
import { App } from "./App";

installPreviewBrowserGlobals();

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Preview root element is missing.");
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
