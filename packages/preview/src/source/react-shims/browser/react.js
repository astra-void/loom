import * as React from "react";

const PREVIEW_INTRINSIC_HOSTS_SYMBOL = Symbol.for(
	"loom-dev.preview-runtime.intrinsic-hosts",
);
const PREVIEW_REACT_EVENT_PROP_KEYS = Object.freeze({
	Activated: "__previewReactEventActivated",
	FocusLost: "__previewReactEventFocusLost",
	InputBegan: "__previewReactEventInputBegan",
});
const PREVIEW_REACT_CHANGE_PROP_KEYS = Object.freeze({
	Text: "__previewReactChangeText",
});
const {
	__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE,
	__COMPILER_RUNTIME,
	Activity,
	act,
	Children,
	Component,
	cache,
	cacheSignal,
	captureOwnerStack,
	cloneElement,
	createContext,
	createRef,
	Fragment,
	forwardRef,
	isValidElement,
	lazy,
	memo,
	Profiler,
	PureComponent,
	StrictMode,
	Suspense,
	startTransition,
	unstable_useCacheRefresh,
	use,
	useActionState,
	useCallback,
	useContext,
	useDebugValue,
	useDeferredValue,
	useEffect,
	useEffectEvent,
	useId,
	useImperativeHandle,
	useInsertionEffect,
	useLayoutEffect,
	useMemo,
	useOptimistic,
	useReducer,
	useRef,
	useState,
	useSyncExternalStore,
	useTransition,
	version,
} = React;

function resolvePreviewIntrinsicHost(type) {
	if (typeof type !== "string") {
		return type;
	}

	const registry = globalThis[PREVIEW_INTRINSIC_HOSTS_SYMBOL];
	return registry?.[type] ?? type;
}

function createElement(type, ...rest) {
	return React.createElement(resolvePreviewIntrinsicHost(type), ...rest);
}

const previewReact = {
	...React,
	Change: PREVIEW_REACT_CHANGE_PROP_KEYS,
	createElement,
	Event: PREVIEW_REACT_EVENT_PROP_KEYS,
};

export default previewReact;
export const Change = PREVIEW_REACT_CHANGE_PROP_KEYS;
export const Event = PREVIEW_REACT_EVENT_PROP_KEYS;
export {
	__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE,
	__COMPILER_RUNTIME,
	Activity,
	act,
	Children,
	Component,
	cache,
	cacheSignal,
	captureOwnerStack,
	cloneElement,
	createContext,
	createRef,
	Fragment,
	forwardRef,
	isValidElement,
	lazy,
	memo,
	Profiler,
	PureComponent,
	StrictMode,
	Suspense,
	startTransition,
	unstable_useCacheRefresh,
	use,
	useActionState,
	useCallback,
	useContext,
	useDebugValue,
	useDeferredValue,
	useEffect,
	useEffectEvent,
	useId,
	useImperativeHandle,
	useInsertionEffect,
	useLayoutEffect,
	useMemo,
	useOptimistic,
	useReducer,
	useRef,
	useState,
	useSyncExternalStore,
	useTransition,
	version,
};
export { createElement };
