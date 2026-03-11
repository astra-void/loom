# @loom-dev/preview

Source-first preview config, server, and headless utilities for Loom workspaces.

`@loom-dev/preview-engine` owns workspace, entry, and build protocol types.  
`@loom-dev/preview-runtime` owns runtime issues and layout debug payload types.  
`@loom-dev/preview` layers config loading, preview server startup, and headless helpers on top.

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

Add `loom.preview.config.ts` to a package or workspace root:

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
- `startPreviewServer`
- `createPreviewHeadlessSession`
- `createPackageTargetDiscovery`
- `createStaticTargetsDiscovery`
- `createWorkspaceTargetsDiscovery`

This repository does not include a CLI package. Consume the preview APIs directly or use `apps/preview-harness` for local development.
