---
title: "Pnpm update in this repo rewrites catalog ranges and can swap a package's catalog: spec…"
author: Astra-void
date: 2026-11-04
id: l-b073d695
scope: repo
status: active
touches:
  - pnpm-workspace.yaml
---

## Decided
`pnpm update <pkg> -r --depth 100` (pnpm 11 rejects `--depth Infinity`) does more than refresh the lockfile. On 2026-09-25, updating `vite` to lift a transitive esbuild made these changes:
- It raised the catalog's `vite: ^6.0.0` to `^6.4.3`, which changes the published `loom-dev` package's `vite` range.
- It replaced `packages/preview`'s dev `"vite": "catalog:"` with `"^7.3.6"`, which would move preview's Vite dev-server tests to Vite 7.

**Why:** catalog entries feed published dependency ranges (loom-release-flow), so a silent range change is a release change.

## Watch out
after any `pnpm update`, `git diff -- '*.json' pnpm-workspace.yaml`. Revert manifest and catalog edits that weren't intended, then `pnpm install` to re-sync the lockfile. For transitive security floors, prefer `overrides` with a major-scoped selector (`"postcss@^8": ^8.5.26`) in `pnpm-workspace.yaml`. Exception, vite (2026-11-03): `"vite@^6"`/`"vite@^7"` overrides didn't move the `catalog:` direct deps and rewrote vitest's vite *peer* range to the override value. For vite, run `pnpm update vite -r --depth 100`, then restore manifests and catalog from a backup and `pnpm install` (the lock keeps
…

_From Claude Code's memory of this repo, last updated Nov 3._
