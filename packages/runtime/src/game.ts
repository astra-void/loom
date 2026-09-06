/**
 * `game.ts` — the `DataModel` root and its service directory.
 *
 * `game` is a real `LoomInstance` (`ClassName === "DataModel"`), so tree APIs
 * work on it, and `GetService` resolves registered singleton factories
 * (`services.ts` populates the registry and pre-builds the trees that
 * `WaitForChild` touches synchronously). Registering a service also hands the
 * DataModel the property Roblox has for it: services are children of `game`
 * there, so `game.Workspace` and `game.Players` have to resolve — lazily,
 * through `GetService`, so registering never costs a construction.
 *
 * Unknown services still resolve to a warned stub rather than throwing, because
 * a preview should not die on an exotic service it merely *mentions*. What the
 * stub refuses is being *called*: `DataStoreService:GetDataStore("x")` used to
 * hand back `undefined`, and the crash then landed on the next line that
 * touched the result — a stack trace pointing at app code that was never the
 * problem. Now the call itself says which service and which member loom does
 * not implement.
 */
import {
	createInstance,
	type LoomInstance,
	registerClassMethods,
	registerPropertyReader,
} from "./instance";
import { type LoomConnection, LoomSignal } from "./signal";

/** The `DataModel` face: `LoomInstance` plus the place-level API. */
export interface DataModel extends LoomInstance {
	GetService(name: string): LoomInstance;
	FindService(name: string): LoomInstance | undefined;
	IsLoaded(): boolean;
	BindToClose(callback: () => void): void;
	readonly PlaceId: number;
	readonly GameId: number;
	readonly JobId: string;
	readonly Loaded: LoomSignal<[]>;
}

const factories = new Map<string, () => LoomInstance>();
const singletons = new Map<string, LoomInstance>();

/** The fake place root every preview shares. */
export const game: DataModel = createInstance("DataModel", "Game") as DataModel;

/**
 * Register a service singleton factory. Called by `services.ts` (and
 * `tween.ts`) at module load; the factory runs at most once, on first
 * `GetService`.
 *
 * The matching `game.<Name>` property is registered here rather than from a
 * hand-kept list, so a service can never be reachable through `GetService` and
 * missing from the DataModel — the two go in together or not at all.
 */
export function registerService(
	name: string,
	factory: () => LoomInstance,
): void {
	factories.set(name, factory);
	registerPropertyReader("DataModel", name, () => getService(name));
}

/**
 * Member-name prefixes that mark a stub member as a *call* rather than a value.
 *
 * A `get` cannot tell `service.Foo()` from `if service.Foo then` — by the time
 * the call happens the property read is over — so the stub has to guess from
 * the name, and Roblox's own naming is what makes that guess a good one: its
 * methods are verbs (`GetDataStore`, `PromptPurchase`, `PublishAsync`) and its
 * properties are nouns and participles (`RequestQueueSize`, `Loaded`,
 * `Enabled`). The prefix must be followed by an upper-case letter or end the
 * name, which is what keeps `Loaded` a property while `LoadCharacter` is a
 * call.
 *
 * It is a heuristic and it will occasionally be wrong in the harmless
 * direction: a *property* on an unimplemented service whose name reads like a
 * verb phrase hands back a function instead of `undefined`. Only unregistered
 * services ever see this — every service loom implements answers from its own
 * class methods long before the fallback is reached.
 */
