# @loom-dev/preview

Source-first preview config, build, server, and headless utilities for Loom workspaces.

`@loom-dev/preview-engine` owns workspace, entry, and build protocol types.  
`@loom-dev/preview-runtime` owns runtime issues and layout debug payload types.  
`@loom-dev/preview` layers config loading, artifact builds, preview server startup, and headless helpers on top.

## Install

```bash
pnpm add @loom-dev/preview
```

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
import { createStaticTargetsDiscovery, definePreviewConfig } from "@loom-dev/preview";

export default definePreviewConfig({
  projectName: "Loom Preview",
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

The main exports are:

- `definePreviewConfig`
- `loadPreviewConfig`
- `buildPreviewArtifacts`
- `buildPreviewModules`
- `startPreviewServer`
- `createPreviewHeadlessSession`
- `createPackageTargetDiscovery`
- `createStaticTargetsDiscovery`
- `createWorkspaceTargetsDiscovery`

`createPreviewHeadlessSession()` now creates a lazy headless session. Call `session.run()` to execute all or selected preview entries, and read `session.getSnapshot()` for the current engine payload plus the `execution` field with per-entry render status, runtime/layout issues, layout debug, degraded-host warnings, and viewport metadata.

`buildPreviewModules` is the raw target-array, module-only wrapper and continues to reject `design-time`.

`buildPreviewArtifacts` is the config-aware surface. It reuses `loadPreviewConfig()` / target discovery and can build metadata sidecars in `design-time`. Relative filesystem paths passed to `cwd`, `configFile`, and `outDir` resolve from the resolved preview working directory.

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

For the packaged CLI, install `@loom-dev/cli` and use `loom preview`, `loom build`, `loom config`, `loom snapshot`, or `loom check`.
