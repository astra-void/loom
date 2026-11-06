---
"@loom-dev/runtime": minor
---

Every engine `Enum` and every engine event now exists, not only the ones loom acts on. Luau libraries read enums and connect to events while they load: Fusion, Iris and Vide all failed on a missing enum such as `SurfaceGuiSizingMode`, `LeftRight` or `Material`, and Iris connects `UserInputService.TouchTapInWorld`. Enums the runtime did not declare are built from the engine's API on first read, and the hand-written ones gain the items they lacked, with the engine's values. An event loom never raises is a signal that never fires, and the first read of each warns that it never fires in the preview.
