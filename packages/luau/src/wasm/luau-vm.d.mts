/**
 * Types for the emscripten module `native/build.sh` emits next to this file.
 * Pointers (`lua_State*`, `char*`) are plain wasm32 addresses.
 */
export interface LuauModule {
	readonly HEAPU8: Uint8Array;
	readonly HEAPU32: Uint32Array;
	UTF8ToString(ptr: number): string;
	_malloc(size: number): number;
	_free(ptr: number): void;

	_lb_open(): number;
	_lb_close(L: number): void;
	_lb_sandbox(L: number): void;
	_lb_sandboxthread(L: number): void;
	_lb_budget(ms: number): void;
	_lb_gc(L: number): void;

	_lb_kind(L: number, idx: number): number;
	_lb_gettop(L: number): number;
	_lb_settop(L: number, idx: number): void;
	_lb_pushvalue(L: number, idx: number): void;
	_lb_remove(L: number, idx: number): void;
	_lb_insert(L: number, idx: number): void;
	_lb_rawequal(L: number, a: number, b: number): number;
	_lb_xmove(from: number, to: number, n: number): void;
	_lb_checkstack(L: number, n: number): number;

	_lb_tonumber(L: number, idx: number): number;
	_lb_toboolean(L: number, idx: number): number;
	_lb_tostring(L: number, idx: number, len: number): number;
	_lb_tostringmeta(L: number, idx: number, len: number): number;
	_lb_tohost(L: number, idx: number): number;
	_lb_tothread(L: number, idx: number): number;
	_lb_typeof(L: number, idx: number): number;

	_lb_pushnil(L: number): void;
	_lb_pushboolean(L: number, b: number): void;
	_lb_pushnumber(L: number, n: number): void;
	_lb_pushstring(L: number, s: number, len: number): void;
	_lb_pushfunction(L: number, id: number, name: number): void;
	_lb_pushhost(L: number, handle: number, metatableRef: number): number;

	_lb_ref(L: number, idx: number): number;
	_lb_getref(L: number, ref: number): void;
	_lb_unref(L: number, ref: number): void;

	_lb_newtable(L: number, narr: number, nrec: number): void;
	_lb_rawget(L: number, idx: number): void;
	_lb_rawset(L: number, idx: number): void;
	_lb_rawseti(L: number, idx: number, n: number): void;
	_lb_rawgeti(L: number, idx: number, n: number): void;
	_lb_setfield(L: number, idx: number, k: number): void;
	_lb_getfield(L: number, idx: number, k: number): void;
	_lb_next(L: number, idx: number): number;
	_lb_objlen(L: number, idx: number): number;
	_lb_setmetatable(L: number, idx: number): number;
	_lb_setreadonly(L: number, idx: number, enabled: number): void;
	_lb_getglobal(L: number, name: number): void;
	_lb_setglobal(L: number, name: number): void;

	_lb_load(L: number, chunkname: number, source: number, len: number): number;
	_lb_pcall(L: number, nargs: number, nresults: number): number;

	_lb_newthread(L: number): number;
	_lb_refthread(L: number): number;
	_lb_resume(co: number, from: number, nargs: number): number;
	_lb_status(L: number): number;
	_lb_debugtrace(L: number): number;
	_lb_namecall(L: number): number;
}

export interface LuauModuleOptions {
	/** Runs host function `id` against `L`'s stack; see `bridge.cpp`. */
	lbHostCall(L: number, id: number): number;
	/** Luau collected a userdata holding `handle`. */
	lbHostRelease(handle: number): void;
	locateFile?(path: string, prefix: string): string;
	wasmBinary?: ArrayBuffer | Uint8Array;
}

export default function createLuauModule(
	options: LuauModuleOptions,
): Promise<LuauModule>;
