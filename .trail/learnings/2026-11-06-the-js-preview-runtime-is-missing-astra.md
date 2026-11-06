---
title: The JS preview runtime is missing many common engine APIs; unset property defaults are the biggest gap
author: Astra-void
date: 2026-11-06
branch: main
cost: { minutes: 12, tokens: 146978 }
id: l-8b160b9a
scope: repo
status: active
src: agent
touches:
  - biome.json
  - ".changeset/engine-enums-events.md"
  - ".changeset/luau-adapter.md"
  - ".changeset/luau-projects.md"
  - ".changeset/rbxts-luau-runtime.md"
  - ".changeset/reflection-get-classes.md"
  - ".changeset/screengui-in-folder.md"
  - ".changeset/screengui-size-udim2.md"
  - ".changeset/gui-insets.md"
  - packages/runtime/src/instance.test.ts
---

## Decided
On 2026-11-06, the clean-ui Tooltip 1.6.0 hover crashed because `GuiService.TopbarInset` read as nil. That fix added `TopbarInset` (an empty Rect, since the preview has no top bar) and `ScreenGui.ScreenInsets` (default CoreUISafeInsets). The audit that followed measured what else is missing.

Method: the TypeScript checker resolved every engine member read in 1012 files of real roblox-ts code (clean-ui, lattice-ui, arcanum, troll-tower). Each one was then read on a fresh runtime instance after `installGlobals()`.

## Watch out
- Unset property defaults are the largest gap. On 22 UI classes, only 241 of 454 non-nil properties have a default when read. Modifiers have almost none: UIStroke 1/11, UIPadding 1/5, UICorner 1/6, UIGradient 1/9. GuiObject.AutomaticSize, TextBox.TextEditable and GuiButton.AutoButtonColor are also missing. Rendering still looks right, because layout and paint apply their own defaults. Code that *reads* one of these values gets nil instead.
- Child-by-name indexing (`player.PlayerGui`, `gui.Frame.Button`) reads undefined in the JS path. The Luau bindings fall back to FindFirstChild; the JS runtime does not.
- Missing methods seen in real UI code: Instance.FindFirstChildWhichIsA (10 files), FindFirstDescendant, IsAncestorOf, the Instance tag methods (HasTag, AddTag, RemoveTag, GetTags), Player.GetMouse and InputObject.IsModifierKeyDown. Sound.Play/Stop are missing too, along with RemoteEvent.FireServer/OnClientEvent and Players.GetPlayers.
- False positives to skip in a future audit: Map/Set `.size()`, which the transform rewrites at the call site. Promise, which is bound per module as RobloxPromise. AbsoluteContentSize, which the React adapter publishes only after layout. Parent and SelectedObject, which are nil by default in Roblox too.
- @rbxts/types has no default values. Use the Roblox API dump (Full-API-Dump) as the source when generating defaults.
