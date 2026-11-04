/**
 * `bindings.ts` — Roblox, as Luau sees it, over `@loom-dev/runtime`.
 *
 * Nothing here re-implements Roblox: every Instance, datatype, enum and signal
 * a Luau script touches is the same JS object the react and vide adapters use,
 * reached through a `HostClass`. What this file decides is only the Luau shape
 * of each — which members are visible, what a method's result becomes, and
 * which calls yield — plus the `task` library and the globals around it.
 */
import {
	CFrame,
	Color3,
	ColorSequence,
	ColorSequenceKeypoint,
	Content,
	createInstance,
	DateTime,
	Enum,
	EnumItem,
	enumTypeName,
	Font,
	game,
	heartbeat,
	isLoomInstance,
	type LoomConnection,
	type LoomInstance,
	LoomSignal,
	NumberRange,
	NumberSequence,
	NumberSequenceKeypoint,
	Random,
	Rect,
	RobloxEnum,
	robloxEquals,
	TweenInfo,
	UDim,
	UDim2,
	Vector2,
	Vector3,
} from "@loom-dev/runtime";
import { PRELUDE } from "./prelude.ts";
import { getScriptSource } from "./project.ts";
import {
	type Classifier,
	type HostClass,
	LuauError,
	type LuauFunction,
	type LuauThread,
	type LuauVM,
	Suspend,
	type ThreadResult,
	Tuple,
	tuple,
} from "./vm.ts";

type Datatype = Record<string, unknown>;
/** A datatype class, compared by identity and read for its static members. */
type Constructor = object;

/** Every runtime datatype class, under its Roblox name. */
const DATATYPES: Readonly<Record<string, Constructor>> = {
	UDim,
	UDim2,
	Vector2,
	Vector3,
	Color3,
	ColorSequence,
	ColorSequenceKeypoint,
	NumberSequence,
	NumberSequenceKeypoint,
	NumberRange,
	Content,
	Rect,
	CFrame,
	TweenInfo,
	Font,
	Random,
	DateTime,
};

/** Roblox members are PascalCase; the JS-side `add`, `toString`, … are not members. */
const isMember = (key: unknown): key is string =>
	typeof key === "string" && /^[A-Z]/.test(key);

/**
 * The Roblox class surface, bound to one VM. `classify` is what the VM is
 * created with; `install` defines the globals once the VM exists.
 */
export interface RobloxBindings {
	readonly classify: Classifier;
	install(vm: LuauVM): void;
}

