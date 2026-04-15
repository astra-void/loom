# AGENTS.md

This repository is a `pnpm` monorepo for the Loom preview and build toolchain. These instructions apply to the whole repository.

## Repository Overview

- Use Node.js 24+, `pnpm` 10, Rust/Cargo, and `wasm-pack`.
- Native and WASM build outputs are part of the normal development loop. Many TypeScript checks and tests expect `@loom-dev/compiler`, `@loom-dev/layout-engine`, and `@loom-dev/preview-analysis` artifacts to be built first.
- The root `package.json` is the source of truth for workspace commands. Prefer root scripts unless a narrower package script is clearly enough for the change.

## Workspace Map

- `packages/compiler`: Rust, SWC, NAPI-RS, and WASM compiler bridge for preview transforms.
- `packages/layout-engine`: Rust/WASM layout engine used by browser preview runtime tests and package builds.
- `packages/preview-analysis`: Rust/WASM preview graph traversal and trace engine.
- `packages/preview-runtime`: shared browser runtime, Roblox globals, DOM host rendering, schemas, and runtime issue handling.
- `packages/preview-engine`: preview protocols, discovery, invalidation, workspace graph, and engine APIs.
- `packages/preview`: source-first preview build, server, Vite integration, client, and headless APIs.
- `packages/cli`: `loom` command-line entrypoint published as `loom-dev`.
- `apps/preview-harness` and `apps/compiler-harness`: local development harnesses.
- `tests/*`: root Vitest suites grouped by package or integration area.

## Development Commands

- Install dependencies with `pnpm install`.
- Build native and WASM prerequisites with `pnpm build:native`.
- Start the preview harness with `pnpm dev`.
- Start the compiler harness with `pnpm dev:compiler`.
- Run linting with `pnpm lint`.
- Run type checking with `pnpm typecheck`.
- Build the full workspace with `pnpm build`.
- Run the full test suite with `pnpm test`.
- Validate release metadata with `pnpm release:validate`.
- Verify package declaration output with `pnpm verify:dts`.
- Verify the preview package consumer flow with `pnpm verify:preview-package`.

## Change Guidelines

- Keep edits scoped to the package or behavior being changed. Avoid broad refactors unless the task requires them.
- Preserve existing user changes. Check `git status --short` before editing and do not revert unrelated work.
- TypeScript and JavaScript formatting is managed by Biome. Follow tabs for indentation and double quotes for strings.
- Rust code should follow `cargo fmt`; use the package scripts where available so generated WASM/native outputs stay consistent with the workspace.
- Do not manually edit generated outputs such as `dist`, `pkg`, `.native`, `target`, `wasm`, or staged publish artifacts unless the task is specifically about generated package output.
- Add or update tests near the behavior being changed. Prefer focused tests first, then run broader checks when shared runtime, compiler, preview, or release behavior is affected.
- Treat public package exports, CLI behavior, generated declarations, schemas, and release scripts as public surfaces. Update tests and verification commands when changing them.

## Testing Guidance

- For Rust compiler, layout, or analysis changes, run the relevant package build/test script first, then run `pnpm test` when the change affects JS integration or generated artifacts.
- For `preview-runtime`, `preview-engine`, or `preview` changes, run the relevant Vitest file or package tests plus `pnpm typecheck`.
- For CLI, package export, declaration, or release changes, run `pnpm typecheck`, `pnpm verify:dts`, `pnpm release:validate`, and the relevant dry-run publish or package verification command when applicable.
- For harness-only changes, run the harness build or dev flow that exercises the edited harness.
- When time or environment constraints prevent a full check, report exactly which checks ran and which checks remain.

## Release and Changesets

- Public packages are versioned together through Changesets fixed mode.
- Use `pnpm changeset:add` only when the user asks for release intent or when a code change clearly requires it.
- Changelog generation is disabled for Changesets; keep manual changelog work separate from package versioning unless explicitly requested.
- Cross-target compiler releases depend on staged native artifacts. Do not alter release staging, npm package names, or publish order without validating the release scripts and CI workflow.

## Agent Safety Rules

- Do not run formatters or fix commands that rewrite many files unless the task calls for it or the user approves it.
- Do not delete build artifacts or generated package directories just to make the tree cleaner.
- Do not change `README.md`, CI workflows, release metadata, or package scripts while working on documentation-only tasks.
- If a command fails because native/WASM artifacts are missing, build the required artifact instead of patching around imports.
- Keep final reports concise: list changed files, checks run, and any checks skipped.
