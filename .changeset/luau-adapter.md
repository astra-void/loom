---
"@loom-dev/luau": minor
"@loom-dev/preview": patch
---

New package `@loom-dev/luau`: a Luau frontend for loom. It runs plain Roblox Luau, with no TypeScript, in upstream Luau compiled to WASM, against the same runtime, layout engine and renderer as the React adapter. Scripts get `Instance`, the datatypes, `Enum`, `game` and its services, signals, `task`, `WaitForChild` and `require`, with Roblox's own yielding, caching and error messages. Install it beside `@loom-dev/preview` and a Rojo project previews and builds as-is: `loom preview`, `loom build --targets`, or `vite build` with `loomPreview()`. `mountLuau`, `runLuauProject` and `createLuauVM` are exported for hosts that drive it themselves. Builds that bundle the VM no longer warn that Vite stubbed out its Node-only `node:module` import.

Compiled roblox-ts and real Luau packages (React-Lua, Ripple, Fusion, Vide) run unchanged: `_G` and `shared` are tables every script shares, `require` takes string paths (`@self/`, `./`, `../`, `@game/`) resolved from the calling script, and `debug`'s profiler labels and memory categories exist as no-ops. A Luau function handed to an engine method, such as `RunService:BindToRenderStep` or a `BindAction` handler, is called, and a value it returns without yielding goes back to the engine. Runaway scripts are stopped by a time budget that counts running time between safepoints, so a hidden, throttled tab does not fail a slow module load.