export function createRobloxBindings(): RobloxBindings {
	let vm: LuauVM | undefined;
	const current = (): LuauVM => {
		if (vm === undefined)
			throw new Error("loom luau: bindings used before install");
		return vm;
	};
	const connections = new WeakSet<LoomConnection>();

	// One wrapper per member name, so `inst.Destroy` is the same function every
	// time — the VM keeps every JS function it is handed, so a fresh closure per
	// read would grow without bound.
	const methodWrappers = new Map<
		string,
		(self: object, ...args: unknown[]) => unknown
	>();
	const method = (cls: HostClass, name: string) => {
		const key = `${cls.name}.${name}`;
		let wrapper = methodWrappers.get(key);
		if (wrapper === undefined) {
			wrapper = (self, ...args) => cls.namecall?.(self, name, args);
			methodWrappers.set(key, wrapper);
		}
		return wrapper;
	};

	// --- datatypes -------------------------------------------------------------

	const datatypeClasses = new Map<Constructor, HostClass<Datatype>>();
	for (const [name, ctor] of Object.entries(DATATYPES)) {
		datatypeClasses.set(ctor, datatypeClass(name));
	}

	function datatypeClass(name: string): HostClass<Datatype> {
		const cls: HostClass<Datatype> = {
			name,
			index(self, key) {
				if (!isMember(key) || !(key in self)) {
					throw new LuauError(
						`${String(key)} is not a valid member of ${name}`,
					);
				}
				const value = self[key];
				return typeof value === "function" ? method(cls, key) : value;
			},
			newindex(_, key) {
				throw new LuauError(`${String(key)} cannot be assigned to`);
			},
			namecall(self, member, args) {
				const fn = isMember(member) ? self[member] : undefined;
				if (typeof fn !== "function") {
					throw new LuauError(`${member} is not a valid member of ${name}`);
				}
				// A Luau method that returns several values is a tuple in roblox-ts
				// (`ToHSV`, `GetComponents`), so an array result spreads.
				const result = fn.apply(self, args);
				return Array.isArray(result) ? new Tuple(result) : result;
			},
			tostring: (self) => String(self),
			eq: (a, b) => robloxEquals(a, b),
			unm(self) {
				if (typeof self.mul !== "function")
					return arithmeticError("unm", self, undefined);
				return (self.mul as (n: number) => unknown)(-1);
			},
			add: (a, b) => arithmetic("add", a, b),
			sub: (a, b) => arithmetic("sub", a, b),
			mul: (a, b) => arithmetic("mul", a, b),
			div: (a, b) => arithmetic("div", a, b),
		};
		return cls;
	}

	function arithmetic(
		op: "add" | "sub" | "mul" | "div",
		a: unknown,
		b: unknown,
	): unknown {
		const left = a as Datatype | undefined;
		if (typeof left?.[op] === "function")
			return (left[op] as (b: unknown) => unknown)(b);
		// `2 * v`: only multiplication commutes with a number on the left.
		const right = b as Datatype | undefined;
		if (
			op === "mul" &&
			typeof a === "number" &&
			typeof right?.mul === "function"
		) {
			return (right.mul as (n: number) => unknown)(a);
		}
		return arithmeticError(op, a, b);
	}

	function arithmeticError(op: string, a: unknown, b: unknown): never {
		throw new LuauError(
			`attempt to perform arithmetic (${op}) on ${typeName(a)} and ${typeName(b)}`,
		);
	}

	/** `UDim2.new`, `Color3.fromRGB`, `Vector2.zero`, … as a plain table. */
	function library(ctor: Constructor): Record<string, unknown> {
		const lib: Record<string, unknown> = {};
		for (const key of Object.getOwnPropertyNames(ctor)) {
			if (key === "length" || key === "name" || key === "prototype") continue;
			const value = (ctor as unknown as Record<string, unknown>)[key];
			lib[key] =
				typeof value === "function"
					? (...args: unknown[]) =>
							(value as (...a: unknown[]) => unknown).apply(ctor, args)
					: value;
		}
		return lib;
	}

	// --- Enum ------------------------------------------------------------------

	const EnumsClass: HostClass<typeof Enum> = {
		name: "Enums",
		index(self, key) {
			const value =
				typeof key === "string"
					? (self as Record<string, unknown>)[key]
					: undefined;
			if (value instanceof RobloxEnum) return value;
			if (key === "GetEnums") return method(EnumsClass, key);
			throw new LuauError(`${String(key)} is not a valid member of "Enum"`);
		},
		namecall(self, member) {
			if (member === "GetEnums") return self.GetEnums();
			throw new LuauError(`${member} is not a valid member of "Enum"`);
		},
		tostring: () => "Enums",
	};

	const EnumClass: HostClass<RobloxEnum> = {
		name: "Enum",
		index(self, key) {
			const value =
				typeof key === "string"
					? (self as unknown as Record<string, unknown>)[key]
					: undefined;
			if (value instanceof EnumItem) return value;
			if (key === "GetEnumItems" || key === "FromName" || key === "FromValue") {
				return method(EnumClass, key);
			}
			throw new LuauError(`${String(key)} is not a valid EnumItem`);
		},
		namecall(self, member, args) {
			switch (member) {
				case "GetEnumItems":
					return self.GetEnumItems();
				case "FromName":
					return self.FromName(args[0] as string);
				case "FromValue":
					return self.FromValue(args[0] as number);
			}
			throw new LuauError(`${member} is not a valid member of ${String(self)}`);
		},
		tostring: (self) => String(self),
	};

	const EnumItemClass: HostClass<EnumItem> = {
		name: "EnumItem",
		index(self, key) {
			if (key === "Name" || key === "Value" || key === "EnumType")
				return self[key];
			if (key === "IsA") return method(EnumItemClass, key);
			throw new LuauError(
				`${String(key)} is not a valid member of "${String(self)}"`,
			);
		},
		namecall(self, member, args) {
			if (member === "IsA") return enumTypeName(self) === args[0];
			throw new LuauError(
				`${member} is not a valid member of "${String(self)}"`,
			);
		},
		tostring: (self) => String(self),
	};

	// --- signals ---------------------------------------------------------------

	const SignalClass: HostClass<LoomSignal<unknown[]>> = {
		name: "RBXScriptSignal",
		index(_, key) {
			if (
				key === "Connect" ||
				key === "ConnectParallel" ||
				key === "Once" ||
				key === "Wait"
			) {
				return method(SignalClass, key);
			}
			throw new LuauError(
				`${String(key)} is not a valid member of RBXScriptSignal`,
			);
		},
		namecall(self, member, args) {
			switch (member) {
				case "Connect":
				case "ConnectParallel":
				case "Once": {
					const fn = args[0] as LuauFunction;
					// Every handler runs in its own thread, so it may yield. A VM that
					// has been unmounted has no threads left to give it.
					const handler = (...values: unknown[]) => {
						const vm = current();
						if (!vm.isClosed) vm.spawn(fn, values);
					};
					const connection =
						member === "Once" ? self.Once(handler) : self.Connect(handler);
					connections.add(connection);
					return connection;
				}
				case "Wait":
					return new Suspend((resume) => {
						self.Once((...values) => resume(...values));
					});
			}
			throw new LuauError(`${member} is not a valid member of RBXScriptSignal`);
		},
		tostring: () => "Signal",
	};

	const ConnectionClass: HostClass<LoomConnection> = {
		name: "RBXScriptConnection",
		index(self, key) {
			if (key === "Connected") return self.Connected;
			if (key === "Disconnect") return method(ConnectionClass, key);
			throw new LuauError(
				`${String(key)} is not a valid member of RBXScriptConnection`,
			);
		},
		namecall(self, member) {
			if (member === "Disconnect") return self.Disconnect();
			throw new LuauError(
				`${member} is not a valid member of RBXScriptConnection`,
			);
		},
		tostring: () => "Connection",
	};

	// --- Instance --------------------------------------------------------------

	const InstanceClass: HostClass<LoomInstance> = {
		name: "Instance",
		index(self, key) {
			if (typeof key !== "string") {
				throw new LuauError(
					`${String(key)} is not a valid member of ${self.ClassName}`,
				);
			}
			const value = self[key];
			if (typeof value === "function") return method(InstanceClass, key);
			if (value !== undefined) return value;
			// `script.Parent.Frame`: a property wins over a child of the same name.
			return self.FindFirstChild(key);
		},
		newindex(self, key, value) {
			(self as Record<string, unknown>)[key as string] = value;
		},
		namecall(self, member, args) {
			if (member === "WaitForChild")
				return waitForChild(
					self,
					args[0] as string,
					args[1] as number | undefined,
				);
			if (member === "GetAttributes")
				return Object.fromEntries(self.GetAttributes());
			const fn = self[member];
			if (typeof fn !== "function") {
				throw new LuauError(
					`${member} is not a valid member of ${self.ClassName} "${self.Name}"`,
				);
			}
			const result = (fn as (...a: unknown[]) => unknown)(...args);
			if (result instanceof Promise) {
				return new Suspend((resume) => {
					result.then((value) => resume(value));
				});
			}
			return result;
		},
		tostring: (self) => self.Name,
	};

	// --- require ---------------------------------------------------------------

	type Loaded =
		| { state: "running" }
		| { state: "waiting"; waiters: Array<() => void> }
		| { state: "done"; value: unknown }
		| { state: "failed" };
	const modules = new Map<LoomInstance, Loaded>();

	/**
	 * `require(moduleScript)`, as `(ok, valueOrMessage)` for the prelude's
	 * `require` to raise from. A module runs once per VM, in its own thread, with
	 * itself as `script`. Whoever requires it while it is still yielding waits
	 * for it; requiring it again from inside its own first run is the recursion
	 * Roblox reports.
	 */
	function requireModule(module: unknown, from?: unknown): unknown {
		if (typeof module === "string") {
			const resolved = resolveRequirePath(module, from);
			if (typeof resolved === "string") return tuple(false, resolved);
			module = resolved;
		}
		if (!isLoomInstance(module) || !module.IsA("ModuleScript")) {
			return tuple(
				false,
				"Attempted to call require with invalid argument(s).",
			);
		}
		const loaded = modules.get(module);
		if (loaded !== undefined) return settle(module, loaded);
		const source = getScriptSource(module);
		if (source === undefined) {
			return tuple(false, `${module.GetFullName()} has no source loom can run`);
		}
		modules.set(module, { state: "running" });
		const result = current().run(source, {
			chunkname: `=${module.GetFullName()}`,
			globals: { script: module },
			onFinish: (ended) => finishModule(module, ended),
		});
		// Still running means it yielded: `onFinish` settles it later.
		if (result.status === "yielded")
			modules.set(module, { state: "waiting", waiters: [] });
		return settle(module, modules.get(module) as Loaded);
	}

	/** `module`'s thread ended: keep what it returned and wake whoever waits on it. */
	function finishModule(module: LoomInstance, result: ThreadResult): void {
		const before = modules.get(module);
		let after: Loaded = { state: "failed" };
		if (result.status === "done") {
			if (result.values.length === 1)
				after = { state: "done", value: result.values[0] };
			else {
				current().report(
					new LuauError(
						`${module.GetFullName()}: Module code did not return exactly one value`,
					),
				);
			}
		}
		modules.set(module, after);
		if (before?.state === "waiting") for (const wake of before.waiters) wake();
	}

	/** What a `require` of `module`, currently `loaded`, hands back. */
	function settle(module: LoomInstance, loaded: Loaded): unknown {
		switch (loaded.state) {
			case "done":
				return tuple(true, loaded.value);
			case "failed":
				return tuple(
					false,
					"Requested module experienced an error while loading",
				);
			case "running":
				return tuple(false, "Requested module was required recursively");
			case "waiting":
				return new Suspend((resume) => {
					loaded.waiters.push(() => {
						const now = settle(module, modules.get(module) as Loaded) as Tuple;
						resume(...now.values);
					});
				});
		}
	}

	/** The real `WaitForChild`: yield until the child turns up, or `timeout` runs out. */
	function waitForChild(
		parent: LoomInstance,
		name: string,
		timeout?: number,
	): unknown {
		const existing = parent.FindFirstChild(name);
		if (existing !== undefined) return existing;
		return new Suspend((resume) => {
			let timer: ReturnType<typeof setTimeout> | undefined;
			const connection = parent.ChildAdded.Connect((child) => {
				if (child.Name !== name) return;
				connection.Disconnect();
				if (timer !== undefined) clearTimeout(timer);
				resume(child);
			});
			if (timeout !== undefined) {
				timer = setTimeout(() => {
					connection.Disconnect();
					resume(undefined);
				}, timeout * 1000);
			}
		});
	}

	// --- classify + globals ----------------------------------------------------

	const classify: Classifier = (value) => {
		if (isLoomInstance(value)) return InstanceClass as HostClass;
		if (value instanceof LoomSignal) return SignalClass as HostClass;
		if (connections.has(value as LoomConnection))
			return ConnectionClass as HostClass;
		if (value instanceof EnumItem) return EnumItemClass as HostClass;
		if (value instanceof RobloxEnum) return EnumClass as HostClass;
		if (value === Enum) return EnumsClass as HostClass;
		return datatypeClasses.get(value.constructor as Constructor) as
			| HostClass
			| undefined;
	};

	function install(target: LuauVM): void {
		vm = target;
		for (const [name, ctor] of Object.entries(DATATYPES))
			target.setGlobal(name, library(ctor));
		target.setGlobal("Enum", Enum);
		target.setGlobal("game", game);
		target.setGlobal("workspace", game.Workspace);
		target.setGlobal("Instance", {
			new: (className: string, parent?: LoomInstance) => {
				const instance = createInstance(className);
				if (parent !== undefined) instance.Parent = parent;
				return instance;
			},
		});
		const started = performance.now();
		target.load(PRELUDE, "=loom.prelude").call({
			wait,
			defer: (thread: LuauThread, ...args: unknown[]) => {
				queueMicrotask(() => target.resumeThread(thread, args));
			},
			delay: (seconds: number, thread: LuauThread, ...args: unknown[]) => {
				afterSeconds(seconds, () => target.resumeThread(thread, args));
			},
			report: (message: string, traceback: string) => {
				target.report(new LuauError(message, message, traceback));
			},
			print: (line: string) => console.log(line),
			warn: (line: string) => console.warn(line),
			require: requireModule,
			tick: () => Date.now() / 1000,
			time: () => (performance.now() - started) / 1000,
		});
	}

	return { classify, install };
}

