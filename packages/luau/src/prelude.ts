/**
 * `prelude.ts` — the Luau half of the globals.
 *
 * Runs once on the main state before the globals freeze, with a table of host
 * primitives as its argument (see `install` in `bindings.ts`). What lives here
 * is what is simplest to say in Luau itself: the `task` library on top of
 * `coroutine` and the host's resume points, and the `print`/`warn` that
 * `tostring` their arguments the way the engine does.
 */
export const PRELUDE = `
local host = ...

local function thread(f)
	return if type(f) == "thread" then f else coroutine.create(f)
end

local task = {}

function task.spawn(f, ...)
	local co = thread(f)
	local ok, err = coroutine.resume(co, ...)
	if not ok then
		host.report(tostring(err), debug.traceback(co))
	end
	return co
end

function task.defer(f, ...)
	local co = thread(f)
	host.defer(co, ...)
	return co
end

function task.delay(seconds, f, ...)
	local co = thread(f)
	host.delay(seconds or 0, co, ...)
	return co
end

task.wait = host.wait

function task.cancel(co)
	coroutine.close(co)
end

function task.synchronize() end
function task.desynchronize() end

_G.task = task
wait = task.wait
spawn = task.defer
delay = task.delay
tick = host.tick
time = host.time
elapsedTime = host.time

local function join(...)
	local n = select("#", ...)
	local parts = table.create(n)
	for i = 1, n do
		parts[i] = tostring((select(i, ...)))
	end
	return table.concat(parts, " ")
end

function print(...)
	host.print(join(...))
end

function warn(...)
	host.warn(join(...))
end

function require(module)
	local ok, value = host.require(module)
	if not ok then
		error(value, 2)
	end
	return value
end
`;
