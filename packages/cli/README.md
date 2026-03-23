# loom-dev

CLI for the Loom preview and build toolchain.

## Install (Optional Global)

```bash
pnpm add -D loom-dev
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
- `loom check [--cwd <path>] [--config <path>] [--entry <id>] [--format <pretty|json>] [--fail-on <warning|error>] [--transform-mode <strict-fidelity|compatibility>]`
- `loom config [--cwd <path>] [--config <path>]`
- `loom help`
- `loom version`

### Examples

```bash
npx loom-dev preview --cwd apps/preview-harness
npx loom-dev build --cwd packages/preview --out-dir ../../generated-preview
npx loom-dev build --cwd packages/preview --out-dir ./metadata-build --artifact-kind entry-metadata --artifact-kind layout-schema --transform-mode design-time
npx loom-dev preview --config ./loom.config.ts --port 4175 --open
npx loom-dev snapshot --cwd packages/preview --output ./preview-snapshot.json
npx loom-dev check --cwd packages/preview --fail-on warning
npx loom-dev config --cwd packages/preview
```
