---
"@loom-dev/layout": patch
"@loom-dev/renderer": patch
---

Two corrections to 0.14.1's text fixes, checked against Roblox Studio.

- A `UISizeConstraint` no longer caps the automatic size of a frame. In Studio, an auto-sized frame with `MaxSize = (60, 40)` around a 200×200 child is 200×200. Only text objects (`TextLabel`, `TextButton`, `TextBox`) are capped. A frame's `MaxSize` still sets the width the text inside it wraps at.
- A `UIScale` now thickens `UIStroke` the way it does in the engine, for both a box ring and a text outline. A stroke with `Thickness = 2` under `Scale = 2` draws 4px wide.
