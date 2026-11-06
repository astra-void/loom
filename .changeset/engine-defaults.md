---
"@loom-dev/runtime": minor
---

A UI instance now reads the engine's default for a property nothing has written, where it used to read `nil`. `UIStroke.Thickness` is `1`, `UIPadding.PaddingTop` is `UDim(0, 0)`, `UICorner.CornerRadius` is `UDim(0, 8)`, `UIGradient.Color` is a white ramp, and `Frame.AutomaticSize` is `None`. Code that read a value before writing it (`stroke.Thickness + 2`) got `NaN` or threw. The defaults come from Roblox's API dump and cover the 2D GUI classes, the `UI*` modifiers, `Sound` and the `*Value` classes: 416 of 454 properties on the common UI classes now answer, up from 241. Defaults are only read back, never sent to the renderer, so nothing paints differently. `Font`, `FontFace` and `FontSize` stay unset, because the renderer's fallback face is what text is measured and painted in.

Reading `hasOwnProperty` or `constructor` on an instance no longer runs the default table's own `Object.prototype` members.
