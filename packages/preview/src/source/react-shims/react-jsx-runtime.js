import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const jsxRuntime = require("react/jsx-runtime");
const { Fragment, jsx, jsxs } = jsxRuntime;

export { Fragment, jsx, jsxs };
