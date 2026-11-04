/**
 * `@loom-dev/luau` — a Luau frontend for loom.
 *
 * The third adapter on the Scene IR, and the first that is not TypeScript:
 * upstream Luau, compiled to WASM (`native/`), runs Luau source in the
 * browser. The VM layer (`./vm`) moves values between Luau and JavaScript and
 * runs threads Roblox's way; Roblox itself — Instance, the datatypes, Enum,
 * `game`, `task` — comes from `@loom-dev/runtime`, exposed to Luau as host
 * userdata (`./bindings`), so a Luau script builds the same live instance tree
 * the react adapter renders, and `mountLuau` paints it through the same world.
 */
export { createRobloxBindings, type RobloxBindings } from "./bindings.ts";
export {
	createLuauVM,
	type LuauMount,
	type LuauProjectMount,
	type LuauVMSetup,
	type MountLuauOptions,
	mountLuau,
	type RunLuauProjectOptions,
	runLuauProject,
} from "./mount.ts";
export {
	type LuauPreview,
	type LuauPreviewOptions,
	luauPreview,
} from "./preview.ts";
export {
	cloneWithSources,
	getScriptSource,
	instantiateProject,
	type LuauProject,
	type LuauProjectNode,
	setScriptSource,
} from "./project.ts";
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
