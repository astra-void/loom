---
"@loom-dev/scene": patch
"@loom-dev/runtime": patch
"@loom-dev/renderer": patch
"@loom-dev/react": patch
---

`UIGradient.Transparency` is painted. The `NumberSequence` now reaches the scene, and the ramp fades the node's own background, image and text but not its children, as the engine does outside a `CanvasGroup`. The gradient's `Color` now multiplies `BackgroundColor3` instead of painting over it, so a transparent background stays transparent under a gradient. rbxts-react-clean-ui's `Pie` chart, built from half-disc gradient masks, had drawn each half as one solid colour.
