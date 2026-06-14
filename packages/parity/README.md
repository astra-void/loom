# @loom-dev/parity

A 1:1 parity harness that compares **Loom's preview output** against **real
Roblox**, per instance, for both **geometry** (AbsolutePosition / AbsoluteSize)
and **visual properties** (BackgroundColor3, transparency, text, …).

Every existing fidelity test in this repo compares Loom against _itself_ (WASM vs
TS fallback). This harness is the missing half: a real Roblox ground-truth dump
diffed against the Loom capture, so divergences are caught — and regressions
prevented — automatically.

```
        same scene source (Roblox-TS instances)
          │                                  │
   [Roblox Studio]                     [Loom headless / jsdom]
   LoomParityDump.lua                  renderAndCaptureLoom()
   walk GuiObject tree                 debug tree + DOM bridge
          └──── HTTP POST ───┐      ┌──── ParitySnapshot ──┘
                             ▼      ▼
                     diffSnapshots()  →  report.json + report.html
```

## Quick start

```bash
# 1. Capture the Loom side (renders fixtures under the real WASM layout engine)
pnpm parity:capture                    # -> parity-out/loom/<scene>.json

# 2. Start the receiver for the Roblox dump plugin
pnpm parity:serve                      # listens on http://localhost:7878

# 3. In Roblox Studio: install roblox-capture/LoomParityDump.lua, enable HTTP
#    requests, select the GUI, and click "Dump GUI" on the Loom Parity toolbar.
#    The runner writes parity-out/roblox/<scene>.json and auto-compares.
```

Or compare two snapshot files directly:

```bash
pnpm parity:compare parity-out/loom/styled-card.json parity-out/roblox/styled-card.json
```

## Capturing the Loom side

Three modes, depending on the source:

| Source | Command | Coverage |
| --- | --- | --- |
| **Fixtures / hand-authored React scenes** | `pnpm parity:capture` | geometry **+ visual props** (jsdom, DOM bridge) |
| **Real preview project, in a browser** (compiler-transformed, e.g. the lattice-ui playground) | `pnpm parity:capture-browser <url>` | geometry **+ visual props** (Playwright walks the live bridge) |
| **Real preview project, headless** (no browser, CI) | `loom snapshot` → `pnpm parity:from-snapshot` | geometry only |

```bash
# Real playground, full fidelity — point Playwright at a running preview:
pnpm exec playwright install chromium                 # one-time
pnpm dev                                              # serve the preview (another shell)
pnpm parity:capture-browser http://localhost:5173 \
  --name dialog --width 1280 --height 720             # -> parity-out/loom/dialog.json

# Or geometry-only without a browser (CI-friendly):
loom snapshot --out snap.json
pnpm parity:from-snapshot snap.json                   # -> parity-out/loom/<entry>.json

# Either way, then dump the same GUI from Roblox (plugin) — parity:serve auto-compares.
```

`parity:capture-browser` walks the live preview host bridge in the page (the same
walk as the jsdom `captureFromHostTree`, validated in tests), so it carries the
same geometry **and** visual properties as the fixture path — on the real,
compiler-transformed source.

## What it catches

- **Layout divergences** — list/grid math, AutomaticSize, padding, anchor,
  pixel rounding — show up as `absolutePosition` / `absoluteSize` deltas.
- **Value divergences** — `BackgroundColor3`, `BackgroundTransparency`,
  `TextColor3`, `Text`, `Visible`, `Rotation`, `ZIndex`, image tint/transparency.
- **Structural divergences** — missing/extra instances, `ClassName` mismatches.

Severity is rolled up per node: missing nodes, `ClassName`, `Visible` flips and
large (≥ ~8px) position/size deltas are **high**; sub-pixel-but-out-of-tolerance
deltas and colour/text differences are **medium**.

## Pixel parity

Pure CSS-rendering divergences that don't change a captured property — `UIStroke`
drawn inside vs. outside, `ImageLabel` ScaleType, `UIGradient` multiply,
`ImageColor3` tint, font rendering — are invisible to the geometry/property diff
above. The **pixel layer** catches them by comparing two screenshots:

```bash
# Loom screenshot from a running preview (loom preview / pnpm dev), GUI region only:
pnpm exec playwright install chromium          # one-time browser setup
pnpm parity:shot http://localhost:5173 parity-out/png/loom.png \
  --width 1280 --height 720 --selector "[data-preview-layout-provider]"

# Roblox screenshot: capture Studio at the same 1280×720 (a full-screen ScreenGui
# makes alignment trivial) -> parity-out/png/roblox.png

# Diff -> composite (loom | roblox | diff) + % + self-contained HTML:
pnpm parity:pixel parity-out/png/loom.png parity-out/png/roblox.png --name dialog
```

`parity:pixel` compares the overlapping region (warning on a size mismatch), so
capture both at the **same viewport** with the GUI in the same place. Font
rendering differs between Roblox and the browser, so expect some baseline
mismatch around text; the composite makes it obvious which differences are
structural (stroke/image/gradient) vs. text aliasing.

## Viewport matters

Scale-based sizes depend on the viewport, so the Loom capture must run at the
**same viewport** as the Roblox dump. The Roblox dump includes its viewport and
the report flags a mismatch. Override the Loom viewport to match:

```bash
pnpm parity:capture -- --viewport 1280x720
```

## API

```ts
import {
  diffSnapshots,
  normalizeLoomDebugPayload,
  renderHtmlReport,
  renderTextReport,
  type ParitySnapshot,
} from "@loom-dev/parity";

// In a DOM env (Vitest jsdom), capture a live scene with visual props:
import {
  installNodeLayoutEngine,
  renderAndCaptureLoom,
} from "@loom-dev/parity/capture";

await installNodeLayoutEngine();
const loom = await renderAndCaptureLoom(<MyScene />, { viewport: { x: 1280, y: 720 } });
const report = diffSnapshots(loom, robloxSnapshot);
```

`normalizeLoomDebugPayload` adapts a `PreviewLayoutDebugPayload` (from
`createPreviewHeadlessSession` / `loom snapshot`) when you only need geometry.

## Data format

A `ParitySnapshot` mirrors the `PreviewLayoutDebugPayload` geometry contract
(`rect` == AbsolutePosition + AbsoluteSize), extended with visual properties:

```jsonc
{
  "source": "loom" | "roblox",
  "viewport": { "x": 800, "y": 600 },
  "scene": "styled-card",
  "roots": [{
    "name": "Card", "className": "Frame",
    "absolutePosition": { "x": 80, "y": 80 },
    "absoluteSize": { "x": 240, "y": 120 },
    "zIndex": 1,
    "visual": { "backgroundColor3": { "r": 0.157, "g": 0.173, "b": 0.204 } },
    "children": [ /* … */ ]
  }]
}
```

Nodes are matched between the two sides by their **Name path** (duplicate sibling
names are disambiguated by child order), so authored `Name`s should be stable.
