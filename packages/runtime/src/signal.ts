/**
 * `signal.ts` — RBXScriptSignal-shaped events for the live instance tree.
 *
 * `LoomSignal` mirrors the Roblox signal contract UI code depends on
 * (`Connect` → `{ Disconnect, Connected }`, `Once`, `ConnectParallel`, `Wait`)
 * while keeping the firing side (`fire`, `hasConnections`, `disconnectAll`)
 * internal to the runtime. Firing snapshots the listener list first, so a
 * handler that disconnects itself (or a sibling) mid-fire never skips the
 * remaining listeners, and connections made during a fire only run on the next
 * one.
 *
 * Every listener also runs inside its own try/catch, because Roblox gives each
 * connection its own thread: a handler that errors is reported to the output
 * and its siblings still run, and the code that raised the event never sees the
 * throw. Without that isolation a single bad `MouseButton1Click` handler takes
 * down the rest of the dispatch *and* unwinds whatever fired it — a DOM event
 * handler, a tween completion, or the frame scheduler, which would cost the
 * whole preview its `RenderStepped`/`Heartbeat` loop over one app-level bug.
 */

/** The object `Connect` returns — the Roblox `RBXScriptConnection` shape. */
export interface LoomConnection {
	/** Whether this connection still receives fires. */
	readonly Connected: boolean;
	/** Stop receiving fires. Safe to call more than once. */
	Disconnect(): void;
}

interface Listener<A extends unknown[]> {
	cb: (...args: A) => void;
	connected: boolean;
}

export interface LoomSignalOptions {
	/**
	 * Called after every successful `Connect`. Scheduler-driven signals
	 * (RenderStepped/Heartbeat) use this to kick the rAF loop on first listen.
	 */
	onConnect?: () => void;
	/**
	 * The signal's Roblox name (`"ChildAdded"`, `"RenderStepped"`), used only
	 * when reporting a listener that threw. A stack trace out of a `Proxy` get
	 * says nothing about which event misbehaved; the name is what makes the
	 * console line actionable. Signals created without one still report.
	 */
	name?: string;
}

/** A Roblox-shaped event signal, generic over its fire arguments. */
export class LoomSignal<A extends unknown[] = []> {
	private listeners: Listener<A>[] = [];
	private readonly onConnect: (() => void) | undefined;
	private readonly label: string;

	constructor(options?: LoomSignalOptions) {
		this.onConnect = options?.onConnect;
		this.label = options?.name ?? "an anonymous RBXScriptSignal";
	}

	/** Register `cb` to run on every fire until disconnected. */
	Connect(cb: (...args: A) => void): LoomConnection {
		const listener: Listener<A> = { cb, connected: true };
		const listeners = this.listeners;
		listeners.push(listener);
		this.onConnect?.();
		return {
			get Connected(): boolean {
				return listener.connected;
			},
			Disconnect(): void {
				if (!listener.connected) return;
				listener.connected = false;
				const index = listeners.indexOf(listener);
				if (index >= 0) listeners.splice(index, 1);
			},
		};
	}

	/** Register `cb` to run on the next fire only. */
	Once(cb: (...args: A) => void): LoomConnection {
		const connection = this.Connect((...args) => {
			// Disconnect first, exactly as Roblox does: the connection is already
			// dead by the time the handler runs, so a handler that throws (or that
			// re-fires the signal) still never gets a second turn.
			connection.Disconnect();
			cb(...args);
		});
		return connection;
	}

	/**
	 * Roblox's parallel-Luau connect.
	 *
	 * A browser page has one thread, so there is no desynchronized phase to
	 * defer the handler to and this is precisely `Connect` — the handler runs
	 * inline with the serial listeners instead of in the next parallel step.
	 * It exists because roblox-ts code that calls `ConnectParallel` would
	 * otherwise die on "not a function", and running the handler a phase too
	 * eagerly is far closer to the engine than not running it at all.
	 */
	ConnectParallel(cb: (...args: A) => void): LoomConnection {
		return this.Connect(cb);
	}

	/**
	 * The arguments of the next fire.
	 *
	 * Roblox yields the calling thread here and returns the fired arguments as
	 * a LuaTuple (`local a, b = sig:Wait()`). The browser has a single thread it
	 * is not allowed to block, so the honest stand-in is a thenable for that
	 * same tuple: `const [a, b] = await sig.Wait()`. Compiled roblox-ts that
	 * uses the result without awaiting gets a Promise instead of the values —
	 * the one part of `Wait` no browser runtime can close.
	 *
	 * The connection removes itself on that first fire (it is an `Once`), so a
	 * `Wait` nobody ever fires leaves no live listener behind on the signal.
	 */
	Wait(): Promise<A> {
		return new Promise<A>((resolve) => {
			this.Once((...args) => resolve(args));
		});
	}

	/** @internal Fire all currently connected listeners (snapshot iteration). */
	fire(...args: A): void {
		// The frame scheduler fires RenderStepped/Heartbeat every tick whether or
		// not anyone listens; don't copy an empty array 60 times a second.
		if (this.listeners.length === 0) return;
		for (const listener of [...this.listeners]) {
			if (!listener.connected) continue;
			try {
				listener.cb(...args);
			} catch (err) {
				// Reported, never rethrown: see the file comment. The firer is a DOM
				// event handler or the frame loop, and neither has anywhere sane to
				// put a UI handler's error — but swallowing it silently would leave
				// the app author debugging a listener that "just stopped running".
				console.error(`loom: a listener on ${this.label} threw:`, err);
			}
		}
	}

	/** @internal Whether any connection is live (drives the frame loop). */
	get hasConnections(): boolean {
		return this.listeners.length > 0;
	}

	/** @internal Sever every connection (instance destruction). */
	disconnectAll(): void {
		for (const listener of this.listeners) listener.connected = false;
		this.listeners = [];
	}
}
