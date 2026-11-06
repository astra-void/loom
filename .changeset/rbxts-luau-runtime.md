---
"@loom-dev/preview": minor
"loom-dev": minor
---

`loomPreview({ runtime: "luau" })` and `loom preview --runtime luau` run a roblox-ts project the way the game runs it: the project is compiled with its own roblox-ts, as `rbxtsc` would, into memory, and the Luau runs in `@loom-dev/luau`'s VM. Luau packages such as React-Lua and Ripple run as themselves instead of through loom's ports. One compiler stays alive for the session, so an edit recompiles only that file and its importers; a compile error shows in Vite's error overlay while the page keeps its last good output. It needs a `default.project.json` and `@loom-dev/luau` installed, and only uses a roblox-ts installed in or above the project. Gallery targets, hot swap, transformer plugins and `vite build` are not supported in this mode yet. The default, `"js"`, is unchanged.