const METHOD_PREFIXES: readonly string[] = [
	"Activate",
	"Add",
	"Apply",
	"Attach",
	"Bind",
	"Broadcast",
	"Calculate",
	"Cancel",
	"Check",
	"Clear",
	"Clone",
	"Compute",
	"Create",
	"Deactivate",
	"Decrement",
	"Delete",
	"Deserialize",
	"Destroy",
	"Detach",
	"Disable",
	"Dispatch",
	"Enable",
	"Filter",
	"Find",
	"Fire",
	"Flush",
	"Generate",
	"Get",
	"Has",
	"Hide",
	"Increment",
	"Insert",
	"Invoke",
	"Is",
	"Kick",
	"List",
	"Load",
	"Lock",
	"Make",
	"Mark",
	"Move",
	"Open",
	"Pause",
	"Play",
	"Preload",
	"Prompt",
	"Publish",
	"Query",
	"Read",
	"Register",
	"Release",
	"Remove",
	"Rename",
	"Report",
	"Request",
	"Reset",
	"Resolve",
	"Restore",
	"Resume",
	"Save",
	"Select",
	"Send",
	"Serialize",
	"Set",
	"Show",
	"Start",
	"Step",
	"Stop",
	"Subscribe",
	"Teleport",
	"Toggle",
	"Translate",
	"Unbind",
	"Unlock",
	"Unregister",
	"Unsubscribe",
	"Update",
	"Upload",
	"Validate",
	"Wait",
	"Write",
];

/** Whether `member` reads as one of Roblox's verb-shaped method names. */
function looksLikeMethod(member: string): boolean {
	// The engine's own suffix for a yielding call, and the one that needs no
	// prefix table: `RequestAsync`, `GetProductInfo`… `UserOwnsGamePassAsync`.
	if (member.endsWith("Async")) return true;
	for (const prefix of METHOD_PREFIXES) {
		if (!member.startsWith(prefix)) continue;
		const next = member.charAt(prefix.length);
		if (next === "" || next !== next.toLowerCase()) return true;
	}
	return false;
}

/**
 * The instance `GetService` hands back for a service loom does not implement.
 *
 * A real `LoomInstance` underneath — it has a `ClassName`, it parents under
 * `game`, `IsA` and the tree API work, and app code that only ever *mentions*
 * the service keeps running. The wrapper adds one thing: a member that does not
 * exist and reads like a method call throws by name instead of being
 * `undefined`.
 *
 * The wrapper is a second Proxy rather than a hook inside `instance.ts`, which
 * has one visible consequence: `isLoomInstance(stub)` is false, so the stub
 * cannot be used as a `Parent` (that assignment throws its own clear
 * `TypeError`) and `typeOf(stub)` says `"table"`. `game.FindFirstChild(name)`
 * returns the unwrapped instance for the rare code that needs the real thing.
 */
function stubService(name: string): LoomInstance {
	// The warning waits until something reads a member this stub does not have,
	// rather than firing here.
	//
	// `@rbxts/services` is a barrel: `import { RunService } from "@rbxts/services"`
	// evaluates EVERY export in that module, so warning on construction printed a
	// wall of warnings about services the app had never mentioned — noise that
	// trains people to ignore the one warning that matters. Warning on any read is
	// no better, because `getService` itself probes `.Parent` on the way out.
	// Reads that land on a real member are the tree API this stub genuinely
	// supports and say nothing about the gap; it is the *missing* member that is
	// worth a word, and that is the one place app code can be standing.
	let warned = false;
	const instance = createInstance(name, name);
	// Parented here rather than by `getService`, which would otherwise probe
	// `.Parent` through the Proxy while it is still unset — an absent member by
	// the test above, and so a warning fired by loom's own bookkeeping.
	instance.Parent = game;
	return new Proxy(instance, {
		get(target, key) {
			const value = Reflect.get(target, key);
			if (value !== undefined || typeof key !== "string") return value;
			if (!warned) {
				warned = true;
				console.warn(
					`[loom] GetService("${name}") has no registered implementation — ` +
						`returning a stub instance, which has no "${key}"`,
				);
			}
			if (!looksLikeMethod(key)) return undefined;
			return () => {
				throw new Error(
					`[loom] ${name}:${key}() is not implemented — GetService("${name}") ` +
						`returned a stub because loom has no browser-side ${name}. ` +
						"Guard the call so it only runs in-game, or assign your own " +
						`stand-in member onto game:GetService("${name}") before the ` +
						"preview mounts.",
				);
			};
		},
	}) as LoomInstance;
}

