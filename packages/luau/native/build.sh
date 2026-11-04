#!/usr/bin/env bash
# Build the Luau VM + compiler and loom's bridge into wasm/ (shipped as-is).
#
# The output is committed, so working on @loom-dev/luau never needs emscripten:
# only re-run this after changing bridge.cpp or bumping LUAU_VERSION.
#
#   brew install emscripten   # or any emsdk with emcc/emcmake on PATH
#   pnpm --filter @loom-dev/luau build:vm
set -euo pipefail

LUAU_VERSION="0.745"

here="$(cd "$(dirname "$0")" && pwd)"
pkg="$(dirname "$here")"
vendor="$pkg/vendor/luau"
build="$pkg/vendor/build-$LUAU_VERSION"
out="$pkg/wasm"

if [ ! -d "$vendor" ] || [ "$(git -C "$vendor" describe --tags 2>/dev/null)" != "$LUAU_VERSION" ]; then
	rm -rf "$vendor"
	git clone --quiet --depth 1 --branch "$LUAU_VERSION" https://github.com/luau-lang/luau.git "$vendor"
fi

# Luau reports errors by throwing C++ exceptions; native wasm exceptions keep
# that cheap. Every object file has to agree on the flag.
flags="-O2 -fwasm-exceptions"

emcmake cmake -S "$vendor" -B "$build" -DCMAKE_BUILD_TYPE=Release \
	-DLUAU_BUILD_CLI=OFF -DLUAU_BUILD_TESTS=OFF \
	-DCMAKE_CXX_FLAGS="$flags" >/dev/null
cmake --build "$build" --target Luau.VM Luau.Compiler -j >/dev/null

exports=$(grep -o 'EMSCRIPTEN_KEEPALIVE [^(]*' "$here/bridge.cpp" | awk '{print "_" $NF}' | tr '\n' ',')

mkdir -p "$out"
em++ $flags -std=c++17 \
	-I"$vendor/VM/include" -I"$vendor/Compiler/include" -I"$vendor/Common/include" \
	"$here/bridge.cpp" \
	"$build/libLuau.Compiler.a" "$build/libLuau.Ast.a" "$build/libLuau.Bytecode.a" \
	"$build/libLuau.VM.a" "$build/libLuau.Common.a" \
	-o "$out/luau-vm.mjs" \
	-sMODULARIZE=1 -sEXPORT_ES6=1 -sEXPORT_NAME=createLuauModule \
	-sENVIRONMENT=web,node -sALLOW_MEMORY_GROWTH=1 -sSTACK_SIZE=1MB \
	-sEXPORTED_FUNCTIONS="${exports}_malloc,_free" \
	-sEXPORTED_RUNTIME_METHODS=HEAPU8,HEAPU32,UTF8ToString \
	-sINCOMING_MODULE_JS_API=locateFile,wasmBinary

echo "built Luau $LUAU_VERSION → ${out#"$pkg/"}/luau-vm.{mjs,wasm} ($(du -h "$out/luau-vm.wasm" | cut -f1))"
