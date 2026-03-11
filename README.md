# Loom Workspace

This repository is a `pnpm` monorepo for the Loom preview and build toolchain plus the local preview harness.

## Requirements

- Node.js 24+
- `pnpm` 10.32.0
- Rust and Cargo
- `wasm-pack`
- `zig` for non-Windows cross-target release builds of `@loom-dev/compiler`
- one compiled native artifact per configured compiler target under `packages/compiler/artifacts` before running the staged publish flow

## Commands

- `pnpm install`
- `pnpm build:native`
- `pnpm build`
- `pnpm dev`
- `pnpm typecheck`
- `pnpm test`

`pnpm build:native` builds the native artifacts used by `@loom-dev/layout-engine` and `@loom-dev/compiler`.
`pnpm dev` starts `apps/preview-harness` after those native artifacts are ready.

`pnpm build:native` remains host-native only. For cross-target release builds of `@loom-dev/compiler`, first install the requested Rust target with `rustup target add <triple>`, then run `pnpm --filter @loom-dev/compiler run build:release -- --target <triple>`.
NAPI-RS `--cross-compile` uses `cargo-zigbuild` for non-Windows targets and `cargo-xwin` for Windows targets.

`@loom-dev/compiler` publishes as a meta package. The root tarball ships only the JS loader and type files, while native binaries are staged into `packages/compiler/.npm/publish/npm/<platform-arch-abi>` and published as target packages such as `@loom-dev/compiler-linux-x64-gnu`.
Linux native packages are split by both architecture and libc (`gnu` vs `musl`), not just OS and CPU.
Run `pnpm --filter @loom-dev/compiler run stage:napi` to prepare the staged publish layout from `packages/compiler/artifacts`, or `pnpm --filter @loom-dev/compiler run publish:napi -- --dry-run` to exercise the publish order without uploading packages.

## CLI

After building the workspace packages, the packaged CLI entrypoints are:

- `pnpm --filter @loom-dev/cli exec loom preview --cwd apps/preview-harness`
- `pnpm --filter @loom-dev/cli exec loom build --cwd packages/preview --out-dir ./generated`
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
