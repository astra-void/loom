---
"@loom-dev/layout": patch
---

`AutomaticSize` measures a free child to its far edge again, matching Studio: a 14x14 child with `AnchorPoint = {0.5, 0.5}` at the origin grows its parent to 7x7, not 14x14. The near-edge clamp from 0.13.1 was a guess, and Studio measured it wrong. The `UIListLayout` flex shrink split (in proportion to size), `FlexMode = None` (never shrinks), and mixed grow under `Fill` are now Studio-verified, and their numbers are unchanged.
