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

## Workspace Packages

- `@loom-dev/compiler`
- `@loom-dev/layout-engine`
- `@loom-dev/preview-runtime`
- `@loom-dev/preview-engine`
- `@loom-dev/preview`

The preview harness loads static targets from:

- `packages/preview/src/shell`
- `packages/preview-runtime/src/hosts`
- `packages/preview-runtime/src/preview`
