# Changesets

Use `pnpm changeset:add` to record release intent for public workspace packages.

The workspace is configured in fixed mode, so all public packages version together.

For prereleases, use `pnpm changeset:pre:enter` and `pnpm changeset:pre:exit`. These commands are idempotent wrappers around Changesets pre mode.
