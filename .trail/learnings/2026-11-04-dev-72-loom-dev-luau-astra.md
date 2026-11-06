---
title: "DEV-72 @loom-dev/luau"
author: Astra-void
date: 2026-11-04
id: l-9dd323f3
scope: repo
status: active
touches:
  - packages/luau/native/bridge.cpp
---

## Decided
DEV-72 (M6 Luau adapter). User picked (2026-11-04) the **browser Luau VM** route over parsing .rbxmx, and **building upstream luau-lang/luau ourselves** over npm `luau-web` (a single maintainer's fork, shipped as a prebuilt bundle).

Layout: `packages/luau/native/bridge.cpp` + `native/build.sh`. The script pins `LUAU_VERSION`, clones into the gitignored `vendor/`, and builds with `emcmake` + `-fwasm-exceptions`. It links Compiler+Ast+Bytecode+VM+Common. Output goes to `wasm/luau-vm.{mjs,wasm}`, which is **committed** so nobody else needs emscripten. Typings in `luau-vm.d.mts` are hand-written. `src/vm.ts` `LuauVM` holds every behaviour; the C side only covers what JS can't do (trampoline sentinels → lua_error/lua_yield, cached tagged host userdata + dtor, stable kinds, time budget).

**Why:** loom owns its fidelity stack (same reasoning as the Rust layout engine). Roblox semantics such as typeof, namecall, yields and sandboxing need to be under our control.

**How to apply / plan:**
1. VM — committed e3ebc62 (2026-11-04).
2. Bindings + `mountLuau` + `apps/luau-example` — committed 1ab5905 (2026-11-04). The card matched the vide example's geometry in the browser. `createWorld` from `@loom-dev/react` is reused, so `@loom-dev/luau` depends on react. Extracting the world into its own package is a possible follow-up.
…

_From Claude Code's memory of this repo, last updated Nov 3._
