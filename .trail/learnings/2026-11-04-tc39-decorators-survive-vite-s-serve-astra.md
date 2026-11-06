---
title: "TC39 decorators survive Vite's serve-mode esbuild transform (esnext) and break in node…"
author: Astra-void
date: 2026-11-04
id: l-487839f5
scope: repo
status: active
touches:
  - tsconfig.base.json
  - packages/preview/src/prerender.ts
  - packages/preview/src/vite.test.ts
---

## Decided
`Invalid or unexpected token` on a `.loom.tsx` with `@ReactComponent` means a raw TC39 decorator reached an engine. Vite's `vite:esbuild` uses `target: "esnext"` in serve mode and keeps decorators verbatim. Neither Node 22's V8 nor Chrome 152 parses them. Only `vite build`'s renderChunk (to `build.target`) lowers them.

The leak needs both of these (verified 2026-09-26, esbuild 0.25):
- no `experimentalDecorators`: legacy decorators are always compiled, which is why roblox-ts projects are safe.
- a tsconfig `target` of ES2022+ (`useDefineForClassFields` true). With no tsconfig, Vite passes `useDefineForClassFields: false` and esbuild lowers the whole class, so a fixture without a tsconfig does not reproduce it.

The gallery demo (extends `tsconfig.base.json`, ES2022) hits it with `ReactClassScene`. Vitest's own transform targets node18, so unit tests never see it.

**Why:** the prerender (`packages/preview/src/prerender.ts`) was fixed on 2026-09-26, uncommitted at the time, by giving its SSR server `esbuild.target: node${process.versions.node}`. The browser dev gallery still broke. That was flagged as a follow-up (`supported: { decorators: false }` in `loomPreview`'s `config()`).
…

## Watch out
before re-diagnosing a gallery-dev `Invalid or unexpected token`, check whether that follow-up landed. Regression fixtures need a tsconfig with an ES2022+ target. Related: loom-next-integration, react-adapter.

_From Claude Code's memory of this repo, last updated Nov 3._
