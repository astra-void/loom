---
title: A layout flush must not patch its own scene after a nested flush has patched a newer one
author: Astra-void
date: 2026-11-06
branch: main
cost: { minutes: 21, tokens: 95606 }
id: l-50cea6b8
scope: repo
status: active
src: agent
touches:
  - packages/react/src/world.test.ts
  - ".changeset/nested-flush-stale-patch.md"
  - packages/react/src/index.ts
---

## Decided
The React adapter's root is legacy (synchronous). `applyAbsoluteGeometry` fires `AbsoluteSize` listeners mid-flush, so a listener that sets state commits on the spot, and `resetAfterCommit` runs a nested flush that patches the newer tree. `flushSync` therefore counts patches. It drops its own patch when another patch happened since its last encode, and `applyAbsoluteGeometry` stops writing the stale geometry once one has.

## Tried and ruled out
A test that mounts and checks the DOM does not reproduce it. The mount flush runs inside React's commit, where setState only queues. The outer flush has to come from outside React (a frame, the font wait, or `flushDirtyNow` after a direct write), as in world.test.ts "keeps what a state update from an AbsoluteSize listener painted".

## Watch out
This was the clean-ui Table "0 wide on a cold load, 362 after a remount" bug. It looked like font-load timing, but it was a stale patch. A rare 1–3px column variance showed up once right after Vite re-optimized deps, and did not reproduce in 18 later cold loads.

In the code: `flushSync`, `applyAbsoluteGeometry` and the `patches` field in packages/react/src/index.ts.
