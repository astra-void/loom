---
"@loom-dev/runtime": minor
"@loom-dev/scene": minor
"@loom-dev/react": minor
"@loom-dev/vide": minor
"@loom-dev/layout": minor
"@loom-dev/preview": minor
---

Add the legacy `FontSize` property, the Luau string methods and `assert`, and
treat `Size` as a floor under `AutomaticSize`.

- `Enum.FontSize` and the `FontSize` prop are supported end to end. The pixel
  size is read out of the enum name, so `FontSize={Enum.FontSize.Size24}` paints
  and measures at 24px. `TextSize` still wins when both are set, matching how
  Roblox keeps the two properties linked.
- `String.prototype` gains the Luau string methods roblox-ts calls off a string
  receiver — `.lower()`, `.upper()`, `.sub()`, `.rep()`, `.find()`, `.gsub()`
  and `.format()` — each delegating to the existing `string` library, so the
  1-based indices and tuple returns carry over. `.sub()` deliberately replaces
  the Annex B HTML wrapper JS ships under that name; `.split()` is deliberately
  left native, since Luau's `string.split` is implemented with it.
- `assert` joins the installed Luau globals. It returns its argument when
  truthy, the way Luau does, so `const cfg = assert(maybeCfg, "no cfg")` works.
- `AutomaticSize` no longer shrinks an element below its own `Size`. Roblox
  treats `Size` as the minimum and only grows past it for larger content; loom
  was overwriting the size with the content size outright, so a fixed-width
  container with a small child collapsed to the child.
