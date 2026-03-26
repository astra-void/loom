# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]
p
This update broadens the preview, compiler, and runtime surface across browser and wasm execution paths, while tightening source resolution for preview entries and diagnostics.

Migration notes:

- Replace `@loom-dev/cli` with `loom-dev` in install commands, package references, and global invocation scripts.
- Replace `definePreviewConfig` with `defineConfig` in preview config files.

### Added

- Preview diagnostics now include code-frame snippets in the shell issue cards.
- The compiler now ships browser and wasm entrypoints.
- The preview runtime now exposes shared Lua-style globals.
- Preview entries can now live in `.loom.tsx` files.

### Changed

- Preview configs now export `defineConfig` instead of `definePreviewConfig`.
- Browser preview imports for React and Roblox shims now resolve to browser-specific modules, while SSR keeps node shims.
- Preview issue cards now show severity, target, import chain, and related diagnostic metadata.
- The CLI package is now published as `loom-dev` for global installs.
- Compiler transforms now treat `next` as a runtime helper.

### Fixed

- Workspace package declaration outputs now map back to source files so dependency tracking uses the real source tree.
- Preview discovery now accepts wrapped `preview` objects and transformable source files under the target root more reliably.
- Callable mocks are now invariant-safe in preview runtime and compiler glue.
- Compiler binaries now fall back to cached local native builds and stay pinned to the host target.
