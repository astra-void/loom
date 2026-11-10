---
title: Text is measured in unscaled pixels while layout widths are real; a UIStroke on text outlines glyphs by default
author: Astra-void
date: 2026-11-10
branch: main
cost: { minutes: 4, tokens: 61258 }
id: l-e8b3ce06
scope: repo
status: active
replaces: l-4220280f
src: agent
touches:
  - ".changeset/studio-checked-text-fixes.md"
  - crates/loom-layout/src/lib.rs
  - packages/react/src/index.ts
  - packages/vide/src/index.ts
  - packages/renderer/src/index.ts
---

## Decided
DEV-159 (GitHub #43), Studio-checked 2026-11-10.
- **Unscaled text pixels.** Adapters measure `TextBounds` at the label's own `TextSize`, and the layout multiplies the bounds by the `UIScale` product. Every wrap width an adapter reads from layout (`AbsoluteSize`, rects) is in real pixels, so it must be divided by the label's inherited `UIScale` before wrapping. The layout result carries a per-node `scale` (omitted at 1). The renderer multiplies `TextSize` and `UIStroke` thickness by it, for box rings and text outlines alike: Thickness 2 under `Scale` 2 equals Thickness 4.
- **MaxSize on text objects.** `UISizeConstraint.MaxSize` caps the automatic size of TextLabel, TextButton and TextBox on both axes. In Studio an unwrapped label capped at 100 is 100 wide with its text overflowing. A label's own padding sits inside the cap, so the text wraps at `MaxSize.X - padding`.
- **MaxSize on frames.** A frame's `MaxSize` does NOT cap the frame's own automatic size. An auto frame with `MaxSize (60, 40)` around a 200x200 child is 200x200. It does bound where the text inside it wraps: a label in an auto frame capped at 200 wrapped at 189.
- **Stroke mode.** `ApplyStrokeMode` defaults to `Contextual`, which means a glyph outline on a text class. Only `Border` puts the box ring back. The outline does not fade with `TextTransparency`: at 1 the full outline still shows. The outline is drawn as `-webkit-text-stroke` at 2x thickness with `paint-order: stroke fill`.

## Tried and ruled out
- Capping every class's automatic size at `MaxSize` (0.14.1). Studio shows frames are not capped.
- Leaving stroke thickness unscaled under `UIScale` (0.14.1). Studio scales it.
- Asserting `-webkit-text-stroke` in happy-dom. happy-dom drops every spelling of it, and a `setProperty` spy's `this` is not `el.style`. The tests record the writes per render instead.

## Watch out
- **Partial lines.** Studio drops a line that only partly fits under `MaxSize.Y`: a 30 cap with 27px lines gives 27. loom caps at 30.
- **Stroke interior.** With a transparent fill, Studio's stroke reads as a solid glyph. CSS centres the stroke on the outline, so very bold glyphs can show a hollow core.
- **Legacy stroke under `UIScale`.** `TextStroke` is assumed to scale, not checked.
- **Studio default font.** It is LegacyArial at TextSize 8, with a line about 1.5x TextSize, so raw Studio heights don't compare 1:1 with loom's font.

In the code: crates/loom-layout/src/lib.rs (`max_size_limits`, `is_text_class`, `record` scale), crates/loom-scene LayoutNode.scale, packages/react/src/index.ts `wrapWidth`/`inheritedScale`, packages/vide/src/index.ts `wrapWidth`/`toScene`, packages/renderer/src/index.ts `textStroke`/`strokeShadow`/`effectiveTextSize`.
