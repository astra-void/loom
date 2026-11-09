---
title: Text is measured in unscaled pixels while layout widths are real; a UIStroke on text outlines glyphs by default
author: Astra-void
date: 2026-11-09
branch: main
cost: { minutes: 13, tokens: 277664 }
id: l-4220280f
scope: repo
status: active
src: agent
touches:
  - crates/loom-scene/src/lib.rs
  - apps/gallery-demo/src/targets/Dev159Scene.loom.tsx
  - ".changeset/text-constraint-stroke-scale.md"
  - crates/loom-layout/src/lib.rs
  - packages/react/src/index.ts
  - packages/vide/src/index.ts
  - packages/renderer/src/index.ts
---

## Decided
DEV-159 (GitHub #43). Adapters measure `TextBounds` at the label's own `TextSize`, and the layout multiplies the bounds by the `UIScale` product. Every wrap width an adapter reads from layout (`AbsoluteSize`, rects) is in real pixels, so it must be divided by the label's inherited `UIScale` before wrapping. The layout result now carries a per-node `scale` (omitted at 1) that the renderer multiplies `TextSize` by.
`UISizeConstraint.MaxSize` caps the grown `AutomaticSize`, not only `Size`. On X it works like a ceiling next to the parent's room, and the tighter one wins. On Y it caps too, because it is the object's own bound and not the parent's room.
`ApplyStrokeMode` defaults to `Contextual`. On a text class that means a glyph outline, and only `Border` puts the box ring back. The outline is drawn as `-webkit-text-stroke` at 2x thickness with `paint-order: stroke fill`, so the full thickness sits outside the glyph.

## Tried and ruled out
Asserting `-webkit-text-stroke` in happy-dom tests. happy-dom drops every spelling of it. A `setProperty` spy works, but its `this` is not the same object as `el.style`, so a WeakMap keyed by style finds nothing. The tests record the writes per render instead.

## Watch out
Not verified in Studio (none was connected): whether a text `UIStroke` fades with `TextTransparency`. It is assumed independent, as is the legacy `TextStroke` 1px outline. Neither stroke scales with `UIScale`.

In the code: crates/loom-layout/src/lib.rs (`max_size_limits`, `record` scale), crates/loom-scene LayoutNode.scale, packages/react/src/index.ts `wrapWidth`/`inheritedScale`, packages/vide/src/index.ts `wrapWidth`/`toScene`, packages/renderer/src/index.ts `textStroke`/`effectiveTextSize`.
