# @loom-dev/cli

CLI for the Loom preview and build toolchain.

## Install

```bash
pnpm add -D @loom-dev/cli
```

## Usage

```bash
loom <command> [options]
```

### Commands

- `loom preview [--cwd <path>][--config <path>] [--port <number>] [--host <host>] [--open] [--transform-mode <strict-fidelity|compatibility>]`
- `loom serve ...`
- `loom build [--cwd <path>] [--config <path>] --out-dir <path> [--artifact-kind <module|entry-metadata|layout-schema>] [--transform-mode <strict-fidelity|compatibility|mocked|design-time>]`
- `loom snapshot [--cwd <path>] [--config <path>] [--output <path>] [--transform-mode <strict-fidelity|compatibility>]`
- `loom config [--cwd <path>] [--config <path>]`
- `loom help` 
- `loom version`

### Examples

```bash
loom preview --cwd apps/preview-harness
loom build --cwd packages/preview --out-dir ./generated
loom build --cwd packages/preview --out-dir ./metadata-build --artifact-kind entry-metadata --artifact-kind layout-schema --transform-mode design-time
loom preview --config ./loom.config.ts --port 4175 --open
loom snapshot --cwd packages/preview --output ./preview-snapshot.json
loom config --cwd packages/preview
```
