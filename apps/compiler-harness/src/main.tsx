import React from "react";
import ReactDOM from "react-dom/client";
import "./styles.css";
import { App } from "./App";

const rootElement = document.getElementById("root");

if (!rootElement) {
	throw new Error("Compiler harness root element is missing.");
}

ReactDOM.createRoot(rootElement).render(
	<React.StrictMode>
		<App />
	</React.StrictMode>,
);
