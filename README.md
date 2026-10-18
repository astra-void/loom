# Loom

Render Roblox UI as a live web DOM preview.

Loom takes a Roblox GUI tree — produced from `@rbxts/react` or `vide` today, and
from Luau later — and renders it in the browser with Roblox-accurate layout. The
pipeline is built around a single framework-agnostic contract, the **Scene IR**,
so any frontend can plug into the same layout + rendering core.

```
 @rbxts/react ─┐
   vide        ├─►  Frontend Adapter  ─►  Scene IR  ─►  Layout Engine  ─►  DOM Renderer  ─►  Browser DOM
   luau        ┘       (TS, swappable)     (contract)      (Rust → WASM)        (TS)
```

## Quick start

### As a Vite plugin

Already have (or want) a `vite.config.ts`? The plugin is the whole setup:

```sh
npm i -D @loom-dev/preview vite
```

```ts
// vite.config.ts
import { loomPreview } from "@loom-dev/preview/vite";
import { defineConfig } from "vite";

export default defineConfig({ plugins: [loomPreview()] });
```

`vite` and `vite build` now work against a roblox-ts source tree as-is — **no
`index.html`, no entry wiring, no aliases**. `loomPreview()` generates the page
around the detected client entry (`src/main.client.tsx` and friends), points
`@rbxts/react` / `@rbxts/react-roblox` / `@rbxts/services` / `@rbxts/vide` at the
loom adapters, pins one react, installs the Roblox datatype globals, sets the
automatic JSX runtime, and rewrites roblox-ts `import X = require(...)`. HMR
comes free from Vite. Options:

```ts
loomPreview({
  entry: "src/ui/boot.tsx", // only if the entry isn't a conventional name
  targets: "src/scenes",    // gallery mode: a glob, a dir, a list, or true
  title: "my UI",           // <title> of the generated page
  html: false,              // opt out of the generated page entirely
  shims: {},                // package redirects — see "Package compatibility"
  assets: false,            // don't bake rbxassetid images into a build
})
```

A project that keeps its own `index.html` gets to use it — the plugin only fills
in when there is none (gallery mode is the exception: its page always wins).

### As a CLI

Or skip the config file entirely:

```sh
loom preview [dir] [--port <n>] [--host] [--targets [glob]]
loom build   [dir] --targets [glob] [--out <dir>] [--base <path>] [--no-assets]
```

`preview` boots a Vite dev server with the plugin pre-applied — same generated
page, same entry detection. `--targets` switches to **gallery mode**: every
`**/*.loom.tsx` under the directory gets a sidebar entry with lazy mounts and
per-target error containment. `build` bundles that same gallery into a static,
client-only site (default `dist-preview/`) — which is exactly what `vite build`
does with `loomPreview({ targets })`. `--no-assets` keeps that build off the
network by skipping the `rbxassetid://` bake.

Only `preview` reads `<dir>/loom.config.ts` (an optional default export of
`{ targets?, port? }`, used when the matching flag is absent). `build` does not
load it at all — `--targets` is required on every invocation.

### Working on loom itself

```sh
pnpm install                  # also builds the WASM layout engine (prepare hook)
pnpm --filter @loom-dev/playground dev     # react harness, own index.html
pnpm --filter @loom-dev/interactive dev    # plugin only, no index.html
pnpm --filter @loom-dev/gallery-demo dev   # plugin gallery mode
```

To embed the gallery in a host toolchain (a docs site, a design-system portal)
rather than run it as its own program, `loom-dev/embed` exposes both pipelines
programmatically:

```ts
import { buildGallery, createGalleryServer } from "loom-dev/embed";

// dev: mount on the host's own dev server
const gallery = await createGalleryServer({
  root: "../my-ui",
  targets: "src/scenes",
  base: "/loom-preview/",
});
hostServer.middlewares.use(gallery.middleware);

// build: emit the static gallery next to the host's own output
await buildGallery({
  root: "../my-ui",
  targets: "src/scenes",
  outDir: "dist/loom-preview",
});
```

The gallery keeps a Vite instance of its own — the plugin rewrites `react` and
`@rbxts/*` for the whole config it lives in, so the host forwards HTTP and
nothing else.

### In a Next.js app

Next.js can't mount the embed middleware on its dev server, so `loom-dev/next`
wraps the same isolated gallery in a config-level integration instead:

```ts
// next.config.ts
import { withLoomGallery } from "loom-dev/next";

export default withLoomGallery(
  { /* your Next config */ },
  { root: "../my-ui", targets: "src/scenes" },
);
```

That one wrapper is the whole setup, dev and build both — the Astro-embed
treatment, not a config kit:

- `next dev` lazily boots the gallery on its own ephemeral port and proxies
  `/loom-preview/*` to it through `rewrites()` — full HMR, and the host app's
  React (18, 19, whatever Next wants) is never touched, because the loom
  aliases live entirely in the gallery's own Vite instance. Works with webpack
  and Turbopack alike: the integration sits at Next's routing layer, not its
  bundler.
- `next build` emits the static gallery into `public/loom-preview`
  automatically (add it to `.gitignore`; `staticBuild: false` opts out for a
  CI that runs `loom build` itself), and `next start` just serves it — the
  wrapper's rewrite maps the bare mount path onto its `index.html`.

