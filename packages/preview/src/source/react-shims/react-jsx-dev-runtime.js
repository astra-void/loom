import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const jsxDevRuntime = require("react/jsx-dev-runtime");
const { Fragment, jsxDEV } = jsxDevRuntime;

export { Fragment, jsxDEV };
