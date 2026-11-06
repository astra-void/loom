---
title: "A new package's first npm publish has to be done by hand; CI's trusted publishing can't create it"
author: Astra-void
date: 2026-11-06
branch: main
cost: { minutes: 25, tokens: 54601 }
id: l-23499646
scope: repo
status: active
src: agent
---

## Decided
Releases publish from CI through npm trusted publishing (OIDC, no token). That only works for a package that already exists on npm and has a trusted publisher configured. When `@loom-dev/luau` became publishable, every Publish run failed. The OIDC token exchange returned 404, then `404 PUT @loom-dev/luau`. Its first version (0.14.0) was published by hand. CI then published the other packages and skipped the one already on npm.

## Tried and ruled out
- `pnpm publish` from the machine after `npm login`: 404 / `pnpm whoami` 401, because pnpm 11 was reading stale auth. `npm publish <packed tgz>` used the fresh login.
- Having the agent publish: npm asks for browser auth or an OTP, which the account owner has to complete.

## Watch out
- Before a release that adds a package, check `npm view <pkg>` for E404.
- Publish the package by hand first: `pnpm pack` in the package (it resolves `workspace:*` to exact versions), then `npm publish <tgz> --access public`. Wait until `registry.npmjs.org/<pkg>/<version>` returns 200, then push the version commit, or CI tries to publish the package again and fails.
- Then add the Trusted Publisher on npmjs.com (GitHub Actions, astra-void/loom, workflow `publish.yaml`), or the package's next version fails in CI the same way. As of 0.14.0 this is still missing for `@loom-dev/luau`.
- npm can serve a version's metadata before its tarball (`/<pkg>/-/<name>-<ver>.tgz` 404s for a few minutes). Check the tarballs before testing an install or pushing the `v*` tag.

In the code: .github/workflows/publish.yaml (`pnpm release` → `pnpm -r --filter ./packages/* publish`); .changeset/config.json fixed group.
