/**
 * `@loom-dev/luau` — a Luau frontend for loom.
 *
 * The third adapter on the Scene IR, and the first that is not TypeScript:
 * upstream Luau, compiled to WASM (`native/`), runs Luau source in the
 * browser. The VM layer (`./vm`) moves values between Luau and JavaScript and
 * runs threads Roblox's way; Roblox itself — Instance, the datatypes, Enum,
 * `game`, `task` — comes from `@loom-dev/runtime`, exposed to Luau as host
 * userdata, so a Luau script builds the same live instance tree the react
 * adapter renders.
 */
export {
	type Classifier,
	type HostClass,
	LuauError,
	LuauFunction,
	LuauOpaque,
	LuauTable,
	LuauThread,
	LuauVM,
	type LuauVMOptions,
	Suspend,
	type ThreadResult,
	Tuple,
	tuple,
} from "./vm.ts";
