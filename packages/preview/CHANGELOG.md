# @loom-dev/preview

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
  - @loom-dev/renderer@0.12.0
  - @loom-dev/react@0.12.0

## 0.11.0

### Patch Changes

- Updated dependencies [[`85f2506`](https://github.com/astra-void/loom/commit/85f250675a15f0cf3aa33bddefe959baa4a15e8f)]:
  - @loom-dev/runtime@0.11.0
  - @loom-dev/react@0.11.0
  - @loom-dev/renderer@0.11.0

## 0.10.2

### Patch Changes

- [`79059cc`](https://github.com/astra-void/loom/commit/79059cc2e5ae537fd8b12263f8400d180d31a2ae) Thanks [@astra-void](https://github.com/astra-void)! - Let a preview reflow at every viewport, and make the zoom `?base=` only.

  A stage narrower than 960px on a coarse-pointer device used to keep a
  desktop-sized logical viewport and paint the whole scene scaled down. That
  looked like the same layout drawn smaller, but it was a _different_ layout from
  the one the engine gives at that viewport: `TextWrapped` text kept the line
  breaks it had at 960, a `UIListLayout` with `Wraps` kept its row count,
  `AutomaticSize` settled at the wide measurement, and scale-vs-offset mixes
  re-proportioned against the wrong number — wrong in exactly the places a narrow
  viewport is the thing being checked.

  Now the scene lays out against the stage's real pixels everywhere, so a phone
  reflows the way a phone-sized Roblox viewport reflows. The zoom is still there
  for a page that wants a wide composition inside a narrow column, but it has to
  be asked for: `?base=<px>` (or a bare `?base` for 960). `?base=none`/`off`/`0`
  spells the default out for a host page templating the param.

- Updated dependencies []:
  - @loom-dev/runtime@0.10.2
  - @loom-dev/renderer@0.10.2
  - @loom-dev/react@0.10.2

## 0.10.1

### Patch Changes

- [`6cfda61`](https://github.com/astra-void/loom/commit/6cfda613768d4ff2ab390ec9ba5d702428c402fe) Thanks [@astra-void](https://github.com/astra-void)! - Give the asset prerender loom's own React, so a static build with `assets` on
  does not die in an installed app.

  `next build` failed with `[loom:asset-bundle] Cannot read properties of undefined
(reading 'ReactCurrentBatchConfig')` as soon as a gallery composed an
  `rbxassetid://` at runtime, and the only way out was `assets: false`. The bake
  mounts the scenes to find those ids, and it hands the CommonJS reconciler to
  node, where Vite's aliases do not apply: node answered the reconciler's own
  `require("react")` with whatever sat beside it. In a published install that is
  the host app's React 19 — npm hoists `@loom-dev/react` next to it while loom's
  React 18 stays nested under `loom-dev` — and reconciler 0.29 dies reading React
  18's since-renamed internals before a single scene mounts.

  Node's resolver is now pinned for the length of the prerender, and only for
  requires coming from inside the reconciler: it gets loom's React 18, and a host
  framework building its own React 19 pages in the same process is untouched.

  A prerender that cannot start no longer fails the build either. That was always
  the promise for a scene that will not render; it now covers the pass itself, so
  the worst case is a warning and the ids the bundle scan could read, not a lost
  build.

- Updated dependencies [[`1a57c8e`](https://github.com/astra-void/loom/commit/1a57c8e07f8a771212de70cc1a82f0797174b4f3)]:
  - @loom-dev/react@0.10.1
  - @loom-dev/runtime@0.10.1
  - @loom-dev/renderer@0.10.1

## 0.10.0

### Minor Changes

- [`354785c`](https://github.com/astra-void/loom/commit/354785c4e6ca8d44feaf1bb7fb2890e9bf72480d) Thanks [@astra-void](https://github.com/astra-void)! - Add a debug mode to the gallery: `?debug=1`, the sidebar's `debug` button, or
  Ctrl+Alt+D.

  The panel reports what a preview is actually doing — the mounted target with
  its import and first-frame timings; the logical viewport the scene laid out
  against beside the stage, the camera and the mobile scale factor; the live tree
  by instance, GuiObject, hidden, depth and class, with each layer's
  `DisplayOrder`; every typeface the text resolved to and whether the browser
  really loaded it or quietly fell back to another face's metrics; the frame rate
  and the DOM patches behind it; and a count of what loom logged to a console
  nobody reads.

  Hovering the stage names the GuiObject under the pointer, outlines it with its
  size, and lists its ancestry, geometry, `UI*` modifiers, resolved typeface and
  properties. Alt+click pins the selection, and the ancestry trail and the rest of
  the hit stack are clickable, so the tree can be walked from the panel. The hit
  test is the scene's own `PlayerGui:GetGuiObjectsAtPosition`, so a click-through
  frame that no browser inspector can reach is still inspectable.

  `copy` puts the readout on the clipboard; `json` downloads it as data — every
  section plus the whole instance tree with absolute geometry — and the same
  snapshot is available as `loomDebug.snapshot()` while the panel is open, for a
  devtools session or a headless harness.

  Everything is read-only and outside the render path, and while the panel is
  closed — the state every non-debugging preview is in — none of it runs: no
  observers, no timers, no tree walks. The toggle is remembered for the tab so an
  HMR reload doesn't close it, except in a `chrome=none` embed, where a debug
  panel only ever appears if the URL asked for one.

### Patch Changes

- Updated dependencies []:
  - @loom-dev/runtime@0.10.0
  - @loom-dev/renderer@0.10.0
  - @loom-dev/react@0.10.0

## 0.9.6

### Patch Changes

- Updated dependencies [[`f14c548`](https://github.com/astra-void/loom/commit/f14c54895ec16c9c425b41deed12f3a4c6c85ace)]:
  - @loom-dev/renderer@0.9.6
  - @loom-dev/react@0.9.6
  - @loom-dev/runtime@0.9.6

## 0.9.5

### Patch Changes

- [`89373b7`](https://github.com/astra-void/loom/commit/89373b7614c3bf64e198ad920d49ac720ffdad9b) Thanks [@astra-void](https://github.com/astra-void)! - Bake the `rbxassetid://` images a static build only builds at runtime.

  The bake read the emitted bundle for `rbxassetid://<digits>`, which finds an id a
  source spells out and nothing else. A component library composes them —
  `` `rbxassetid://${iconId}` `` over a table of ids — and after bundling that is a
  prefix, a `+`, and a few hundred bare numbers no scan can tell from any other
  number. So the manifest came out empty and a gallery built from a real UI library
  painted none of its icons, while `loom preview` showed them all.

  The build now _runs_ the scenes to find out. Every gallery target is mounted in
  node — happy-dom for the DOM, the real react adapter and runtime, a stub layout
  in place of the WASM engine — and the live instance tree is read for its `Image`
  properties. That answers with what the page will ask for however the string was
  built, and only that: a 700-icon set contributes the dozen icons the scenes
  actually render.

  The pass runs only when the output composes an id (a build whose ids are all
  spelled out is unchanged, and pays nothing), and never fails a build — a target
  that will not import or render is warned about and skipped, and composition that
  prerendering could not resolve says so rather than leaving a blank image
  unexplained. Still out of reach: an image the first render never reaches, behind
  a hover state or a later fetch.

- Updated dependencies [[`f4bf03d`](https://github.com/astra-void/loom/commit/f4bf03de7c2bf58d1cb4135b43c26a4e235fb7a4), [`f4bf03d`](https://github.com/astra-void/loom/commit/f4bf03de7c2bf58d1cb4135b43c26a4e235fb7a4)]:
  - @loom-dev/renderer@0.9.5
  - @loom-dev/react@0.9.5
  - @loom-dev/runtime@0.9.5

## 0.9.4

### Patch Changes

- Updated dependencies [[`e6de267`](https://github.com/astra-void/loom/commit/e6de267522721c64bf65aa2fba78b3f67f5e5818)]:
  - @loom-dev/renderer@0.9.4
  - @loom-dev/react@0.9.4
  - @loom-dev/runtime@0.9.4

## 0.9.3

### Patch Changes

- Updated dependencies [[`dc2757d`](https://github.com/astra-void/loom/commit/dc2757d80383f09db0002e4ac8a1aa7ccce6dd94), [`a1bbf8d`](https://github.com/astra-void/loom/commit/a1bbf8d7b03f2e9caf37bf1819f3df752095c64e), [`9574052`](https://github.com/astra-void/loom/commit/9574052ae9edec22d2c46843fefe13133c78554c)]:
  - @loom-dev/renderer@0.9.3
  - @loom-dev/react@0.9.3
  - @loom-dev/runtime@0.9.3

## 0.9.2

### Patch Changes

- Updated dependencies [[`62cec5f`](https://github.com/astra-void/loom/commit/62cec5f362c483f54da49f7fe26b90c1e2548ff1)]:
  - @loom-dev/renderer@0.9.2
  - @loom-dev/react@0.9.2
  - @loom-dev/runtime@0.9.2

## 0.9.1

### Patch Changes

- Updated dependencies [[`75f6d5b`](https://github.com/astra-void/loom/commit/75f6d5b5818c8f9f8267564e7269830d90b194b5)]:
  - @loom-dev/runtime@0.9.1
  - @loom-dev/react@0.9.1
  - @loom-dev/renderer@0.9.1

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
  - @loom-dev/renderer@0.9.0
  - @loom-dev/runtime@0.9.0
  - @loom-dev/react@0.9.0

## 0.8.1

### Patch Changes

- Updated dependencies [[`9cf0372`](https://github.com/astra-void/loom/commit/9cf037253244bcabdc145251c5a3013b33c03c44), [`fc04521`](https://github.com/astra-void/loom/commit/fc04521e40bba3aa6ef20097b2f703cb78074203)]:
  - @loom-dev/renderer@0.8.1
  - @loom-dev/react@0.8.1
  - @loom-dev/runtime@0.8.1

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

- Updated dependencies [[`7d30cf0`](https://github.com/astra-void/loom/commit/7d30cf05a00f7783793a969dcd3598447ddbc48e)]:
  - @loom-dev/runtime@0.8.0
  - @loom-dev/react@0.8.0
  - @loom-dev/renderer@0.8.0

## 0.7.1

### Patch Changes

- Updated dependencies []:
  - @loom-dev/runtime@0.7.1
  - @loom-dev/renderer@0.7.1
  - @loom-dev/react@0.7.1

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
  - @loom-dev/runtime@0.7.0
  - @loom-dev/renderer@0.7.0
  - @loom-dev/react@0.7.0

## 0.6.8

### Patch Changes

- Updated dependencies []:
  - @loom-dev/react@0.6.8
  - @loom-dev/runtime@0.6.8
  - @loom-dev/renderer@0.6.8

## 0.6.7

### Patch Changes

- Updated dependencies []:
  - @loom-dev/react@0.6.7
  - @loom-dev/runtime@0.6.7
  - @loom-dev/renderer@0.6.7

## 0.6.6

### Patch Changes

- Updated dependencies []:
  - @loom-dev/react@0.6.6
  - @loom-dev/renderer@0.6.6
  - @loom-dev/runtime@0.6.6

## 0.6.5

### Patch Changes

- Updated dependencies []:
  - @loom-dev/react@0.6.5
  - @loom-dev/runtime@0.6.5
  - @loom-dev/renderer@0.6.5

## 0.6.4

### Patch Changes

- Let a narrow desktop preview reflow instead of zooming out, and add `?base=` to control it.

  Below 960px the preview stopped laying the scene out against the window and started shrinking the pixels instead: the mount kept a 960-wide logical viewport and took a CSS `scale()` to fit. That adaptation exists for phones — a desktop-width UI sliced down to a ~390px strip is a slice of a layout rather than a layout — but it was applied to every screen, including a desktop window an author had merely dragged narrow. There, it is wrong in the way that matters most: Studio reflows at that viewport, so the preview showed text wrapping at the wrong width and columns re-proportioning at the wrong breakpoints, and dragging the window narrower stopped changing the layout at all.

  - **It now applies only where it was meant to**, a device whose primary pointer is coarse — a phone or a tablet. Under a mouse, a narrow window is a narrow window and the scene lays out against it, matching Studio at every width.
  - **`?base=<px>`** sets the logical viewport explicitly, so a docs page embedding a preview at a fixed width can pick the one its scene was written for. `?base=none` (or `off`, or `0`) turns the adaptation off outright, and `?base=960` restores the previous behaviour everywhere. A value that can't be read falls back to the device default rather than silently un-adapting the phone this exists for.

- Updated dependencies []:
  - @loom-dev/react@0.6.4
  - @loom-dev/renderer@0.6.4
  - @loom-dev/runtime@0.6.4

## 0.6.3

### Patch Changes

- [`c91268b`](https://github.com/astra-void/loom/commit/c91268bb01d1566f640093c15c5f33c30bc45c6c) Thanks [@astra-void](https://github.com/astra-void)! - Stop the embedded gallery flashing its dark backdrop before `?theme=` / `?background=` takes effect.

  The generated page painted `#14161a` from its inline `<style>` no matter what the URL asked for, and the requested backdrop only arrived once the bundle, the WASM layout engine and the target chunk had loaded — half a second of black on a light or custom-coloured embed, repeated every time a host control changed a param and reloaded the iframe.

  The backdrop is now decided in the page's `<head>`, from `location.search` alone, before the first paint: a small inline script applies the theme class and the `?background=` colour, and the stylesheet that used to carry the colour no longer paints one at all (so nothing repaints over the decision). The shell's own theme and `{type:"loom-background"}` handling is unchanged and writes to the same element, which makes its first pass a no-op rather than a second paint.

  The inline script shares its colour patterns with `parseBackgroundColor`, so the early paint and the shell can't drift; a test pins the two readings together over one table of inputs.

- Updated dependencies [[`abe2845`](https://github.com/astra-void/loom/commit/abe28455deb7f12b2a467e6a7ada8b6602f01f97), [`abe2845`](https://github.com/astra-void/loom/commit/abe28455deb7f12b2a467e6a7ada8b6602f01f97), [`abe2845`](https://github.com/astra-void/loom/commit/abe28455deb7f12b2a467e6a7ada8b6602f01f97)]:
  - @loom-dev/renderer@0.6.3
  - @loom-dev/react@0.6.3
  - @loom-dev/runtime@0.6.3

## 0.6.2

### Patch Changes

- [`ed16a33`](https://github.com/astra-void/loom/commit/ed16a330dc1b7740c376d95e7784c7a6a7884eef) Thanks [@astra-void](https://github.com/astra-void)! - Let an embedded preview take a specific backdrop colour, not just one of the two themes.

  - **`?background=<css color>` paints the stage.** `?theme=light|dark` picks a whole palette (chrome, text, and one of loom's two backdrops, `#14161a` or `#f6f9fc`); `background` overrides just the backdrop with a colour of your own and leaves the rest to the theme, so a plain white stage is `?theme=light&background=white`. `transparent` lets the host page show through the iframe. It applies in both gallery modes and to the static build, on the same URL contract as the rest.
  - **Hex without the `#`.** A literal `?background=#ffffff` never reaches the gallery — `#` opens the URL fragment, which is also where the gallery keeps its route. Both spellings that survive are accepted: percent-encoded (`%23ffffff`) and bare digits (`ffffff`).
  - **`{ type: "loom-background", background }` re-points it live**, next to the existing `{ type: "loom-theme" }` message, so a docs page that switches theme at runtime need not reload the iframe. Posting the message with no colour hands the backdrop back to the theme.
  - Only colours are accepted, through an allowlist: a gradient, a `url(...)`, or anything else that could turn a query param into a network fetch is ignored, and the theme's own backdrop stands.

- Updated dependencies []:
  - @loom-dev/runtime@0.6.2
  - @loom-dev/renderer@0.6.2
  - @loom-dev/react@0.6.2

## 0.6.1

### Patch Changes

- [`bbf0e6f`](https://github.com/astra-void/loom/commit/bbf0e6fb02e008c762677725c438165ec6a2eb9f) Thanks [@astra-void](https://github.com/astra-void)! - Fix `import ReactRoblox from "@rbxts/react-roblox"` failing with "does not provide an export named 'default'". The preview's stand-in now exports the namespace object too, matching upstream's `export =` typings and the `@rbxts/react` facade.

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

- Updated dependencies [[`3c32df7`](https://github.com/astra-void/loom/commit/3c32df745836a34e4f1df05b0099ef9108556763), [`ceb5b7e`](https://github.com/astra-void/loom/commit/ceb5b7ed4dbc452d776c14bb5090bb7efa0d1665)]:
  - @loom-dev/renderer@0.6.1
  - @loom-dev/runtime@0.6.1
  - @loom-dev/react@0.6.1

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
  - @loom-dev/react@0.6.0
  - @loom-dev/renderer@0.6.0

## 0.5.3

### Patch Changes

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

- Updated dependencies [[`60ee957`](https://github.com/astra-void/loom/commit/60ee957ba6c1936d3614029446ce7d2ec1df9228), [`de7d915`](https://github.com/astra-void/loom/commit/de7d915563173a6c35a75c0f14d5453fc53d9ff7)]:
  - @loom-dev/runtime@0.5.3
  - @loom-dev/react@0.5.3

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
  - @loom-dev/react@0.5.2
  - @loom-dev/runtime@0.5.2

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

- [`225a3e5`](https://github.com/astra-void/loom/commit/225a3e5fb64d729ed1b3ec6501da86d6983726d6) Thanks [@astra-void](https://github.com/astra-void)! - Add zero-config Loom compatibility for the root `@rbxts/ui-labs` `Environment`
  import while preserving user-provided shim overrides.

  The package ships a Luau runtime plus `.d.ts` and nothing a browser can run, so
  importing it used to fail outright. Loom now aliases the root specifier — and
  only the root specifier — to a built-in module modelling the **non-story** UI
  Labs environment: `IsStory()` is `false`, `InputListener` is `undefined`, and
  `UserInput` is loom's own `UserInputService` singleton, so the common
  `Environment.IsStory() ? Environment.InputListener : UserInputService` guard
  selects loom's service with no configuration. Story creators, controls,
  snapshots and the Studio plugin APIs are not emulated.

  A `shims` entry for the same specifier still wins, and a Luau-only package with
  no shim now fails with a loom diagnostic naming the package and the `shims`
  option instead of handing Luau to the JavaScript parser.

- [`225a3e5`](https://github.com/astra-void/loom/commit/225a3e5fb64d729ed1b3ec6501da86d6983726d6) Thanks [@astra-void](https://github.com/astra-void)! - Add a `shims` option for roblox-ts packages loom can't run in the browser.

  A declaration-only Luau package (`"main": "src/init.lua"` plus a `.d.ts`, no
  `src/index.ts`) has no source entry the `.luau`-main fallback can redirect to,
  so importing one fails with `Failed to resolve entry for package`.
  `shims: { "<specifier>": "<module>" }` redirects the package to a browser module
  the project supplies — exact-match only, applied before loom's own `@rbxts/*`
  aliases, and available on every entry path (`loomPreview()`, `loom.config.ts`,
  `loom-dev/embed`, `withLoomGallery()`). See "Package compatibility" in the
  README.

- Updated dependencies [[`225a3e5`](https://github.com/astra-void/loom/commit/225a3e5fb64d729ed1b3ec6501da86d6983726d6)]:
  - @loom-dev/react@0.5.1
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

- Fix gallery shell and target module loading on Windows by generating valid
  Vite `/@fs/` URLs, and make Next.js gallery roots resolve eagerly from the app
  directory.
- Updated dependencies []:
  - @loom-dev/runtime@0.5.0
  - @loom-dev/react@0.5.0

## 0.4.0

### Patch Changes

- [`12c6c8e`](https://github.com/astra-void/loom/commit/12c6c8e59e6b7276e0c9245470746a1a9121fe39) Thanks [@astra-void](https://github.com/astra-void)! - Narrow the `react` peer range to `^18.3.1`.

  The declared range allowed `^19.0.0`, but the React adapter drives
  `react-reconciler@^0.29.2`, which reads React 18 internals that React 19
  renamed — a React 19 install fails at evaluation time with an
  `Invalid hook call` / duplicate-React error. The range now matches what the
  reconciler actually supports, so the failure surfaces at install time instead
  of at first render.

- Updated dependencies []:
  - @loom-dev/runtime@0.4.0
  - @loom-dev/react@0.4.0

## 0.3.0

### Minor Changes

- [`46bbb48`](https://github.com/astra-void/loom/commit/46bbb48622341ed55df0fc99f4e0f8f5addcb700) Thanks [@astra-void](https://github.com/astra-void)! - Make `loomPreview()` usable on its own: dropped into a `vite.config.ts` it now
  serves the whole preview, with no `index.html` and no other setup.

  - The plugin **generates the page**. Under `serve` a middleware answers `/` with
    a document carrying `#loom-root` and a module script for the detected client
    entry (`src/main.client.tsx` and friends); under `build` the same document is
    a virtual `<root>/index.html` wired up as the Rollup input, so `vite build`
    emits a static site from a project that has no HTML file at all. A project
    with its own `index.html` keeps it.
  - **Gallery mode is a plugin option**: `loomPreview({ targets })` serves the
    `*.loom.tsx` sidebar shell in dev and emits the same static, deep-linkable
    gallery under `vite build` that `loom build` does. `entry`, `title` and
    `html: false` round out the options.
  - Under `build` the Roblox globals are now part of the module graph — the html's
    entry modules get the globals import prepended, so `installGlobals()` runs
    first. A `vite build` with the plugin previously produced a bundle with no
    globals at all unless the CLI generated the entry.
  - Target discovery, codegen and the gallery shell moved from the CLI package to
    `@loom-dev/preview` (new `@loom-dev/preview/gallery` entry point) — the CLI is
    now a thin wrapper over the plugin, and `loom build` drops its scratch-dir
    codegen for the plugin's own build path.

### Patch Changes

- Updated dependencies []:
  - @loom-dev/runtime@0.3.0
  - @loom-dev/react@0.3.0

## 0.2.1

### Patch Changes

- [`00ac09b`](https://github.com/astra-void/loom/commit/00ac09b2a85a6cbf7481c83a3a33d85880adf8ac) Thanks [@astra-void](https://github.com/astra-void)! - Fix the preview plugin against an **installed** loom (as opposed to a workspace
  checkout), which never worked: a project depending on the published packages got
  a blank preview and `does not provide an export named 'DefaultEventPriority'`.

  Everything that failed traces back to one thing — Vite resolves
  `optimizeDeps.include` entries, and anything an optimized chunk imports, from
  the _previewed project's_ root, which has no `@loom-dev` packages at all:

  - `@loom-dev/react` is now pre-bundled (aliased to an absolute path so the
    optimizer can find it), which folds in its CJS `react-reconciler`. Excluded
    from optimization, its raw ESM imported raw CJS and died at evaluation. The
    other loom packages stay excluded, so they remain external to that chunk and
    keep their single instance.
  - The loom packages that chunk imports are aliased to absolute paths too;
    otherwise they resolve to nothing from `node_modules/.vite/deps`.
  - `server.fs.allow` now covers the `node_modules` that holds them, so
    `@loom-dev/layout` can serve its wasm binary out of its own `pkg/` instead of
    answering 403 (`TypeError: HTTP status code is not ok`).

  All of it is gated on the adapter resolving inside `node_modules`: a workspace
  checkout keeps resolving through its own link chain, unbundled and hot-reloading
  as before.

- Updated dependencies []:
  - @loom-dev/runtime@0.2.1
  - @loom-dev/react@0.2.1

## 0.2.0

### Minor Changes

- [`4c5eb6d`](https://github.com/astra-void/loom/commit/4c5eb6d17fa962c2c9841c2f4c509167c7e8c955) Thanks [@astra-void](https://github.com/astra-void)! - Add `loom-dev/embed`, a programmatic API for hosting the gallery inside another
  toolchain: `createGalleryServer()` returns a middleware-mode Vite server that a
  host dev server can mount under a public base, and `buildGallery()` runs the
  static build into a host-chosen output directory. `findGalleryTargets()`,
  `isGalleryRequest()` and `normalizeGalleryBase()` round out the surface for
  hosts that need to route or skip cleanly. Middleware mode always puts HMR on a
  standalone port, so the gallery picks a free one instead of colliding on Vite's
  default 24678; `hmrPort` pins it or turns HMR off.

  Both the gallery index HTML and the injected Roblox-globals script are now
  base-aware, so a gallery mounted at e.g. `/loom-preview/` serves and boots
  correctly instead of requesting its entry from the host's root.

### Patch Changes

- Updated dependencies []:
  - @loom-dev/runtime@0.2.0
  - @loom-dev/react@0.2.0
