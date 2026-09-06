# @loom-dev/react

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

- [`1a57c8e`](https://github.com/astra-void/loom/commit/1a57c8e07f8a771212de70cc1a82f0797174b4f3) Thanks [@astra-void](https://github.com/astra-void)! - Narrow the react peer range to `^18.3.1`, which is the react the adapter can
  actually drive.

  It advertised `^18.3.1 || ^19.0.0`, and the second half was never true: the host
  config runs on `react-reconciler` 0.29, which reads react 18's internals and
  finds nothing under react 19. The range was also the mechanism of the failure —
  it let npm hoist the adapter next to a host app's react 19 while loom's react 18
  stayed nested under `loom-dev`, which is how a static gallery build ended up
  handing the reconciler the wrong react.

  Installing the adapter into a react 19 app now reports a peer conflict instead of
  resolving quietly and breaking later. Nothing changes for a react 18 app, or for
  `loom-dev`, which brings its own react 18 along.

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

- [`9574052`](https://github.com/astra-void/loom/commit/9574052ae9edec22d2c46843fefe13133c78554c) Thanks [@astra-void](https://github.com/astra-void)! - Make `ScrollingFrame` scroll, and draw the bar that says so.

  A scrolling list in Roblox is an `AutomaticSize` column inside an
  `AutomaticCanvasSize` frame, and loom capped every child's automatic growth at
  its parent's box — a rule that is right for a `45%` column and wrong for a
  canvas, where outgrowing the window is the entire point. The column came out
  exactly the window's height, so the canvas equalled the window, nothing ever
  overflowed, and nothing ever scrolled. A `ScrollingFrame` now leaves its
  children no ceiling on an axis whose canvas is free to grow (`AutomaticCanvasSize`,
  or a `CanvasSize` of 0 on that axis); a `CanvasSize` that gives the axis a real
  extent is still the ceiling it always was.

  And loom drew no scroll bar at all, so a frame that did have something to scroll
  looked like a static, clipped box. It now paints the engine's bar: a rounded
  thumb in `ScrollBarImageColor3`, `ScrollBarThickness` px down the right edge (or
  along the bottom), sized to the window's share of the canvas and draggable, over
  the canvas rather than inset into it. Bars appear only on an axis with something
  to scroll, and not at all under `ScrollingEnabled = false`, a zero thickness, or
  a `ScrollingDirection` that rules the axis out.

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

- [`fc04521`](https://github.com/astra-void/loom/commit/fc04521e40bba3aa6ef20097b2f703cb78074203) Thanks [@astra-void](https://github.com/astra-void)! - Resolve scale `UIPadding` when working out the width `TextWrapped` text wraps
  at. An auto-sizing wrapped label under an ancestor whose padding is a scale —
  `PaddingLeft={new UDim(0.15, 0)}` — was measured against a width that ignored
  the inset entirely, so it came out with a box built for fewer lines than it was
  then painted with. The overflow is clipped from both edges, which shows up as a
  paragraph with its middle band visible and the rest cut away.

  The layout engine has always resolved the scale (`padding_insets`): against the
  node's own width where its X axis is a real one, and against zero where the axis
  is automatic, since a scale inset on an automatic axis is circular — the width
  sets the padding sets the width. The adapter read offsets only, which is the
  right answer for the automatic case and wrong for the other. It now asks the
  same question the engine does.

  Only wrapped text was affected, and only under a scale inset: offset padding —
  what a spacing helper emits — measured correctly before and is unchanged.

  Also adds `wrap.test.ts`, which settles this feedback loop against the **real**
  wasm layout rather than a stub, and checks the invariant directly: re-run the
  adapter's own greedy wrap at the width the layout actually handed the label, and
  the line count has to match the one the label's height encodes. It sweeps a
  card-shaped tree across every stage width from 1200 down to 200, plus the shapes
  where the two widths could come apart — a sibling on the same row, a
  `UISizeConstraint`, a shrinking `UIFlexItem`, and the scale padding above.

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

- Settle wrapped text inside the flush that resizes it, so a live window resize stops painting labels that overrun their container.

  A `TextWrapped` label with `AutomaticSize` wraps at a width that only exists once the layout has run, so the first encode after its container changes still measures against the width the container had a moment ago. That first, unwrapped measurement was patched into the DOM and the re-measure was deferred to the next scheduler frame — fine when the width settles, but during a window drag every frame brings a new width, so the stale pass is what stays on screen: body text painted past the edge of its card and under the card beside it.

  The flush now re-encodes and re-lays-out until the wrap widths it measured against are the ones the layout produced (up to four passes, then it defers as before), and patches the DOM once, with the settled result. Reported in [#11](https://github.com/astra-void/loom/issues/11), where it shows up as the left column of a `Card` grid clipping mid-word while the right column renders in full — but only in the frames where the window is being dragged.

- Stop `AutomaticSize` at the room its parent has, so a narrow column can no longer overrun the one beside it.

  Roblox bounds automatic growth: an object with `AutomaticSize` on an axis increases "up to maximum size allowed by the parent", and a `TextWrapped` label grows "until the maximum extent is reached (parent's max size)" and only _then_ wraps. Loom grew unbounded. Any content with an irreducible minimum — a row of buttons, a long word — therefore pushed its container wider than the slot positioning it, and at narrow viewports a `width="45%"` card grew past its column and painted over the card beside it. Every auto-sized node now carries the ceiling its parent leaves, inherited through the padding in between, and `Size` remains the floor even when it is itself past that ceiling.

  A wrapping `UIListLayout` on an automatic fill axis now wraps against that same ceiling. It previously measured as one run there — correct while the axis was genuinely unbounded, but it left the measure and paint passes disagreeing once a ceiling existed: an auto-sized footer was grown for one row of buttons and then painted with two, putting the second row outside the box that was grown for it.

  Content that still does not fit overflows, which is what the engine does — it does not widen the object to make room.

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

- [`abe2845`](https://github.com/astra-void/loom/commit/abe28455deb7f12b2a467e6a7ada8b6602f01f97) Thanks [@astra-void](https://github.com/astra-void)! - Round each `UICorner` corner on its own, and draw a `UIStroke` on the side of the edge it asks for.

  - **`TopLeftRadius` … `BottomRightRadius` are applied**, each overriding `CornerRadius` for its own corner. That is how a card rounds only its top while its footer rounds only its bottom — a shape that came out square before, since only `CornerRadius` was read. Everything drawn from the same box follows: the `UIStroke` ring and the `UIShadow` are box-shadows, so they take the new radius for free. A radius that returns to zero now squares the box off again instead of keeping the last rounding it had. Thanks to [@Shadercloud](https://github.com/Shadercloud) for the report and the first cut in [#10](https://github.com/astra-void/loom/pull/10).
  - **`UIStroke.BorderStrokePosition`**: `Outer` (the default, and what was always drawn) spreads outward, `Inner` insets so the stroke eats into the object instead of inflating it — a bordered header stays flush with the card around it rather than overhanging it — and `Center` straddles the edge with half the thickness each way.
  - **`UIStroke.Enabled = false` and a fully transparent stroke paint nothing**, matching what `UIShadow` already did, and a stroke that is switched off takes its ring with it instead of leaving it on the element.

- [`abe2845`](https://github.com/astra-void/loom/commit/abe28455deb7f12b2a467e6a7ada8b6602f01f97) Thanks [@astra-void](https://github.com/astra-void)! - `LineHeight` spaces out wrapped text, the way the engine does.

  The multiplier is read, clamped to the 1…3 Studio allows, and spent **between** lines: `n` lines measure `TextSize + (n - 1) * TextSize * LineHeight`, so a one-line label is exactly `TextSize` tall however high its `LineHeight` is. CSS instead gives every line box the full `line-height`, half of the extra above the text and half below, so the leading is cropped off the two outer edges of the block — the paint then lands where `AutomaticSize` measured it.

  A library that sets a per-variant `LineHeight` on every label (1.25 for a heading, 1.4 for body copy) got single-spaced paragraphs before this, and an `AutomaticSize.Y` container measured to match.

- [`abe2845`](https://github.com/astra-void/loom/commit/abe28455deb7f12b2a467e6a7ada8b6602f01f97) Thanks [@astra-void](https://github.com/astra-void)! - Make wrapped text and auto-sized rows measure the way Roblox does — a card whose body overflowed its own container, and a footer a whole button row too tall.

  - **`TextWrapped` wraps at the nearest ancestor that has a width**, less the padding in between, instead of stopping at the immediate parent. A parent that is itself `AutomaticSize` was sized _by_ the label, so wrapping against it is the same circle as wrapping against the label's own width and the text never wrapped at all. The library idiom stacks two or three such containers (a padded body inside a flex item inside a card), and the card — the one node with a real width — is where the room actually runs out. Text that used to run past its card and get painted over by the next one now wraps inside it.
  - **A `Wraps` list measures as one run when the fill direction is the axis being measured.** `AutomaticSize` on that axis means there is no width yet to wrap against, so wrapping against the 0-wide measurement box put every item on its own line: a row of buttons measured one line per button, and the auto-sized footer holding them came out a row too tall while the paint — which runs against the real width — still laid them side by side. Same "unconstrained fill axis" rule `UIGridLayout` already followed.
  - **`TextWrap` is declared on the text props.** It has been read as an alias of `TextWrapped` since 0.6.1, but only `TextWrapped` was on `TextGuiProps`, so a component written against the alias wrapped correctly at runtime and still failed to typecheck. `TextWrapped` continues to win when both are set.

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

- [`ceb5b7e`](https://github.com/astra-void/loom/commit/ceb5b7ed4dbc452d776c14bb5090bb7efa0d1665) Thanks [@astra-void](https://github.com/astra-void)! - Run a real third-party roblox-ts UI library (`@rbxts/react-clean-ui`) end to end, and close every gap it hit:

  - `UIListLayout.Wraps` now wraps, per line, like CSS `flex-wrap` — lines break on the fill axis, each line aligns its own items, the stack of lines aligns as a block, flex distributes per line, and `AutomaticSize` measures the wrapped shape.
  - `UIShadow` renders as a CSS drop shadow, layered under a `UIStroke` ring instead of replacing it.
  - `ImageColor3` tints, through an `feColorMatrix` that is the same per-channel multiply the engine does — so a full-colour image tints as correctly as a monochrome icon. One filter per colour, none at all for the default white.
  - `RichText` markup is parsed and painted: `<b>`, `<i>`, `<u>`, `<s>`, `<br/>`, `<font>` (colour, size, face, family, weight, transparency), `<uppercase>`/`<smallcaps>` and the character entities. With the flag off the same string stays literal, as in Roblox, and anything the engine would not recognise stays literal too. `AutomaticSize` measures each run in the font its own tags ask for, so a bold or resized run no longer clips the label.
  - `import ReactRoblox from "@rbxts/react-roblox"` works: the preview's stand-in exports the namespace object, matching upstream's `export =` typings.
  - The `rbxassetid://` route is built from the configured base again, so assets resolve under a mounted gallery (the Next integration, the Astro embed) instead of 404ing.
  - roblox-ts `.size()` / `.isEmpty()` resolve on `Map` and `Set`, through a symbol the preview rewrites previewed source to — leaving every other `Map` in the page (React's, loom's own scheduler) on plain JS semantics.
  - `UDim.add` / `UDim.sub`, `NumberSequence` / `NumberSequenceKeypoint`, and `BindableEvent` (`.Event`, `:Fire()`) are available to previewed code.
  - React's prop diff now uses Roblox `==`, which compares datatypes **by value**. A component that rebuilds `Position={UDim2.fromScale(.5,.5)}` every render no longer counts as a change, so a value written outside React — a drag moving a window, motion code on a ref — survives the next render instead of being overwritten.
  - `TextWrapped` text wraps. The deprecated `TextWrap` alias is read as the same property (Roblox's docs call it "simply an alias"), and measurement lays the runs into lines at word boundaries instead of always measuring one long line — constrained by the object's own width, or by the parent's when the X axis is automatic. Wrapped text is re-measured once the layout has sized its container, converging on the second pass.
  - A `GuiObject` the app listens to is hit-testable whether or not it is `Active`. Roblox's `Active` governs whether input is _sunk_, not whether the object hears it, so a slider handle — a plain `Frame` with an `InputBegan` handler — never received a pointer event. Frames with no listeners stay click-through, so a transparent positioning layer still lets clicks through to what is underneath.
  - The datatypes stringify the way the engine does (`Vector2` → `"2, 8"`, `UDim2` → `"{0.5, 10}, {0, 20}"`, `Color3` → `"1, 0, 0"`). A label reading `Range Slider (${value})` printed `[object Object]`.
  - `@rbxts/react`'s `Children.map` / `Children.forEach` count from **1**, as React-Lua does (`ReactChildren.lua` marks the line a ROBLOX DEVIATION). roblox-ts code recovering a 0-based position writes `index - 1`, so browser React's 0-based index shifted every result by one — a `<Select>` keyed on it selected and displayed its neighbour.
  - `UIListLayout` / `UIGridLayout` report `AbsoluteContentSize`, fed back after layout like the `ScrollingFrame` metrics and gated on real change. A dropdown that sizes itself from `Change={{ AbsoluteContentSize }}` collapsed to zero height without it, clipping away everything inside — click targets included.
  - An empty `TextBox` is measured against its `PlaceholderText`, which is what it displays. Measuring the empty string collapsed an `AutomaticSize.Y` input to zero height: invisible as well as unclickable.
  - Reading a `GuiObject` property nobody has written yields its Roblox default (`Visible`, `ZIndex`, `BackgroundTransparency`, `Rotation`, `LayoutOrder`, `Active`, `ClipsDescendants`, `AnchorPoint`, `Position`, `Size`) instead of `undefined`. App code that branches on one — a drag's `descendant.Visible` hit test — took the wrong path for every node.

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

- [#9](https://github.com/astra-void/loom/pull/9) [`06b8636`](https://github.com/astra-void/loom/commit/06b8636e0b3a55001cc81f0db73b183195c75c93) Thanks [@Shadercloud](https://github.com/Shadercloud) and [@astra-void](https://github.com/astra-void)! - Render `ImageLabel` and `ImageButton`.

  Image classes now paint their `Image` in an `<img>` layer beneath the text,
  honoring `ScaleType` (`Stretch`/`Fit`/`Crop`) and `ImageTransparency`. Plain
  `http(s):`, `data:` and `blob:` URLs load directly.

  `rbxassetid://` needs a hop the browser cannot make on its own — Roblox's
  thumbnail API sends no CORS headers — so the renderer takes a host-installed
  resolver via `setImageResolver` and ships no default rather than routing every
  consumer's asset traffic through some third party's proxy. `@loom-dev/preview`
  installs one backed by a new dev-server route that resolves the id server-side
  and redirects to the CDN image, so asset ids paint under `loom preview`, the
  embedded server and Next dev with no configuration. Resolutions are cached on
  both sides, so a repaint never re-resolves. A static gallery build has no
  server to ask: pass real URLs there, or install your own resolver.

  `Enum.ScaleType` is added. `Slice` and `Tile` are accepted but paint as
  `Stretch`, as do `ImageColor3` tints and `ImageRectOffset`/`ImageRectSize`
  sprite windows — each needs more than one `<img>`.

### Patch Changes

- Updated dependencies [[`68701b7`](https://github.com/astra-void/loom/commit/68701b77ce4bd0a31168687e83c4e08d683efd53), [`06b8636`](https://github.com/astra-void/loom/commit/06b8636e0b3a55001cc81f0db73b183195c75c93)]:
  - @loom-dev/runtime@0.6.0
  - @loom-dev/scene@0.6.0
  - @loom-dev/layout@0.6.0
  - @loom-dev/renderer@0.6.0

## 0.5.3

### Patch Changes

- [`60ee957`](https://github.com/astra-void/loom/commit/60ee957ba6c1936d3614029446ce7d2ec1df9228) Thanks [@astra-void](https://github.com/astra-void)! - Fix two class-registry gaps that made loom warn about — and in one case
  mis-render — classes it already supports.

  - `CollectionService` was missing from the runtime's `CLASS_PARENTS` table even
    though the service itself is fully implemented. Because `@rbxts/react`'s `Tag`
    prop resolves the service on every tagged mount, the first tagged component in
    a preview logged `[loom] unknown class "CollectionService" — treating it as a
direct Instance subclass`. The service is registered now, so tagged trees mount
    silently and `IsA("CollectionService")` answers correctly.
  - The React adapter's intrinsic → class-name map omitted `uipagelayout`,
    `uitablelayout` and `uitextsizeconstraint`, so the fallback casing minted
    `Uipagelayout`. An unknown class participates in layout, which meant these
    modifiers were laid out and painted as plain grey boxes on top of the UI they
    were meant to modify. Mapped to their real casing they join the non-layout
    modifier set and render as nothing — loom still implements none of their
    behavior, but an app that uses one no longer gets a stray box.

- Updated dependencies [[`60ee957`](https://github.com/astra-void/loom/commit/60ee957ba6c1936d3614029446ce7d2ec1df9228), [`de7d915`](https://github.com/astra-void/loom/commit/de7d915563173a6c35a75c0f14d5453fc53d9ff7)]:
  - @loom-dev/runtime@0.5.3
  - @loom-dev/renderer@0.5.3
  - @loom-dev/scene@0.5.3
  - @loom-dev/layout@0.5.3

## 0.5.2

### Patch Changes

- [`ba578d4`](https://github.com/astra-void/loom/commit/ba578d4556322f8739630fe5bc46d03652dcb61e) Thanks [@astra-void](https://github.com/astra-void)! - Replace the hand-written `@rbxts/react` shim with an audited browser
  compatibility facade, so a roblox-ts React project imports into Loom unchanged.

  `import React, { Component, ReactComponent } from "@rbxts/react"` previously
  failed the production build with `RollupError: "ReactComponent" is not exported
by …/react-shim.js`. The shim listed the names Loom's own demos used; the
  replacement (`@loom-dev/preview/src/compat/react.ts`) forwards the complete
  runtime surface of the supported `@rbxts/react` (17.3.7-ts.2):

  - **Standard React by identity.** `Component`, `createElement`, every hook and
    the rest come from the one pinned React the reconciler renders with —
    `Component === (await import("react")).Component` — so there is still exactly
    one React, one hook dispatcher, and no wrappers.
  - **`ReactComponent` / `ReactPureComponent`** as identity decorators, preserving
    constructor identity, statics, `displayName` and the prototype chain, under
    both `experimentalDecorators` and TC39 decorators.
  - **`Event`, `Change` and `Tag`** as runtime values as well as props. `Tag` now
    writes to a real `CollectionService` in `@loom-dev/runtime` (`AddTag`,
    `HasTag`, `GetTagged`, the added/removed signals) and is retracted on unmount.
  - **`None`** is importable and throws a Loom-specific error when used, rather
    than silently settling into class state that browser React cannot delete from.
  - **`@rbxts/react-roblox`** covers everything upstream declares —
    `createBlockingRoot`, `createLegacyRoot`, `act` and `version` alongside
    `createRoot` and `createPortal` — and its alias is now exact, so an unadapted
    subpath of either package raises a named Loom diagnostic listing the supported
    entrypoints instead of resolving to the wrong module or dying inside Rollup.

  A contract test derives the expected surface from upstream's own `index.d.ts`
  via the TypeScript compiler API, and real Vite/Rollup builds (plus a packed
  tarball install into an external Next.js app) cover the export-analysis failure
  the unit tests could not see.

- Updated dependencies [[`ba578d4`](https://github.com/astra-void/loom/commit/ba578d4556322f8739630fe5bc46d03652dcb61e)]:
  - @loom-dev/runtime@0.5.2
  - @loom-dev/renderer@0.5.2
  - @loom-dev/scene@0.5.2
  - @loom-dev/layout@0.5.2

## 0.5.1

### Patch Changes

- [`225a3e5`](https://github.com/astra-void/loom/commit/225a3e5fb64d729ed1b3ec6501da86d6983726d6) Thanks [@astra-void](https://github.com/astra-void)! - Add browser runtime compatibility for `@rbxts/ripple` and `@rbxts/react-ripple`,
  preventing Luau package entries from reaching Vite and Rollup during gallery
  development and static builds.

  Both packages publish a Luau runtime (`"main": "src/init.luau"`) and a `.d.ts`,
  so normal resolution handed Rollup a Luau file and `loom build` / `next build`
  failed with `Expected ';', '}' or <eof>` — while development could look fine,
  because a gallery target is only fetched when it is opened. Both packages now
  alias to loom's own adapters, in serve and build alike.

  The adapters are a port of the published implementation, not a stub:
  `createSpring`, `createTween`, `createMotion`, `config`, `easing` and the
  `useSpring` / `useTween` / `useMotion` hooks, animating `number`, `Vector2`,
  `Vector3`, `Color3`, `UDim`, `UDim2`, `Rect` and records of numbers. `CFrame`
  throws with a named loom error rather than animating. Controllers share one
  `RunService.Heartbeat` connection and release it when the last one settles.

  `@loom-dev/react` gains the React bindings this needs: `createBinding`,
  `useBinding` and `joinBindings` (re-exported from `@rbxts/react`), with every
  host prop accepting a value or a `Binding` of one. A bound prop is written
  straight onto the live instance, so an animation costs no React renders.

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
