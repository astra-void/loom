# Loom Workspace

This repository is a `pnpm` monorepo for the Loom preview and build toolchain plus the local preview harness.

## Requirements

- Node.js 24+
- `pnpm` 10
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

- `pnpm --filter loom-dev exec loom preview --cwd apps/preview-harness`
- `pnpm --filter loom-dev exec loom build --cwd packages/preview --out-dir ../../generated-preview`
- `pnpm --filter loom-dev exec loom config --cwd packages/preview`
- `pnpm --filter loom-dev exec loom snapshot --cwd packages/preview --output ./preview-snapshot.json`

## Library

For direct package consumption, install `@loom-dev/preview`.
Use root imports for config/build/server/headless APIs, and use `@loom-dev/preview/vite` for the Vite plugin entrypoint.

## Workspace Packages

- `@loom-dev/compiler`
- `loom-dev`
- `@loom-dev/layout-engine`
- `@loom-dev/preview-analysis`
- `@loom-dev/preview-runtime`
- `@loom-dev/preview-engine`
- `@loom-dev/preview`

## Release

Package publishing runs from `.github/workflows/publish.yml` when a `vX.Y.Z` tag is pushed.
All public packages are versioned together, and the tag version must exactly match every public package version.
The release validation step also requires the tagged commit to be contained in `main`.

Before the first release, configure npm trusted publishing for each public package in this repository:

- `@loom-dev/compiler`
- `@loom-dev/compiler-darwin-arm64`
- `@loom-dev/compiler-darwin-x64`
- `@loom-dev/compiler-linux-arm64-gnu`
- `@loom-dev/compiler-linux-arm64-musl`
- `@loom-dev/compiler-linux-x64-gnu`
- `@loom-dev/compiler-linux-x64-musl`
- `@loom-dev/compiler-win32-arm64-msvc`
- `@loom-dev/compiler-win32-x64-msvc`
- `@loom-dev/layout-engine`
- `@loom-dev/preview-analysis`
- `@loom-dev/preview-runtime`
- `@loom-dev/preview-engine`
- `@loom-dev/preview`
- `loom-dev`

Release flow:

- update the public package versions in the repo
- merge the release commit into `main`
- push a matching tag such as `v0.1.0`

The publish workflow runs a full preflight (`lint`, `typecheck`, `test`, release metadata validation, preview package consumer verification), builds the eight `@loom-dev/compiler` native target artifacts in a matrix, publishes the staged compiler packages, and then publishes the remaining workspace packages from `pnpm pack` tarballs.
For local verification, use `pnpm release:validate`, `pnpm verify:preview-package`, `pnpm --filter @loom-dev/compiler run publish:napi -- --dry-run`, and `pnpm publish:workspace-packages -- --dry-run`.

The preview harness loads static targets from:

- `packages/preview/src/shell`
- `packages/preview-runtime/src/hosts`
- `packages/preview-runtime/src/preview`
