# @loom-dev/renderer

## 0.12.0

### Minor Changes

- [`8132a84`](https://github.com/astra-void/loom/commit/8132a845fbdbd2d0e280da2e232a05eb86cb36a0) Thanks [@astra-void](https://github.com/astra-void)! - Close the high-severity gaps in the Roblox API shim.

  An audit of `@loom-dev/runtime` against the real engine surface found 277 missing
  pieces; this is the 53 the audit rated high — the ones an everyday roblox-ts UI
  hits on its first run.

  **The runtime**

  - The roblox-ts `Promise` (evaera's), which was absent entirely, so any preview
    that loaded data died on its first call. It is a module-scope binding injected
    by the preview plugin, not a global: the page's `Promise` belongs to the host,
    and the two APIs disagree about `allSettled` and `all`.
  - `Instance:Clone()`, with `Archivable`; class read defaults, so a property read
    before it is written yields a typed value the way Roblox reflection does
    instead of `undefined`; a `WaitForChild` that resolves.
  - `Random` and `DateTime`, both usually constructed at module scope, where a
    missing global took the whole preview down before it could render.
  - `Enum.KeyCode`'s digits, modifiers and gamepad — a keyboard-driven UI could not
    match what the user pressed — plus `Enum.CoreGuiType`, `BorderMode`,
    `MembershipType`, `AssetFetchStatus` and the thumbnail enums.
  - `RunService.Stepped` / `IsServer` / `BindToRenderStep`, `UserInputService`'s key
    and touch state, `Player.UserId` / `DisplayName`, `Players:GetUserThumbnailAsync`,
    `ContentProvider`, and services reachable as `game.<Name>` properties.
  - Lua-compatible `string.format` specifiers (`%02d`, `%-10s`, `%5.1f`), the
    function and table forms of `string.gsub`, a working `coroutine`, and
    `Array.prototype.sort` accepting roblox-ts's boolean predicate.
  - `GuiObject:TweenPosition` / `TweenSize` / `TweenSizeAndPosition`.
  - `GuiLabel` and the `ValueBase` family in the class registry, so `IsA` stops
    answering wrongly.
  - A signal listener that throws no longer kills the dispatch or the caller.

  **The renderer** now fires `MouseButton1Down` / `MouseButton1Up` /
  `MouseButton2Click` / `MouseMoved`, which were connectable but never dispatched —
  silently doing nothing — and handles keyboard input, which did not exist. It also
  paints `BorderSizePixel` / `BorderColor3` / `BorderMode` and `TextScaled`.

  **The layout engine** honours `UIScale`, which was accepted and ignored.

  **The preview plugin** reads the project's tsconfig `baseUrl` and `paths`, so a
  project that imports non-relatively can start at all.

  **Breaking:** `EnumItem.Value` now reports the engine's number instead of the
  item's position in loom's declaration list. Comparing `.Value` against a
  hardcoded integer may need updating; comparing items, or matching on `.Name`, is
  unaffected — as is the layout engine, which matches by name.

### Patch Changes

- Updated dependencies [[`8132a84`](https://github.com/astra-void/loom/commit/8132a845fbdbd2d0e280da2e232a05eb86cb36a0)]:
  - @loom-dev/runtime@0.12.0
  - @loom-dev/scene@0.12.0

## 0.11.0

### Patch Changes

- Updated dependencies [[`85f2506`](https://github.com/astra-void/loom/commit/85f250675a15f0cf3aa33bddefe959baa4a15e8f)]:
  - @loom-dev/runtime@0.11.0
  - @loom-dev/scene@0.11.0

## 0.10.2

### Patch Changes

- Updated dependencies []:
  - @loom-dev/scene@0.10.2
  - @loom-dev/runtime@0.10.2

## 0.10.1

### Patch Changes

- Updated dependencies []:
  - @loom-dev/scene@0.10.1
  - @loom-dev/runtime@0.10.1

## 0.10.0

### Patch Changes

- Updated dependencies []:
  - @loom-dev/scene@0.10.0
  - @loom-dev/runtime@0.10.0

## 0.9.6

### Patch Changes

- [`f14c548`](https://github.com/astra-void/loom/commit/f14c54895ec16c9c425b41deed12f3a4c6c85ace) Thanks [@astra-void](https://github.com/astra-void)! - Stop sizing text by a face the browser never loaded.

  `ENGINE_FACE_BOX` carries the ratio the engine sizes each bundled family by, and
  it was reached purely by _name_: a family with a registration got its entry, and
  a registration is only a claim about a file the page still has to fetch. When
  that fetch fails, the browser paints the fallback while loom goes on sizing the
  text as though Source Sans 3 were there — every advance comes off the wrong
  glyphs, so `wrapLines` breaks in places the engine does not and `AutomaticSize`
  reports a box that does not fit the text drawn in it.

  Only a dev server can land there. A static build carries its font files in its
  own output, so the face is always present and the calibration always right,
  which is what made this read as a dev-only rendering bug rather than a font that
  failed to load. Measured against the same gallery target at one width, a dev
  server whose face 404s wrapped the issue's paragraph to ten lines where the
  build of the same source took nine.

  The calibration now applies only when the browser can actually paint the family,
  and falls back to measuring the face it really has — which is self-correcting,
  since a font-loading cycle drops the metric caches and the label re-measures
  against the face that just landed. And the missing-face audit no longer skips a
  family because it has a registration: a registered face that never arrived is
  now reported instead of quietly mis-measured.

  `familyIsAvailable` is exported for hosts that register their own faces and want
  the same answer.

  Refs: [#11](https://github.com/astra-void/loom/issues/11)

- Updated dependencies []:
  - @loom-dev/scene@0.9.6
  - @loom-dev/runtime@0.9.6

## 0.9.5

### Patch Changes

- [`f4bf03d`](https://github.com/astra-void/loom/commit/f4bf03de7c2bf58d1cb4135b43c26a4e235fb7a4) Thanks [@astra-void](https://github.com/astra-void)! - Size the bundled faces the way the engine sizes them, and spend kerning.

  `TextSize` is the height of the whole face, so loom divides by the face's own
  box to get a `font-size`. It read that box from the browser
  (`fontBoundingBoxAscent + Descent`), and that is not the number Roblox divides
  by: Roboto reports 1.17 there while the engine sizes it as though it were 1.14.
  Every Roboto glyph was painted about 2.6% small, and since advances come off the
  same size, every string measured that much narrow before half-pixel rounding
  pushed it back out.

  `ENGINE_FACE_BOX` now carries the engine's ratio for each family
  `@loom-dev/renderer/fonts` registers, solved against
  `TextService:GetTextBoundsAsync` per-glyph advances at `TextSize` 18. 24 of the
  28 reproduce all 24 sampled glyphs exactly; `FredokaOne` (Fredoka stands in for
  it), `Merriweather`, `Nunito`, `Oswald` and `DenkOne` do not, and their fitted
  ratio is still closer than the browser's. A family with no entry — anything a
  project registered itself, `Gotham` included — keeps the measured box.

  With the glyphs at the right size, advances round to the half pixel instead of
  snapping up, which was only ever compensating for their being small. The engine
  also kerns (`AV` is 19.5 where its glyphs are 10.5 and 10 alone), so
  `shapedTextWidth` now adds the run's kerning, quantized once for the run.

  Against the engine, Roboto 18, the [#11](https://github.com/astra-void/loom/issues/11)
  paragraph: string widths are exact on 6 of 10 and never off by more than 0.5
  (they were off by up to 9), and the wrapped line count matches at 49 of 50
  widths from 320 to 1300 — 45 before this, 34 when CSS did the wrapping.

- [`f4bf03d`](https://github.com/astra-void/loom/commit/f4bf03de7c2bf58d1cb4135b43c26a4e235fb7a4) Thanks [@astra-void](https://github.com/astra-void)! - Paint wrapped text at the line breaks it was measured with.

  A label's box came from `shapedTextWidth` — one advance per grapheme, snapped to
  the half pixel, the way the engine spends them — while the glyphs inside it were
  left to CSS, which wraps on its own kerned run widths. Those are a couple of
  percent narrower, so a label could reserve nine lines and paint eight, ending
  short of a box built for it, and break at different words than Studio does.

  `wrapLines` is now the single place a wrap is decided: measurement asks it how
  many lines a label needs, and the text layer asks it where to put the breaks it
  paints, keeping them in `white-space: pre`. `RichText` runs go through the same
  wrap with the line carried across runs, each measured in the font its `<font>`
  tag gave it.

  Checked against `TextService:GetTextBoundsAsync` (Roboto 18, the paragraph from
  [#11](https://github.com/astra-void/loom/issues/11), 50 widths from 320 to
  1300): the painted line count matches the engine 45 times, against 34 when CSS
  did the wrapping. What is left over is the measurement running about a percent
  roomy, so text wraps a hair early rather than overflowing its box.

- Updated dependencies []:
  - @loom-dev/scene@0.9.5
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

- Updated dependencies []:
  - @loom-dev/scene@0.9.4
  - @loom-dev/runtime@0.9.4

## 0.9.3

### Patch Changes

- [`dc2757d`](https://github.com/astra-void/loom/commit/dc2757d80383f09db0002e4ac8a1aa7ccce6dd94) Thanks [@astra-void](https://github.com/astra-void)! - Draw text at the size the engine draws it. `TextSize` is not a font size:
  Roblox fits the _whole face_ into it — ascender to descender, which is why a
  one-line label measures exactly `TextSize` tall — while CSS `font-size` sets the
  em square, and a face's ascent + descent runs well past 1em. Painting
  `font-size: TextSize` therefore drew every glyph too big by that font's own
  ratio: 17% for Roboto, 18% for Jura, 25% for Merriweather, 47% for Oswald.

  Everything downstream inherited it. Text measured that much wider than the
  engine's, so it wrapped that much earlier, so `AutomaticSize` boxes came out
  taller and wider, and a card sized to its text overran the column that was
  meant to hold it — all of it looking like a wrap bug, none of it being one.

  Measured against Studio (`TextService:GetTextBoundsAsync`, Roboto, `TextSize`
  18): `Player Profile` 93 units in the engine and 105 here, the whole body
  string 797 against 910. The paragraph from [#11](https://github.com/astra-void/loom/issues/11) laid out at eleven widths, in
  lines:

  | width | engine | before |  after |
  | ----: | -----: | -----: | -----: |
  |   300 |     29 |     33 |     27 |
  |   400 |     21 |     24 |     20 |
  |   500 |     17 |     19 | **17** |
  |   586 |     14 |     17 | **14** |
  |   700 |     12 |     14 | **12** |
  |   800 |     10 |     12 | **10** |
  |   900 |      9 |     11 |  **9** |
  |  1000 |      9 |     10 |      8 |
  |  1099 |      8 |      9 |  **8** |
  |  1200 |      7 |      8 |  **7** |

  Wrong at every width before; matching at eight of ten now. The rest is the
  engine rendering ~3% wider than its own metrics at small sizes, where it
  advances glyphs in whole pixels and a browser does not — loom now sits a hair
  narrow rather than a seventh wide.

  The ratio is read off the face the browser will actually paint with, so it
  follows a registered typeface, and is re-read when one finishes loading. A
  browser that reports no `fontBoundingBox*` metrics keeps the old 1:1 mapping
  rather than guessing. `LineHeight` now sets the line box in pixels off
  `TextSize`, since the pitch the engine spends is `TextSize`-relative and no
  longer follows the font size; `<font size="…">` in `RichText` converts through
  the metrics of the face that run lands in.

- [`a1bbf8d`](https://github.com/astra-void/loom/commit/a1bbf8d7b03f2e9caf37bf1819f3df752095c64e) Thanks [@astra-void](https://github.com/astra-void)! - Paint the string the engine paints. A newline in `Text` breaks the line in
  Roblox — wrapped or not, `RichText` or not, exactly as `<br/>` does — and a run
  of spaces stays a run of spaces. Loom measured it that way (every measurer here
  splits on `\n`) but painted through HTML's defaults, `white-space: normal` and
  `nowrap`, which fold both away. So a label written with line breaks in it
  measured as, say, twenty-three lines and painted as seventeen: a box a hundred
  pixels taller than the text inside it, and every sibling below pushed down by
  room nothing occupies.

  It is now `pre-wrap` when the label wraps and `pre` when it does not, so the
  paint has the line breaks the measurement counted. Text with no newlines and no
  double spaces — most text — is unaffected.

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

- Updated dependencies [[`9574052`](https://github.com/astra-void/loom/commit/9574052ae9edec22d2c46843fefe13133c78554c)]:
  - @loom-dev/scene@0.9.3
  - @loom-dev/runtime@0.9.3

## 0.9.2

### Patch Changes

- [`62cec5f`](https://github.com/astra-void/loom/commit/62cec5f362c483f54da49f7fe26b90c1e2548ff1) Thanks [@astra-void](https://github.com/astra-void)! - Re-measure text when a face finishes loading, not only when the first font
  loading cycle ends. A registered face is never loaded at the moment it is
  registered — nothing has asked the browser for it, and the canvas loom measures
  with never will, since `measureText` paints nothing and so starts no download.
  The face only loads when the text first paints in it, and until loom hears about
  that, every `AutomaticSize` bound and every `TextWrapped` line count standing on
  screen belongs to the fallback the browser used instead.

  Loom heard about it through `document.fonts.ready`, which is one promise for the
  cycle in flight when it is read. Read while the document is still loading it
  resolves after the faces land — so a static build, where one bundle and one
  stylesheet register everything before the document is done, came out right. Read
  a moment later, with the document settled and no face asked for yet, it is
  _already resolved_: the listeners fired at once against the fallback, and the
  face that downloaded seconds afterwards notified nobody. The layout stayed
  measured for a typeface that is no longer the one being painted — text wrapped
  at the wrong width, in a box built for the wrong number of lines — until
  something unrelated, a resize, forced it to be measured again.

  A dev server puts loom on exactly that side of the line: the app boots through a
  graph of separate module requests, long after the document finished. That is why
  the same scene at the same version could render correctly deployed and wrongly
  under `npm run dev` — and why it was worst where the fallback's metrics are
  furthest from the registered face, which on Windows (Segoe UI standing in for
  Roboto or Source Sans 3) is a great deal further than on macOS. A target
  switched in the gallery, or any scene loaded lazily, is on that side whatever
  the build.

  Loom now listens for `loadingdone` on `document.fonts`, which fires at the end
  of _every_ cycle and so has no such window. The missing-face warning waits the
  same way, instead of naming a family whose download had only just begun.

- Updated dependencies []:
  - @loom-dev/scene@0.9.2
  - @loom-dev/runtime@0.9.2

## 0.9.1

### Patch Changes

- Updated dependencies [[`75f6d5b`](https://github.com/astra-void/loom/commit/75f6d5b5818c8f9f8267564e7269830d90b194b5)]:
  - @loom-dev/runtime@0.9.1
  - @loom-dev/scene@0.9.1

## 0.9.0

### Minor Changes

- [`14a2294`](https://github.com/astra-void/loom/commit/14a229432c4f665e3e5fb88b62f23d59253039c8) Thanks [@astra-void](https://github.com/astra-void)! - Load the engine's fonts in the preview, and know the rest of them by name
  (reported in [#11](https://github.com/astra-void/loom/issues/11)).

  **The preview now loads the faces.** `@loom-dev/renderer/fonts` has shipped real
  font files since 0.6.4 — Fontsource `woff2` in the bundle, no CDN and nothing
  installed on the machine — but it was an opt-in import and the preview never
  made it, so out of the box every Roblox family fell through to `system-ui`: SF
  Pro on macOS, Segoe UI on Windows, Roboto on Linux. `AutomaticSize` and
  `TextWrapped` are driven by _measuring_ the face, so the same scene laid out
  differently on each. The import now sits in the globals module, which is
  injected ahead of the app entry whichever frontend it uses, so a vide preview
  gets the same faces as a react one.

  **And it covers the list now, not four of it.** `SourceSans`, `Roboto`,
  `RobotoMono` and `Inconsolata` were the only families with a face; every other
  name loom did not recognise resolved to the generic sans stack _silently_, since
  the missing-face warning only fires for families it knows about. Twenty-eight
  families now register a real face — Jura, Merriweather, Nunito, Oswald, Ubuntu,
  TitilliumWeb, JosefinSans, GrenzeGotisch, RobotoCondensed, Arimo, Sarpanch,
  Michroma, AmaticSC, Bangers, Creepster, DenkOne, Fondamento, FredokaOne,
  IndieFlower, Kalam, LuckiestGuy, PatrickHand, PermanentMarker and SpecialElite
  alongside the original four. All OFL-1.1 bar Ubuntu, which is under the Ubuntu
  Font Licence.

  The rest of the engine's list is at least _named_ now, so it resolves to a stack
  that leads with the right typeface and warns instead of drifting in silence:
  `Gotham` and `BuilderSans` (proprietary), `Bodoni`, `Garamond`, `Cartoon`,
  `SciFi`, `Arcade`, `Fantasy`, `Antique`, `Highway`. `Arial` and `Legacy` need
  nothing — Arimo is metric-compatible with Arial and is now in their stack.

  **`Enum.Font` is the engine's whole enum**, all 53 items in its own order,
  instead of the sixteen loom happened to paint. `Enum.Font.Jura` was `undefined`
  in a preview, so a scene that named it crashed before it drew anything, and
  `Font.fromEnum` sent every unrecognised item to `SourceSansPro`; it now resolves
  each item's own family.

  `FredokaOne` is the one approximation: Google folded "Fredoka One" into
  Fredoka's heavier weights, so Fredoka is what registers for it.

  Sizes, since this is a font shipment: a static gallery build emits ~2.8 MB of
  `woff2` across the whole set. What a _page_ downloads is unchanged — Fontsource
  declares per-script `unicode-range` subsets, so a browser fetches only the
  families and scripts a scene actually paints with.

### Patch Changes

- Updated dependencies [[`14a2294`](https://github.com/astra-void/loom/commit/14a229432c4f665e3e5fb88b62f23d59253039c8)]:
  - @loom-dev/runtime@0.9.0
  - @loom-dev/scene@0.9.0

## 0.8.1

### Patch Changes

- [`9cf0372`](https://github.com/astra-void/loom/commit/9cf037253244bcabdc145251c5a3013b33c03c44) Thanks [@astra-void](https://github.com/astra-void)! - Stop cutting the descenders off wrapped text. A paragraph's last line lost the
  tails of its `y`, `p` and `g` — `activity` painting as `activitv` — and at a
  large enough `TextSize` the first line lost the tops of its ascenders too
  (reported in [#11](https://github.com/astra-void/loom/issues/11)).

  `TextSize` means different things to the two renderers, and the label's box is
  sized in the engine's. Roblox fits the whole face into `TextSize`: one line of
  it measures exactly `TextSize` tall and nothing pokes out. CSS spends it on the
  em instead, and a face's own ascent + descent runs to ~1.2em on top of that. The
  overlay was clipped to the box the layout computed — the engine's height,
  `TextSize + (n - 1) * TextSize * LineHeight` — so the browser's taller line
  boxes had nowhere to go, and the clip took the difference out of the glyphs.

  The overlay's clip rect now carries that overhang, with padding handing the
  content box its original height straight back: the text is placed exactly where
  it was, `TextXAlignment`/`TextYAlignment` are untouched, and a label still clips
  its own text at its left and right edges. Nothing about the layout moves —
  `TextBounds`, `AbsoluteSize` and every rect around the label are the values they
  were.

  The room needed turns out to be the same at both edges, and the same whatever
  `LineHeight` is set to and however many lines the text wraps onto: lines 2..n
  sit on `TextSize * LineHeight` of pitch in either renderer and cancel, leaving
  one face box against one `TextSize`, split evenly above and below. It is
  measured per typeface and size, and re-measured when a face registered with
  `registerFont` finishes loading and the metrics behind it change.

  Also fixed: a label whose `LineHeight` was the only thing to change kept its old
  line spacing, since the fingerprint that decides whether to repaint the overlay
  did not read the property.

- Updated dependencies []:
  - @loom-dev/scene@0.8.1
  - @loom-dev/runtime@0.8.1

## 0.8.0

### Patch Changes

- Updated dependencies [[`7d30cf0`](https://github.com/astra-void/loom/commit/7d30cf05a00f7783793a969dcd3598447ddbc48e)]:
  - @loom-dev/runtime@0.8.0
  - @loom-dev/scene@0.8.0

## 0.7.1

### Patch Changes

- Updated dependencies []:
  - @loom-dev/scene@0.7.1
  - @loom-dev/runtime@0.7.1

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
  - @loom-dev/runtime@0.7.0

## 0.6.8

### Patch Changes

- Updated dependencies []:
  - @loom-dev/scene@0.6.8
  - @loom-dev/runtime@0.6.8

## 0.6.7

### Patch Changes

- Updated dependencies []:
  - @loom-dev/scene@0.6.7
  - @loom-dev/runtime@0.6.7

## 0.6.6

### Patch Changes

- Updated dependencies [[`45b3278`](https://github.com/astra-void/loom/commit/45b3278d157646302e33f8abd1a9dafeed7d3c29)]:
  - @loom-dev/scene@0.6.6
  - @loom-dev/runtime@0.6.6

## 0.6.5

### Patch Changes

- Updated dependencies []:
  - @loom-dev/scene@0.6.5
  - @loom-dev/runtime@0.6.5

## 0.6.4

### Patch Changes

- Let the host install the engine's typefaces, and stop silently drifting per OS when it hasn't.

  Loom named the Roblox families in CSS (`font-family: "Gotham", system-ui, …`) and loaded nothing behind them, so on a machine without the font installed every family resolved to `system-ui` — SF Pro on macOS, Segoe UI on Windows, Roboto on Linux. Three typefaces, three sets of advance widths, and `AutomaticSize` and `TextWrapped` are driven by measuring those widths: the same scene laid out differently on each, with nothing pointing at the font as the reason.

  - **`registerFont(family, { family, faces, fallback })`** installs a typeface for one Roblox family, following the `setImageResolver` contract already used for `rbxassetid://`. Any spelling of the name reaches it — `Gotham`, `GothamBold` and a `GothamSSm` `FontFace` are one family — and `faces` declares `@font-face` rules for a family the page has not loaded itself. `clearRegisteredFonts()` takes it all back out.
  - **A late face re-lays-out.** Text bounds are measured against whatever the browser had at the time, so a registration (or a `@font-face` finishing its download) invalidates every `AutomaticSize` bound that came out of the old one. Both adapters subscribe to `onFontsChanged` and measure again, so the settled layout is the one the registered face produces rather than the fallback's.
  - **`import "@loom-dev/renderer/fonts"`** registers the Roblox families that are openly licensed — `SourceSans` (Source Sans 3), `Roboto`, `RobotoMono` and `Inconsolata`, all OFL-1.1. These are the _actual_ fonts the engine draws with, so their metrics are the engine's rather than an approximation. It is a separate entry point with the font packages behind it, so a project that does not import it ships none of it.
  - **`Gotham` cannot ship here.** Roblox's default family — and the Builder faces behind it today — is proprietary. A project that has the files registers them itself, with the same call `/fonts` makes.
  - **Unbacked families now say so, once each**, naming the family and what to do about it, rather than leaving a layout that is simply different on a different machine. Availability is decided by probe-string width, not `document.fonts.check()`, which answers "would this resolve" and so returns true for a family nobody has.

- Updated dependencies []:
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

- Updated dependencies [[`abe2845`](https://github.com/astra-void/loom/commit/abe28455deb7f12b2a467e6a7ada8b6602f01f97)]:
  - @loom-dev/scene@0.6.3
  - @loom-dev/runtime@0.6.3

## 0.6.2

### Patch Changes

- Updated dependencies []:
  - @loom-dev/scene@0.6.2
  - @loom-dev/runtime@0.6.2

## 0.6.1

### Patch Changes

- [`3c32df7`](https://github.com/astra-void/loom/commit/3c32df745836a34e4f1df05b0099ef9108556763) Thanks [@astra-void](https://github.com/astra-void)! - Make previews usable on a phone.

  - **The stage keeps a desktop viewport instead of overflowing.** Below 960px wide the preview mount lays out at 960 logical pixels and is scaled down with a CSS transform to fit the real screen, so a UI written for a desktop viewport shrinks rather than running off the edge. The logical height follows the real aspect ratio (no letterboxing), and at 960px or wider nothing is applied at all — desktop previews are unchanged. The generated pages use `dvh`, so a full-height stage no longer hangs under the mobile browser toolbars.
  - **Pointer coordinates follow the scale.** The renderer converts on-screen pixels back into layout pixels (`MouseEnter`/`Activated`/`InputChanged` positions, `GetMouseLocation`, wheel deltas) by reading the mount's own rendered-to-layout ratio, so hit testing lands where the scene looks like it is.
  - **ScrollingFrames scroll from a touch drag.** There is no wheel on a phone; a drag now moves `CanvasPosition` with the same clamping the wheel uses, and past a small slop it stops counting as a tap so the control under the finger is not activated. Only ScrollingFrames opt out of native touch panning — a preview embedded in a docs page never traps the reader — and taps no longer wait for the browser's double-tap-zoom timeout.
  - **The gallery chrome stacks on a narrow screen.** The 248px sidebar becomes a top bar with a `targets` button that opens the list and closes it again on selection, leaving the rest of the screen to the stage. `?chrome=none` (the docs-site iframes) is unaffected.

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

- Updated dependencies [[`ceb5b7e`](https://github.com/astra-void/loom/commit/ceb5b7ed4dbc452d776c14bb5090bb7efa0d1665)]:
  - @loom-dev/runtime@0.6.1
  - @loom-dev/scene@0.6.1

## 0.6.0

### Minor Changes

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

## 0.5.3

### Patch Changes

- Updated dependencies [[`60ee957`](https://github.com/astra-void/loom/commit/60ee957ba6c1936d3614029446ce7d2ec1df9228), [`de7d915`](https://github.com/astra-void/loom/commit/de7d915563173a6c35a75c0f14d5453fc53d9ff7)]:
  - @loom-dev/runtime@0.5.3
  - @loom-dev/scene@0.5.3

## 0.5.2

### Patch Changes

- Updated dependencies [[`ba578d4`](https://github.com/astra-void/loom/commit/ba578d4556322f8739630fe5bc46d03652dcb61e)]:
  - @loom-dev/runtime@0.5.2
  - @loom-dev/scene@0.5.2

## 0.5.1

### Patch Changes

- Updated dependencies []:
  - @loom-dev/scene@0.5.1
  - @loom-dev/runtime@0.5.1

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

## 0.4.0

### Patch Changes

- Updated dependencies []:
  - @loom-dev/scene@0.4.0
  - @loom-dev/runtime@0.4.0

## 0.3.0

### Patch Changes

- Updated dependencies []:
  - @loom-dev/scene@0.3.0
  - @loom-dev/runtime@0.3.0

## 0.2.1

### Patch Changes

- Updated dependencies []:
  - @loom-dev/scene@0.2.1
  - @loom-dev/runtime@0.2.1

## 0.2.0

### Patch Changes

- Updated dependencies []:
  - @loom-dev/scene@0.2.0
  - @loom-dev/runtime@0.2.0
