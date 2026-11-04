---
title: User wants roblox-ts preview to run rbxtsc output in the Luau VM (no library ports)
author: Astra-void
date: 2026-11-04
id: l-c0018e52
scope: repo
status: active
touches:
  - docs/design/rbxts-on-luau-vm.md
---

## Decided
On 2026-11-04 the user asked to drop library ports (Ripple, React-Lua compat, ui-labs) by running roblox-ts projects as rbxtsc→Luau in the `@loom-dev/luau` VM, "without losing anything". The design is in `docs/design/rbxts-on-luau-vm.md` (uncommitted when written).

Key findings behind it:
- roblox-ts 3.0 is usable as a library: `roblox-ts/out/Project` exports `VirtualProject` (the playground compiler); its `compileSource` shows the per-file path `createProgram → TransformState → transformSourceFile → renderAST`.
- roblox-ts emits no source maps. Hook point: `TransformState.prototype.getLeadingComments` runs per statement in `transformStatementList`, so a line marker comment can be injected there.
- `@rbxts/react` is a thin Luau wrapper over `@rbxts-js/react` (real React-Lua 17).
- The current TS preview already does a full reload on edit (gallery-shell blocks self-patch), so Luau-side module hot swap would improve on it.

**Why:** the principle is "port the engine, never port libraries".

## Watch out
the P0 spike (gallery-demo compiled by rbxtsc, CardScene and RippleScene on real React-Lua, timed) is the go/no-go before any other phase. Open decisions are listed in §6 of the doc. Related: luau-adapter, react-adapter.

_From Claude Code's memory of this repo, last updated Nov 4._
