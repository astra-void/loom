---
title: "Preview cold-start reload: give the dep scan entries and always pre-bundle the reconciler"
author: Astra-void
date: 2026-11-04
branch: main
cost: { minutes: 1, tokens: 2274 }
id: l-b10e8ce5
scope: repo
status: active
src: agent
touches:
  - packages/preview/src/html.ts
  - packages/preview/src/vite.ts
---

## Decided
Every loom preview whose page loom generates (no index.html on disk) reloaded once on a cold start or config change. The server log showed "new dependencies optimized: react-reconciler, react-reconciler/constants.js", and the first load hit a stale-chunk 404. This happened for TypeScript and Luau projects alike, so it is not Luau-specific. The fix has two parts, and both are needed:
1. The scan gets explicit entries: whatever the generated page loads.
2. The reconciler is pre-bundled even in a workspace checkout, under both ids it is imported by.

## Tried and ruled out
- Making the Luau page entry a real file instead of a virtual module. That is still worth doing (the scanner can't follow virtual entries), but alone it changed nothing, because the scan had no entries at all.
- Scan entries alone. Still reloaded: in a workspace, @loom-dev/react is in optimizeDeps.exclude, and the scanner never crawls into an excluded package, so it can't see the reconciler import inside it.
- Aliasing the `.js` spelling to the same file without adding it to include. Still reloaded: the optimizer keys pre-bundled deps by the id as written.

## Watch out
- One cold start can look clean by luck when the cache survived. Delete `apps/<app>/node_modules/.vite` first, and read the dev server's log, not the browser console (the console keeps history across reloads).
- A gallery only imports a target when it's opened, so open one before reading the log.

In the code:
- `scanEntries()` in `packages/preview/src/html.ts`, applied from `loomIndexHtml`'s `config` hook (serve only; skipped when the project has its own index.html or optimizeDeps.entries).
- `resolveAdapter()` in `packages/preview/src/vite.ts` now always returns reconciler + constants; `adapter` stays installed-only. The include list has `react-reconciler/constants` and `react-reconciler/constants.js`, and the alias is `/^react-reconciler\/constants(\.js)?$/`.
- `fromViteFsUrl()` in `vite-fs-url.ts` turns the Luau entry's `/@fs/` URL back into a path.
- Tests: `packages/preview/src/scan-entries.test.ts`.
