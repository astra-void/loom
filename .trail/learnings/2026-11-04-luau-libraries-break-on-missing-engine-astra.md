---
title: "Luau libraries break on missing engine pieces, so fill the engine; Iris clicks still blocked by an Active frame"
author: Astra-void
date: 2026-11-04
branch: main
cost: { minutes: 18, tokens: 172261 }
id: l-27fd85cf
scope: repo
status: active
replaces: l-49f3d745
src: agent
touches:
  - scripts/gen-engine-api.mjs
  - packages/runtime/src/enums.test.ts
  - packages/react/src/index.ts
---

## Decided
A sweep of 13 npm @rbxts Luau libraries (fusion 0.2, vide 0.6, iris 2.3, charm, reflex, janitor, trove, t, sift, goodsignal, flipper, jecs, topbar-plus) on the Luau VM failed only on missing engine pieces, never on the libraries. Fixed in the engine, not ported: 12/13 load and run; Fusion, Vide and Iris render in headless Chromium.
- Full `Enum` from `@rbxts/types` (generated `packages/runtime/src/engine-enums.ts`, lazily built; loom's 44 hand-written enums matched the engine values and are extended, not replaced). Regenerate with `node scripts/gen-engine-api.mjs`.
- Real engine events loom never raises resolve to inert signals that warn once (`engine-events.ts`), instead of nil.
- Luau functions passed to engine methods (`BindToRenderStep`, `BindAction`) become callbacks; a non-yielding return value goes back (BindAction's Sink).
- A ScreenGui inside a Folder under PlayerGui renders (Iris_Root), and a ScreenGui under PlayerGui reports the viewport as `AbsoluteSize` before any layout (Iris clamps windows to it).
- `UDim2.new(UDim, UDim)` works from Luau (only the constructor took that form).

## Watch out
- Iris buttons don't click in the preview: Iris puts an `Active = true` transparent `ResizeBorder` Frame over the window content (same ZIndex, later sibling), and the renderer's `sinksPointerInput` makes Active frames block. Roblox docs say Active on a Frame sinks input to 3D space; Iris works in Roblox, so loom's rule is probably too strict. NOT changed: c142924 introduced the rule deliberately and nobody has checked it in Studio yet. Check it there before touching it.
- topbar-plus keeps its implementation in `icon.rbxm`; the Rojo reader skips `.rbxm(x)`. Needs a binary model reader.
