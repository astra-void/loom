---
title: "Roblox hands GUI input to everything under the pointer until a button takes it; Active doesn't block"
author: Astra-void
date: 2026-11-06
branch: main
cost: { minutes: 44, tokens: 354209 }
id: l-634f3683
scope: repo
status: active
replaces: l-27fd85cf
src: agent
touches:
  - ".changeset/nested-flush-stale-patch.md"
  - packages/react/src/index.ts
  - packages/react/src/world.test.ts
  - ".changeset/engine-defaults.md"
  - packages/runtime/src/engine-defaults.ts
  - packages/runtime/src/instance.test.ts
  - packages/runtime/src/instance.ts
  - scripts/gen-engine-defaults.mjs
  - packages/preview/src/luau-plugin.ts
  - packages/renderer/src/index.ts
---

## Decided
Studio probes (2026-11-06, Play mode, clicks made through the Studio MCP) settled how GUI input goes through overlapping objects, and loom's renderer now matches it:
- A press goes to every GuiObject under the pointer, topmost first, down to the first GuiButton or TextBox, which takes it. Anything below that, even the button's own parent Frame, gets no InputBegan.
- A transparent Frame on top doesn't block the button underneath, whether or not it has `Active = true`. A ScrollingFrame on top doesn't block a click either. (`Active` only keeps input from reaching the 3D world.)
- MouseEnter and MouseMoved reach every object under the pointer, the button and everything above and below it.
- For equal ZIndex under Sibling, the child added later is drawn and hit on top (`GetGuiObjectsAtPosition` lists it first).
The renderer builds that stack with `elementsFromPoint` and falls back to the target's ancestor chain where it isn't available (happy-dom, so tests stub it). Hover is recomputed on every pointermove, because one object can start or stop being under the pointer while the browser's target stays the same.

## Tried and ruled out
Only loosening the `Active` → pointer-events rule. Iris's ResizeBorder also has MouseEnter listeners, and listeners alone make an element hit-testable, so it would still have been the only thing that heard the click.

## Watch out
Iris windows also kept losing focus, which hid the click fix: `GuiService:GetGuiInset()` reached Luau as one table, and Iris's `mouse - inset` became NaN. Engine methods that return several values must use `luaTuple(...)` so the Luau bindings spread them; a plain array is one table (`GetChildren`). `GetMouseLocation` must also update on press, since a press can arrive with no move before it.
Iris's checkbox tick is the engine texture `rbxasset://textures/AnimationEditor/icon_checkmark.png`, which loom can't draw. The state toggles; the tick is invisible.
topbar-plus still needs a `.rbxm` reader.

In the code: packages/renderer/src/index.ts `hitsAt`/`stackAt`/`untilSunk`/`textInputToFocus`, `sinksPointerInput` (no `Active`); packages/runtime/src/instance.ts `luaTuple`/`isLuaTuple`; packages/luau/src/bindings.ts Instance namecall.
