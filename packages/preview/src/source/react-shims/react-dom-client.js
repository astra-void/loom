import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ReactDomClient = require("react-dom/client");
const { createRoot, hydrateRoot, version } = ReactDomClient;

export default ReactDomClient;
export { createRoot, hydrateRoot, version };
