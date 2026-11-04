/**
 * `mount.ts` — run a Luau LocalScript into a live loom preview.
 *
 * A Luau script builds instances imperatively and parents them under
 * `PlayerGui`, so what it needs from loom is exactly the react adapter's
 * world: the runtime PlayerGui as root, encoded → laid out → painted on every
 * dirty frame. `createWorld` is reused as-is; nothing in the layout engine or
 * the renderer knows the tree came from Luau.
 */
import { initLayout } from "@loom-dev/layout";
import { createWorld, type World, type WorldOptions } from "@loom-dev/react";
import { createInstance, type LoomInstance } from "@loom-dev/runtime";
import { createRobloxBindings } from "./bindings.ts";
import {
	instantiateProject,
	type LuauProject,
	startClient,
} from "./project.ts";
import { type LuauError, LuauVM, type ThreadResult } from "./vm.ts";

/** How a Roblox-flavoured Luau VM is made: shared by every entry point. */
export interface LuauVMSetup {
	/** Where an error that escapes a script thread goes. Defaults to `console.error`. */
	onError?: (error: LuauError) => void;
	/** Wall-clock milliseconds one entry into Luau may run. Defaults to 5000. */
	budgetMs?: number;
	/** The Luau VM's `.wasm` bytes, skipping the fetch (tests). */
	wasmBinary?: ArrayBuffer | Uint8Array;
}

export interface MountLuauOptions extends LuauVMSetup, WorldOptions {
	/** The element to paint into; defaults to a fresh container under `#loom-root`. */
	target?: HTMLElement;
	/** The script's `Name`, which is also its chunk name in errors. */
	name?: string;
}

/** Print an escaped error the way the engine's output does: message, then stack. */
function printError(error: LuauError): void {
	console.error(
		`${error.message}${error.traceback ? `\n${error.traceback}` : ""}`,
	);
}

/** A fresh VM with Roblox's globals installed, ready to run scripts. */
export async function createLuauVM(setup: LuauVMSetup = {}): Promise<LuauVM> {
	const bindings = createRobloxBindings();
	const vm = await LuauVM.create({
		classify: bindings.classify,
		budgetMs: setup.budgetMs ?? 5000,
		...(setup.wasmBinary ? { wasmBinary: setup.wasmBinary } : {}),
		onError: setup.onError ?? printError,
	});
	bindings.install(vm);
	return vm;
}

export interface LuauMount {
	readonly vm: LuauVM;
	readonly world: World;
	/** The `LocalScript` the source runs as (`script` inside it). */
	readonly script: LoomInstance;
	/** How the script's thread first came back. */
	readonly result: ThreadResult;
	unmount(): void;
}

const HOST_ID = "loom-root";

/**
 * Where the world paints. An explicit `target` is the mount itself, as with
 * react's `render`; without one each mount gets its own container under the
 * preview viewport (`#loom-root`, created if the page lacks it), as react's
 * `createRoot` and vide's `mount` do, so independent mounts don't clobber.
 */
function resolveMount(target?: HTMLElement): {
	mount: HTMLElement;
	owned: boolean;
} {
	if (target) return { mount: target, owned: false };
	let viewport = document.getElementById(HOST_ID);
	if (!viewport) {
		viewport = document.createElement("div");
		viewport.id = HOST_ID;
		viewport.style.position = "relative";
		viewport.style.width = "100vw";
		viewport.style.height = "100vh";
		viewport.style.overflow = "hidden";
		document.body.appendChild(viewport);
	}
	const mount = document.createElement("div");
	mount.style.position = "absolute";
	mount.style.inset = "0";
	viewport.appendChild(mount);
	return { mount, owned: true };
}

/**
 * Run `source` as a LocalScript in a fresh VM and paint what it builds. The
 * script sits inside the world's default ScreenGui, so the common
 * `script.Parent` idiom lands its UI on screen, and anything it parents to
 * `Players.LocalPlayer.PlayerGui` renders as its own layer.
 */
export async function mountLuau(
	source: string,
	options: MountLuauOptions = {},
): Promise<LuauMount> {
	if (options.computeLayout === undefined) await initLayout();
	const vm = await createLuauVM(options);

	const { mount, owned } = resolveMount(options.target);
	const world = createWorld(mount, options);

	const name = options.name ?? "LocalScript";
	const script = createInstance("LocalScript", name);
	script.Parent = world.defaultGui;
	const result = vm.run(source, { chunkname: `=${name}`, globals: { script } });
	world.flushSync();

	return {
		vm,
		world,
		script,
		result,
		unmount() {
			world.dispose();
			vm.close();
			if (owned) mount.remove();
		},
	};
}

export interface RunLuauProjectOptions extends LuauVMSetup, WorldOptions {
	/** The element to paint into; defaults to a fresh container under `#loom-root`. */
	target?: HTMLElement;
}

export interface LuauProjectMount {
	readonly vm: LuauVM;
	readonly world: World;
	/** Every LocalScript the client started, with how its thread first came back. */
	readonly scripts: ReadonlyArray<{
		readonly script: LoomInstance;
		readonly result: ThreadResult;
	}>;
	unmount(): void;
}

/**
 * Start a Rojo project the way a client joins a place: build the tree into
 * `game`, then run every LocalScript a client runs (ReplicatedFirst, the
 * StarterGui copy in PlayerGui, the StarterPlayerScripts copy in
 * PlayerScripts) in one VM, so `require` shares each module between them.
 */
export async function runLuauProject(
	project: LuauProject,
	options: RunLuauProjectOptions = {},
): Promise<LuauProjectMount> {
	if (options.computeLayout === undefined) await initLayout();
	const vm = await createLuauVM(options);
	const { mount, owned } = resolveMount(options.target);
	const world = createWorld(mount, options);

	instantiateProject(project);
	const scripts = startClient().map(({ script, source }) => ({
		script,
		result: vm.run(source, {
			chunkname: `=${script.GetFullName()}`,
			globals: { script },
		}),
	}));
	world.flushSync();

	return {
		vm,
		world,
		scripts,
		unmount() {
			world.dispose();
			vm.close();
			if (owned) mount.remove();
		},
	};
}
