# @loom-dev/preview

Source-first preview config, build, server, and headless utilities for Loom workspaces.

`@loom-dev/preview-engine` owns workspace, entry, and build protocol types.  
`@loom-dev/preview-runtime` owns runtime issues and layout debug payload types.  
`@loom-dev/preview` layers config loading, artifact builds, preview server startup, and headless helpers on top.

## Install

```bash
pnpm add @loom-dev/preview
```

For CLI-only usage, install `loom-dev` and use `loom preview`, `loom build`, `loom config`, `loom snapshot`, or `loom check`.

## Workspace Development

Within this repository, use:

```bash
pnpm build:native
pnpm dev
```

The local preview harness loads static targets from:

- `packages/preview/src/shell`
- `packages/preview-runtime/src/hosts`
- `packages/preview-runtime/src/preview`

## Config File

Add `loom.config.ts` to a package or workspace root:

```ts
import { createStaticTargetsDiscovery, defineConfig } from "@loom-dev/preview";

export default defineConfig({
  projectName: "Loom Preview",
  runtimeAliases: ["@my-studio/core"],
  reactAliases: ["@my-studio/react"],
  reactRobloxAliases: ["@my-studio/react-roblox"],
  targetDiscovery: createStaticTargetsDiscovery([
    {
      name: "preview-shell",
      packageName: "@loom-dev/preview",
      packageRoot: "./packages/preview",
      sourceRoot: "./packages/preview/src/shell",
    },
  ]),
});
```

## Programmatic Surface

`@loom-dev/preview` is the official library package for programmatic Loom usage.

Root exports:

- `defineConfig`
- `loadPreviewConfig`
- `buildPreviewArtifacts`
- `buildPreviewModules`
- `startPreviewServer`
- `createPreviewHeadlessSession`
- `createPackageTargetDiscovery`
- `createStaticTargetsDiscovery`
- `createWorkspaceTargetsDiscovery`

Subpaths:

- `@loom-dev/preview/config`
- `@loom-dev/preview/build`
- `@loom-dev/preview/client`
- `@loom-dev/preview/headless`
- `@loom-dev/preview/server`
- `@loom-dev/preview/progress`
- `@loom-dev/preview/vite` (`createPreviewVitePlugin`, `createScopedPreviewPlugins`)

`createPreviewHeadlessSession()` now creates a lazy headless session. Call `session.run()` to execute all or selected preview entries, and read `session.getSnapshot()` for the current engine payload plus the `execution` field with per-entry render status, runtime/layout issues, layout debug, degraded-host warnings, and viewport metadata.

`buildPreviewModules` is the raw target-array, module-only wrapper and continues to reject `design-time`.

`buildPreviewArtifacts` is the config-aware surface. It reuses `loadPreviewConfig()` / target discovery and can build metadata sidecars in `design-time`. Relative filesystem paths passed to `cwd`, `configFile`, and `outDir` resolve from the resolved preview working directory.

`writePreviewProgress` and `writePreviewTiming` live in `@loom-dev/preview/progress`.

`createPreviewVitePlugin` and `createScopedPreviewPlugins` live in `@loom-dev/preview/vite`.

`@loom-dev/preview/client` is the browser-safe surface for already-loaded preview entries. Keep using the root package for config loading, build, headless, and server APIs; use the `client` subpath when you need CSR, hydration, or build-time prerender helpers without pulling in Node-only preview entrypoints.

## Node API Example

```ts
import {
  buildPreviewArtifacts,
  createPreviewHeadlessSession,
  loadPreviewConfig,
  startPreviewServer,
} from "@loom-dev/preview";

const resolvedConfig = await loadPreviewConfig({
  cwd: process.cwd(),
});

await buildPreviewArtifacts({
  cwd: process.cwd(),
  outDir: "./generated-preview",
});

const session = await createPreviewHeadlessSession({
  cwd: process.cwd(),
});

try {
  const snapshot = await session.run();
  console.log(snapshot.execution.summary);
} finally {
  session.dispose();
}

const server = await startPreviewServer({
  ...resolvedConfig,
  server: {
    ...resolvedConfig.server,
    open: false,
    port: 0,
  },
});

await server.close();
```

## Vite Plugin Example

Use `createPreviewVitePlugin()` for Loom's own preview virtual modules and source transforms.
Use `createScopedPreviewPlugins()` when third-party Vite plugins should only run for preview-scoped files instead of the whole app.

```ts
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { loadPreviewConfig } from "@loom-dev/preview";
import {
  createPreviewVitePlugin,
  createScopedPreviewPlugins,
} from "@loom-dev/preview/vite";
import topLevelAwait from "vite-plugin-top-level-await";
import wasm from "vite-plugin-wasm";

const resolvedConfig = await loadPreviewConfig({
  cwd: process.cwd(),
});

export default defineConfig({
  plugins: [
    ...createScopedPreviewPlugins([react(), wasm(), topLevelAwait()], resolvedConfig),
    ...createPreviewVitePlugin({
      projectName: resolvedConfig.projectName,
      reactAliases: resolvedConfig.reactAliases,
      reactRobloxAliases: resolvedConfig.reactRobloxAliases,
      runtimeModule: resolvedConfig.runtimeModule,
      runtimeAliases: resolvedConfig.runtimeAliases,
      targets: resolvedConfig.targets,
      transformMode: resolvedConfig.transformMode,
      workspaceRoot: resolvedConfig.workspaceRoot,
    }),
  ],
});
```

```ts
import { buildPreviewArtifacts } from "@loom-dev/preview";

await buildPreviewArtifacts({
  cwd: process.cwd(),
  outDir: "../generated-preview",
});
```

```ts
import { buildPreviewArtifacts } from "@loom-dev/preview";

await buildPreviewArtifacts({
  cwd: process.cwd(),
  outDir: "./metadata-build",
  artifactKinds: ["entry-metadata", "layout-schema"],
  transformMode: "design-time",
});
```

## Client API

Use `@loom-dev/preview/client` when you already have a loaded preview entry payload and module and want to render it in a React app.

This subpath is intended for:

- CSR with `mountPreview()`
- hydration with `hydratePreview()`
- build-time prerender with `renderPreviewToString()` / `renderPreviewToStaticMarkup()`
- low-level composition with `createPreviewElement()`

The `client` subpath does not perform target discovery, preview builds, or Vite module loading. Those remain on the root `@loom-dev/preview` package.

### CSR Example

```ts
import { mountPreview } from "@loom-dev/preview/client";

const handle = mountPreview({
  container: document.getElementById("root")!,
  entry: previewEntryPayload.descriptor,
  module: loadedPreviewModule,
});

// Later:
handle.dispose();
```

### SSG Example

```ts
import { renderPreviewToString } from "@loom-dev/preview/client";

const html = renderPreviewToString({
  entry: previewEntryPayload.descriptor,
  module: loadedPreviewModule,
});
```

`renderPreviewToString()` and `renderPreviewToStaticMarkup()` are meant for build-time prerender of initial markup. They do not guarantee final Wasm layout convergence on the server; the client runtime still owns layout initialization and hydration-time stabilization.