Options: `base` (default `/loom-preview/`), `port`, `hmrPort`, `staticBuild`,
`shims` (paths relative to `root` — see [Package compatibility](#package-compatibility)).
`base` is the mount **relative to the Next app**; a `basePath` is added to it
automatically (see [below](#deploying-under-a-basepath-github-pages)).
The wrapper returns a Next *function config* (phase-aware), and accepts yours
as an object or function — apply it outermost when composing wrappers, e.g.
around Fumadocs' `createMDX`:

```ts
// next.config.mjs of a Fumadocs site
export default withLoomGallery(withMDX(config), {
  root: "../my-ui",
  targets: "src/scenes",
});
```

Verified against both harnesses in `apps/`: `next-demo` (Next 15, pages
router, webpack, React 18) and `fumadocs-demo` (Fumadocs 16 on Next 16, App
Router, Turbopack, React 19, `proxy.ts` middleware) — the integration sits at
the routing layer, so none of those axes touch it.

Deep links keep working in both modes through the same `?target=<relPath>` /
`?chrome=none` URL contract, e.g. an
`<iframe src="/loom-preview/?chrome=none&target=src/scenes/Card.loom.tsx" />`
in a page. The `apps/next-demo` workspace app is a running example
(`pnpm --filter @loom-dev/next-demo dev`).

#### Deploying under a `basePath` (GitHub Pages)

A project site on GitHub Pages serves the whole app below the repository path,
which Next models as `basePath`. Loom reads it off the **resolved** Next config
— after wrappers like Fumadocs' `createMDX` have run — and generates the
gallery for the URL the browser really uses. Nothing loom-specific to add:

```js
// docs/next.config.mjs
const isProduction = process.env.NODE_ENV === "production";

const config = {
  output: "export",
  basePath: isProduction ? "/rbxts-react-clean-ui" : "",
  images: {
    unoptimized: true,
  },
};

export default withLoomGallery(withMDX(config), {
  root: "..",
});
```

That deploys to `https://<user>.github.io/rbxts-react-clean-ui/loom-preview/`,
with every script, stylesheet, lazily imported scene chunk and runtime URL
(the WASM layout engine included) generated for that prefix.

The two bases stay separate, and only one of them is yours to set:

| | what it is | who sets it |
| --- | --- | --- |
| Next `basePath` | the prefix the whole site is deployed under | you, in the Next config |
| loom `base` | the gallery mount **relative to the app** (default `/loom-preview/`) | you, only to move the mount |
| generated gallery base | `basePath` + `base` | loom, automatically |

So do **not** repeat the deployment prefix in loom's `base` — with
`basePath: "/docs"`, a `base: "/docs/loom-preview/"` deploys the gallery at
`/docs/docs/loom-preview/` (loom warns when it sees that shape). Custom mounts
compose the same way: `base: "previews"` under `basePath: "/docs"` serves at
`/docs/previews/`.

The static output is unchanged by any of this: `next build` still writes
`public/loom-preview` (or `public/previews`), never
`public/rbxts-react-clean-ui/…`. The `basePath` is a URL prefix Next applies
when it serves `public/`, not a directory.

One thing loom cannot fix for you is a **literal** iframe URL in MDX or JSX:

```mdx
<iframe src="/loom-preview/?chrome=none&target=src/Scenes/Button.loom.tsx" />
```

That string never passes through `next/link` or Next's router, so nothing
prefixes it, and it keeps pointing at the domain root once deployed. Put the
prefix in one project-level constant instead:

```ts
// lib/site-config.ts
export const siteBasePath =
  process.env.NODE_ENV === "production" ? "/rbxts-react-clean-ui" : "";
```

```mdx
import { siteBasePath } from '@/lib/site-config';

<iframe
  src={`${siteBasePath}/loom-preview/?chrome=none&target=src/Scenes/Button.loom.tsx`}
/>
```

`apps/fumadocs-demo` does exactly this (`lib/site-config.ts`), and runs under a
prefix on demand:

```sh
LOOM_DEMO_BASE_PATH=/rbxts-react-clean-ui pnpm --filter @loom-dev/fumadocs-demo dev
```

#### Fumadocs with a sibling Loom source tree

A docs app can live inside the Roblox UI project:

```text
react-clean-ui/
├── docs/          # Next.js + Fumadocs
│   └── next.config.mjs
├── out/           # compiled Luau
└── src/           # roblox-ts source
    └── Scenes/
        └── Button.loom.tsx
```

Apply the Loom wrapper outermost. Relative `root` values are resolved from the
Next app directory while `next.config.*` is evaluated, so `root: ".."` selects
`react-clean-ui`, not `react-clean-ui/docs` or Loom's installed package:

```js
// docs/next.config.mjs
import { withLoomGallery } from "loom-dev/next";

export default withLoomGallery(withMDX(config), {
  root: "..",
});
```

Gallery targets use an explicit named `preview` export; a normal default React
component is not a gallery entry:

```tsx
// src/Scenes/Button.loom.tsx
import React from "@rbxts/react";
import { Button } from "../Components";

export const preview = {
  render: () => <Button text="Hello World" />,
  title: "Button",
} as const;
```

Loom configures Vite's automatic JSX runtime, so the `React` import is optional
when the file uses only JSX. Keep it when the scene also references the
`React` namespace.

Open the full gallery at `http://localhost:3000/loom-preview` or embed one
target without gallery chrome:

```text
http://localhost:3000/loom-preview?chrome=none&target=src/Scenes/Button.loom.tsx
```

Development galleries support Windows, macOS, and Linux paths.

#### Gallery URL parameters

The same query contract works on the dev server and the static build:

| param | values | what it does |
| --- | --- | --- |
| `target` | a target's path relative to the root | selects the target to show |
| `chrome` | `none` | drops the sidebar and renders one target full-bleed |
| `theme` | `light`, `dark` (default) | picks the palette, and seeds `PlayerGui.LoomTheme` |
| `background` | any CSS colour | paints the stage that exact colour |
| `debug` | `1` (or bare `?debug`); `0` is off | opens the debug panel over the stage |
| `base` | a width in px (or bare `?base` for 960); off by default | lays the scene out at that logical width and paints it scaled to fit |

By default a preview lays the scene out against the stage's real pixels at
every size, so a narrow stage reflows exactly as the engine reflows at that
viewport — text re-wraps, a `UIListLayout` with `Wraps` re-flows,
`AutomaticSize` re-measures. `?base=` opts out of that: the scene keeps a
logical viewport of the width you give and the whole stage is scaled down to
fit, so it stays composed the way it was written and is simply drawn smaller.
That is what you want for a thumbnail of a wide dashboard in a narrow column,
and what you do *not* want when the narrow viewport is the thing you are
checking. The debug panel's **viewport** section shows both boxes and the
factor between them.

`theme` chooses between loom's own two backdrops (`#14161a` and `#f6f9fc`);
`background` overrides just that backdrop with a colour of your own, leaving
the chrome and text to `theme`. So a white stage that also reads as light is
`?theme=light&background=white`.

A `#` opens the URL fragment, so a literal `?background=#ffffff` never reaches
the gallery. Write hex either percent-encoded or bare — `?background=%23ffffff`
and `?background=ffffff` are the same colour — or use a name (`white`), an
`rgb()` / `oklch()` / `light-dark()` form, or `transparent` to let the host
page's own background show through the iframe. Only colours are accepted;
anything else (a gradient, a `url(...)`) is ignored and the theme's backdrop
stands.

Both are settled from the URL by the generated page itself, before the first
paint — an iframe that reloads with new params comes up on its final backdrop
rather than flashing loom's dark default while the bundle loads.

A host page that switches theme at runtime can skip the reload entirely and
`postMessage` the embedded iframe — `{ type: "loom-theme", theme: "light" }`
for the palette, `{ type: "loom-background", background: "white" }` for the
backdrop. Posting `{ type: "loom-background" }` with no colour hands the
backdrop back to the theme. (A param that drives the *scene* rather than the
gallery — a control that picks your own component's theme, say — still needs
the reload; only the backdrop is switchable in place.)

#### Debug mode

Every gallery has a debug panel: the `debug` button in the sidebar header,
**Ctrl+Alt+D**, or `?debug=1` on any gallery URL (including a `chrome=none`
embed). It is off by default, and while it is closed nothing it does runs at
all — no observers, no timers, no tree walks.

Open, it reports — each section folds away, and keeps reporting its one number
when folded:

- **target** — the target's path and title, how long its `import()` took, and
  how long from the mount to the first frame on screen. The panel's `↻` button
  re-mounts the active target, which is how those timings are taken for a
  target that was already up when the panel opened.
- **viewport** — the stage in real pixels, the *logical* viewport the scene
  actually laid out against, `Workspace.CurrentCamera.ViewportSize`, the scale
  factor and the `?base=` width behind it, the device pixel ratio, and the
  theme. They agree unless the page asked for a `?base=` viewport, which is how
  you tell a scene that laid out small from one that was painted small.
- **scene** — live instances, how many of them are GuiObjects (and how many of
  those are invisible, which is usually why a scene looks empty), tree depth,
  the DOM nodes it became, a count per class, and each layer with its
  `DisplayOrder` and size.
- **fonts** — every typeface the scene's text resolved to, with the weights
  asked for and whether the browser really **loaded** it or fell back. A family
  that never arrived still paints, just at another face's metrics, so this is
  the row that explains a layout that only differs on one machine.
- **frame** — frame rate, DOM patches committed since the panel opened, and a
  count of what loom logged (its warnings explain a scene, and nobody reads the
  console).
- **inspect** — hover the stage and the panel names the GuiObject under the
  pointer, outlines it with its size, and lists its ancestry, absolute
  geometry, `UI*` modifiers, resolved typeface and properties — colours as
  swatches, everything else typed and coloured. **Alt+click pins** the
  selection so it stops following the pointer (Escape releases it); the
  ancestry trail and the *under* rows — everything else the pointer is over —
  are clickable, so you can walk the tree. The hit test is the scene's own
  (`PlayerGui:GetGuiObjectsAtPosition`), so a click-through frame no browser
  inspector can reach is still inspectable here.

`copy` puts the readout on the clipboard as text. `json` downloads the whole
thing as a file — every section as data, plus the complete instance tree with
each object's absolute position and size, which is what an issue wants instead
of a screenshot of a panel. The same object is available while the panel is
open as `loomDebug.snapshot()`, so a devtools session or a headless harness can
take one too.

The toggle is remembered for the tab, so the full reload the gallery takes on
every edit doesn't close it behind you. Embeds (`chrome=none`) deliberately do
not remember it — a debug panel on a docs page is only ever one you asked for
with `?debug=1`.

#### Gallery troubleshooting

- A black page plus a Vite error mentioning the gallery `shell.ts` or a
  malformed `/@fs/` URL is a shell-loading/path failure: the gallery UI never
  started. Current Loom releases generate Vite filesystem URLs for both POSIX
  and Windows paths.
- `invalid preview export in <target>` means the target module loaded, but it
  did not export `const preview = { render, title }`. Use the complete target
  example above; a default export alone is intentionally unsupported.
- `no *.loom.tsx targets found` (and the matching terminal warning) means
  `root` resolved successfully but no file matched `targets`. Check the root,
  filename suffix, and any configured target glob or directory.

## Package compatibility

Loom runs a roblox-ts source tree in a browser, so every package the tree
imports has to have something a browser can execute. Most roblox-ts packages
do: their `"main"` points at compiled Luau (`out/init.luau`), and loom
redirects them to their own TypeScript source at `src/index.ts(x)` — whether or
not the Luau was ever compiled. That is automatic and needs no configuration.

A **declaration-only** package has nothing to redirect to: a Luau runtime plus
`.d.ts` files and no TypeScript implementation —

```json
{ "main": "src/init.lua", "types": "src/index.d.ts" }
```

Declaration files are types, not code, and executing the Luau in a browser is
not an option, so such a package can only be answered by a browser module that
stands in for it. Loom ships that module for the packages whose browser meaning
is unambiguous, and lets you supply one for anything else.

### Built-in: `@rbxts/react`

Loom exposes the complete browser-meaningful runtime surface of the supported
`@rbxts/react` version (currently **17.3.7-ts.2**), forwarding standard React
APIs to one pinned React instance and adapting Roblox-specific APIs where
necessary. An existing roblox-ts React file compiles and runs unchanged:

```tsx
import React, {
  Component,
  PureComponent,
  ReactComponent,
  ReactPureComponent,
  createContext,
  createElement,
  createRef,
  forwardRef,
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "@rbxts/react";
```

#### Standard React

`Children`, `Component`, `PureComponent`, `Fragment`, `Profiler`,
`StrictMode`, `Suspense`, `cloneElement`, `createContext`, `createElement`,
`createRef`, `forwardRef`, `isValidElement`, `lazy`, `memo` and every hook come
straight from loom's own React 18 — **by identity**, not through wrappers:

```ts
import ReactDefault, { Component, useState } from "@rbxts/react";
import * as BrowserReact from "react";

ReactDefault.Component === Component; // true
Component === BrowserReact.Component;  // true
useState === BrowserReact.useState;    // true
```

That matters because `@loom-dev/react` is a `react-reconciler` host config: a
second React copy would mean a second hook dispatcher, and every function
component would throw *Invalid hook call*. Loom pins its React by absolute-path
alias, so a project that hoists React 19 for its own use keeps it — the gallery
still renders on loom's React 18.

#### `ReactComponent` / `ReactPureComponent`

Both decorators are the **identity function**. React-Lua needs them because it
has no `class` statement — upstream copies the decorated table onto a fresh
`Component:extend(...)`. Browser React already recognises a class that extends
`Component`, so loom hands the constructor straight back: nothing is wrapped or
subclassed, statics and `displayName` keep their identity, the prototype chain
is untouched, and the constructor is never invoked.

```tsx
@ReactComponent
export class Column extends Component<{ gap?: number }> {
  render() {
    return <frame />;
  }
}

Column === ReactComponent(Column); // true
```

Both TypeScript decorator dialects work: `experimentalDecorators` (what
roblox-ts projects enable) and TC39 standard decorators.

#### `Event`, `Change`, `Tag`

The handler-table props work as upstream documents them, and the renderer reads
them directly:

```tsx
<textbutton
  Event={{ Activated: (rbx) => print(rbx) }}
  Change={{ AbsoluteSize: (rbx) => print(rbx.AbsoluteSize) }}
  Tag="surface"
/>
```

`React.Event`, `React.Change` and `React.Tag` also exist as runtime values, and
the named imports are the same values as the ones on the default export:

```tsx
import { Change, Event, Tag } from "@rbxts/react";

<textbutton {...{ [Event.Activated]: onClick, [Tag]: "surface" }} />;
```

`Event` and `Change` mint a prefixed prop key for any signal or property name.
`Tag` is a single key, matching upstream, and it writes to a real
`CollectionService` in loom's runtime — `AddTag`, `RemoveTag`, `HasTag`,
`GetTags`, `GetTagged`, `GetAllTags`, `GetInstanceAddedSignal` and
`GetInstanceRemovedSignal` all work, and the tag is retracted when the element
unmounts. What a preview has no equivalent for is Studio's tag editor, so tags
only ever come from code.

#### Bindings

`createBinding`, `useBinding` and `joinBindings` come from `@loom-dev/react` —
the implementation the renderer resolves — so there is exactly one kind of
binding. A binding minted by `React.useBinding` and one minted by
`@rbxts/react-ripple`'s `useSpring` are the same object to the renderer, and
any host prop accepts a plain value or a `Binding` of one.

#### `React.None`

**Intentionally unsupported, and it says so.** React-Lua uses `None` to *delete*
a key from class-component state. React's update queue merges partial state with
`Object.assign({}, prev, partial)`, which can add and overwrite keys but never
remove one, and the only place that could change is `Component` itself — which
has to stay identical to browser React's for hooks and the reconciler to work.

`None` is still a real, importable value (`React.None === None`), so code that
merely mentions it keeps compiling. Using it in `setState` throws immediately,
naming the offending key, instead of letting the sentinel settle into state and
corrupt a render later. Set the field to `undefined` and treat that as absent,
or move the state into a hook where you own the whole value.

#### JSX runtime entrypoints

`@rbxts/react`, `@rbxts/react/jsx-runtime` and `@rbxts/react/jsx-dev-runtime`
all converge on the same React instance, as do bare `react`,
`react/jsx-runtime` and `react/jsx-dev-runtime`. Classic
(`React.createElement("frame")`) and automatic (`<frame />`) JSX both work; loom
configures the automatic runtime by default, so the `React` import is optional
in a file that only uses JSX.

Any other subpath is a compatibility boundary loom names rather than guesses at:

```text
[loom] The @rbxts/react subpath "@rbxts/react/internal" is not supported by
Loom's browser compatibility layer.

Supported entrypoints:
- @rbxts/react
- @rbxts/react/jsx-runtime
- @rbxts/react/jsx-dev-runtime
```

#### `@rbxts/react-roblox`

The root import is answered by loom's preview client, covering every value
upstream declares: `createRoot` (and its React 17 flavours `createBlockingRoot`
and `createLegacyRoot`, which map onto the same root because loom commits
synchronously either way), `createPortal`, `act`, `version`, and a root's
`render` / `unmount`. `RootOptions` is accepted and ignored — every field is
React-Lua hydration machinery with no browser meaning. Unsupported subpaths get
the same named diagnostic as above.

#### Intentional differences from React-Lua

| Upstream | Under loom |
| --- | --- |
| `ReactComponent` re-creates the class via `Component:extend` | identity — browser React already accepts the class |
| `createElement` lower-cases host tags and folds `Event`/`Change`/`Tag` into keyed props | `createElement` is browser React's own; the renderer reads those props directly |
| `React.None` removes a state key | throws a loom error (see above) |
| `React.Tag` reaches Studio's CollectionService | loom's own CollectionService: code-set tags only, no tag editor |
| React 17 semantics | React 18 — loom also exposes `act`, `startTransition`, `useId`, `useDeferredValue`, `useInsertionEffect`, `useSyncExternalStore`, `useTransition`, `version` and `createFactory`, which **roblox-ts will reject** when the same file is compiled for Roblox |
| `createMutableSource` / `useMutableSource`, `unstable_DebugTracingMode`, `unstable_LegacyHidden`, `unstable_parseReactError`, `__subscribeToBinding` | not exposed — React 17 experiments or React-Lua internals with no browser counterpart |

The runtime surface is derived from upstream rather than hand-listed: a contract
test parses `@rbxts/react`'s own `index.d.ts` with the TypeScript compiler API
and fails if a declared runtime export is missing, and every deliberate omission
carries a written reason. See `packages/preview/src/compat/react.contract.test.ts`.

### Built-in: `@rbxts/ui-labs`

The root import works with **no configuration at all** — no `shims` entry, no
local compatibility file:

```ts
import { Environment } from "@rbxts/ui-labs";
```

Loom models the **non-story** environment, which is exactly how UI Labs itself
behaves when the same code runs outside a story:

- `Environment.IsStory()` returns `false`.
- `Environment.InputListener` is `undefined` (it is story-only).
- `Environment.UserInput` is loom's `UserInputService` — the same object
  `game.GetService("UserInputService")` returns, never a copy.
- `Unmount`, `Reload`, `CreateSnapshot` and `SetStoryHolder` are no-ops, and
  `GetJanitor()` returns `undefined`, so ordinary cleanup code doesn't fail.

So the usual reusable-input guard picks loom's own service, with nothing to
configure:

```ts
import { Environment } from "@rbxts/ui-labs";
import { UserInputService } from "@rbxts/services";

export const InputService = Environment.IsStory()
  ? Environment.InputListener
  : UserInputService;
```

This is compatibility for that one import, **not** support for UI Labs. Loom is
not the Studio plugin and a loom scene is not a story, so story creators
(`CreateReactStory` and friends), controls, snapshots, sandbox injection, story
mounting, hot-reload internals and the plugin APIs are not emulated — importing
one fails with the normal ESM missing-export error, which is far better than a
stub that behaves differently than it does in Studio. Subpaths
(`@rbxts/ui-labs/controls`) are not covered either.

To replace loom's implementation with your own, declare a shim: user shims are
matched first.

```ts
loomPreview({
  shims: { "@rbxts/ui-labs": "./loom-shims/ui-labs.ts" },
})
```

### Built-in: `@rbxts/ripple` and `@rbxts/react-ripple`

Both root imports work with **no configuration**:

```tsx
import { config, useSpring } from "@rbxts/react-ripple";

function AnimatedButton() {
  const [offset, spring] = useSpring(0, config.stiff);

  return (
    <textbutton
      Size={offset.map((value) => UDim2.fromOffset(200 + value, 50 + value))}
      Event={{
        MouseEnter: () => spring.setGoal(10),
        MouseLeave: () => spring.setGoal(0),
      }}
    />
  );
}
```

Ripple publishes a Luau runtime and a `.d.ts` (`"main": "src/init.luau"`) — no
browser-executable code — so loom answers both packages with a **port** of the
published implementation, not a stub. The spring integrator, the easing curves,
the Oklab colour interpolation and the rest thresholds all follow the Luau
source, so a component animates the same way it does in Roblox.

Animation runs on loom's own frame loop: controllers connect to
`RunService.Heartbeat` — one listener shared by every spring, tween and motion,
released the moment the last one settles — and push values into a React
*binding*, which the renderer writes straight onto the live instance. A 60fps
animation is 60 property writes and **zero** React renders.

**Supported exports.** `createSpring`, `createTween`, `createMotion`, `config`,
`easing`, `springScheduler`, `tweenScheduler`, `motionScheduler`, and the
`useSpring` / `useTween` / `useMotion` hooks (which also re-export the core, as
the real package does). Every published `config` preset and every published
`easing` curve is implemented.

**Supported controller methods**, matching the published `.d.ts`:

| | methods |
| --- | --- |
| all three | `getPosition` `getGoal` `setPosition` `setGoal` `onChange` `onComplete` `step` `idle` `configure` `start` `stop` `destroy` |
| `Spring` / `Motion` | `getVelocity` `setVelocity` |
| `Spring` | `impulse` `halt` |
| `Tween` | `getFrom` `setFrom` |
| `Motion` | `spring` `tween` |

Every documented option is honoured: `start`, `tension`, `friction`, `mass`,
`dampingRatio`, `frequency`, `precision`, `restVelocity`, `position`,
`velocity`, `impulse` (spring); `start`, `easing`, `duration`, `repeats`,
`reverses`, `position` (tween); `start`, `spring`, `tween` (motion).

**Supported values.** `number`, `Vector2`, `Vector3`, `Color3`, `UDim`,
`UDim2`, `Rect`, and records of numbers (which accept partial goals — keys you
leave out don't move). `Color3` interpolates through Oklab, and `UDim`/`UDim2`
offsets round to integers, both as Roblox does.

**Not supported.** `CFrame` throws rather than animating:

```text
[loom] Ripple compatibility does not yet support animating CFrame
```

loom's `CFrame` carries position only and the Scene IR has no property slot for
one, so an interpolation could not reach the screen. Anything else — a string,
a record of non-numbers — throws by name too, instead of freezing or producing
a corrupt value. Subpaths (`@rbxts/ripple/foo`) are not covered.

Two deliberate differences from upstream, both in loom's favour:

- `destroy()` also drops the controller's `onChange` / `onComplete` callbacks
  (upstream only stops it), so a torn-down controller can't call into an
  unmounted component.
- The hooks ignore a changed `initialOptions` after mount, exactly as upstream
  does — recreating a controller mid-animation would drop its velocity and its
  subscribers. Call `controller.configure(...)` to retune one in place.

Bindings themselves are part of the React adapter, not this shim:
`createBinding`, `useBinding` and `joinBindings` are exported from
`@rbxts/react`, and any host prop accepts a plain value or a `Binding` of one.

To replace loom's implementation with your own, declare a shim — user shims win:

```ts
loomPreview({
  shims: { "@rbxts/react-ripple": "./loom-shims/react-ripple.ts" },
})
```

### Built-in: `@rbxts/services`

`@rbxts/services` needs no configuration either: the specifier is aliased to
loom's own service singletons, and every export is the same object
`game.GetService(...)` returns — never a copy.

```ts
import { HttpService, RunService, UserInputService } from "@rbxts/services";

HttpService === game.GetService("HttpService"); // true
```

The exported services are the ones loom implements for the browser:

| Service | What loom provides |
| --- | --- |
| `CollectionService` | the real tag registry (code-set tags; no Studio tag editor) |
| `ContextActionService` | `BindAction` / `BindActionAtPriority` / `UnbindAction` as no-ops |
| `Debris` | `AddItem(instance, lifetime)` on a real timer |
| `GuiService` | `SelectedObject` with selection signals, `GetGuiInset`, `ReducedMotionEnabled` |
| `HttpService` | `GenerateGUID` and the JSON pair — see below |
| `Players` | `LocalPlayer` with a pre-built `PlayerGui` |
| `RunService` | `RenderStepped` / `Heartbeat` / `PostSimulation`, `IsStudio` / `IsRunning` / `IsClient` |
| `StarterGui` | a real container; `SetCore` / `GetCore` / `SetCoreGuiEnabled` as no-ops |
| `TextService` | `GetTextSize` / `GetTextBoundsAsync`, measured with the renderer's own fonts |
| `TweenService` | `Create` and real tween playback |
| `UserInputService` | input signals, `GetMouseLocation`, `GetFocusedTextBox`, capability flags |
| `Workspace` | `CurrentCamera` with a live `ViewportSize` |

Plus the services that are only *containers* in a client, exported so a tree can
be parented into them: `Lighting`, `ReplicatedFirst`, `ReplicatedStorage`,
`ServerScriptService`, `ServerStorage`, `SoundService`, `StarterPack`,
`StarterPlayer` and `Teams`.

`TextService` measures through the same font stack the renderer paints with, so
a component that reserves room for a label agrees with the label it then draws:

```ts
const bounds = TextService.GetTextSize(
  "Hello world",
  18,
  Enum.Font.SourceSans,
  new Vector2(200, 1000),
);
```

That list is deliberate rather than exhaustive. Importing a service loom does
*not* implement fails with the normal ESM missing-export error, which is better
than a stub that quietly does nothing in a scene you are trying to trust.

#### `HttpService`

```ts
import { HttpService } from "@rbxts/services";

const id = HttpService.GenerateGUID(false);
```

- `GenerateGUID(wrapInCurlyBraces?)` returns an RFC 9562 (RFC 4122) **version 4
  UUID**, lowercase, in canonical `8-4-4-4-12` form, fresh on every call.
- `wrapInCurlyBraces` defaults to **`true`**, as in Roblox:
  `GenerateGUID()` and `GenerateGUID(true)` return
  `{xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx}`, `GenerateGUID(false)` returns the
  bare 36 characters.
- Entropy comes from the **Web Crypto API** — `crypto.randomUUID()` when the
  browser offers it (it is secure-context only), otherwise
  `crypto.getRandomValues()` with the version and variant bits set explicitly.
  Never `Math.random`, never a timestamp or a counter. Without Web Crypto it
  throws rather than generating a weak identifier:

  ```text
  [loom] HttpService.GenerateGUID requires the Web Crypto API
  ```

- `JSONEncode(value)` / `JSONDecode(value)` are `JSON.stringify` /
  `JSON.parse` — loom's values *are* JavaScript values, so what roblox-ts
  writes as an array or an object encodes exactly as it does in Studio.
  `JSONEncode(undefined)` yields `"null"`; a malformed `JSONDecode` input
  throws a loom error rather than returning `undefined`.

**No networking is implied.** A loom preview renders in a browser and never
issues requests on your behalf, so `GetAsync`, `PostAsync` and `RequestAsync`
throw by name — a preview says why it can't run that code instead of silently
doing nothing or firing a request while documentation renders. `UrlEncode` is
absent on purpose: the engine encodes more than `encodeURIComponent` does (`.`
becomes `%2E`), and a near-miss encoder is worse than an honest omission.

### Roblox datatypes

The datatypes roblox-ts code reaches as globals (`UDim2`, `Color3`, `Vector2`,
`Font`, `TweenInfo`, …) are loom's own, installed before any app module runs.

#### `Color3.fromHex`

```ts
const accent = Color3.fromHex("#6366F1");
```

Accepts **exactly six** RGB hex digits, in either case, with or without one
leading `#` — `"6366F1"`, `"6366f1"`, `"#6366F1"`, `"#6366f1"` all give the
same color. Channels then go through `Color3.fromRGB`, so rounding and clamping
match every other color in the scene.

Anything else throws instead of guessing:

```text
[loom] Color3.fromHex expected exactly 6 hexadecimal digits, received "#FFF"
```

CSS shorthand (`#FFF`), an alpha channel (`#FFFFFFFF`), `0x` notation and
surrounding whitespace are all rejected — accepting them would render a color
the same source never shows in Studio.

#### `Color3:ToHex()` and the HSV pair

```ts
Color3.fromRGB(99, 102, 241).ToHex(); // "6366f1"
```

Six **lowercase** hexadecimal digits, no leading `#` — verified against a running
engine rather than guessed at, along with its rounding (each channel is clamped
to 0…1 and rounded to the nearest 255th, so `Color3.fromHex(c.ToHex())` is `c`
again). `ToHSV()` destructures as a tuple (`const [h, s, v] = color.ToHSV()`) and
`Color3.fromHSV(h, s, v)` is its inverse.

The other datatype members that come with them: `Vector2`'s `Unit` / `Dot` /
`Cross` / `Lerp` / `Min` / `Max` / `Abs` and its `xAxis` / `yAxis` constants,
`Vector3`'s `Unit` / `Dot` / `Cross` / `Lerp` and axis constants, and
`UDim2:Lerp`. `UDim` has no `Lerp` here because it has none in the engine.

### The Luau standard library

The whole environment roblox-ts output expects is installed as globals, so code
that calls it with no import runs as written: the `math`, `string`, `table`,
`os`, `bit32`, `utf8`, `buffer` and `debug` libraries, `task`, `pcall` /
`xpcall`, `pairs` / `ipairs` / `next`, `select`, `unpack`, `rawget` / `rawset` /
`rawequal` / `rawlen`, `typeIs` / `typeOf`, `tostring` / `tonumber`, `assert`,
`warn` and an inert `coroutine`.

**Positions stay 1-based**, as they are in Luau: `table.insert(list, 1, x)` puts
`x` at the front, `table.find` and `string.find` return 1-based indices, and
`table.concat(list, sep, i, j)` includes both ends. These are not roblox-ts
macros — the compiler passes their arguments straight to the engine, so the
number written in the source is already a Luau index. The array *methods*
roblox-ts does compile as macros are the other way round: `list.remove(0)`
drops the first element, and `table.remove(list, 1)` drops that same one.

`table` is complete: `insert`, `remove`, `find`, `concat`, `sort`, `create`,
`clear`, `clone`, `freeze`, `isfrozen`, `pack`, `unpack` and `move`, over
arrays, `Map`s, `Set`s and plain objects — plus the Lua 5.1 leftovers Roblox
still exposes and marks deprecated, `getn`, `maxn`, `foreach` and `foreachi`
(deprecated here too, and present for the same reason: old code calls them).
`sort` takes Luau's *predicate* comparator, not a JS one — `comp(a, b)` is true
when `a` comes first:

```ts
table.sort(players, (a, b) => a.score > b.score);
```

Where the engine would raise an error, loom leans forgiving instead, so a
preview renders rather than dying over an off-by-one: an out-of-range `insert`
position clamps, an out-of-range `remove` returns `nil` and mutates nothing, and
`concat` stringifies whatever it is given. `freeze` is `Object.freeze` — enough
for arrays and objects, but it cannot stop `Map.set`.

#### Where the rest differs from the engine

Everything below is a deliberate choice, not a gap:

- **Strings are JS strings.** Luau's are byte strings, so `string.len`,
  `string.byte` and every index count UTF-16 code units here, not bytes. ASCII
  is identical either way. `utf8.len`, `utf8.char` and `utf8.codepoint` deal in
  code points and match exactly; the positions `utf8.codes`, `utf8.offset` and
  `utf8.graphemes` return are code-unit positions — the ones `string.sub` on
  that same string wants.
- **Patterns are a subset.** `find`, `match`, `gmatch` and `gsub` translate
  literals, `%w`-style classes, bracket sets, `.`, the `+*-?` quantifiers and
  the edge anchors; anything richer (`%b`, `%f`, negated classes) is treated as
  literal text rather than silently mismatched.
- **`string.match` is not patched onto `String.prototype`.** JS already defines
  `match` there with different semantics, and these patches are page-wide —
  forcing it would rewrite `match` for React and Vite too. Call
  `string.match(s, pattern)`, which is the form roblox-ts code writes anyway.
  The other Luau string methods (`sub`, `gsub`, `gmatch`, `byte`, `len`,
  `reverse`, `format`, …) are patched on and work off a string receiver.
- **`math.randomseed` really seeds.** `Math.random` cannot be, so seeding
  switches `math.random` to a small deterministic generator — same seed, same
  sequence. The numbers are loom's, not the engine's.
- **`os.date` is a strftime subset** (`%a %A %b %B %c %d %H %I %j %m %M %p %S
  %x %X %y %Y %%`, plus `*t` and the `!` UTC prefix). An unknown specifier is
  left as written.
- **`bit32` follows Luau on shifts.** A displacement of 32 or more clears the
  value, where JS would mask the count to 5 bits and shift by nothing.
- **`debug` profiling is wired to the browser.** `profilebegin`/`profileend`
  become a `performance.measure` the devtools Performance panel shows;
  `setmemorycategory` and `resetmemorycategory` are no-ops, and `debug.info`
  returns an empty tuple because there is no Luau VM to interrogate.
- **`buffer` is bounds-checked and little-endian**, like the engine's, and
  `typeOf` answers `"buffer"` for one.
- **There is no `setmetatable` / `getmetatable` / `newproxy`.** Loom runs the
  author's TypeScript, whose classes are JS classes; giving a plain object a
  metatable's `__index` behaviour would mean proxying every table in the
  program, and a half-working metatable is worse than an honest omission.

### `shims`

For any other package loom can't run, point the specifier at a browser module
you write:

```ts
// vite.config.ts
loomPreview({
  shims: { "@rbxts/example": "./loom-shims/example.ts" },
})
```

Targets are absolute paths, paths relative to the project root, or bare package
ids. Matching is **exact** — `@rbxts/example` does not capture
`@rbxts/example/controls`, which keeps a partial shim from silently answering
for a subpath it was never written for. List the subpath separately when you
mean to cover it. Shims are matched before every one of loom's own aliases, so
they can also override the built-in `@rbxts/*` ones — including the built-in
compatibility above.

The same option exists on every entry path, since they all share one Vite
config: `loom.config.ts` (`loom preview` / `loom build`), `createGalleryServer`
and `buildGallery` in `loom-dev/embed`, and `withLoomGallery()` in
`loom-dev/next`.

```ts
// loom.config.ts — for the CLI
export default {
  targets: "src/scenes",
  shims: { "@rbxts/example": "./loom-shims/example.ts" },
};
```

### Writing a shim

Model what the package means *here*, and only the slice your code uses. Import
loom's own modules the way app code does — `@rbxts/services` is aliased to
loom's service singletons, so a shim that re-exports one hands back the same
object `game.GetService(...)` returns. Never construct a second service.

```ts
// loom-shims/example.ts
import { UserInputService } from "@rbxts/services";

export const listener = UserInputService;
```

Leaving the rest out is the point: an import of something you didn't shim fails
with the normal ESM missing-export error, which beats a stub that behaves
differently than it does in Studio.

A package loom can't run and you haven't shimmed says so directly:

```text
[loom] Package "@rbxts/example" only provides a Lua/Luau runtime
("src/init.lua") and cannot run in the browser.
Imported by /project/src/app.ts

Provide a browser-compatible replacement with:

loomPreview({
  shims: {
    "@rbxts/example": "./loom-shims/example.ts",
  },
});
```

That message replaces what you would otherwise get: Vite's opaque `Failed to
resolve entry for package`, or — worse, and only during `vite build` — Rollup
trying to *parse* the Luau as JavaScript:

```text
RollupError:
../node_modules/@rbxts/example/src/init.luau (1:6):
Expected ';', '}' or <eof>
```

Both mean the same thing: the package's npm runtime is `.lua`/`.luau`, so loom
needs a **browser runtime adapter** for it — either one loom ships (the
built-ins above) or one you supply through `shims`. Nothing can be inferred
automatically; Luau is not JavaScript, and a `.d.ts` is types rather than code.

Worth knowing: this can surface *only* in the static build. A gallery target is
a lazy `import()`, so the dev server never fetches a scene you don't open, while
`loom build` (and `next build`) follows every target eagerly to code-split it.
A gallery that runs fine in development can still fail the build — which is why
loom applies the same aliases and the same resolver in both modes.

## Layouts

Every `UIGridStyleLayout` the engine has is implemented: `UIListLayout` (with
`Wraps` and the flex properties), `UIGridLayout`, `UITableLayout` and
`UIPageLayout`. The geometry was read off a running engine, not inferred.

> **`SortOrder` defaults to `Name`**, as it does on a fresh layout in Studio — so
> a list whose children carry distinct `Name`s flows *alphabetically* unless it
> says otherwise. Children with equal names keep source order (the sort is
> stable), which is why a tree that never sets `Name` is unaffected. Set
> `SortOrder={Enum.SortOrder.LayoutOrder}` for source/`LayoutOrder` order.

> **Flex shrinks as well as grows.** A `UIListLayout` line that does not wrap
> and overflows its container gives the overflow back from its `Fill` items (and
> any `UIFlexItem` set to `Shrink`, or `Custom` with a `ShrinkRatio`), never below
> a `UISizeConstraint.MinSize`; any other `UIFlexItem` keeps its size. A list that
> wraps breaks the overflow onto a new line instead, and a row with no width of
> its own (or an automatic scrolling canvas) lets it run on. One part of this is
> inferred rather than measured: Roblox documents that items shrink but not how
> the overflow is divided, and loom splits it in proportion to each item's size
> times its shrink ratio, as CSS flexbox does.

### `UITableLayout`

The layout's siblings are the table's *lines* — rows, or columns under
`MajorAxis.ColumnMajor` — and each line's own children are the cells:

```tsx
<frame Size={UDim2.new(1, 0, 0, 120)}>
  <uitablelayout Padding={UDim2.new(0, 8, 0, 4)} FillEmptySpaceColumns={true} />
  <frame Name="Row1">
    <textlabel Text="Region" Size={UDim2.fromOffset(120, 26)} />
    <textlabel Text="Players" Size={UDim2.fromOffset(100, 26)} />
  </frame>
</frame>
```

A column is as wide as its widest cell and a row as tall as its tallest, both
measured against the *table's* content box (so a `0.25` scale cell is a quarter
of the table, not of its row). `FillEmptySpaceColumns` / `FillEmptySpaceRows`
scale the tracks proportionally to span the container — in both directions, as
the engine does. A hidden cell takes neither a track nor a gap.

### `UIPageLayout`

Pages keep their own `Size` and sit one container-plus-`Padding` apart along
`FillDirection`, so a parent with `ClipsDescendants` shows exactly one. Which one
is *state*, changed by method call as in Roblox — through a ref:

```tsx
const pager = useRef<{ Next(): void; CurrentPageIndex: number }>();

<frame ClipsDescendants={true}>
  <uipagelayout
    ref={(instance) => { pager.current = instance as never; }}
    Padding={UDim.new(0, 16)}
    Circular={true}
  />
  {/* …pages… */}
</frame>;
```

`JumpToIndex(i)` / `JumpTo(page)` / `Next()` / `Previous()` all work, and fire
`PageLeave` → `PageEnter` → `Stopped`. `Circular` decides whether `Next` and
`Previous` wrap. `Animated`, `TweenTime` and the easing properties are accepted
and ignored: a preview shows the settled layout, so page changes are instant.

The engine's `CurrentPage` is a **GuiObject reference**, and a Scene IR property
value is a datatype — never a node — so it cannot cross the wasm boundary. The
layout engine reads **`CurrentPageIndex`** (a 0-based int) instead, which the
runtime keeps in step; `CurrentPage` itself still reads back as the instance for
app code, and is what a non-react adapter should set if it drives a pager itself.

## Images

`ImageLabel` and `ImageButton` paint every `ScaleType`:

| `ScaleType` | What loom paints |
| --- | --- |
| `Stretch` (default) | the image over the whole node |
| `Fit` / `Crop` | contained / covered, centred |
| `Slice` | a 9-slice from `SliceCenter`, borders scaled by `SliceScale` |
| `Tile` | repeated at `TileSize` (a `UDim2` against the node) |

`ImageRectOffset` / `ImageRectSize` window a sprite out of a sheet (a zero size
means the whole image, as in Roblox), `ImageColor3` multiplies the image per
channel, `ImageTransparency` fades it, and `ResampleMode.Pixelated` turns off
smoothing when it is scaled up.

Two combinations are **not** reproduced, and say so rather than painting
something wrong: `ScaleType.Tile` with an `ImageRect` window (CSS backgrounds
cannot repeat a *region*, so the whole image is tiled and a console warning names
the node), and a `SliceCenter` measured against a window rather than the whole
image.

### `rbxassetid://`

A browser cannot resolve an asset id by itself — Roblox's thumbnail API sends no
CORS header — so loom does the id → URL hop for it:

- **Dev server** (`loom preview`, the embedded server, Next dev): the id is
  resolved on request and answered as a redirect from `<base>__loom/asset/<id>`.
- **Static build** (`loom build`, `vite build`): there is no server later, so the
  ids the bundle mentions are resolved *at build time*, the images are downloaded
  into the output, and a `__loom/assets.json` manifest points the page at them.
  The result needs nothing but its own origin.

Only ids **written out** as `rbxassetid://<digits>` can be baked; one assembled
at runtime (`"rbxassetid://" + id`) is not in the output to find. An id that will
not resolve is warned about and skipped — the build never fails over an image.

To keep a build off the network entirely, turn the bake off wherever the build is
configured: `loomPreview({ assets: false })`, `loom build --no-assets`, or
`assets: false` on `loom-dev/embed`'s `buildGallery` and `withLoomGallery`.

Anywhere else, a host can install its own resolver with `setImageResolver` from
`@loom-dev/renderer`; plain `http(s):`, `data:` and `blob:` URLs never need one.

## Layout

- `crates/` — Rust workspace
  - `loom-scene` — Scene IR types + schema (single source of truth)
  - `loom-layout` — the layout engine
  - `loom-layout-wasm` — `wasm-bindgen` wrapper around `loom-layout`
- `packages/` — TypeScript workspace (`@loom-dev/*`)
  - `@loom-dev/scene` — Scene IR types (mirrors `loom-scene`)
  - `@loom-dev/layout` — thin JS binding over the WASM layout engine
  - `@loom-dev/runtime` — Roblox datatypes, Instance model, signals, services,
    scheduler, and Luau globals
  - `@loom-dev/renderer` — Scene IR → DOM, plus an incremental patching session
    with pointer/keyboard input delegation
  - `@loom-dev/react` — `@rbxts/react` adapter (custom `react-reconciler` host
    config driving live loom instances)
  - `@loom-dev/vide` — `vide` signals adapter on the same Scene IR
  - `@loom-dev/preview` — zero-config Vite plugin (generated page, entry
    detection, gallery mode), browser roblox-ts resolver, globals, and client
  - `loom-dev` — the `loom` CLI (`preview` / `build`)
- `apps/` — dev harnesses: `playground`, `example`, `interactive`,
  `gallery-demo`, `vide-example`

## Toolchain

- Node.js 24+, pnpm 11
- Rust (rustup) with the `wasm32-unknown-unknown` target, `wasm-pack`

> On macOS with Homebrew Rust installed, the rustup toolchain must be used for
> WASM builds (Homebrew's `rustc` ships no `wasm32` std). WASM build scripts
> prepend `~/.cargo/bin` to `PATH` for this reason.

## Commands

- `pnpm install` — install deps (runs `build:native`)
- `pnpm build:native` — build the WASM layout engine (`scripts/build-wasm.sh`)
- `cargo build` — build the Rust workspace
- `pnpm typecheck` / `pnpm build`
- `pnpm test` — `cargo test` + `vitest run`
- `pnpm test:packed` — packs the tarballs, installs them into a throwaway
  external Next.js app and runs `next build` against it. Slow (it installs
  Next from the network) and deliberately outside `pnpm test`, but it is the
  only check that covers the *published* layout — `files`, tarball contents,
  and loom's React winning over a host app's
- `pnpm test:base-path` — assembles a Fumadocs app in the reported
  `rbxts-react-clean-ui/{docs,src}` shape, runs three real `next build
  --output export` passes (with a `basePath`, the user's `root: ".."` layout,
  and a no-`basePath` control), then serves the export under
  `/rbxts-react-clean-ui/` and fetches every gallery resource it names. Needs
  no network; outside `pnpm test` because it runs Next builds
- `pnpm lint` / `pnpm format` — Biome
- `pnpm changeset` — record a release note for the packages you touched

## Releasing

Everything under `packages/` is published to npm under the `@loom-dev` scope
(the CLI keeps the unscoped name `loom-dev`), and all of them move in lockstep —
one version bump bumps them all.

The workspace itself stays source-first: `exports` point at `src/`, so a
checkout needs no build step and edits are picked up immediately. `dist/` is
swapped in only for the published tarball, via `publishConfig`.

Versioning is done locally and CI only publishes. (There used to be a workflow
that kept a "Version Packages" PR in sync; it needed GitHub Actions to be
allowed to open pull requests, which this repo does not permit, so it never
worked and is gone.)

1. Add a changeset to your PR: `pnpm changeset`.
2. When you want to cut a release, apply the pending changesets locally:
   `pnpm version-packages`. That bumps every package to the same version and
   writes the changelogs. It needs `GITHUB_TOKEN` in the environment — the
   changelog generator links commits and authors — e.g.
   `GITHUB_TOKEN=$(gh auth token) pnpm version-packages`.
3. Commit the result and push it to `main`.
   [`publish.yaml`](.github/workflows/publish.yaml) runs on every push and ships
   whatever the registry does not have yet: release-profile WASM, then the JS,
   then `pnpm publish:packages` (`pnpm -r publish` over `packages/*`, which
   skips versions npm already has). A push with no version change is a cheap
   no-op, and `pnpm publish:packages` is the same command you would run by hand.

   Changesets is used for changelogs and version bumps only, never to publish:
   `changeset publish` reports registry rejections as a bare `E404 undefined`
   per package, which hides npm's actual error.
4. Optionally push a `v<version>` tag to cut a GitHub Release;
   [`tag-release.yml`](.github/workflows/tag-release.yml) attaches the npm
   tarballs and the WASM bundle to it.

### Trusted publishing (OIDC)

There is no `NPM_TOKEN`. Publishing authenticates with npm's trusted publishing:
the job mints a GitHub OIDC token (`id-token: write`), pnpm exchanges it for a
short-lived publish token, and npm attaches a provenance attestation
automatically. Two constraints follow from that:

- **The workflow filename is part of the trust config, extension included.**
  Each package's trusted publisher on npmjs.com names `publish.yaml`. Renaming
  the file — or moving the publish step into another workflow — breaks
  publishing until the publisher is updated. A mismatch is not reported as a
  permission error: the token exchange 404s, pnpm logs `Skipped OIDC` and
  carries on unauthenticated, and every package then fails its PUT with `E404`.
- **npm cannot configure a trusted publisher for a package that does not exist
  yet.** Every new `@loom-dev/*` package needs one bootstrap publish from a
  local `npm publish` (or a `0.0.0` placeholder) before its trusted publisher
  can be added.

Requires pnpm 11.6+ (it performs the OIDC exchange itself) and Node 22.14+.

## Roadmap

- **M0** — workspace skeleton ✅
- **M1** — vertical slice: Scene IR + WASM layout + DOM renderer ✅
- **M2** — Roblox runtime datatypes + `@rbxts/react` adapter ✅
- **M3** — layout completeness ✅ list/grid/table/pages/padding/constraints/
  automatic size/text/flex (`HorizontalFlex`/`VerticalFlex`, `UIFlexItem`)
- **M4** — visual fidelity ✅ text (both the legacy `Font` enum and the modern
  `FontFace`), corners, strokes, gradients, clipping, transparency, rotation,
  scrolling frames, and images (every `ScaleType`, sprite windows, tints)
- **M5** — dev loop ✅ (Vite plugin, HMR, `loom preview`, `loom build`);
  a standalone roblox-ts compiler transform is still open
- **M6** — extensibility proof — `vide` adapter shipped on the same Scene IR;
  a Luau adapter is still open
