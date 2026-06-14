# roblox-capture

The Roblox Studio side of the [`@loom-dev/parity`](../packages/parity) harness:
a drop-in plugin that walks a GUI tree and POSTs its geometry + visual
properties to the local parity runner, in the same JSON shape Loom emits.

## Install

`LoomParityDump.lua` is a self-contained local plugin — drop it into your Studio
plugins folder:

| OS      | Path                                              |
| ------- | ------------------------------------------------- |
| macOS   | `~/Documents/Roblox/Plugins/LoomParityDump.lua`   |
| Windows | `%LOCALAPPDATA%/Roblox/Plugins/LoomParityDump.lua` |

(Alternatively, paste it into a `Script` in Studio, right-click → **Save as
Local Plugin**.) A **Loom Parity** toolbar with a **Dump GUI** button appears.

## Use

1. **Start the runner** in this repo:

   ```bash
   pnpm parity:serve          # listens on http://localhost:7878
   ```

2. **Enable HTTP** in Studio: _Game Settings → Security → Allow HTTP Requests_.

3. **Select** the `ScreenGui` (or any `GuiObject`) you want to compare, then
   click **Dump GUI**. With nothing selected it falls back to every top-level
   `GuiObject` under `StarterGui` / `PlayerGui`.

The runner writes `parity-out/roblox/<scene>.json` and, if a matching Loom
capture exists (`pnpm parity:capture`), prints the diff and writes an HTML
report under `parity-out/report/`.

## Notes

- **Capture reflects the live, on-screen layout.** `AbsolutePosition` /
  `AbsoluteSize` are only meaningful for a GUI that is actually rendered, so dump
  in the state you want to compare (Play mode for `PlayerGui`, or an enabled
  `ScreenGui` in edit mode).
- **Match the viewport.** The dump includes `workspace.CurrentCamera.ViewportSize`;
  render the Loom side at the same size (`pnpm parity:capture -- --viewport WxH`).
  The report warns on a mismatch.
- **Endpoint** is `http://localhost:7878/dump`. Change `ENDPOINT` at the top of
  the plugin if you run the receiver on another port.
- This folder is intentionally outside the pnpm workspace globs (`packages/*`,
  `apps/*`) so the Luau project is not treated as a Node package.
