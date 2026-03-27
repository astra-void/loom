import * as jsxDevRuntime from "react/jsx-dev-runtime";

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

const { Fragment } = jsxDevRuntime;

function jsxDEV(type, props, key, isStaticChildren, source, self) {
	return jsxDevRuntime.jsxDEV(
		resolvePreviewIntrinsicHost(type),
		props,
		key,
		isStaticChildren,
		source,
		self,
	);
}

export { Fragment, jsxDEV };
