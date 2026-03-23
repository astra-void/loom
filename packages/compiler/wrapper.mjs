import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const compiler = require("./wrapper.js");

export const compile_tsx = compiler.compile_tsx;
export const normalizeTransformPreviewSourceResult =
	compiler.normalizeTransformPreviewSourceResult;
export const transformPreviewSource = compiler.transformPreviewSource;
export default compiler;
