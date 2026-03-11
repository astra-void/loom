# Loom Workspace

This repository is a `pnpm` monorepo for the Loom preview toolchain and local preview harness.

## Requirements

- Node.js 24+
- `pnpm` 10.32.0
- Rust and Cargo
- `wasm-pack`

## Commands

- `pnpm install`
- `pnpm build:native`
- `pnpm build`
- `pnpm dev`
- `pnpm typecheck`
- `pnpm test`

`pnpm build:native` builds the native artifacts used by `@loom-dev/layout-engine` and `@loom-dev/compiler`.
`pnpm dev` starts `apps/preview-harness` after those native artifacts are ready.

## CLI

After building the workspace packages, the packaged CLI entrypoints are:

- `pnpm --filter @loom-dev/cli exec loom preview --cwd apps/preview-harness`
- `pnpm --filter @loom-dev/cli exec loom config --cwd packages/preview`
- `pnpm --filter @loom-dev/cli exec loom snapshot --cwd packages/preview --output ./preview-snapshot.json`

## Workspace Packages

- `@loom-dev/compiler`
- `@loom-dev/cli`
- `@loom-dev/layout-engine`
- `@loom-dev/preview-runtime`
- `@loom-dev/preview-engine`
- `@loom-dev/preview`

The preview harness loads static targets from:

- `packages/preview/src/shell`
- `packages/preview-runtime/src/hosts`
- `packages/preview-runtime/src/preview`
