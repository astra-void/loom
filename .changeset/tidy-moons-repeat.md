---
"@loom-dev/renderer": minor
"@loom-dev/scene": minor
"@loom-dev/runtime": minor
"@loom-dev/react": minor
"@loom-dev/preview": minor
---

Render `ImageLabel` and `ImageButton`.

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
