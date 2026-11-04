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
import { type LuauError, LuauVM, type ThreadResult } from "./vm.ts";

export interface MountLuauOptions extends WorldOptions {
	/** The element to paint into; defaults to a fresh container under `#loom-root`. */
	target?: HTMLElement;
	/** The script's `Name`, which is also its chunk name in errors. */
	name?: string;
	/** Where an error that escapes a script thread goes. Defaults to `console.error`. */
	onError?: (error: LuauError) => void;
	/** Wall-clock milliseconds one entry into Luau may run. Defaults to 5000. */
	budgetMs?: number;
	/** The Luau VM's `.wasm` bytes, skipping the fetch (tests). */
	wasmBinary?: ArrayBuffer | Uint8Array;
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
	const bindings = createRobloxBindings();
	const vm = await LuauVM.create({
		classify: bindings.classify,
		budgetMs: options.budgetMs ?? 5000,
		...(options.wasmBinary ? { wasmBinary: options.wasmBinary } : {}),
		onError:
			options.onError ??
			((error) =>
				console.error(
					`${error.message}${error.traceback ? `\n${error.traceback}` : ""}`,
				)),
	});
	bindings.install(vm);

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