/**
 * Require-by-string, the engine's way: `@self/x` starts at the requiring
 * script itself, `./x` at its parent, `../x` one above that (each further
 * `..` climbs one more), and `@game/x` at the DataModel. Returns the instance
 * the path names, or the error message when it names none.
 */
function resolveRequirePath(
	path: string,
	from: unknown,
): LoomInstance | string {
	const parts = path.split("/");
	const head = parts.shift();
	if (head === "@game")
		return walkPath(game as unknown as LoomInstance, parts, path, "game");
	if (head !== "@self" && head !== "." && head !== "..")
		return `require("${path}"): a path must start with "./", "../", "@self/" or "@game/"`;
	if (!isLoomInstance(from))
		return `require("${path}"): cannot resolve a path outside a script`;
	const parent = from.Parent as LoomInstance | undefined;
	const start =
		head === "@self"
			? from
			: head === "."
				? parent
				: (parent?.Parent as LoomInstance | undefined);
	return walkPath(start, parts, path, from.GetFullName());
}

/** Follow `parts` (child names, or `..` for a parent) down from `at`. */
function walkPath(
	at: LoomInstance | undefined,
	parts: readonly string[],
	path: string,
	origin: string,
): LoomInstance | string {
	for (const part of parts) {
		if (at === undefined) break;
		if (part === "" || part === ".") continue;
		at =
			part === ".."
				? (at.Parent as LoomInstance | undefined)
				: (at.FindFirstChild(part) as LoomInstance | undefined);
	}
	return at ?? `require("${path}"): no module at that path from ${origin}`;
}

/** `task.wait`: yield until the first Heartbeat after `seconds`, return the time waited. */
function wait(seconds?: number): Suspend {
	const started = performance.now();
	return new Suspend((resume) => {
		afterSeconds(seconds ?? 0, () =>
			resume((performance.now() - started) / 1000),
		);
	});
}

/** Run `fn` on the first Heartbeat at least `seconds` from now — Roblox's resume point. */
function afterSeconds(seconds: number, fn: () => void): void {
	const deadline = performance.now() + Math.max(seconds, 0) * 1000;
	const connection = heartbeat.Connect(() => {
		if (performance.now() < deadline) return;
		connection.Disconnect();
		fn();
	});
}

function typeName(value: unknown): string {
	if (value === undefined || value === null) return "nil";
	if (typeof value !== "object") return typeof value;
	const entry = Object.entries(DATATYPES).find(
		([, ctor]) => value.constructor === ctor,
	);
	return entry?.[0] ?? "userdata";
}
