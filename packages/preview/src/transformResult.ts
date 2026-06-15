// The transform-preview-source normalization logic is owned by the preview
// engine (which in turn mirrors the compiler-owned surface). This module is a
// thin re-export shim so existing `../transformResult` imports inside the
// preview package keep resolving to the single shared implementation.
export { normalizeTransformPreviewSourceResult } from "@loom-dev/preview-engine";
