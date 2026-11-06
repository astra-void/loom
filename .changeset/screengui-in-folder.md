---
"@loom-dev/react": patch
---

A `ScreenGui` kept in a folder under `PlayerGui` now renders, as in Roblox, which draws a `LayerCollector` anywhere under `PlayerGui`. Iris keeps its window and popup ScreenGuis in such a folder. Only a `GuiObject` outside every `LayerCollector` is still warned about.
