# loom-dev

## 0.12.0

### Patch Changes

- Updated dependencies [[`8132a84`](https://github.com/astra-void/loom/commit/8132a845fbdbd2d0e280da2e232a05eb86cb36a0)]:
  - @loom-dev/preview@0.12.0

## 0.11.0

### Patch Changes

- Updated dependencies []:
  - @loom-dev/preview@0.11.0

## 0.10.2

### Patch Changes

- Updated dependencies [[`79059cc`](https://github.com/astra-void/loom/commit/79059cc2e5ae537fd8b12263f8400d180d31a2ae)]:
  - @loom-dev/preview@0.10.2

## 0.10.1

### Patch Changes

- Updated dependencies [[`6cfda61`](https://github.com/astra-void/loom/commit/6cfda613768d4ff2ab390ec9ba5d702428c402fe)]:
  - @loom-dev/preview@0.10.1

## 0.10.0

### Patch Changes

- Updated dependencies [[`354785c`](https://github.com/astra-void/loom/commit/354785c4e6ca8d44feaf1bb7fb2890e9bf72480d)]:
  - @loom-dev/preview@0.10.0

## 0.9.6

### Patch Changes

- Updated dependencies []:
  - @loom-dev/preview@0.9.6

## 0.9.5

### Patch Changes

- Updated dependencies [[`89373b7`](https://github.com/astra-void/loom/commit/89373b7614c3bf64e198ad920d49ac720ffdad9b)]:
  - @loom-dev/preview@0.9.5

## 0.9.4

### Patch Changes

- Updated dependencies []:
  - @loom-dev/preview@0.9.4

## 0.9.3

### Patch Changes

- Updated dependencies []:
  - @loom-dev/preview@0.9.3

## 0.9.2

### Patch Changes

- Updated dependencies []:
  - @loom-dev/preview@0.9.2

## 0.9.1

### Patch Changes

- Updated dependencies []:
  - @loom-dev/preview@0.9.1

## 0.9.0

### Patch Changes

- Updated dependencies [[`14a2294`](https://github.com/astra-void/loom/commit/14a229432c4f665e3e5fb88b62f23d59253039c8)]:
  - @loom-dev/preview@0.9.0

## 0.8.1

### Patch Changes

- Updated dependencies []:
  - @loom-dev/preview@0.8.1

## 0.8.0

### Patch Changes

- Updated dependencies [[`7d30cf0`](https://github.com/astra-void/loom/commit/7d30cf05a00f7783793a969dcd3598447ddbc48e)]:
  - @loom-dev/preview@0.8.0

## 0.7.1

### Patch Changes

- [`7eef986`](https://github.com/astra-void/loom/commit/7eef986d72991b0a084b1b381108a51a94b18b03) Thanks [@astra-void](https://github.com/astra-void)! - Let a host actually turn the `rbxassetid://` bake off. `assets: false` shipped on
  the Vite plugin in `0.7.0`, but every wrapper around it — `loom build`,
  `buildGallery`, `withLoomGallery` — dropped the option on the floor, so the one
  place a build most needs to stay off the network (a docs site's embedded
  gallery) had no way to say so. All three forward it now, and `loom build` takes
  `--no-assets`.
- Updated dependencies []:
  - @loom-dev/preview@0.7.1

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
  - @loom-dev/preview@0.7.0

## 0.6.8

### Patch Changes

- Updated dependencies []:
  - @loom-dev/preview@0.6.8

## 0.6.7

### Patch Changes

- Updated dependencies []:
  - @loom-dev/preview@0.6.7

## 0.6.6

### Patch Changes

- Updated dependencies []:
  - @loom-dev/preview@0.6.6

## 0.6.5

### Patch Changes

- Updated dependencies []:
  - @loom-dev/preview@0.6.5

## 0.6.4

### Patch Changes

- Updated dependencies []:
  - @loom-dev/preview@0.6.4

## 0.6.3

### Patch Changes

- Updated dependencies [[`c91268b`](https://github.com/astra-void/loom/commit/c91268bb01d1566f640093c15c5f33c30bc45c6c)]:
  - @loom-dev/preview@0.6.3

## 0.6.2

### Patch Changes

- [`ed16a33`](https://github.com/astra-void/loom/commit/ed16a330dc1b7740c376d95e7784c7a6a7884eef) Thanks [@astra-void](https://github.com/astra-void)! - Let an embedded preview take a specific backdrop colour, not just one of the two themes.

  - **`?background=<css color>` paints the stage.** `?theme=light|dark` picks a whole palette (chrome, text, and one of loom's two backdrops, `#14161a` or `#f6f9fc`); `background` overrides just the backdrop with a colour of your own and leaves the rest to the theme, so a plain white stage is `?theme=light&background=white`. `transparent` lets the host page show through the iframe. It applies in both gallery modes and to the static build, on the same URL contract as the rest.
  - **Hex without the `#`.** A literal `?background=#ffffff` never reaches the gallery — `#` opens the URL fragment, which is also where the gallery keeps its route. Both spellings that survive are accepted: percent-encoded (`%23ffffff`) and bare digits (`ffffff`).
  - **`{ type: "loom-background", background }` re-points it live**, next to the existing `{ type: "loom-theme" }` message, so a docs page that switches theme at runtime need not reload the iframe. Posting the message with no colour hands the backdrop back to the theme.
  - Only colours are accepted, through an allowlist: a gradient, a `url(...)`, or anything else that could turn a query param into a network fetch is ignored, and the theme's own backdrop stands.

- Updated dependencies [[`ed16a33`](https://github.com/astra-void/loom/commit/ed16a330dc1b7740c376d95e7784c7a6a7884eef)]:
  - @loom-dev/preview@0.6.2

## 0.6.1

### Patch Changes

- Updated dependencies [[`bbf0e6f`](https://github.com/astra-void/loom/commit/bbf0e6fb02e008c762677725c438165ec6a2eb9f), [`3c32df7`](https://github.com/astra-void/loom/commit/3c32df745836a34e4f1df05b0099ef9108556763), [`ceb5b7e`](https://github.com/astra-void/loom/commit/ceb5b7ed4dbc452d776c14bb5090bb7efa0d1665)]:
  - @loom-dev/preview@0.6.1

## 0.6.0

### Patch Changes

- Updated dependencies [[`68701b7`](https://github.com/astra-void/loom/commit/68701b77ce4bd0a31168687e83c4e08d683efd53), [`06b8636`](https://github.com/astra-void/loom/commit/06b8636e0b3a55001cc81f0db73b183195c75c93)]:
  - @loom-dev/preview@0.6.0

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

- Updated dependencies [[`de7d915`](https://github.com/astra-void/loom/commit/de7d915563173a6c35a75c0f14d5453fc53d9ff7)]:
  - @loom-dev/preview@0.5.3

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

- [`34d9f40`](https://github.com/astra-void/loom/commit/34d9f400d8e85298057c518ccd330dd8266e0eb4) Thanks [@astra-void](https://github.com/astra-void)! - Make the Next.js gallery integration automatically respect the resolved Next
  `basePath`, including GitHub Pages and other static exports hosted below a
  subpath, while keeping the gallery output under its existing `public/` mount.

  `withLoomGallery()` used one normalized `base` as three different things: the
  Next rewrite route, the `public/` output directory, and the Vite base baked
  into the generated gallery. Under a `basePath` those diverge — a site exported
  to `https://…/rbxts-react-clean-ui/` served its gallery at
  `/rbxts-react-clean-ui/loom-preview/` while every script, stylesheet, scene
  chunk and runtime URL inside it still pointed at `/loom-preview/…` and 404'd.

  The wrapper now derives two bases from the _resolved_ config (after wrappers
  like Fumadocs' `createMDX` have run):

  - `mountBase` — the mount relative to the Next app (`/loom-preview/`). Rewrite
    rules keep using it, because Next prefixes `basePath` onto rewrite sources
    itself, and the static gallery still goes to `public/loom-preview`.
  - `publicBase` — `basePath` + `mountBase`, used as the gallery's Vite base, so
    the generated HTML, chunks, dynamic imports and runtime URLs resolve where
    the browser actually loads them. The cross-process build marker keys on it,
    so builds with different effective bases can't share a stale marker.

  The `base` option is unchanged and still means the mount relative to the app —
  do not repeat the deployment prefix in it (loom now warns when it looks like
  you did). A literal `<iframe src="/loom-preview/…">` in MDX is still yours to
  prefix: it never passes through Next's router.

- Updated dependencies [[`ba578d4`](https://github.com/astra-void/loom/commit/ba578d4556322f8739630fe5bc46d03652dcb61e)]:
  - @loom-dev/preview@0.5.2

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

- Updated dependencies [[`225a3e5`](https://github.com/astra-void/loom/commit/225a3e5fb64d729ed1b3ec6501da86d6983726d6), [`225a3e5`](https://github.com/astra-void/loom/commit/225a3e5fb64d729ed1b3ec6501da86d6983726d6), [`225a3e5`](https://github.com/astra-void/loom/commit/225a3e5fb64d729ed1b3ec6501da86d6983726d6)]:
  - @loom-dev/preview@0.5.1

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
  - @loom-dev/preview@0.5.0

## 0.4.0

### Minor Changes

- [`0a883fe`](https://github.com/astra-void/loom/commit/0a883feb2f22fe9bcd04cd73faf8dff2b2fcd556) Thanks [@astra-void](https://github.com/astra-void)! - Add `loom-dev/next` — a Next.js integration for the loom gallery with the same one-line setup the Astro embed gets. `withLoomGallery(nextConfig, { root, targets })` returns a phase-aware function config: `next dev` proxies `/loom-preview/*` to an isolated, lazily-booted gallery Vite server (full HMR, host React untouched, webpack and Turbopack alike), `next build` emits the static gallery into `public/<base>` automatically (`staticBuild: false` to opt out), and `next start` serves it with the bare mount path mapped onto its `index.html`. Also exports `startGalleryServer`, a standalone HTTP wrapper around the embed middleware for hosts that can only forward to a URL.

### Patch Changes

- Updated dependencies [[`12c6c8e`](https://github.com/astra-void/loom/commit/12c6c8e59e6b7276e0c9245470746a1a9121fe39)]:
  - @loom-dev/preview@0.4.0

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

- Updated dependencies [[`46bbb48`](https://github.com/astra-void/loom/commit/46bbb48622341ed55df0fc99f4e0f8f5addcb700)]:
  - @loom-dev/preview@0.3.0

## 0.2.1

### Patch Changes

- Updated dependencies [[`00ac09b`](https://github.com/astra-void/loom/commit/00ac09b2a85a6cbf7481c83a3a33d85880adf8ac)]:
  - @loom-dev/preview@0.2.1

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

- Updated dependencies [[`4c5eb6d`](https://github.com/astra-void/loom/commit/4c5eb6d17fa962c2c9841c2f4c509167c7e8c955)]:
  - @loom-dev/preview@0.2.0
