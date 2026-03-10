# @lattice-ui/preview

Source-first preview bootstrap for Lattice UI workspaces.

`@lattice-ui/preview-engine` owns workspace/index/entry/build protocol types.  
`@lattice-ui/preview-runtime` owns runtime issues and layout debug payload types.  
`@lattice-ui/preview` is the config, server, CLI, and headless bootstrap layer on top of those protocols.

## Install

```bash
npm install -D @lattice-ui/preview @lattice-ui/cli
```

## Zero-Config Preview

Run preview from a package root:

```bash
npx lattice preview
```

This keeps the current package-root workflow:

- package root must contain `package.json`
- preview source root defaults to `src`
- dev preview defaults to `transformMode: "strict-fidelity"`

## Config File

For workspace preview, add `lattice.preview.config.ts`:

```ts
import { createWorkspaceTargetsDiscovery, definePreviewConfig } from "@lattice-ui/preview";

export default definePreviewConfig({
  projectName: "Lattice Preview",
  targetDiscovery: createWorkspaceTargetsDiscovery({
    workspaceRoot: ".",
    include: ["@lattice-ui/*"],
    exclude: ["internal-*"],
  }),
});
```

`lattice preview` resolves config in this order:

1. `--config <path>`
2. nearest `lattice.preview.config.ts` found by walking upward from `cwd`
3. zero-config package-root mode

## Public Bootstrap API

`@lattice-ui/preview` exposes:

- `definePreviewConfig(config)`
- `loadPreviewConfig(options?)`
- `startPreviewServer(configOrOptions)`
- `createPreviewHeadlessSession(configOrOptions)`
- `createPackageTargetDiscovery(options?)`
- `createStaticTargetsDiscovery(targets)`
- `createWorkspaceTargetsDiscovery(options)`

Headless mode is available from the CLI too:

```bash
npx lattice preview --headless
```

That prints:

```ts
type PreviewHeadlessSnapshot = {
  protocolVersion: number;
  workspaceIndex: PreviewWorkspaceIndex;
  entries: Record<string, PreviewEntryPayload>;
};
```

## Preview Contract

Core selection is fixed to explicit preview contracts:

```ts
export function DialogPreview() {
  return <frame />;
}

export const preview = {
  title: "Dialog",
  entry: DialogPreview,
};
```

Supported explicit contracts:

- `preview.entry`
- `preview.render`

Files without an explicit preview contract stay indexed, but they do not auto-render. They surface as `needs_harness` or `ambiguous` guidance until `preview.entry` or `preview.render` is added.

Selection pipeline:

```text
preview contract -> entry descriptor -> render target
```

## Protocol Boundary

The browser shell stays internal.

The public protocol is not the shell UI. It is the exported engine/runtime schema:

- `PreviewWorkspaceIndex`
- `PreviewEntryPayload`
- `PreviewDiagnostic`
- `PreviewRuntimeIssue`
- `PreviewLayoutDebugPayload`

Use `@lattice-ui/preview-engine` and `@lattice-ui/preview-runtime` as the source of truth for those contracts.

Machine-readable schema artifacts are published from those packages:

- `@lattice-ui/preview-engine/schemas/workspace-index`
- `@lattice-ui/preview-engine/schemas/entry-payload`
- `@lattice-ui/preview-engine/schemas/diagnostic`
- `@lattice-ui/preview-runtime/schemas/runtime-issue`
- `@lattice-ui/preview-runtime/schemas/layout-debug-payload`

## Transform Modes

Strict fidelity is the default:

- `strict-fidelity` blocks previews when transform fidelity would degrade
- `compatibility` allows fallback rendering as an explicit opt-in
- `mocked` allows explicit mock-backed execution as an explicit opt-in
- `design-time` is metadata-only and does not emit executable preview modules

## Target Discovery Adapters

Built-in target discovery helpers:

- `createPackageTargetDiscovery()` for zero-config single-package preview
- `createStaticTargetsDiscovery()` for explicit target arrays
- `createWorkspaceTargetsDiscovery()` for monorepo or external workspace scanning

Example static target setup:

```ts
import { createStaticTargetsDiscovery, definePreviewConfig } from "@lattice-ui/preview";

export default definePreviewConfig({
  projectName: "Lattice Preview",
  targetDiscovery: createStaticTargetsDiscovery([
    {
      name: "checkbox",
      packageName: "@lattice-ui/checkbox",
      packageRoot: "./packages/checkbox",
      sourceRoot: "./packages/checkbox/src",
    },
  ]),
});
```

## Notes

- browser preview remains internal UI over public protocol data
- discovery stops only at real external or unresolved boundaries
- add explicit preview contracts during migration; legacy export inference is no longer part of the engine contract
