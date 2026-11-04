---
"@loom-dev/preview": minor
"@loom-dev/runtime": patch
---

`loomPreview()` previews Luau projects. A Rojo `default.project.json`, or Luau scripts in the `rojo init` layout (`src/client`, `src/server`, `src/shared`), now count as a client entry: the page builds the place and runs its LocalScripts the way a joining client does, with `require` across ModuleScripts, and reloads on any script edit. Gallery mode also picks up `*.loom.luau` targets by default, beside `*.loom.tsx`. Each target runs as a LocalScript inside its own ScreenGui. Both need the `@loom-dev/luau` adapter installed. A TypeScript entry still wins when a project has both. `StarterPlayerScripts`, `StarterCharacterScripts` and `PlayerScripts` join the runtime's class registry.
