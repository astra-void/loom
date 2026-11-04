// @vitest-environment node
import { game, type LoomInstance } from "@loom-dev/runtime";
import { describe, expect, it, vi } from "vitest";
import { createLuauVM } from "./mount.ts";
import {
	cloneWithSources,
	getScriptSource,
	instantiateProject,
	type LuauProject,
	type LuauProjectNode,
	startClient,
} from "./project.ts";
import type { LuauError } from "./vm.ts";

// Every test builds into the one runtime `game`, so each names its own folder.
let unique = 0;
const fresh = (prefix: string) => `${prefix}${++unique}`;

const module = (name: string, source: string): LuauProjectNode => ({
	name,
	className: "ModuleScript",
	source,
});
const folder = (
	name: string,
	...children: LuauProjectNode[]
): LuauProjectNode => ({
	name,
	className: "Folder",
	children,
});
const place = (services: Record<string, LuauProjectNode[]>): LuauProject => ({
	tree: {
		name: "DataModel",
		className: "DataModel",
		children: Object.entries(services).map(([name, children]) => ({
			name,
			className: name,
			children,
		})),
	},
});

/** Run `source` as a LocalScript in a fresh VM, collecting what it `log`s. */
async function client(
	source: string,
	onError: (error: LuauError) => void = () => {},
) {
	const vm = await createLuauVM({ onError });
	const log: unknown[] = [];
	const result = vm.run(source, {
		globals: {
			log: (...values: unknown[]) => {
				log.push(values.length === 1 ? values[0] : values);
			},
		},
	});
	return { vm, log, result };
}

describe("instantiateProject", () => {
	it("builds the tree into its services, keeping each script's source", () => {
		const name = fresh("Shared");
		instantiateProject(
			place({ ReplicatedStorage: [folder(name, module("Util", "return 1"))] }),
		);
		const util = game
			.GetService("ReplicatedStorage")
			.FindFirstChild(name)
			?.FindFirstChild("Util");
		expect(util?.ClassName).toBe("ModuleScript");
		expect(getScriptSource(util as LoomInstance)).toBe("return 1");
	});

	it("keeps sources through a clone", () => {
		const name = fresh("Kit");
		instantiateProject(
			place({ ReplicatedStorage: [folder(name, module("A", "return 'a'"))] }),
		);
		const original = game
			.GetService("ReplicatedStorage")
			.FindFirstChild(name) as LoomInstance;
		const copy = cloneWithSources(original) as LoomInstance;
		expect(getScriptSource(copy.FindFirstChild("A") as LoomInstance)).toBe(
			"return 'a'",
		);
	});
});

describe("startClient", () => {
	it("starts ReplicatedFirst, then StarterGui in PlayerGui, then StarterPlayerScripts", () => {
		const first = fresh("First");
		const gui = fresh("Gui");
		const scripts = fresh("Scripts");
		const local = (name: string): LuauProjectNode => ({
			name,
			className: "LocalScript",
			source: "",
		});
		instantiateProject({
			tree: {
				name: "DataModel",
				className: "DataModel",
				children: [
					{
						name: "ReplicatedFirst",
						className: "ReplicatedFirst",
						children: [local(first)],
					},
					{
						name: "StarterGui",
						className: "StarterGui",
						children: [
							{
								name: gui,
								className: "ScreenGui",
								children: [local(`${gui}Script`)],
							},
						],
					},
					{
						name: "StarterPlayer",
						className: "StarterPlayer",
						children: [
							{
								name: "StarterPlayerScripts",
								className: "StarterPlayerScripts",
								children: [folder(scripts, local(`${scripts}Main`))],
							},
						],
					},
					// A server Script is part of the place, but a client never runs it.
					{
						name: "ServerScriptService",
						className: "ServerScriptService",
						children: [
							{ name: fresh("Server"), className: "Script", source: "" },
						],
					},
				],
			},
		});
		const started = startClient().map(({ script }) => script.GetFullName());
		const mine = started.filter((n) =>
			[first, gui, scripts].some((x) => n.includes(x)),
		);
		expect(mine).toEqual([
			`ReplicatedFirst.${first}`,
			expect.stringMatching(new RegExp(`PlayerGui\\.${gui}\\.${gui}Script$`)),
			expect.stringMatching(
				new RegExp(`PlayerScripts\\.${scripts}\\.${scripts}Main$`),
			),
		]);
	});
});

describe("require", () => {
	it("runs a module once, as itself, and shares what it returns", async () => {
		const name = fresh("Lib");
		instantiateProject(
			place({
				ReplicatedStorage: [
					folder(
						name,
						module(
							"Counter",
							"local n = 0 return { bump = function() n += 1 return n end, name = script.Name }",
						),
						module("Uses", "return require(script.Parent.Counter)"),
					),
				],
			}),
		);
		const { log, result } = await client(`
			local lib = game:GetService("ReplicatedStorage").${name}
			local a, b = require(lib.Counter), require(lib.Uses)
			log(a == b, a.name, a.bump(), b.bump())
		`);
		expect(result.status).toBe("done");
		expect(log).toEqual([[true, "Counter", 1, 2]]);
	});

	it("lets a requirer wait for a module that yields", async () => {
		const name = fresh("Slow");
		instantiateProject(
			place({
				ReplicatedStorage: [module(name, "task.wait(0.01) return 'ready'")],
			}),
		);
		const { log, result } = await client(`
			task.spawn(function() log("first", require(game.ReplicatedStorage.${name})) end)
			log("second", require(game.ReplicatedStorage.${name}))
		`);
		expect(result.status).toBe("yielded");
		await vi.waitFor(() =>
			expect(log).toEqual([
				["first", "ready"],
				["second", "ready"],
			]),
		);
	});

	it("reports recursion, a bad return, a failed module and a bad argument", async () => {
		const name = fresh("Bad");
		instantiateProject(
			place({
				ReplicatedStorage: [
					folder(
						name,
						module("Loop", "return require(script)"),
						module("Two", "return 1, 2"),
						module("Throws", "error('boom')"),
					),
				],
			}),
		);
		const onError = vi.fn();
		const { log } = await client(
			`
			local f = game.ReplicatedStorage.${name}
			for _, m in { f.Loop, f.Two, f.Throws, f.Throws } do
				log((select(2, pcall(require, m))))
			end
			log((select(2, pcall(require, Instance.new("Folder")))))
		`,
			onError,
		);
		expect(log).toEqual([
			"Requested module experienced an error while loading",
			"Requested module experienced an error while loading",
			"Requested module experienced an error while loading",
			"Requested module experienced an error while loading",
			"Attempted to call require with invalid argument(s).",
		]);
		const reported = onError.mock.calls.map(([e]) => (e as LuauError).message);
		expect(reported.some((m) => m.includes("required recursively"))).toBe(true);
		expect(
			reported.some((m) => m.includes("did not return exactly one value")),
		).toBe(true);
		expect(reported.some((m) => m.includes("boom"))).toBe(true);
		// A failed module is not run again.
		expect(reported.filter((m) => m.includes("boom"))).toHaveLength(1);
	});
});
