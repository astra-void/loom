---
title: "On this Mac, Homebrew rustc has no wasm32 std"
author: Astra-void
date: 2026-11-04
id: l-6983637b
scope: repo
status: active
touches:
  - rust-toolchain.toml
---

## Decided
On this machine both Homebrew Rust and rustup are installed, and **Homebrew's
`cargo`/`rustc` come first in PATH** (`/opt/homebrew/bin` before `~/.cargo/bin`).

Homebrew's `rustc` ships **no `wasm32-unknown-unknown` std**, so `wasm-pack` /
`cargo build --target wasm32-unknown-unknown` fail with the default PATH. The
rustup toolchain (`stable-aarch64-apple-darwin`) DOES have the wasm32 target.

Fix used in loom-rewrite (project-loom-rewrite): a `rust-toolchain.toml`
pins `channel = "stable"` + `targets = ["wasm32-unknown-unknown"]`, and WASM
build scripts prepend `~/.cargo/bin` to PATH so the rustup proxy is used. Native
(non-wasm) builds work with either toolchain.

_From Claude Code's memory of this repo, last updated Jun 19._
