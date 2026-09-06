# @loom-dev/runtime

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

### Minor Changes

- [`85f2506`](https://github.com/astra-void/loom/commit/85f250675a15f0cf3aa33bddefe959baa4a15e8f) Thanks [@astra-void](https://github.com/astra-void)! - Give every instance Roblox's attribute API.

  `GetAttribute`, `SetAttribute`, `GetAttributes`, `GetAttributeChangedSignal` and
  the `AttributeChanged` event were missing entirely, so app code reaching for the
  one namespace a Roblox app owns outright died on
  `GetAttribute is not a function` — before drawing anything, since the read is
  usually on mount. Vela's runtime host hits both halves of it resolving `dark:`
  (it reads `LocalPlayer:GetAttribute("VelaColorScheme")` on every environment read
  and subscribes to the change signal), which took down every preview whose scene
  reached that host.

  Attributes are a second namespace beside the property store, as in Roblox: an
  attribute is not readable as a property, does not fire `Changed`, and reaches
  neither the renderer nor the Scene IR — so a write schedules no flush.
  `SetAttribute(name, nil)` removes the attribute and still notifies, an unchanged
  write is silent, and `GetAttributes` hands back a snapshot rather than the live
  store.

  Names are validated the way the engine validates them — up to 100 alphanumerics
  and underscores, with the `RBX` prefix reserved — and a bad one throws rather
  than storing something a real place would refuse.

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

- Updated dependencies [[`9574052`](https://github.com/astra-void/loom/commit/9574052ae9edec22d2c46843fefe13133c78554c)]:
  - @loom-dev/scene@0.9.3

## 0.9.2

### Patch Changes

- Updated dependencies []:
  - @loom-dev/scene@0.9.2

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

- Updated dependencies []:
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

- Updated dependencies []:
  - @loom-dev/scene@0.9.0

## 0.8.1

### Patch Changes

- Updated dependencies []:
  - @loom-dev/scene@0.8.1

## 0.8.0

### Minor Changes

- [`7d30cf0`](https://github.com/astra-void/loom/commit/7d30cf05a00f7783793a969dcd3598447ddbc48e) Thanks [@astra-void](https://github.com/astra-void)! - Add the Luau `table` library to the globals a previewed roblox-ts tree runs
  against — `insert`, `remove`, `find`, `concat`, `sort`, `create`, `clear`,
  `clone`, `freeze`, `isfrozen`, `pack`, `unpack` and `move`, over arrays, `Map`s,
  `Set`s and plain objects, plus the deprecated `getn`, `maxn`, `foreach` and
  `foreachi` that Roblox still exposes and old code still calls. It was the last
  of the standard libraries `luau.ts` left out, and the one UI code reaches for
  most: a component that built its rows with `table.insert` crashed on `table is
not defined` before it ever rendered.

  Positions are **1-based**, like the engine's. `table` is not a roblox-ts macro —
  the compiler passes its arguments straight through to Luau, so the number
  written in the source is already a Luau index, exactly as it is for the
  `string.find` already shipped here. The array _methods_ roblox-ts does compile
  as macros keep their 0-based TS indices, so `list.remove(0)` and
  `table.remove(list, 1)` drop the same element.

  `sort` takes Luau's boolean predicate (`comp(a, b)` is true when `a` comes
  first), not a JS comparator returning a number.

  Where the engine raises an error, loom leans forgiving instead, so a preview
  renders rather than dying over an off-by-one: an out-of-range `insert` position
  clamps, an out-of-range `remove` returns `nil` without mutating, and `concat`
  stringifies whatever it is handed. `freeze` is `Object.freeze`, which covers
  arrays and objects but cannot stop `Map.set`.

  **And with it, the rest of the Luau standard library**, so a roblox-ts tree no
  longer trips over a missing global halfway through a render:

  - `string` gains `match`, `gmatch`, `byte`, `char`, `len` and `reverse`, and
    `find` now takes a negative `init` the way the engine does. `match`/`gmatch`
    return captures as the tuple roblox-ts reads, empty when unmatched, like
    `find`. The prototype patches pick up `gmatch`, `byte`, `len` and `reverse` —
    but deliberately not `match`, which JS already defines with other semantics on
    a prototype the whole page shares.
  - `math` gains `asin`, `acos`, `atan`, `atan2`, `sinh`, `cosh`, `tanh`, `log10`,
    `ldexp`, `frexp`, `modf` and `randomseed`, and `log` now takes an optional
    base. `randomseed` genuinely seeds: `Math.random` cannot be, so it switches
    `math.random` to a deterministic generator rather than silently ignoring code
    that seeds for reproducibility.
  - `os` gains `date` (a strftime subset, `*t` tables and the `!` UTC prefix) and
    `difftime`, and `time` now accepts a date table.
  - New libraries: `bit32` (Luau's saturating shifts, not JS's masked ones),
    `utf8`, `debug` (profiling wired to `performance.measure`, so Roblox
    instrumentation shows up in the devtools Performance panel) and `buffer`
    (little-endian and bounds-checked; `typeOf` answers `"buffer"`).
  - New globals: `select`, the deprecated `unpack`, and `rawget` / `rawset` /
    `rawequal` / `rawlen`.

  Still absent, on purpose: `setmetatable`/`getmetatable`/`newproxy`. Loom runs
  the author's TypeScript, whose classes are JS classes, and there is no faithful
  way to give a plain object a metatable's `__index` behaviour without proxying
  every table in the program.

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

- Updated dependencies []:
  - @loom-dev/scene@0.6.8

## 0.6.7

### Patch Changes

- Updated dependencies []:
  - @loom-dev/scene@0.6.7

## 0.6.6

### Patch Changes

- Updated dependencies [[`45b3278`](https://github.com/astra-void/loom/commit/45b3278d157646302e33f8abd1a9dafeed7d3c29)]:
  - @loom-dev/scene@0.6.6

## 0.6.5

### Patch Changes

- Updated dependencies []:
  - @loom-dev/scene@0.6.5

## 0.6.4

### Patch Changes

- Updated dependencies []:
  - @loom-dev/scene@0.6.4

## 0.6.3

### Patch Changes

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
  - @loom-dev/scene@0.6.0

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

- [`de7d915`](https://github.com/astra-void/loom/commit/de7d915563173a6c35a75c0f14d5453fc53d9ff7) Thanks [@astra-void](https://github.com/astra-void)! - Add browser-compatible `HttpService.GenerateGUID` support and implement
  `Color3.fromHex`, allowing roblox-ts UI projects that generate component IDs and
  define themes with hexadecimal colors to render in Loom unchanged.

  ```ts
  import { HttpService } from "@rbxts/services";

  const id = HttpService.GenerateGUID(false);
  const accent = Color3.fromHex("#6366F1");
  ```

  Both lines used to fail: the import with `The requested module
"@rbxts/services" does not provide an export named "HttpService"` (the alias
  module exports an explicitly reviewed list, and loom had no `HttpService` to
  put in it), the theme with `Color3.fromHex is not a function`.

  - `HttpService` is now a real service instance in the runtime registry, so
    `game.GetService("HttpService")` and the `@rbxts/services` export are the same
    singleton. `GenerateGUID` returns an RFC 9562 v4 UUID from the Web Crypto API
    — `crypto.randomUUID()`, or `crypto.getRandomValues()` with the version and
    variant bits set explicitly — braced by default, and throws rather than
    falling back to a weak identifier when Web Crypto is unavailable.
    `JSONEncode` / `JSONDecode` come with it; `GetAsync`, `PostAsync` and
    `RequestAsync` throw by name, because a preview never issues requests on your
    behalf.
  - `Color3.fromHex` accepts exactly six RGB hex digits, either case, with or
    without one leading `#`, and converts through the existing `Color3.fromRGB`
    path. CSS shorthand, alpha channels, `0x` notation and stray whitespace are
    rejected with a located loom error instead of being silently reinterpreted.

- Updated dependencies []:
  - @loom-dev/scene@0.5.3

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
