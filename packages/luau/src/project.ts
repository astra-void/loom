/**
 * `project.ts` — a Rojo project as live instances, and the client's startup.
 *
 * The preview plugin reads a project from disk (`default.project.json`, or the
 * Rojo template's `src/{client,server,shared}` when there is none) and hands it
 * over as a `LuauProjectNode` tree with every script's source inlined. Here it
 * becomes real instances under the runtime's `game`: Folders, ModuleScripts,
 * LocalScripts and Scripts in their services, with each script's source kept
 * beside it — Roblox does not let a LocalScript read `Source`, and neither
 * does loom.
 *
 * `startClient` then does what a joining client does: run the LocalScripts in
 * ReplicatedFirst, copy StarterGui into PlayerGui and StarterPlayerScripts into
 * PlayerScripts, and run the LocalScripts that land there. Server Scripts are
 * instantiated (so `require` and `FindFirstChild` see them) but never run — a
 * preview is one client.
 */
import { createInstance, game, type LoomInstance } from "@loom-dev/runtime";

/** One instance of a project tree, as the preview plugin emits it. */
export interface LuauProjectNode {
	readonly name: string;
	readonly className: string;
	/** A script's source. */
	readonly source?: string;
	readonly children?: readonly LuauProjectNode[];
}

export interface LuauProject {
	/** The `DataModel` root; its children are services. */
	readonly tree: LuauProjectNode;
}

const SOURCES = new WeakMap<LoomInstance, string>();

/** Attach `source` to a script instance (what `require` and `startClient` run). */
export function setScriptSource(script: LoomInstance, source: string): void {
	SOURCES.set(script, source);
}

/** The source behind a script instance, if loom has one for it. */
export function getScriptSource(script: LoomInstance): string | undefined {
	return SOURCES.get(script);
}

/**
 * `Clone`, keeping every script's source. The runtime copies instances but
 * knows nothing about loom's source registry, so the two trees are walked side
 * by side — `Clone` keeps child order and drops the non-Archivable ones.
 */
export function cloneWithSources(
	original: LoomInstance,
): LoomInstance | undefined {
	const copy = original.Clone();
	if (copy !== undefined) copySources(original, copy);
	return copy;
}

function copySources(from: LoomInstance, to: LoomInstance): void {
	const source = SOURCES.get(from);
	if (source !== undefined) SOURCES.set(to, source);
	const kept = from.GetChildren().filter((child) => child.Archivable !== false);
	const copies = to.GetChildren();
	kept.forEach((child, i) => {
		const copy = copies[i];
		if (copy !== undefined) copySources(child, copy);
	});
}

const instantiated = new WeakSet<LuauProject>();

/**
 * Build `project` into the runtime's `game`, once per project object. A node
 * whose name and class match an instance that already exists (a service,
 * `StarterPlayerScripts`) is merged into it rather than duplicated.
 */
export function instantiateProject(project: LuauProject): void {
	if (instantiated.has(project)) return;
	instantiated.add(project);
	for (const child of project.tree.children ?? []) {
		const service = game.GetService(child.name);
		populate(service, child);
	}
}

function populate(parent: LoomInstance, node: LuauProjectNode): void {
	for (const child of node.children ?? []) {
		const existing = parent.FindFirstChild(child.name);
		const instance =
			existing?.ClassName === child.className
				? existing
				: createInstance(child.className, child.name);
		if (child.source !== undefined) setScriptSource(instance, child.source);
		populate(instance, child);
		instance.Parent = parent;
	}
}

/** A LocalScript to run, and the name errors should give it. */
export interface ClientScript {
	readonly script: LoomInstance;
	readonly source: string;
}

/**
 * The client's startup, in Roblox order: ReplicatedFirst's LocalScripts, then
 * StarterGui copied into PlayerGui, then StarterPlayerScripts copied into
 * PlayerScripts. Returns every LocalScript that should run, in that order.
 */
export function startClient(): ClientScript[] {
	const player = game.GetService("Players").LocalPlayer as LoomInstance;
	const playerGui = player.WaitForChild("PlayerGui") as LoomInstance;
	let playerScripts = player.FindFirstChildOfClass("PlayerScripts");
	if (playerScripts === undefined) {
		playerScripts = createInstance("PlayerScripts", "PlayerScripts");
		playerScripts.Parent = player;
	}

	const scripts: ClientScript[] = [];
	collect(game.GetService("ReplicatedFirst"), scripts);
	for (const child of game.GetService("StarterGui").GetChildren()) {
		const copy = cloneWithSources(child);
		if (copy === undefined) continue;
		copy.Parent = playerGui;
		collect(copy, scripts);
	}
	const starterScripts = game
		.GetService("StarterPlayer")
		.FindFirstChild("StarterPlayerScripts");
	for (const child of starterScripts?.GetChildren() ?? []) {
		const copy = cloneWithSources(child);
		if (copy === undefined) continue;
		copy.Parent = playerScripts;
		collect(copy, scripts);
	}
	return scripts;
}

/** `root` and its descendants' runnable LocalScripts, in tree order. */
function collect(root: LoomInstance, into: ClientScript[]): void {
	for (const instance of [root, ...root.GetDescendants()]) {
		if (instance.ClassName !== "LocalScript" || instance.Disabled === true)
			continue;
		const source = SOURCES.get(instance);
		if (source !== undefined) into.push({ script: instance, source });
	}
}
