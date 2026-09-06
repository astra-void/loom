# @loom-dev/vide

## 0.12.0

### Patch Changes

- Updated dependencies [[`8132a84`](https://github.com/astra-void/loom/commit/8132a845fbdbd2d0e280da2e232a05eb86cb36a0)]:
  - @loom-dev/runtime@0.12.0
  - @loom-dev/renderer@0.12.0
  - @loom-dev/layout@0.12.0
  - @loom-dev/scene@0.12.0

## 0.11.0

### Patch Changes

- Updated dependencies [[`85f2506`](https://github.com/astra-void/loom/commit/85f250675a15f0cf3aa33bddefe959baa4a15e8f)]:
  - @loom-dev/runtime@0.11.0
  - @loom-dev/renderer@0.11.0
  - @loom-dev/scene@0.11.0
  - @loom-dev/layout@0.11.0

## 0.10.2

### Patch Changes

- Updated dependencies []:
  - @loom-dev/scene@0.10.2
  - @loom-dev/layout@0.10.2
  - @loom-dev/runtime@0.10.2
  - @loom-dev/renderer@0.10.2

## 0.10.1

### Patch Changes

- Updated dependencies []:
  - @loom-dev/scene@0.10.1
  - @loom-dev/layout@0.10.1
  - @loom-dev/runtime@0.10.1
  - @loom-dev/renderer@0.10.1

## 0.10.0

### Patch Changes

- Updated dependencies []:
  - @loom-dev/scene@0.10.0
  - @loom-dev/layout@0.10.0
  - @loom-dev/runtime@0.10.0
  - @loom-dev/renderer@0.10.0

## 0.9.6

### Patch Changes

- Updated dependencies [[`f14c548`](https://github.com/astra-void/loom/commit/f14c54895ec16c9c425b41deed12f3a4c6c85ace)]:
  - @loom-dev/renderer@0.9.6
  - @loom-dev/scene@0.9.6
  - @loom-dev/layout@0.9.6
  - @loom-dev/runtime@0.9.6

## 0.9.5

### Patch Changes

- Updated dependencies [[`f4bf03d`](https://github.com/astra-void/loom/commit/f4bf03de7c2bf58d1cb4135b43c26a4e235fb7a4), [`f4bf03d`](https://github.com/astra-void/loom/commit/f4bf03de7c2bf58d1cb4135b43c26a4e235fb7a4)]:
  - @loom-dev/renderer@0.9.5
  - @loom-dev/scene@0.9.5
  - @loom-dev/layout@0.9.5
  - @loom-dev/runtime@0.9.5

## 0.9.4

### Patch Changes

- [`e6de267`](https://github.com/astra-void/loom/commit/e6de267522721c64bf65aa2fba78b3f67f5e5818) Thanks [@astra-void](https://github.com/astra-void)! - Measure text with the same quantized advances Roblox uses, and share that
  measurement across the static renderer and both live adapters.

  Browser canvas measurement shapes and kerns a whole run with fractional glyph
  advances. Roblox spends each displayed grapheme on a half-pixel boundary, so
  the browser answer can be a few percent narrower and wrap a long paragraph at
  different words. The difference was especially visible in development, where
  the React adapter measured `TextBounds` itself while a compiled scene used the
  renderer path.

  The renderer now caches half-pixel grapheme advances per font, invalidates them
  when a face changes, and preserves the engine's fractional result instead of
  rounding it to a whole pixel. React and Vide use the same measurement, keeping
  development and static previews aligned for the long wrapped text reported in
  [#11](https://github.com/astra-void/loom/issues/11).

- Updated dependencies [[`e6de267`](https://github.com/astra-void/loom/commit/e6de267522721c64bf65aa2fba78b3f67f5e5818)]:
  - @loom-dev/renderer@0.9.4
  - @loom-dev/scene@0.9.4
  - @loom-dev/layout@0.9.4
  - @loom-dev/runtime@0.9.4

## 0.9.3

### Patch Changes

- Updated dependencies [[`dc2757d`](https://github.com/astra-void/loom/commit/dc2757d80383f09db0002e4ac8a1aa7ccce6dd94), [`a1bbf8d`](https://github.com/astra-void/loom/commit/a1bbf8d7b03f2e9caf37bf1819f3df752095c64e), [`9574052`](https://github.com/astra-void/loom/commit/9574052ae9edec22d2c46843fefe13133c78554c)]:
  - @loom-dev/renderer@0.9.3
  - @loom-dev/layout@0.9.3
  - @loom-dev/scene@0.9.3
  - @loom-dev/runtime@0.9.3

## 0.9.2

### Patch Changes

- Updated dependencies [[`62cec5f`](https://github.com/astra-void/loom/commit/62cec5f362c483f54da49f7fe26b90c1e2548ff1)]:
  - @loom-dev/renderer@0.9.2
  - @loom-dev/scene@0.9.2
  - @loom-dev/layout@0.9.2
  - @loom-dev/runtime@0.9.2

## 0.9.1

### Patch Changes

- [`75f6d5b`](https://github.com/astra-void/loom/commit/75f6d5b5818c8f9f8267564e7269830d90b194b5) Thanks [@astra-void](https://github.com/astra-void)! - Read an enum property off a live instance whichever way it was written. The
  engine takes the bare string wherever it takes the item — `AutomaticSize = "XY"`
  _is_ `Enum.AutomaticSize.XY`, and roblox-ts's own React typings offer both — and
  `@loom-dev/scene` has always encoded either. The adapters did not: every place
  they read one back off an instance insisted on an `EnumItem` and treated a
  string as absent.

  So a label written `AutomaticSize="XY"` was auto-sized by the layout, which took
  the string happily, and measured by nobody: no `TextBounds` was emitted for it,
  so it collapsed to zero and its text spilled out of a box with no height. The
  same blind spot ran through the wrap machinery — the ancestor walk that finds
  the width `TextWrapped` wraps at could not tell such a frame was automatic, so
  it stopped there and wrapped against a width that frame had been given _by the
  label_, which is a circle that leaves text frozen at whatever width it first
  got; and the staleness check skipped the label, so nothing re-measured it.
  `FontSize` written as a string was ignored the same way, falling back to 14.

  `enumName` in `@loom-dev/runtime` is now the one reader for all of it, and both
  adapters go through it.

  The regression test drives it through the real layout engine across forty-one
  stage widths: before, the label measured `0` wide at every one of them.

- Updated dependencies [[`75f6d5b`](https://github.com/astra-void/loom/commit/75f6d5b5818c8f9f8267564e7269830d90b194b5)]:
  - @loom-dev/runtime@0.9.1
  - @loom-dev/renderer@0.9.1
  - @loom-dev/scene@0.9.1
  - @loom-dev/layout@0.9.1

## 0.9.0

### Patch Changes

- Updated dependencies [[`14a2294`](https://github.com/astra-void/loom/commit/14a229432c4f665e3e5fb88b62f23d59253039c8)]:
  - @loom-dev/renderer@0.9.0
  - @loom-dev/runtime@0.9.0
  - @loom-dev/scene@0.9.0
  - @loom-dev/layout@0.9.0

## 0.8.1

### Patch Changes

- Updated dependencies [[`9cf0372`](https://github.com/astra-void/loom/commit/9cf037253244bcabdc145251c5a3013b33c03c44)]:
  - @loom-dev/renderer@0.8.1
  - @loom-dev/scene@0.8.1
  - @loom-dev/layout@0.8.1
  - @loom-dev/runtime@0.8.1

## 0.8.0

### Patch Changes

- Updated dependencies [[`7d30cf0`](https://github.com/astra-void/loom/commit/7d30cf05a00f7783793a969dcd3598447ddbc48e)]:
  - @loom-dev/runtime@0.8.0
  - @loom-dev/renderer@0.8.0
  - @loom-dev/scene@0.8.0
  - @loom-dev/layout@0.8.0

## 0.7.1

### Patch Changes

- Updated dependencies []:
  - @loom-dev/scene@0.7.1
  - @loom-dev/layout@0.7.1
  - @loom-dev/runtime@0.7.1
  - @loom-dev/renderer@0.7.1

## 0.7.0

### Minor Changes

- [`47e4796`](https://github.com/astra-void/loom/commit/47e4796df59a746194607806ea8145545fba4490) Thanks [@astra-void](https://github.com/astra-void)! - Close the five gaps loom kept documenting instead of implementing: the last two
  layouts, the image modes, asset ids in a static build, the missing datatype
  members, and the services a UI actually reaches for. Every behaviour below was
  read off a running engine (Studio) rather than inferred.

  **`UITableLayout` and `UIPageLayout`.** A table's lines are its layout's
  siblings and their children are the cells; a column takes its widest cell and a
  row its tallest, both measured against the table's own content box, and
  `FillEmptySpaceColumns`/`Rows` scale the tracks proportionally in either
  direction. A pager's pages keep their own size and sit one container-plus-
  `Padding` apart, so `ClipsDescendants` shows exactly one; `JumpToIndex`/`JumpTo`/
  `Next`/`Previous` work off a ref and fire `PageLeave`/`PageEnter`/`Stopped`.
  Since the engine's `CurrentPage` is a GuiObject reference, which a Scene IR
  property cannot carry, the layout engine reads a `CurrentPageIndex` int that the
  runtime keeps in step.

  **`SortOrder` now defaults to `Name`** on every layout, which is the engine's own
  default — a list whose children carry distinct `Name`s flows alphabetically
  unless it sets `SortOrder`. Equal names keep source order, so a tree that never
  sets `Name` is unaffected.

  **Images.** `Slice` (from `SliceCenter`, scaled by `SliceScale`), `Tile` (at
  `TileSize`), the `ImageRectOffset`/`ImageRectSize` sprite window and
  `ResampleMode.Pixelated` all paint. The image layer is a background-painted
  element rather than an `<img>`, since a sprite window and a 9-slice both place a
  _region_ of the source. Tiling a sprite window is still not reproducible in CSS
  and now warns instead of pretending.

  **`rbxassetid://` in a static build.** `vite build`/`loom build` resolve the
  asset ids the bundle mentions, download the images into the output, and emit a
  `__loom/assets.json` the page reads — so a static preview paints them with no
  server. Opt out with `loomPreview({ assets: false })`.

  **Datatypes.** `Color3:ToHex()` (lowercase, unprefixed, the exact inverse of
  `fromHex`), `ToHSV`/`fromHSV`, `Vector2`'s `Unit`/`Dot`/`Cross`/`Lerp`/`Min`/
  `Max`/`Abs` and axis constants, the same for `Vector3`, `UDim2:Lerp`, and a
  `Rect` that encodes into the IR.

  **Services.** `TextService` measures with the renderer's own fonts
  (`GetTextSize`, `GetTextBoundsAsync`), `Debris.AddItem` destroys on a real timer,
  `StarterGui` answers the core-UI calls, and the container-only services
  (`ReplicatedStorage`, `Lighting`, `SoundService`, …) resolve to real instances
  instead of warned stubs.

### Patch Changes

- Updated dependencies [[`47e4796`](https://github.com/astra-void/loom/commit/47e4796df59a746194607806ea8145545fba4490)]:
  - @loom-dev/scene@0.7.0
  - @loom-dev/layout@0.7.0
  - @loom-dev/runtime@0.7.0
  - @loom-dev/renderer@0.7.0

## 0.6.8

### Patch Changes

- Updated dependencies [[`b246625`](https://github.com/astra-void/loom/commit/b2466251f12c99fb82ed6603169c1cf7abe8420d)]:
  - @loom-dev/layout@0.6.8
  - @loom-dev/scene@0.6.8
  - @loom-dev/runtime@0.6.8
  - @loom-dev/renderer@0.6.8

## 0.6.7

### Patch Changes

- Updated dependencies [[`7a9498d`](https://github.com/astra-void/loom/commit/7a9498d322cfe6a94c0e82f7ec9ef6ae202f7643)]:
  - @loom-dev/layout@0.6.7
  - @loom-dev/scene@0.6.7
  - @loom-dev/runtime@0.6.7
  - @loom-dev/renderer@0.6.7

## 0.6.6

### Patch Changes

- Updated dependencies [[`45b3278`](https://github.com/astra-void/loom/commit/45b3278d157646302e33f8abd1a9dafeed7d3c29)]:
  - @loom-dev/scene@0.6.6
  - @loom-dev/layout@0.6.6
  - @loom-dev/renderer@0.6.6
  - @loom-dev/runtime@0.6.6

## 0.6.5

### Patch Changes

- Updated dependencies [[`d3a6371`](https://github.com/astra-void/loom/commit/d3a63719dfff6cc19392674b64beeaec4539966a)]:
  - @loom-dev/layout@0.6.5
  - @loom-dev/scene@0.6.5
  - @loom-dev/runtime@0.6.5
  - @loom-dev/renderer@0.6.5

## 0.6.4

### Patch Changes

- Wrap `TextWrapped` text in the vide adapter, the way the react adapter already does.

  The vide adapter measured a label's `TextBounds` by splitting on newlines only, so `TextWrapped` (and its `TextWrap` alias) did nothing: a long label measured onto one line whatever it sat in, grew its `AutomaticSize` ancestors with it, and ran out of the container. The same scene therefore laid out differently through vide than through react, which is the one thing the shared Scene IR is supposed to rule out.

  - **Words are laid into lines greedily** at the wrap width, whitespace measured rather than assumed, and a run of spaces that would overflow is dropped instead of being carried to the next line. `LineHeight` is spent between lines, so `n` lines measure `TextSize + (n - 1) * TextSize * LineHeight` and a one-line label is unaffected.
  - **Which width it wraps at** follows react: a label with a width of its own wraps at that width; an `AutomaticSize.X` label — whose width is the thing being computed — wraps at the room left by the nearest ancestor that has a width of its own, less every `UIPadding` in between. Wrapping against an auto-sized parent that this label sized is the same circle as wrapping against the label itself.
  - **The re-wrap settles inside the paint that caused it.** The wrap width comes from the layout the paint itself produces, so the first snapshot after a container narrows still measures against the old width; the paint now re-snapshots until the two agree (up to four passes) and renders once, with the settled result. Rendering the first pass would put a label wider than its container on screen for a frame — which, during a live window resize, is every frame.
  - `mount` takes an optional `{ computeLayout }`, matching `mountSync` in `@loom-dev/react`, so the layout pass can be replaced in tests without the WASM engine.

- Let the host install the engine's typefaces, and stop silently drifting per OS when it hasn't.

  Loom named the Roblox families in CSS (`font-family: "Gotham", system-ui, …`) and loaded nothing behind them, so on a machine without the font installed every family resolved to `system-ui` — SF Pro on macOS, Segoe UI on Windows, Roboto on Linux. Three typefaces, three sets of advance widths, and `AutomaticSize` and `TextWrapped` are driven by measuring those widths: the same scene laid out differently on each, with nothing pointing at the font as the reason.

  - **`registerFont(family, { family, faces, fallback })`** installs a typeface for one Roblox family, following the `setImageResolver` contract already used for `rbxassetid://`. Any spelling of the name reaches it — `Gotham`, `GothamBold` and a `GothamSSm` `FontFace` are one family — and `faces` declares `@font-face` rules for a family the page has not loaded itself. `clearRegisteredFonts()` takes it all back out.
  - **A late face re-lays-out.** Text bounds are measured against whatever the browser had at the time, so a registration (or a `@font-face` finishing its download) invalidates every `AutomaticSize` bound that came out of the old one. Both adapters subscribe to `onFontsChanged` and measure again, so the settled layout is the one the registered face produces rather than the fallback's.
  - **`import "@loom-dev/renderer/fonts"`** registers the Roblox families that are openly licensed — `SourceSans` (Source Sans 3), `Roboto`, `RobotoMono` and `Inconsolata`, all OFL-1.1. These are the _actual_ fonts the engine draws with, so their metrics are the engine's rather than an approximation. It is a separate entry point with the font packages behind it, so a project that does not import it ships none of it.
  - **`Gotham` cannot ship here.** Roblox's default family — and the Builder faces behind it today — is proprietary. A project that has the files registers them itself, with the same call `/fonts` makes.
  - **Unbacked families now say so, once each**, naming the family and what to do about it, rather than leaving a layout that is simply different on a different machine. Availability is decided by probe-string width, not `document.fonts.check()`, which answers "would this resolve" and so returns true for a family nobody has.

- Updated dependencies []:
  - @loom-dev/layout@0.6.4
  - @loom-dev/renderer@0.6.4
  - @loom-dev/scene@0.6.4
  - @loom-dev/runtime@0.6.4

## 0.6.3

### Patch Changes

- [`abe2845`](https://github.com/astra-void/loom/commit/abe28455deb7f12b2a467e6a7ada8b6602f01f97) Thanks [@astra-void](https://github.com/astra-void)! - `LineHeight` spaces out wrapped text, the way the engine does.

  The multiplier is read, clamped to the 1…3 Studio allows, and spent **between** lines: `n` lines measure `TextSize + (n - 1) * TextSize * LineHeight`, so a one-line label is exactly `TextSize` tall however high its `LineHeight` is. CSS instead gives every line box the full `line-height`, half of the extra above the text and half below, so the leading is cropped off the two outer edges of the block — the paint then lands where `AutomaticSize` measured it.

  A library that sets a per-variant `LineHeight` on every label (1.25 for a heading, 1.4 for body copy) got single-spaced paragraphs before this, and an `AutomaticSize.Y` container measured to match.

- Updated dependencies [[`abe2845`](https://github.com/astra-void/loom/commit/abe28455deb7f12b2a467e6a7ada8b6602f01f97), [`abe2845`](https://github.com/astra-void/loom/commit/abe28455deb7f12b2a467e6a7ada8b6602f01f97), [`abe2845`](https://github.com/astra-void/loom/commit/abe28455deb7f12b2a467e6a7ada8b6602f01f97)]:
  - @loom-dev/renderer@0.6.3
  - @loom-dev/scene@0.6.3
  - @loom-dev/layout@0.6.3
  - @loom-dev/runtime@0.6.3

## 0.6.2

### Patch Changes

- Updated dependencies []:
  - @loom-dev/scene@0.6.2
  - @loom-dev/layout@0.6.2
  - @loom-dev/runtime@0.6.2
  - @loom-dev/renderer@0.6.2

## 0.6.1

### Patch Changes

- Updated dependencies [[`3c32df7`](https://github.com/astra-void/loom/commit/3c32df745836a34e4f1df05b0099ef9108556763), [`ceb5b7e`](https://github.com/astra-void/loom/commit/ceb5b7ed4dbc452d776c14bb5090bb7efa0d1665)]:
  - @loom-dev/renderer@0.6.1
  - @loom-dev/runtime@0.6.1
  - @loom-dev/scene@0.6.1
  - @loom-dev/layout@0.6.1

## 0.6.0

### Minor Changes

- [#8](https://github.com/astra-void/loom/pull/8) [`68701b7`](https://github.com/astra-void/loom/commit/68701b77ce4bd0a31168687e83c4e08d683efd53) Thanks [@Shadercloud](https://github.com/Shadercloud)! - Add the legacy `FontSize` property, the Luau string methods and `assert`, and
  treat `Size` as a floor under `AutomaticSize`.

  - `Enum.FontSize` and the `FontSize` prop are supported end to end. The pixel
    size is read out of the enum name, so `FontSize={Enum.FontSize.Size24}` paints
    and measures at 24px. `TextSize` still wins when both are set, matching how
    Roblox keeps the two properties linked.
  - `String.prototype` gains the Luau string methods roblox-ts calls off a string
    receiver — `.lower()`, `.upper()`, `.sub()`, `.rep()`, `.find()`, `.gsub()`
    and `.format()` — each delegating to the existing `string` library, so the
    1-based indices and tuple returns carry over. `.sub()` deliberately replaces
    the Annex B HTML wrapper JS ships under that name; `.split()` is deliberately
    left native, since Luau's `string.split` is implemented with it.
  - `assert` joins the installed Luau globals. It returns its argument when
    truthy, the way Luau does, so `const cfg = assert(maybeCfg, "no cfg")` works.
  - `AutomaticSize` no longer shrinks an element below its own `Size`. Roblox
    treats `Size` as the minimum and only grows past it for larger content; loom
    was overwriting the size with the content size outright, so a fixed-width
    container with a small child collapsed to the child.

### Patch Changes

- Updated dependencies [[`68701b7`](https://github.com/astra-void/loom/commit/68701b77ce4bd0a31168687e83c4e08d683efd53), [`06b8636`](https://github.com/astra-void/loom/commit/06b8636e0b3a55001cc81f0db73b183195c75c93)]:
  - @loom-dev/runtime@0.6.0
  - @loom-dev/scene@0.6.0
  - @loom-dev/layout@0.6.0
  - @loom-dev/renderer@0.6.0

## 0.5.3

### Patch Changes

- Updated dependencies [[`60ee957`](https://github.com/astra-void/loom/commit/60ee957ba6c1936d3614029446ce7d2ec1df9228), [`de7d915`](https://github.com/astra-void/loom/commit/de7d915563173a6c35a75c0f14d5453fc53d9ff7)]:
  - @loom-dev/runtime@0.5.3
  - @loom-dev/renderer@0.5.3
  - @loom-dev/scene@0.5.3
  - @loom-dev/layout@0.5.3

## 0.5.2

### Patch Changes

- Updated dependencies [[`ba578d4`](https://github.com/astra-void/loom/commit/ba578d4556322f8739630fe5bc46d03652dcb61e)]:
  - @loom-dev/runtime@0.5.2
  - @loom-dev/renderer@0.5.2
  - @loom-dev/scene@0.5.2
  - @loom-dev/layout@0.5.2

## 0.5.1

### Patch Changes

- Updated dependencies []:
  - @loom-dev/scene@0.5.1
  - @loom-dev/layout@0.5.1
  - @loom-dev/runtime@0.5.1
  - @loom-dev/renderer@0.5.1

## 0.5.0

### Minor Changes

- Support the modern Roblox UI surface: `FontFace`, flex layout, and tweens

  Four things a roblox-ts UI written today reaches for, which previews used to
  either ignore or die on:

  - **`FontFace` and the `Font` datatype.** `new Font(family, weight, style)` is a
    global, `Enum.FontWeight` / `Enum.FontStyle` exist, and the renderer resolves
    `FontFace` (preferred) or the legacy `Font` enum into a CSS family/weight/slant
    — including for `AutomaticSize` text measurement. `Font` is a new Scene IR
    property value, and `<textlabel FontFace={…} />` typechecks.
  - **`UIListLayout` flex and `UIFlexItem`.** `HorizontalFlex` / `VerticalFlex`
    spread leftover space along the fill axis (`SpaceBetween`, `SpaceAround`,
    `SpaceEvenly`, `Fill`) and stretch children across the cross axis (`Fill`);
    `UIFlexItem.FlexMode` grows an individual child (`Grow`/`Fill`, or `Custom`
    with `GrowRatio`).
  - **`TweenService`.** `Create`/`Play`/`Pause`/`Cancel`, `Completed`,
    `PlaybackState`, `GetValue`, every `EasingStyle`/`EasingDirection`, plus
    `DelayTime`, `RepeatCount` and `Reverses`. Tweens interpolate numbers,
    `Color3`, `UDim`, `UDim2` and `Vector2` on the scheduler's frame signal, so
    tweened writes flush like any other property write. Exported from
    `@loom-dev/preview/services`, so `import { TweenService } from "@rbxts/services"`
    resolves.
  - **`new ColorSequence(c0, c1)`.** The constructor now takes every form
    `ColorSequence.new` does. roblox-ts compiles the two-color factory call to the
    constructor, so a gradient built that way used to throw while the frame was
    being encoded.

### Patch Changes

- Updated dependencies []:
  - @loom-dev/runtime@0.5.0
  - @loom-dev/scene@0.5.0
  - @loom-dev/renderer@0.5.0
  - @loom-dev/layout@0.5.0

## 0.4.0

### Patch Changes

- Updated dependencies []:
  - @loom-dev/scene@0.4.0
  - @loom-dev/layout@0.4.0
  - @loom-dev/runtime@0.4.0
  - @loom-dev/renderer@0.4.0

## 0.3.0

### Patch Changes

- Updated dependencies []:
  - @loom-dev/scene@0.3.0
  - @loom-dev/layout@0.3.0
  - @loom-dev/runtime@0.3.0
  - @loom-dev/renderer@0.3.0

## 0.2.1

### Patch Changes

- Updated dependencies []:
  - @loom-dev/scene@0.2.1
  - @loom-dev/layout@0.2.1
  - @loom-dev/runtime@0.2.1
  - @loom-dev/renderer@0.2.1

## 0.2.0

### Patch Changes

- Updated dependencies []:
  - @loom-dev/scene@0.2.0
  - @loom-dev/layout@0.2.0
  - @loom-dev/runtime@0.2.0
  - @loom-dev/renderer@0.2.0
