# @loom-dev/layout

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

- Updated dependencies []:
  - @loom-dev/scene@0.12.0

## 0.11.0

### Patch Changes

- Updated dependencies []:
  - @loom-dev/scene@0.11.0

## 0.10.2

### Patch Changes

- Updated dependencies []:
  - @loom-dev/scene@0.10.2

## 0.10.1

### Patch Changes

- Updated dependencies []:
  - @loom-dev/scene@0.10.1

## 0.10.0

### Patch Changes

- Updated dependencies []:
  - @loom-dev/scene@0.10.0

## 0.9.6

### Patch Changes

- Updated dependencies []:
  - @loom-dev/scene@0.9.6

## 0.9.5

### Patch Changes

- Updated dependencies []:
  - @loom-dev/scene@0.9.5

## 0.9.4

### Patch Changes

- Updated dependencies []:
  - @loom-dev/scene@0.9.4

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

- Updated dependencies [[`9574052`](https://github.com/astra-void/loom/commit/9574052ae9edec22d2c46843fefe13133c78554c)]:
  - @loom-dev/scene@0.9.3

## 0.9.2

### Patch Changes

- Updated dependencies []:
  - @loom-dev/scene@0.9.2

## 0.9.1

### Patch Changes

- Updated dependencies []:
  - @loom-dev/scene@0.9.1

## 0.9.0

### Patch Changes

- Updated dependencies []:
  - @loom-dev/scene@0.9.0

## 0.8.1

### Patch Changes

- Updated dependencies []:
  - @loom-dev/scene@0.8.1

## 0.8.0

### Patch Changes

- Updated dependencies []:
  - @loom-dev/scene@0.8.0

## 0.7.1

### Patch Changes

- Updated dependencies []:
  - @loom-dev/scene@0.7.1

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

## 0.6.8

### Patch Changes

- [`b246625`](https://github.com/astra-void/loom/commit/b2466251f12c99fb82ed6603169c1cf7abe8420d) Thanks [@astra-void](https://github.com/astra-void)! - Settle a scale size against an unsized parent on its own content, the way the engine does.

  `Size={UDim2.fromScale(1, 0)}` inside an auto-sizing parent is the library idiom for "as wide as whatever ends up holding me", and the pair is circular: the parent is waiting on this node's content, and this node is waiting on the parent. Loom resolved the scale against the parent's zero and collapsed the node — and everything under it — to nothing.

  Measured in Studio, the engine settles the same chain on the content. A `fromScale(1, 0)` control inside an auto-sized row comes out the width of its own text. The numbers are now pinned as a test against Studio's: a padded 300 box holding an auto row, a fixed 150 label that does not grow, and a growing control whose child is `fromScale(1, 0)` gives `fieldset 240.5 / label 150 / control 84.5 / inner 84.5` in both.

  The visible case was a `Select` inside a `Fieldset`: zero wide, with its value and caret spilling out of a box that had no size. A definite parent is unaffected — a scale size against a real width still resolves against that width.

- Updated dependencies []:
  - @loom-dev/scene@0.6.8

## 0.6.7

### Patch Changes

- [`7a9498d`](https://github.com/astra-void/loom/commit/7a9498d322cfe6a94c0e82f7ec9ef6ae202f7643) Thanks [@astra-void](https://github.com/astra-void)! - Stop a `Wraps` list breaking every item onto its own line when it has no room to wrap against.

  A fill axis with nothing on it is unconstrained, not a zero-wide box every item overflows. `UIGridLayout` has always read it that way — a `line_len <= 0` fill axis is one row, no wrap — and 0.6.5 gave `AutomaticSize` the same reading. `UIListLayout`'s `Wraps` was still measuring against the zero, so every item took a line of its own.

  It shows up wherever a control is laid out before it has been given a width: a `Select` inside a `Fieldset` put its caret on the line below its own value, and the button around them came out twice as tall as it should be. Any `HStack` inside a container sized `{fromScale(1, 0)} AutomaticSize={Y}` had the same shape.

- Updated dependencies []:
  - @loom-dev/scene@0.6.7

## 0.6.6

### Patch Changes

- [`45b3278`](https://github.com/astra-void/loom/commit/45b3278d157646302e33f8abd1a9dafeed7d3c29) Thanks [@astra-void](https://github.com/astra-void)! - Read an enum property written as a plain string, the way the engine does.

  Roblox coerces a bare string on an enum property — `FlexMode = "Custom"` is `Enum.UIFlexMode.Custom` — and roblox-ts types the props that way, so component libraries pass strings straight through: `valign="Center"`, `align="Right"`, `mode="Custom"`. Loom read only the `EnumItem` form, so every one of those was a silent no-op, with nothing logged and nothing to point at.

  The visible one was flex. A `UIFlexItem` whose `FlexMode` came through as a string took no weight at all, so the row's grower never grew: a `Fieldset`'s control — a `Select` — was laid out at zero width, with its value and caret spilling out of a box with no size. Alignment properties written the same way were being ignored too.

  Both readers now take either spelling, since both only ever ask for the item's name.

- Updated dependencies [[`45b3278`](https://github.com/astra-void/loom/commit/45b3278d157646302e33f8abd1a9dafeed7d3c29)]:
  - @loom-dev/scene@0.6.6

## 0.6.5

### Patch Changes

- [`d3a6371`](https://github.com/astra-void/loom/commit/d3a63719dfff6cc19392674b64beeaec4539966a) Thanks [@astra-void](https://github.com/astra-void)! - Stop a parent with no width on an axis from collapsing everything inside it.

  0.6.4 bounded `AutomaticSize` by the room its parent leaves, which is what keeps a `45%` card from overrunning the column beside it. It took that too literally: a parent measuring 0 on an axis was handed down as a ceiling of 0, so every auto-sized descendant was pinned to nothing.

  A box with nothing on an axis is not a statement that everything inside it is zero. `Size={fromScale(1, 0)} AutomaticSize={Y}` — "as wide as my parent, as tall as my content" — is the library idiom for a control that has no width of its own yet, and a popover positioned from a ref is 0 wide on the render before the ref resolves. The engine lets content overflow such a box rather than collapsing it. A `Select` lost its value label and its caret to this; anything nested under a width-less container would have.

  Zero is now read as "no ceiling", which is how the rest of the engine already reads it — `UIGridLayout` treats a `line_len <= 0` fill axis as unconstrained, and a zero `CanvasSize` is ignored in favour of the window. A ceiling that is genuinely positive still applies, so the overrun 0.6.4 fixed stays fixed.

- Updated dependencies []:
  - @loom-dev/scene@0.6.5

## 0.6.4

### Patch Changes

- Stop `AutomaticSize` at the room its parent has, so a narrow column can no longer overrun the one beside it.

  Roblox bounds automatic growth: an object with `AutomaticSize` on an axis increases "up to maximum size allowed by the parent", and a `TextWrapped` label grows "until the maximum extent is reached (parent's max size)" and only _then_ wraps. Loom grew unbounded. Any content with an irreducible minimum — a row of buttons, a long word — therefore pushed its container wider than the slot positioning it, and at narrow viewports a `width="45%"` card grew past its column and painted over the card beside it. Every auto-sized node now carries the ceiling its parent leaves, inherited through the padding in between, and `Size` remains the floor even when it is itself past that ceiling.

  A wrapping `UIListLayout` on an automatic fill axis now wraps against that same ceiling. It previously measured as one run there — correct while the axis was genuinely unbounded, but it left the measure and paint passes disagreeing once a ceiling existed: an auto-sized footer was grown for one row of buttons and then painted with two, putting the second row outside the box that was grown for it.

  Content that still does not fit overflows, which is what the engine does — it does not widen the object to make room.

- Updated dependencies []:
  - @loom-dev/scene@0.6.4

## 0.6.3

### Patch Changes

- [`abe2845`](https://github.com/astra-void/loom/commit/abe28455deb7f12b2a467e6a7ada8b6602f01f97) Thanks [@astra-void](https://github.com/astra-void)! - Make wrapped text and auto-sized rows measure the way Roblox does — a card whose body overflowed its own container, and a footer a whole button row too tall.

  - **`TextWrapped` wraps at the nearest ancestor that has a width**, less the padding in between, instead of stopping at the immediate parent. A parent that is itself `AutomaticSize` was sized _by_ the label, so wrapping against it is the same circle as wrapping against the label's own width and the text never wrapped at all. The library idiom stacks two or three such containers (a padded body inside a flex item inside a card), and the card — the one node with a real width — is where the room actually runs out. Text that used to run past its card and get painted over by the next one now wraps inside it.
  - **A `Wraps` list measures as one run when the fill direction is the axis being measured.** `AutomaticSize` on that axis means there is no width yet to wrap against, so wrapping against the 0-wide measurement box put every item on its own line: a row of buttons measured one line per button, and the auto-sized footer holding them came out a row too tall while the paint — which runs against the real width — still laid them side by side. Same "unconstrained fill axis" rule `UIGridLayout` already followed.
  - **`TextWrap` is declared on the text props.** It has been read as an alias of `TextWrapped` since 0.6.1, but only `TextWrapped` was on `TextGuiProps`, so a component written against the alias wrapped correctly at runtime and still failed to typecheck. `TextWrapped` continues to win when both are set.

- Updated dependencies [[`abe2845`](https://github.com/astra-void/loom/commit/abe28455deb7f12b2a467e6a7ada8b6602f01f97)]:
  - @loom-dev/scene@0.6.3

## 0.6.2

### Patch Changes

- Updated dependencies []:
  - @loom-dev/scene@0.6.2

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

- Updated dependencies [[`ceb5b7e`](https://github.com/astra-void/loom/commit/ceb5b7ed4dbc452d776c14bb5090bb7efa0d1665)]:
  - @loom-dev/scene@0.6.1

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
  - @loom-dev/scene@0.6.0

## 0.5.3

### Patch Changes

- Updated dependencies []:
  - @loom-dev/scene@0.5.3

## 0.5.2

### Patch Changes

- Updated dependencies []:
  - @loom-dev/scene@0.5.2

## 0.5.1

### Patch Changes

- Updated dependencies []:
  - @loom-dev/scene@0.5.1

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
  - @loom-dev/scene@0.5.0

## 0.4.0

### Patch Changes

- Updated dependencies []:
  - @loom-dev/scene@0.4.0

## 0.3.0

### Patch Changes

- Updated dependencies []:
  - @loom-dev/scene@0.3.0

## 0.2.1

### Patch Changes

- Updated dependencies []:
  - @loom-dev/scene@0.2.1

## 0.2.0

### Patch Changes

- Updated dependencies []:
  - @loom-dev/scene@0.2.0
