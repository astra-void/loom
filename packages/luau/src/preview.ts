/**
 * `preview.ts` — a `*.loom.luau` file as a gallery target.
 *
 * The gallery shell mounts `preview.render` as a React component, so a Luau
 * target is one: it renders a ScreenGui and, once React has made it, runs the
 * target's source as a LocalScript inside it. The script shares the shell's
 * world — what it parents under `script.Parent` paints beside React's own
 * instances — and an error that stops its first run reaches the shell's error
 * boundary the way a throwing component's would.
 */
import { createInstance, game, type LoomInstance } from "@loom-dev/runtime";
import {
	createElement,
	type FunctionComponent,
	useEffect,
	useState,
} from "react";
import { createLuauVM, type LuauVMSetup } from "./mount.ts";
import { instantiateProject, type LuauProject } from "./project.ts";
import type { LuauError, LuauVM } from "./vm.ts";

export interface LuauPreviewOptions extends LuauVMSetup {
	/** The script's `Name`, and its chunk name in errors. */
	readonly name: string;
	/** The gallery sidebar label; the file name when omitted. */
	readonly title?: string;
	/** The project around the target, so its `require`s find their modules. */
	readonly project?: LuauProject;
}

export interface LuauPreview {
	readonly title: string;
	readonly render: FunctionComponent;
}

function playerGui(): LoomInstance {
	const player = game.GetService("Players").LocalPlayer as LoomInstance;
	return player.WaitForChild("PlayerGui") as LoomInstance;
}

/** The `preview` export a `*.loom.luau` file compiles to. */
export function luauPreview(
	source: string,
	options: LuauPreviewOptions,
): LuauPreview {
	function LuauTarget() {
		const [gui, setGui] = useState<LoomInstance | null>(null);
		const [failure, setFailure] = useState<LuauError>();
		if (failure) throw failure;

		useEffect(() => {
			if (gui === null) return;
			let vm: LuauVM | undefined;
			let cancelled = false;
			// A target may parent a ScreenGui straight to PlayerGui; that one is
			// not under React, so unmounting has to take it away by hand.
			const before = new Set(playerGui().GetChildren());
			void createLuauVM(options).then((created) => {
				if (cancelled) {
					created.close();
					return;
				}
				vm = created;
				if (options.project) instantiateProject(options.project);
				const script = createInstance("LocalScript", options.name);
				script.Parent = gui;
				const result = created.run(source, {
					chunkname: `=${options.name}`,
					globals: { script },
				});
				if (result.status === "error") setFailure(result.error);
			}, setFailure);
			return () => {
				cancelled = true;
				vm?.close();
				for (const child of playerGui().GetChildren()) {
					if (!before.has(child)) child.Destroy();
				}
			};
		}, [gui]);

		return createElement("screengui", {
			ref: setGui,
			Name: options.name,
			ResetOnSpawn: false,
		});
	}
	LuauTarget.displayName = `LuauTarget(${options.name})`;
	return { title: options.title ?? options.name, render: LuauTarget };
}
