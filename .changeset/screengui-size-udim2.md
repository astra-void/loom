---
"@loom-dev/runtime": patch
---

A `ScreenGui` under `PlayerGui` reports the viewport as its `AbsoluteSize` as soon as it is parented, as in Roblox, instead of zero until the first layout. Iris clamps new windows to it and used to shrink every window to its minimum. `UDim2.new` also accepts two `UDim`s, as the constructor already did.
