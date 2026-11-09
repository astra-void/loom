# @loom-dev/luau

## 0.14.1

### Patch Changes

- Updated dependencies [[`1a9777f`](https://github.com/astra-void/loom/commit/1a9777f478df7540e2e57df9194b472f59b11ef3)]:
  - @loom-dev/layout@0.14.1
  - @loom-dev/react@0.14.1
  - @loom-dev/runtime@0.14.1

## 0.14.0

### Minor Changes

- [`b0552b1`](https://github.com/astra-void/loom/commit/b0552b1f9c84f4541f76895f3d4b92e806546f61) Thanks [@astra-void](https://github.com/astra-void)! - New package `@loom-dev/luau`: a Luau frontend for loom. It runs plain Roblox Luau, with no TypeScript, in upstream Luau compiled to WASM, against the same runtime, layout engine and renderer as the React adapter. Scripts get `Instance`, the datatypes, `Enum`, `game` and its services, signals, `task`, `WaitForChild` and `require`, with Roblox's own yielding, caching and error messages. Install it beside `@loom-dev/preview` and a Rojo project previews and builds as-is: `loom preview`, `loom build --targets`, or `vite build` with `loomPreview()`. `mountLuau`, `runLuauProject` and `createLuauVM` are exported for hosts that drive it themselves. Builds that bundle the VM no longer warn that Vite stubbed out its Node-only `node:module` import.

  Compiled roblox-ts and real Luau packages (React-Lua, Ripple, Fusion, Vide) run unchanged: `_G` and `shared` are tables every script shares, `require` takes string paths (`@self/`, `./`, `../`, `@game/`) resolved from the calling script, and `debug`'s profiler labels and memory categories exist as no-ops. A Luau function handed to an engine method, such as `RunService:BindToRenderStep` or a `BindAction` handler, is called, and a value it returns without yielding goes back to the engine. Runaway scripts are stopped by a time budget that counts running time between safepoints, so a hidden, throttled tab does not fail a slow module load. Engine methods that return several values, such as `GuiService:GetGuiInset()`, return them as separate values rather than one table.

### Patch Changes

- Updated dependencies [[`253867b`](https://github.com/astra-void/loom/commit/253867b27cdfbda3fb67493479517731032d65d2), [`bfb2fc7`](https://github.com/astra-void/loom/commit/bfb2fc750d22ab2d48a36f6001946801856340ce), [`9a31c96`](https://github.com/astra-void/loom/commit/9a31c96af64717a35ba87ed2d2e22ed78bdb601d), [`00bf400`](https://github.com/astra-void/loom/commit/00bf400c998809d20c1d2490cbc9a8ad1aaf6cd9), [`d863472`](https://github.com/astra-void/loom/commit/d863472f4bf139fb1abf58fc1831c9b3eea6887b), [`161e437`](https://github.com/astra-void/loom/commit/161e437809a86f3fc62266051a5e85c7719dae3e), [`6bb352c`](https://github.com/astra-void/loom/commit/6bb352cde16c84409ff1375bf6f1fa4ad5bbd04e), [`64b2802`](https://github.com/astra-void/loom/commit/64b280210556e1c87abc1587afcd8f452bd0171a), [`00bf400`](https://github.com/astra-void/loom/commit/00bf400c998809d20c1d2490cbc9a8ad1aaf6cd9), [`00bf400`](https://github.com/astra-void/loom/commit/00bf400c998809d20c1d2490cbc9a8ad1aaf6cd9), [`00bf400`](https://github.com/astra-void/loom/commit/00bf400c998809d20c1d2490cbc9a8ad1aaf6cd9)]:
  - @loom-dev/layout@0.14.0
  - @loom-dev/runtime@0.14.0
  - @loom-dev/react@0.14.0
