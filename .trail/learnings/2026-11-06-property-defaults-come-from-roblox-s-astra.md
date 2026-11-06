---
title: "Property defaults come from Roblox's API dump, except fonts; a clean-ui Table measures 0 wide on a cold load"
author: Astra-void
date: 2026-11-06
branch: main
cost: { minutes: 1, tokens: 0 }
id: l-9c2ab5db
scope: repo
status: active
src: agent
touches:
  - packages/runtime/src/instance.ts
---

## Decided
Unset property defaults are generated from Roblox's Full-API-Dump, because @rbxts/types has no default values. Hand-written CLASS_DEFAULTS and property readers win over the dump. That matters for TextSize: the dump says 8, while loom measures and paints at 14. Defaults are only read back, never written to raw props, so they never reach the scene IR or change what paints.

## Tried and ruled out
Generating Font/FontFace/FontSize. The dump says Legacy, and the adapter measures text through `inst.Font`. The renderer paints from the IR, where an absent font is the sans fallback. With Legacy answered, text would be measured in Arial and painted in sans.

## Watch out
- Abstract classes (GuiObject, GuiButton, GuiBase2d) have no Default in the dump, only `__api_dump_class_not_creatable__`. Their values are hand-listed in the generator from the docs, not from Studio.
- Table lookups keyed by property name must check own keys. Reading `hasOwnProperty` on an instance used to call Object.prototype's function out of CLASS_DEFAULTS and throw.
- The clean-ui `Table` scene renders 0 wide on a cold page load and 362 wide after a remount, with or without defaults. This is a measurement timing bug, not a defaults regression, so don't mistake it for one when diffing scenes.

In the code: scripts/gen-engine-defaults.mjs (fetches the dump when given no path), packages/runtime/src/engine-defaults.ts, `classDefaultProperty` in packages/runtime/src/instance.ts.
