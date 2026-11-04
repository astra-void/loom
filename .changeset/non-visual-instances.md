---
"@loom-dev/react": patch
"@loom-dev/runtime": patch
---

Instances Roblox never draws are no longer painted: a script, a value object or a `BindableEvent` parented among GUI objects used to render as an empty box and take a slot in its parent's `UIListLayout`. They now stay out of the scene, along with everything under them. `LuaSourceContainer`, `BaseScript`, `Script`, `LocalScript` and `ModuleScript` join the class registry, so `IsA` answers for them instead of warning about an unknown class.
