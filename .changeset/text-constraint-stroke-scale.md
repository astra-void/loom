---
"@loom-dev/layout": patch
"@loom-dev/scene": patch
"@loom-dev/react": patch
"@loom-dev/vide": patch
"@loom-dev/renderer": patch
---

Three text features now render the way they do in Roblox ([#43](https://github.com/astra-void/loom/issues/43)).

- A `UISizeConstraint` caps the size `AutomaticSize` grows to, not only `Size`. A wrapped, auto-sized label with `MaxSize.X = 260` is at most 260 wide and wraps there, where it used to run on as one long line. An auto-sized frame with a `MaxSize` is also the width its content wraps against, and `MaxSize.Y` caps an automatic height.
- A `UIStroke` on a `TextLabel`, `TextButton` or `TextBox` outlines the glyphs unless its `ApplyStrokeMode` is `Border`. `Contextual` is the engine's default, so a stroked label no longer gets a rectangle around its box. The legacy `TextStrokeColor3` / `TextStrokeTransparency` outline is drawn too.
- A `UIScale` scales `TextSize`, including rich-text `<font size>` runs and `UITextSizeConstraint` bounds. Wrapped text under a `UIScale` now wraps at the width it is actually given, so it no longer overflows its box. Each layout rect carries the `scale` it is painted at for this.
