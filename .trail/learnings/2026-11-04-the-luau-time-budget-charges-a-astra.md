---
title: "The Luau time budget charges a stall at most 50ms, so a throttled tab can't fail a healthy script"
author: Astra-void
date: 2026-11-04
branch: main
cost: { minutes: 1, tokens: 1702 }
id: l-8b8d425a
scope: repo
status: active
src: agent
touches:
  - packages/luau/native/bridge.cpp
  - packages/luau/src/vm.ts
---

## Decided
The VM's per-entry time budget, which exists to stop runaway Luau, now counts the time between Luau safepoints instead of raw wall-clock time. Any gap over 50ms costs at most 50ms of the budget. A gap can be a suspended or throttled tab, a long host call, or a compile. A running loop hits a safepoint every few microseconds, so infinite loops are still caught, and a loop of slow calls is caught at 50ms per call.

Why: with the pure wall clock, a hidden browser tab slowed React-Lua's module loading (normally about 60ms) past 5s. That raised "script exceeded its time budget" mid-require, and React's work loop then failed forever, so the page hung.

In the same pass, the host-userdata refcount is now raised before the userdata is allocated. Allocating can run a GC step that finalizes the object's previous userdata, which is already gone from the weak cache. Counting afterwards let that release delete the handle first, giving "reading 'count' of undefined" inside `__index`. This was seen once in a hidden tab and could not be reproduced deterministically.

In the code: `packages/luau/native/bridge.cpp` `interrupt` uses `STALL_MS = 50` and `lastSafepoint`, reset by `lb_budget`. The wasm was rebuilt with `pnpm --filter @loom-dev/luau build:vm`. `packages/luau/src/vm.ts` `pushHost` does `entry.count++` before `_lb_pushhost`, then `--` when nothing was created. The tests are in `vm.test.ts`: "doesn't charge a stall…" and "still stops a loop of slow calls".

## Tried and ruled out
- Extending the deadline by the time spent in host calls: requires nest inside host calls, so the outer deadline never paused for nested module loads. That didn't fix the hang.
- A Node stress test for the refcount race: it never hit the GC-step-during-allocation timing, so it was dropped instead of kept as false coverage.

## Watch out
- The stall test's budget has to fit the charges: three 400ms stalls cost 150ms, so it uses `budgetMs: 200`.
- When `loom preview` runs on a root outside the repo, Vite does not watch `packages/luau`. Restart the server after VM edits. esbuild strips comments, so check served code by its statements, not its comments.
- Time previews in headless Chromium, not the hidden in-app pane, which throttles rAF and timers.
