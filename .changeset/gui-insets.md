---
"@loom-dev/runtime": patch
---

`ScreenGui.ScreenInsets` reads as `Enum.ScreenInsets.CoreUISafeInsets`, the engine default, and `GuiService.TopbarInset` is an empty `Rect`, because the preview has no top bar (this matches the zero `GetGuiInset`). Popups that clamp against `TopbarInset.Max.Y` used to throw on the missing value.
