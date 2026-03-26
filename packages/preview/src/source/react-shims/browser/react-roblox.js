import * as ReactDom from "react-dom";
import * as ReactDomClient from "react-dom/client";
import { act } from "./react.js";

const createPortal = ReactDom.createPortal;
const version = ReactDom.version;

function createRoot(container, options) {
	const root = ReactDomClient.createRoot(container, options);
	return {
		render(children) {
			root.render(children);
		},
		unmount() {
			root.unmount();
		},
	};
}

function createBlockingRoot(container, options) {
	return createRoot(container, options);
}

function createLegacyRoot(container, options) {
	return createRoot(container, options);
}

const ReactRoblox = {
	act,
	createBlockingRoot,
	createLegacyRoot,
	createPortal,
	createRoot,
	version,
};

export default ReactRoblox;
export {
	act,
	createBlockingRoot,
	createLegacyRoot,
	createPortal,
	createRoot,
	version,
};
