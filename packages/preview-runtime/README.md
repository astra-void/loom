# @loom-dev/preview-runtime

High-precision browser polyfills for the Roblox runtime APIs that Loom previews commonly need.

## Surface

- `task`
- `RunService`
- `Enum`
- `TweenService` (`Create` with time-based preview-safe playback)
- `setupRobloxEnvironment`

## Usage

```ts
import { setupRobloxEnvironment } from "@loom-dev/preview-runtime";

setupRobloxEnvironment();
```

You can also import the pieces directly:

```ts
import { Enum, RunService, task } from "@loom-dev/preview-runtime";
```

## Vite Alias Guide

Use narrow local shim files when you need to redirect packages with a larger API surface than this runtime provides.

```ts
// vite.config.ts
import path from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  resolve: {
    alias: {
      // Redirect Roblox service imports to a local shim that only re-exports what you use.
      "@rbxts/services": path.resolve(__dirname, "./src/preview-shims/rbxts-services.ts"),
      // Packages like @flamework/core usually need app-specific stubs, so alias them to a local shim too.
      "@flamework/core": path.resolve(__dirname, "./src/preview-shims/flamework-core.ts"),
    },
  },
});
```

```ts
// src/preview-shims/rbxts-services.ts
export { RunService } from "@loom-dev/preview-runtime";
```

```ts
// src/preview-shims/flamework-core.ts
// Keep this file intentionally narrow. Add only the members your preview imports.
export const Flamework = {};
export const Modding = {};
```

If your previewed code uses Roblox globals directly, call `setupRobloxEnvironment()` once in the preview app entrypoint before rendering.
