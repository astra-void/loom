---
"@loom-dev/preview": patch
---

A preview no longer reloads once on every cold start. Without an `index.html` on disk, Vite's dependency scan had nowhere to start, and in a workspace checkout the React adapter's reconciler was never pre-bundled. Its dependencies only turned up as the page first imported them, which meant a re-optimize, a stale-chunk 404, and a reload. Now, when loom generates the page, the scan starts from what that page loads: the detected entry (TypeScript or `@loom-dev/luau/entry`), or the gallery shell and its targets. The reconciler is always pre-bundled, under both of the ids it is imported by. A project with its own `index.html` or `optimizeDeps.entries` is left as it was.
