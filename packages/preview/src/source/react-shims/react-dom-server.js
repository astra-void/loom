import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ReactDomServer = require("react-dom/server");
const {
	renderToPipeableStream,
	renderToReadableStream,
	renderToStaticMarkup,
	renderToString,
	resume,
	resumeToPipeableStream,
	version,
} = ReactDomServer;

export default ReactDomServer;
export {
	renderToPipeableStream,
	renderToReadableStream,
	renderToStaticMarkup,
	renderToString,
	resume,
	resumeToPipeableStream,
	version,
};
