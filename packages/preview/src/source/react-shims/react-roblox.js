import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ReactDomClient = require("react-dom/client");
const ReactDom = require("react-dom");

let ReactDomTestUtils;
try {
	ReactDomTestUtils = require("react-dom/test-utils");
} catch {
	ReactDomTestUtils = {};
}

const act = ReactDomTestUtils.act ?? ((callback) => callback());
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
