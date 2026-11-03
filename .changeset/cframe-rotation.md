---
"@loom-dev/runtime": minor
"@loom-dev/preview": minor
---

`CFrame` now carries a rotation. It gains the engine's constructors (`CFrame.new` with a look-at target, a quaternion or all twelve components, `Angles`, `fromEulerAnglesXYZ`/`YXZ`, `fromOrientation`, `fromAxisAngle`, `fromMatrix`, `lookAt`), its basis vectors (`XVector`/`YVector`/`ZVector`, `RightVector`/`UpVector`/`LookVector`, `Rotation`), composition and space conversion (`mul`, `add`, `sub`, `Inverse`, `ToWorldSpace`/`ToObjectSpace`, `Point…`/`Vector…` variants), `GetComponents`, Euler/orientation/axis-angle readback, `Orthonormalize`, and a `Lerp` that slerps the rotation. `new CFrame(x, y, z)` and `CFrame.new(x, y, z)` behave as before.

Ripple compatibility animates `CFrame` instead of throwing: springs and motions move the position and basis vectors and orthonormalize the result, and tweens slerp through `Lerp`, both as upstream does.
