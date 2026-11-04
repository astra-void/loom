import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { ComputeLayout } from "@loom-dev/react";
import type { LayoutResult, SceneNode } from "@loom-dev/scene";
import {
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import { type LuauMount, mountLuau } from "./mount.ts";

// Under happy-dom emscripten takes the web loader and would fetch the .wasm;
// hand it the bytes instead.
let wasmBinary: Uint8Array;
beforeAll(async () => {
	wasmBinary = await readFile(
		resolve(process.cwd(), "packages/luau/src/wasm/luau-vm.wasm"),
	);
});

/** Records the scene and gives every node the whole stage, like react's portal tests. */
function capturing(capture: { root?: SceneNode }): ComputeLayout {
	return (root): LayoutResult => {
		capture.root = root;
		const rects: LayoutResult["rects"] = {};
		const walk = (node: SceneNode): void => {
			rects[node.id ?? "?"] = { rect: { x: 0, y: 0, width: 800, height: 600 } };
			for (const child of node.children ?? []) walk(child);
		};
		walk(root);
		return { rects };
	};
}

function find(
	node: SceneNode | undefined,
	name: string,
): SceneNode | undefined {
	if (node === undefined) return undefined;
	if (node.name === name) return node;
	for (const child of node.children ?? []) {
		const hit = find(child, name);
		if (hit) return hit;
	}
	return undefined;
}

describe("mountLuau", () => {
	let target: HTMLElement;
	let capture: { root?: SceneNode };
	let mounted: LuauMount | undefined;

	beforeEach(() => {
		document.body.innerHTML = "";
		target = document.createElement("div");
		Object.defineProperty(target, "clientWidth", { value: 800 });
		Object.defineProperty(target, "clientHeight", { value: 600 });
		document.body.appendChild(target);
		capture = {};
	});
	afterEach(() => {
		mounted?.unmount();
		mounted = undefined;
	});

	const run = async (source: string) => {
		mounted = await mountLuau(source, {
			target,
			wasmBinary,
			computeLayout: capturing(capture),
			onError: (error) => {
				throw error;
			},
		});
		return mounted;
	};

	it("paints what a LocalScript parents under script.Parent", async () => {
		await run(`
			local card = Instance.new("Frame")
			card.Name = "Card"
			card.Size = UDim2.fromOffset(320, 120)
			card.BackgroundColor3 = Color3.fromRGB(24, 27, 34)
			card.Parent = script.Parent
		`);
		const card = find(capture.root, "Card");
		expect(card?.className).toBe("Frame");
		expect(card?.properties?.Size).toEqual({
			type: "UDim2",
			value: { x: { scale: 0, offset: 320 }, y: { scale: 0, offset: 120 } },
		});
		expect(target.querySelector('[data-loom-name="Card"]')).not.toBeNull();
		// The script itself is not something the renderer paints.
		expect(target.querySelector('[data-loom-class="LocalScript"]')).toBeNull();
	});

	it("repaints when the script changes the tree after a yield", async () => {
		await run(`
			local label = Instance.new("TextLabel")
			label.Name = "Ticks"
			label.Text = "ticks: 0"
			label.Parent = script.Parent
			task.wait(0.01)
			label.Text = "ticks: 1"
		`);
		expect(find(capture.root, "Ticks")?.properties?.Text).toEqual({
			type: "string",
			value: "ticks: 0",
		});
		await vi.waitFor(() =>
			expect(find(capture.root, "Ticks")?.properties?.Text).toEqual({
				type: "string",
				value: "ticks: 1",
			}),
		);
	});

	it("renders a ScreenGui parented straight to PlayerGui as its own layer", async () => {
		await run(`
			local gui = Instance.new("ScreenGui")
			gui.Name = "Overlay"
			local box = Instance.new("Frame", gui)
			box.Name = "Box"
			gui.Parent = game:GetService("Players").LocalPlayer:WaitForChild("PlayerGui")
		`);
		expect(find(capture.root, "Overlay")?.className).toBe("ScreenGui");
		expect(target.querySelector('[data-loom-name="Box"]')).not.toBeNull();
	});

	it("clears the stage on unmount", async () => {
		const mount = await run(`
			local f = Instance.new("Frame")
			f.Name = "Gone"
			f.Parent = script.Parent
		`);
		mount.unmount();
		mounted = undefined;
		expect(target.querySelector('[data-loom-name="Gone"]')).toBeNull();
	});
});
