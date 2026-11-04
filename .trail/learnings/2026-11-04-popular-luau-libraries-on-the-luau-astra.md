---
title: "Popular Luau libraries on the Luau VM fail on engine gaps, not on the libraries"
author: Astra-void
date: 2026-11-04
branch: main
cost: { minutes: 55, tokens: 295101 }
id: l-49f3d745
scope: repo
status: active
src: agent
touches:
  - docs/design/rbxts-on-luau-vm.md
  - packages/cli/src/cli.ts
  - packages/preview/package.json
  - packages/preview/src/html.ts
  - packages/preview/src/luau-plugin.ts
  - packages/preview/src/rbxts-compiler.test.ts
  - packages/preview/src/rbxts-compiler.ts
  - packages/preview/src/vite.ts
  - pnpm-lock.yaml
  - packages/preview/src/luau-project.ts
---

## Decided
A compatibility sweep (2026-11-04) ran 13 npm @rbxts libraries as real Luau through `--runtime luau`'s compiler + `runLuauProject`: fusion 0.2, vide 0.6, iris 2.3, charm 0.11, reflex 4.3, janitor, trove, t, sift, goodsignal, flipper, jecs 0.11, topbar-plus 3.2.
As-is 8 pass (janitor, trove, t, sift, goodsignal, charm, reflex, flipper, plus jecs once the smoke test used `w.component()`).
Every failure was a missing engine piece, never the library: fill those in the engine, don't port.

## Watch out
- `Enum` is a hand-written subset (~44 of the engine's 652). Fusion (SurfaceGuiSizingMode), Iris (LeftRight) and Vide (Material) die at load because their default-property tables touch enums no UI ever renders. `@rbxts/types/include/generated/enums.d.ts` carries every enum with engine values (`Name: "X"; Value: N;`) and filled all 609 missing ones.
- A Luau function passed to an engine method (not a signal `Connect`) reaches JS as a `LuauFunction` handle, so `RunService:BindToRenderStep(name, prio, fn)` throws "needs a function" (Fusion's Tween/Spring schedulers). The `Instance` namecall must wrap `LuauFunction` args into callbacks that `vm.spawn`.
- Libraries subscribe to events loom never fires: Iris connects `UserInputService.TouchTapInWorld` and got nil. Unknown-but-real events should resolve to inert signals.
- topbar-plus ships its implementation in `icon.rbxm`; the Rojo reader skips `.rbxm(x)`, so `require(script.icon)` gets nil.
With the first three filled in (temporarily, in a harness), fusion, vide and iris also pass: 12/13.

In the code: harness pattern = createRbxtsCompiler → readLuauProject(root, compiler.fs) → generateLuauProjectModule → runLuauProject with a stub computeLayout (see packages/preview/src/rbxts-compiler.test.ts). Node only, no real layout or rendering checked.
