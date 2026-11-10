---
title: "The luau package now publishes from CI like the others, so its trusted publisher is validated"
author: Astra-void
date: 2026-11-09
branch: main
cost: { minutes: 10, tokens: 28685 }
id: l-67e571d7
scope: repo
status: active
src: agent
touches:
  - apps/fumadocs-demo/CHANGELOG.md
  - apps/fumadocs-demo/package.json
  - apps/next-demo/CHANGELOG.md
  - apps/next-demo/package.json
  - packages/cli/CHANGELOG.md
  - packages/cli/package.json
  - packages/layout/CHANGELOG.md
  - packages/layout/package.json
  - packages/luau/CHANGELOG.md
---

## Decided
0.14.1 (2026-11-09) was the first release to publish `@loom-dev/luau` through CI's OIDC trusted publishing. 0.14.0 was published by hand. All nine fixed-group packages published in one run, so luau needs no special handling at release time anymore.

## Tried and ruled out
Checking the trusted-publisher status from the agent before releasing. npmjs.com shows a bot-verification page to the in-app browser. npm 10 has no `trust` command, and the CLI here is not logged in. The user checked the package's Settings page and confirmed it was active.

## Watch out
Before a release, check that every package in the fixed group has ever published from CI. Do this when a package is new or was published by hand. A lapsed trusted publisher fails mid-run, after the packages before it have already gone out at the new version.
Watching a publish run: the run for a just-pushed commit can take more than 20s to appear, and it queues behind the previous push's run. Look it up by ID once it exists rather than by `--limit 1` right after the push.

In the code: .github/workflows/publish.yaml (run 42721372164 published all of 0.14.1), check provenance with `npm view <pkg>@<ver> dist.attestations`.
