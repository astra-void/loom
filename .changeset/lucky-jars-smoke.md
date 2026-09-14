---
"@loom-dev/renderer": patch
---

Keep a node's own image, text and `TextBox` input painted beneath its children.

The layers were given the node's own `ZIndex`, which put them in the same
z-index space as its children — so an `ImageLabel` with `ZIndex = 2` painted its
image over the default-`ZIndex` content inside it, and a themed card header hid
its own title behind its background plaque. `ZIndexBehavior.Sibling` (the
renderer's model) orders siblings only: a descendant always draws above its
ancestors.
