---
"@loom-dev/layout": patch
"@loom-dev/react": patch
"@loom-dev/vide": patch
---

Fix two layout gaps found by running rbxts-react-clean-ui's `Accordion` through the preview.

- `AutomaticSize` hugs a child's whole size when its `AnchorPoint` is not `{0, 0}`. A 14×14 icon anchored at its centre — the idiom for rotating about itself — hangs half of itself off the parent's top-left, and the parent had measured 7×7 because the overhang was read as negative room (#16).
- `UIListLayout`'s `Fill` flex shrinks as well as grows (#15). A line that does not wrap and declares more than its container holds is compressed back to fit, and so is a `UIFlexItem` set to `Shrink`, or to `Custom` with a `ShrinkRatio`. Any other `UIFlexItem` keeps its size, `UISizeConstraint.MinSize` is as far as an item goes, a list that wraps still wraps instead, and a row with no width of its own — or an automatic scrolling canvas — still runs on. The standard idiom for reserving room for a trailing element — size the middle item `{1, iconWidth}` and let `Fill` pull the line back in — had left the icon outside the row, and so invisible inside a `ClipsDescendants` container.

  The overflow is split in proportion to each item's size times its shrink ratio, as CSS flexbox does. Roblox documents that items shrink but not how the overflow is divided, so the split is not yet confirmed against the engine.

  `TextWrapped` text inside an item the row shrinks wraps at the room the row leaves that item, in both the react and vide adapters, so the label's box is built for the lines it is painted with. The room is the row less its other items' sizes before flex, so the measurement settles instead of chasing the width the last layout handed out.
