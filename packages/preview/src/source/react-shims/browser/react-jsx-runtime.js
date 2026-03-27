import * as jsxRuntime from "react/jsx-runtime";

const PREVIEW_INTRINSIC_HOSTS_SYMBOL = Symbol.for(
	"loom-dev.preview-runtime.intrinsic-hosts",
);

function resolvePreviewIntrinsicHost(type) {
	if (typeof type !== "string") {
		return type;
	}

	const registry = globalThis[PREVIEW_INTRINSIC_HOSTS_SYMBOL];
	return registry?.[type] ?? type;
}

const { Fragment } = jsxRuntime;

function jsx(type, props, key) {
	return jsxRuntime.jsx(resolvePreviewIntrinsicHost(type), props, key);
}

function jsxs(type, props, key) {
	return jsxRuntime.jsxs(resolvePreviewIntrinsicHost(type), props, key);
}

export { Fragment, jsx, jsxs };
