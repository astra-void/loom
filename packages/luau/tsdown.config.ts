import { loomBuild } from "../../tsdown.base.ts";

export default loomBuild({
	entry: ["src/index.ts", "src/entry.ts"],
	// `wasm/` is the emscripten build (`native/build.sh`), shipped verbatim:
	// dist/*.js reaches it at `../wasm/…`, the same hop that works from src/.
	// The project module only exists inside a preview, where the plugin serves it.
	deps: { neverBundle: [/^\.\.\/wasm\//, /^virtual:loom-luau-project$/] },
});
