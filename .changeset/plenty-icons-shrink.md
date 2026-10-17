---
"@loom-dev/layout": patch
"@loom-dev/react": patch
---

Fix two layout gaps found by running rbxts-react-clean-ui's `Accordion` through the preview.

- `AutomaticSize` hugs a child's whole size when its `AnchorPoint` is not `{0, 0}`. A 14×14 icon anchored at its centre — the idiom for rotating about itself — hangs half of itself off the parent's top-left, and the parent had measured 7×7 because the overhang was read as negative room.
- `UIListLayout`'s `Fill` flex shrinks as well as grows. A line whose items declare more than it holds is compressed back to fit, each item giving up a share of the overflow proportional to its own size and its `ShrinkRatio`. The standard idiom for reserving room for a trailing element — size the middle item `{1, iconWidth}` and let `Fill` pull the line back in — had left the icon outside the row, and so invisible inside a `ClipsDescendants` container. Wrapped text inside an item its line compressed is measured against the width the line leaves it, so it wraps where it is painted.