/** Resolve (and cache) a service singleton, parenting it under `game`. */
export function getService(name: string): LoomInstance {
	const cached = singletons.get(name);
	if (cached) return cached;
	const factory = factories.get(name);
	const service = factory ? factory() : stubService(name);
	if (service.Parent === undefined) service.Parent = game;
	singletons.set(name, service);
	return service;
}

/**
 * `game.Loaded`, with one deliberate deviation from the engine.
 *
 * Roblox fires it once, when the place has finished loading, and a handler
 * connected after that moment never runs. In a preview *every* connection is
 * after that moment — the tree is complete before the first line of app code —
 * so a faithful signal would strand `game.Loaded:Connect(start)` forever. Each
 * connection is therefore invoked once on the next microtask: late, exactly as
 * the engine's own would be, but not never. Pair it with `IsLoaded()`, which is
 * the guard Roblox code already writes and which answers `true` here.
 */
class LoadedSignal extends LoomSignal<[]> {
	override Connect(callback: () => void): LoomConnection {
		const connection = super.Connect(callback);
		queueMicrotask(() => {
			// A handler disconnected inside the same tick asked not to run.
			if (connection.Connected) callback();
		});
		return connection;
	}
}

const loaded = new LoadedSignal({ name: "game.Loaded" });

/**
 * `BindToClose` callbacks, run on `pagehide`.
 *
 * Roblox runs these when a *server* shuts down, and gives them up to 30
 * seconds; a browser tab closing gives whatever the event handler can do
 * synchronously. That is the closest honest equivalent — a save-on-shutdown
 * hook fires at the one moment the preview has left — and it is a great deal
 * closer than a no-op for shared code that registers one at startup.
 */
const closeCallbacks: (() => void)[] = [];
let closeListenerAttached = false;

function runCloseCallbacks(): void {
	for (const callback of [...closeCallbacks]) {
		try {
			callback();
		} catch (err) {
			console.error("loom: a game:BindToClose callback threw:", err);
		}
	}
}

registerClassMethods("DataModel", {
	GetService: (_self: LoomInstance, name: string) => getService(name),
	/**
	 * Roblox's non-creating lookup: `FindService` answers only for services that
	 * exist. Every service loom has a factory for exists in the same sense — it
	 * is a member of the DataModel whose construction merely happens on demand —
	 * so those resolve, and anything else is `undefined` rather than a new stub.
	 * That is the whole difference from `GetService`, and it is why feature
	 * detection written as `game:FindService("X")` gives the right answer here.
	 */
	FindService: (_self: LoomInstance, name: string) =>
		factories.has(name) || singletons.has(name) ? getService(name) : undefined,
	IsLoaded: () => true,
	BindToClose: (_self: LoomInstance, callback: () => void) => {
		if (typeof callback !== "function") return undefined;
		closeCallbacks.push(callback);
		if (!closeListenerAttached && typeof addEventListener === "function") {
			closeListenerAttached = true;
			// `pagehide` rather than `beforeunload`: it also fires when the page
			// goes into the back/forward cache, which is the other way a preview
			// stops being on screen.
			addEventListener("pagehide", runCloseCallbacks);
		}
		return undefined;
	},
});

/**
 * The place identity, as an *unpublished* place reports it — which is exactly
 * what a preview is. Studio answers `0`, `0` and `""` for a place that has
 * never been published, so UI that prints a place id shows the same nothing it
 * would there instead of a number loom invented. Readers rather than stored
 * properties because all three are read-only in Roblox.
 */
registerPropertyReader("DataModel", "PlaceId", () => 0);
registerPropertyReader("DataModel", "GameId", () => 0);
registerPropertyReader("DataModel", "JobId", () => "");
registerPropertyReader("DataModel", "Loaded", () => loaded);
