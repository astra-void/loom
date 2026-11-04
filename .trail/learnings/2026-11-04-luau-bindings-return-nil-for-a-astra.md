---
title: "Luau bindings return nil for a missing member, where Roblox errors; not yet checked in Studio"
author: Astra-void
date: 2026-11-04
branch: main
cost: { minutes: 1, tokens: 2331 }
id: l-30bd1b46
scope: repo
status: active
src: agent
touches:
  - packages/luau/src/bindings.ts
---

## Decided
An Instance member that doesn't exist reads as nil, and writing one is silently accepted. Roblox raises "X is not a valid member of Frame". This was a deliberate choice: loom's runtime knows only the properties it implements, so erroring would break scripts that touch a real Roblox property loom hasn't modelled yet. A name lookup falls back to a child of that name (`script.Parent.Frame`), and properties win over children.

## Tried and ruled out
Nothing yet. A Studio comparison is the planned way to settle this, and to check the exact error wording for `require`, enums and datatypes.

## Watch out
- Before matching Roblox here, check whether the runtime knows enough properties: an error on every unmodelled property would be worse than nil.
- The loom-side results of the fidelity probe are known; Studio's are not. Run both with the same script, with a `makeModule(name, source, parent)` helper that sets `.Source` in Studio, then diff the two outputs.

In the code:
- `InstanceClass.index` / `newindex` in `packages/luau/src/bindings.ts`. Method calls on a missing member already error with Roblox's wording (`namecall`).
