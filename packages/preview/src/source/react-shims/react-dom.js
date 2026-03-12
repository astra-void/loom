import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ReactDom = require("react-dom");
const {
	__DOM_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE,
	createPortal,
	flushSync,
	preconnect,
	prefetchDNS,
	preinit,
	preinitModule,
	preload,
	preloadModule,
	requestFormReset,
	unstable_batchedUpdates,
	useFormState,
	useFormStatus,
	version,
} = ReactDom;

export default ReactDom;
export {
	__DOM_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE,
	createPortal,
	flushSync,
	preconnect,
	prefetchDNS,
	preinit,
	preinitModule,
	preload,
	preloadModule,
	requestFormReset,
	unstable_batchedUpdates,
	useFormState,
	useFormStatus,
	version,
};
