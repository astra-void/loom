---
title: "Fixes to a package that hasn't shipped yet go into its new-package changeset, not their own entries"
author: Astra-void
date: 2026-11-06
branch: main
cost: { minutes: 10, tokens: 101057 }
id: l-6a3898cb
scope: repo
status: active
src: agent
touches:
  - biome.json
  - ".changeset/engine-enums-events.md"
  - ".changeset/luau-adapter.md"
  - ".changeset/luau-projects.md"
  - ".changeset/rbxts-luau-runtime.md"
  - ".changeset/reflection-get-classes.md"
  - ".changeset/screengui-in-folder.md"
  - ".changeset/screengui-size-udim2.md"
  - ".changeset/gui-insets.md"
  - packages/runtime/src/instance.test.ts
---

## Decided
Before 0.14.0, about ten commits had landed with no changeset. Some of them fixed `@loom-dev/luau` and the preview's Luau project reader, and neither had ever been on npm. Those fixes were folded into the existing "new package" and "Luau projects" changesets as extra paragraphs. A separate "fixed X" entry would describe a bug no user ever had. Changes to packages that already shipped (runtime, react, preview, cli) each got their own changeset, one per topic, like the rest of the repo.

## Watch out
- Check that every feat/fix commit since the last `v*` tag has a changeset before running `pnpm version-packages`. Compare `git log v<last>..HEAD` with `git log --name-only v<last>..HEAD -- .changeset`; commits keep landing without one.
- Don't claim a library "runs unchanged" in a changeset unless it fully works. Iris still loads, but its clicks are blocked, so it was left out of the list.
- A full `pnpm test` on a loaded machine (load average ~27) can time out `vite.test.ts` at 30s. Re-run that file alone before treating it as a regression; it passes in about 7s.
- The `.trail` folder must stay excluded from biome. Its vendored session-start script uses control-character regexes that the recommended preset rejects, which fails CI lint.

In the code: `.changeset/luau-adapter.md`, `.changeset/luau-projects.md` (folded fixes); `biome.json` `files.includes` has `"!.trail"`.
