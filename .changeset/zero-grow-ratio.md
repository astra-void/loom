---
"@loom-dev/layout": patch
---

A `UIFlexItem` with a zero `GrowRatio` keeps its size in a `Fill` row. When every item in a line had a `UIFlexItem` and none asked to grow, the list's `Fill` took over and grew them all, so rbxts-react-clean-ui's checkbox `Fieldset` spread its box and label across the row where Studio keeps the label beside the box. Grow ratios are now read per child, like shrink ratios: a child's own `UIFlexItem` speaks for it, and only a child without one follows the list's `Fill`.
