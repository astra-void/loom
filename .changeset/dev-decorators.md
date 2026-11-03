---
"@loom-dev/preview": patch
---

`loomPreview()` now lowers TC39 standard decorators in dev. A `@ReactComponent` class in a project whose tsconfig targets ES2022+ without `experimentalDecorators` used to reach the browser as written and fail with `Invalid or unexpected token`; only `vite build` worked.
