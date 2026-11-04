// bridge.cpp — the C surface `@loom-dev/luau` drives the Luau VM through.
//
// Deliberately thin: every Roblox behaviour (Instance, datatypes, Enum, task)
// lives in TypeScript, on top of `@loom-dev/runtime`. What this file adds over
// the raw Luau C API is only what JavaScript cannot do itself:
//
// * host functions — a `lua_CFunction` trampoline that hands the call to JS
//   and turns its sentinel returns into `lua_error` / `lua_yield`, which must
//   be called from C;
// * host userdata — one tagged userdata per JS object, cached weakly so the
//   same object always comes back as the same (rawequal) userdata, with a
//   destructor that tells JS when Luau has let go of it;
// * stable value kinds, so TS never depends on the layout of Luau's own
//   `lua_Type` enum (which changes with build options);
// * a wall-clock budget checked at VM safepoints, so a runaway loop in a
//   preview script errors instead of freezing the page.

#include "lua.h"
#include "luacode.h"
#include "lualib.h"

#include <emscripten.h>

#include <cstdlib>
#include <cstring>

extern "C" {

// Returned by the JS host-call handler in place of a result count.
static const int LB_ERROR = -1; // error message is on top of the stack
static const int LB_YIELD = -2; // yield the calling thread with no values

// The userdata tag that marks a host object. Payload: one int32 handle.
static const int LB_HOST_TAG = 1;

// Registry slot of the weak `handle -> userdata` cache.
static int hostCacheRef = LUA_NOREF;

static double deadline = 0;

EM_JS(int, lb_js_call, (lua_State * L, int id), { return Module.lbHostCall(L, id); });

EM_JS(void, lb_js_release, (int handle), { Module.lbHostRelease(handle); });

static int trampoline(lua_State* L)
{
    int id = int(lua_tonumber(L, lua_upvalueindex(1)));
    int n = lb_js_call(L, id);
    if (n == LB_ERROR)
        lua_error(L);
    if (n == LB_YIELD)
        return lua_yield(L, 0);
    return n;
}

static void hostDestructor(lua_State* L, void* data)
{
    lb_js_release(*static_cast<int*>(data));
}

static void interrupt(lua_State* L, int gc)
{
    // Never error from a GC step: only at execution safepoints.
    if (gc >= 0 || deadline <= 0)
        return;
    if (emscripten_get_now() > deadline)
    {
        deadline = 0;
        luaL_error(L, "script exceeded its time budget");
    }
}

static int traceback(lua_State* L)
{
    const char* message = lua_tostring(L, 1);
    lua_pushstring(L, message ? message : "(error object is not a string)");
    lua_pushstring(L, "\n");
    lua_pushstring(L, lua_debugtrace(L));
    lua_concat(L, 3);
    return 1;
}

// --- state -------------------------------------------------------------------

EMSCRIPTEN_KEEPALIVE lua_State* lb_open()
{
    lua_State* L = luaL_newstate();
    luaL_openlibs(L);
    lua_setuserdatadtor(L, LB_HOST_TAG, hostDestructor);
    lua_callbacks(L)->interrupt = interrupt;

    lua_newtable(L);
    lua_newtable(L);
    lua_pushstring(L, "v");
    lua_setfield(L, -2, "__mode");
    lua_setmetatable(L, -2);
    hostCacheRef = lua_ref(L, -1);
    lua_pop(L, 1);
    return L;
}

EMSCRIPTEN_KEEPALIVE void lb_close(lua_State* L)
{
    lua_close(L);
}

// Freeze the globals (and the built-in libraries) the way Roblox does. Script
// threads then get their own writable environment from `lb_sandboxthread`.
EMSCRIPTEN_KEEPALIVE void lb_sandbox(lua_State* L)
{
    luaL_sandbox(L);
}

EMSCRIPTEN_KEEPALIVE void lb_sandboxthread(lua_State* L)
{
    luaL_sandboxthread(L);
}

// Milliseconds from now until running Luau errors; 0 lifts the budget.
EMSCRIPTEN_KEEPALIVE void lb_budget(double ms)
{
    deadline = ms > 0 ? emscripten_get_now() + ms : 0;
}

EMSCRIPTEN_KEEPALIVE void lb_gc(lua_State* L)
{
    lua_gc(L, LUA_GCCOLLECT, 0);
}

// --- stack -------------------------------------------------------------------

enum Kind
{
    KIND_NIL = 0,
    KIND_BOOLEAN = 1,
    KIND_NUMBER = 2,
    KIND_STRING = 3,
    KIND_TABLE = 4,
    KIND_FUNCTION = 5,
    KIND_HOST = 6,
    KIND_THREAD = 7,
    KIND_OTHER = 8,
};

EMSCRIPTEN_KEEPALIVE int lb_kind(lua_State* L, int idx)
{
    switch (lua_type(L, idx))
    {
    case LUA_TNONE:
    case LUA_TNIL:
        return KIND_NIL;
    case LUA_TBOOLEAN:
        return KIND_BOOLEAN;
    case LUA_TNUMBER:
        return KIND_NUMBER;
    case LUA_TSTRING:
        return KIND_STRING;
    case LUA_TTABLE:
        return KIND_TABLE;
    case LUA_TFUNCTION:
        return KIND_FUNCTION;
    case LUA_TTHREAD:
        return KIND_THREAD;
    case LUA_TUSERDATA:
        return lua_touserdatatagged(L, idx, LB_HOST_TAG) ? KIND_HOST : KIND_OTHER;
    default:
        return KIND_OTHER;
    }
}

EMSCRIPTEN_KEEPALIVE int lb_gettop(lua_State* L)
{
    return lua_gettop(L);
}

EMSCRIPTEN_KEEPALIVE void lb_settop(lua_State* L, int idx)
{
    lua_settop(L, idx);
}

EMSCRIPTEN_KEEPALIVE void lb_pushvalue(lua_State* L, int idx)
{
    lua_pushvalue(L, idx);
}

EMSCRIPTEN_KEEPALIVE void lb_remove(lua_State* L, int idx)
{
    lua_remove(L, idx);
}

EMSCRIPTEN_KEEPALIVE void lb_insert(lua_State* L, int idx)
{
    lua_insert(L, idx);
}

EMSCRIPTEN_KEEPALIVE int lb_rawequal(lua_State* L, int a, int b)
{
    return lua_rawequal(L, a, b);
}

EMSCRIPTEN_KEEPALIVE void lb_xmove(lua_State* from, lua_State* to, int n)
{
    lua_xmove(from, to, n);
}

EMSCRIPTEN_KEEPALIVE int lb_checkstack(lua_State* L, int n)
{
    return lua_checkstack(L, n);
}

// --- reading -----------------------------------------------------------------

EMSCRIPTEN_KEEPALIVE double lb_tonumber(lua_State* L, int idx)
{
    return lua_tonumber(L, idx);
}

EMSCRIPTEN_KEEPALIVE int lb_toboolean(lua_State* L, int idx)
{
    return lua_toboolean(L, idx);
}

// Only for values of KIND_STRING: Luau converts numbers in place otherwise.
EMSCRIPTEN_KEEPALIVE const char* lb_tostring(lua_State* L, int idx, size_t* len)
{
    return lua_tolstring(L, idx, len);
}

// `tostring(v)` with metamethods — for printing any value.
EMSCRIPTEN_KEEPALIVE const char* lb_tostringmeta(lua_State* L, int idx, size_t* len)
{
    return luaL_tolstring(L, idx, len); // pushes the result
}

EMSCRIPTEN_KEEPALIVE int lb_tohost(lua_State* L, int idx)
{
    void* data = lua_touserdatatagged(L, idx, LB_HOST_TAG);
    return data ? *static_cast<int*>(data) : -1;
}

EMSCRIPTEN_KEEPALIVE lua_State* lb_tothread(lua_State* L, int idx)
{
    return lua_tothread(L, idx);
}

EMSCRIPTEN_KEEPALIVE const char* lb_typeof(lua_State* L, int idx)
{
    return luaL_typename(L, idx);
}

// --- pushing -----------------------------------------------------------------

EMSCRIPTEN_KEEPALIVE void lb_pushnil(lua_State* L)
{
    lua_pushnil(L);
}

EMSCRIPTEN_KEEPALIVE void lb_pushboolean(lua_State* L, int b)
{
    lua_pushboolean(L, b);
}

EMSCRIPTEN_KEEPALIVE void lb_pushnumber(lua_State* L, double n)
{
    lua_pushnumber(L, n);
}

EMSCRIPTEN_KEEPALIVE void lb_pushstring(lua_State* L, const char* s, size_t len)
{
    lua_pushlstring(L, s, len);
}

// A host function: calls `Module.lbHostCall(L, id)`.
EMSCRIPTEN_KEEPALIVE void lb_pushfunction(lua_State* L, int id, const char* name)
{
    lua_pushnumber(L, id);
    lua_pushcclosurek(L, trampoline, name, 1, nullptr);
}

// The userdata for `handle`, or a new one carrying the metatable at
// registry `metatableRef`. Returns 1 when it was created by this call, so JS
// can count how many live userdata hold the handle.
EMSCRIPTEN_KEEPALIVE int lb_pushhost(lua_State* L, int handle, int metatableRef)
{
    lua_getref(L, hostCacheRef);
    lua_rawgeti(L, -1, handle);
    if (!lua_isnil(L, -1))
    {
        lua_remove(L, -2);
        return 0;
    }
    lua_pop(L, 1);

    int* data = static_cast<int*>(lua_newuserdatatagged(L, sizeof(int), LB_HOST_TAG));
    *data = handle;
    lua_getref(L, metatableRef);
    lua_setmetatable(L, -2);

    lua_pushvalue(L, -1);
    lua_rawseti(L, -3, handle);
    lua_remove(L, -2);
    return 1;
}

// --- references --------------------------------------------------------------

EMSCRIPTEN_KEEPALIVE int lb_ref(lua_State* L, int idx)
{
    return lua_ref(L, idx);
}

EMSCRIPTEN_KEEPALIVE void lb_getref(lua_State* L, int ref)
{
    lua_getref(L, ref);
}

EMSCRIPTEN_KEEPALIVE void lb_unref(lua_State* L, int ref)
{
    lua_unref(L, ref);
}

// --- tables ------------------------------------------------------------------

EMSCRIPTEN_KEEPALIVE void lb_newtable(lua_State* L, int narr, int nrec)
{
    lua_createtable(L, narr, nrec);
}

// t[k] with k on top (popped, replaced by the value). Raw: no metamethods.
EMSCRIPTEN_KEEPALIVE void lb_rawget(lua_State* L, int idx)
{
    lua_rawget(L, idx);
}

// t[k] = v with k, v on top (both popped). Raw: no metamethods.
EMSCRIPTEN_KEEPALIVE void lb_rawset(lua_State* L, int idx)
{
    lua_rawset(L, idx);
}

EMSCRIPTEN_KEEPALIVE void lb_rawseti(lua_State* L, int idx, int n)
{
    lua_rawseti(L, idx, n);
}

EMSCRIPTEN_KEEPALIVE void lb_rawgeti(lua_State* L, int idx, int n)
{
    lua_rawgeti(L, idx, n);
}

EMSCRIPTEN_KEEPALIVE void lb_setfield(lua_State* L, int idx, const char* k)
{
    lua_rawsetfield(L, idx, k);
}

EMSCRIPTEN_KEEPALIVE void lb_getfield(lua_State* L, int idx, const char* k)
{
    lua_rawgetfield(L, idx, k);
}

EMSCRIPTEN_KEEPALIVE int lb_next(lua_State* L, int idx)
{
    return lua_next(L, idx);
}

EMSCRIPTEN_KEEPALIVE int lb_objlen(lua_State* L, int idx)
{
    return lua_objlen(L, idx);
}

EMSCRIPTEN_KEEPALIVE int lb_setmetatable(lua_State* L, int idx)
{
    return lua_setmetatable(L, idx);
}

EMSCRIPTEN_KEEPALIVE void lb_setreadonly(lua_State* L, int idx, int enabled)
{
    lua_setreadonly(L, idx, enabled);
}

EMSCRIPTEN_KEEPALIVE void lb_getglobal(lua_State* L, const char* name)
{
    lua_getglobal(L, name);
}

EMSCRIPTEN_KEEPALIVE void lb_setglobal(lua_State* L, const char* name)
{
    lua_setglobal(L, name);
}

// --- code --------------------------------------------------------------------

// Compile and load `source` as a function on top of the stack. Returns 0 on
// success; otherwise the compile error message is on top instead.
EMSCRIPTEN_KEEPALIVE int lb_load(lua_State* L, const char* chunkname, const char* source, size_t len)
{
    lua_CompileOptions options = {};
    options.optimizationLevel = 1;
    options.debugLevel = 1;
    size_t size = 0;
    char* bytecode = luau_compile(source, len, &options, &size);
    int status = luau_load(L, chunkname, bytecode, size, 0);
    free(bytecode);
    return status;
}

// pcall with a traceback appended to the error message.
EMSCRIPTEN_KEEPALIVE int lb_pcall(lua_State* L, int nargs, int nresults)
{
    int base = lua_gettop(L) - nargs;
    lua_pushcfunction(L, traceback, "traceback");
    lua_insert(L, base);
    int status = lua_pcall(L, nargs, nresults, base);
    lua_remove(L, base);
    return status;
}

// --- threads -----------------------------------------------------------------

// A new thread, pushed onto L (ref it to keep it alive).
EMSCRIPTEN_KEEPALIVE lua_State* lb_newthread(lua_State* L)
{
    return lua_newthread(L);
}

// A registry reference to thread L itself, so a suspended thread stays alive
// while JS holds on to it.
EMSCRIPTEN_KEEPALIVE int lb_refthread(lua_State* L)
{
    lua_pushthread(L);
    int ref = lua_ref(L, -1);
    lua_pop(L, 1);
    return ref;
}

EMSCRIPTEN_KEEPALIVE int lb_resume(lua_State* co, lua_State* from, int nargs)
{
    return lua_resume(co, from, nargs);
}

EMSCRIPTEN_KEEPALIVE int lb_status(lua_State* L)
{
    return lua_status(L);
}

// `coroutine.status(co)` as seen from L: 1 (LUA_COSUS) when co can be resumed.
EMSCRIPTEN_KEEPALIVE int lb_costatus(lua_State* L, lua_State* co)
{
    return lua_costatus(L, co);
}

EMSCRIPTEN_KEEPALIVE const char* lb_debugtrace(lua_State* L)
{
    return lua_debugtrace(L);
}

// The method name of the `__namecall` in progress, or null.
EMSCRIPTEN_KEEPALIVE const char* lb_namecall(lua_State* L)
{
    return lua_namecallatom(L, nullptr);
}

} // extern "C"
