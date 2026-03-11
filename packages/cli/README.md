# @loom-dev/cli

Preview-only CLI for Loom workspaces.

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
- `loom snapshot [--cwd <path>] [--config <path>] [--output <path>] [--transform-mode <strict-fidelity|compatibility>]`
- `loom config [--cwd <path>] [--config <path>]`
- `loom help` 
- `loom version`

### Examples

```bash
loom preview --cwd apps/preview-harness
loom preview --config ./loom.config.ts --port 4175 --open
loom snapshot --cwd packages/preview --output ./preview-snapshot.json
loom config --cwd packages/preview
```
