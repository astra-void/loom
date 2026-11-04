// @vitest-environment happy-dom
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runLuauProject } from "../../luau/src/mount.ts";
import {
	generateLuauProjectModule,
	type LuauFileNode,
	readLuauProject,
} from "./luau-project.ts";
import { createRbxtsCompiler } from "./rbxts-compiler.ts";

const PREVIEW_MODULES = resolve(process.cwd(), "packages/preview/node_modules");

let roots: string[] = [];
afterEach(() => {
	for (const root of roots) rmSync(root, { recursive: true, force: true });
	roots = [];
});

/**
 * A roblox-ts game the way `rbxtsc` expects one: tsconfig, Rojo project, and
 * roblox-ts plus the typings linked in from this package's devDependencies.
 */
function rbxtsProject(
	files: Record<string, string>,
	{ withCompiler = true } = {},
): string {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "loom-rbxts-")));
	roots.push(root);
	const all: Record<string, string> = {
		"package.json": JSON.stringify({ name: "fixture", private: true }),
		"tsconfig.json": JSON.stringify({
			compilerOptions: {
				allowSyntheticDefaultImports: true,
				downlevelIteration: true,
				module: "commonjs",
				moduleResolution: "Node",
				noLib: true,
				strict: true,
				target: "ESNext",
				moduleDetection: "force",
				typeRoots: ["node_modules/@rbxts"],
				rootDir: "src",
				outDir: "out",
			},
		}),
		"default.project.json": JSON.stringify({
			name: "fixture",
			tree: {
				$className: "DataModel",
				ReplicatedStorage: {
					rbxts_include: {
						$path: "include",
						node_modules: {
							$className: "Folder",
							"@rbxts": { $path: "node_modules/@rbxts" },
						},
					},
					TS: { $path: "out/shared" },
				},
				StarterPlayer: {
					StarterPlayerScripts: { TS: { $path: "out/client" } },
				},
			},
		}),
		...files,
	};
	for (const [path, contents] of Object.entries(all)) {
		const file = join(root, path);
		mkdirSync(dirname(file), { recursive: true });
		writeFileSync(file, contents);
	}
	mkdirSync(join(root, "node_modules/@rbxts"), { recursive: true });
	for (const pkg of ["@rbxts/types", "@rbxts/compiler-types"])
		symlinkSync(join(PREVIEW_MODULES, pkg), join(root, "node_modules", pkg));
	if (withCompiler)
		symlinkSync(
			join(PREVIEW_MODULES, "roblox-ts"),
			join(root, "node_modules/roblox-ts"),
		);
	return root;
}

const GAME = {
	"src/shared/math.ts":
		"export function double(n: number) {\n\treturn n * 2;\n}\n",
	"src/shared/data.lua": "return { answer = 42 }\n",
	"src/client/main.client.ts": [
		'import { double } from "shared/math";',
		'const ReplicatedStorage = game.GetService("ReplicatedStorage");',
		'const data = require(ReplicatedStorage.WaitForChild("TS").WaitForChild("data") as ModuleScript) as { answer: number };',
		"print(double(21), data.answer);",
		"",
	].join("\n"),
};

/** `name:Class` paths of every script in the tree. */
function scripts(node: LuauFileNode, at = ""): string[] {
	const here = at ? `${at}.${node.name}` : node.name;
	return [
		...(node.file ? [`${here}:${node.className}`] : []),
		...(node.children ?? []).flatMap((child) => scripts(child, here)),
	];
}

describe("createRbxtsCompiler", () => {
	it("compiles into memory and lays out/ and include/ over the Rojo tree", () => {
		const root = rbxtsProject({
			...GAME,
			"tsconfig.json": JSON.stringify({
				compilerOptions: {
					allowSyntheticDefaultImports: true,
					downlevelIteration: true,
					module: "commonjs",
					moduleResolution: "Node",
					noLib: true,
					strict: true,
					target: "ESNext",
					moduleDetection: "force",
					typeRoots: ["node_modules/@rbxts"],
					rootDir: "src",
					outDir: "out",
					baseUrl: "src",
				},
			}),
		});
		const compiler = createRbxtsCompiler(root);
		const result = compiler.build();
		expect(result.errors).toEqual([]);
		expect(result.compiled).toBe(2);
		// Nothing written: a `rbxtsc -w` beside the preview owns the disk.
		expect(existsSync(join(root, "out"))).toBe(false);
		expect(existsSync(join(root, "include"))).toBe(false);

		const tree = readLuauProject(root, compiler.fs) as LuauFileNode;
		expect(scripts(tree)).toEqual([
			"DataModel.ReplicatedStorage.rbxts_include.Promise:ModuleScript",
			"DataModel.ReplicatedStorage.rbxts_include.RuntimeLib:ModuleScript",
			"DataModel.ReplicatedStorage.TS.data:ModuleScript",
			"DataModel.ReplicatedStorage.TS.math:ModuleScript",
			"DataModel.StarterPlayer.StarterPlayerScripts.TS.main:LocalScript",
		]);
		const main = compiler.fs.readFile(
			join(root, "out/client/main.client.luau"),
		);
		expect(main).toMatch(/TS\.import\(script/);
	});

	it("runs the compiled place in the Luau VM", async () => {
		const root = rbxtsProject({
			...GAME,
			"src/client/main.client.ts": GAME["src/client/main.client.ts"].replace(
				'from "shared/math"',
				'from "../shared/math"',
			),
		});
		const compiler = createRbxtsCompiler(root);
		expect(compiler.build().errors).toEqual([]);
		const tree = readLuauProject(root, compiler.fs);
		const module = generateLuauProjectModule(tree, compiler.fs);
		const project = JSON.parse(
			module.slice(module.indexOf("{"), module.lastIndexOf(";")),
		);

		const log = vi.spyOn(console, "log").mockImplementation(() => {});
		const errors: string[] = [];
		const mounted = await runLuauProject(project, {
			wasmBinary: readFileSync(
				resolve(process.cwd(), "packages/luau/wasm/luau-vm.wasm"),
			),
			onError: (error) => errors.push(error.message),
			computeLayout: () => ({ rects: {} }),
		});
		mounted.unmount();
		expect(errors).toEqual([]);
		expect(log).toHaveBeenCalledWith("42 42");
		log.mockRestore();
	});

	it("recompiles an edited file and everything that imports it", () => {
		const root = rbxtsProject({
			...GAME,
			"src/client/main.client.ts": GAME["src/client/main.client.ts"].replace(
				'from "shared/math"',
				'from "../shared/math"',
			),
		});
		const compiler = createRbxtsCompiler(root);
		compiler.build();
		const math = join(root, "src/shared/math.ts");
		writeFileSync(
			math,
			"export function double(n: number) {\n\treturn n + n;\n}\n",
		);
		const result = compiler.update([math]);
		expect(result.errors).toEqual([]);
		expect(result.compiled).toBe(2);
		expect(compiler.fs.readFile(join(root, "out/shared/math.luau"))).toMatch(
			/n \+ n/,
		);
	});

	it("reports an error and keeps the file's last good output", () => {
		const root = rbxtsProject({
			...GAME,
			"src/client/main.client.ts": GAME["src/client/main.client.ts"].replace(
				'from "shared/math"',
				'from "../shared/math"',
			),
		});
		const compiler = createRbxtsCompiler(root);
		compiler.build();
		const math = join(root, "src/shared/math.ts");
		const before = compiler.fs.readFile(join(root, "out/shared/math.luau"));
		writeFileSync(
			math,
			"export function double(n: number) {\n\treturn n * '2';\n}\n",
		);
		const result = compiler.update([math]);
		expect(result.errors.join("\n")).toMatch(/math\.ts/);
		expect(compiler.fs.readFile(join(root, "out/shared/math.luau"))).toBe(
			before,
		);
	});

	it("tracks what it owns: sources under the root dir, not declarations", () => {
		const root = rbxtsProject(GAME);
		const compiler = createRbxtsCompiler(root);
		expect(compiler.owns(join(root, "src/shared/math.ts"))).toBe(true);
		expect(compiler.owns(join(root, "src/shared/data.lua"))).toBe(true);
		expect(compiler.owns(join(root, "src/shared/types.d.ts"))).toBe(false);
		expect(compiler.owns(join(root, "scripts/build.ts"))).toBe(false);
	});

	it("says to install roblox-ts when the project has none", () => {
		const root = rbxtsProject(GAME, { withCompiler: false });
		expect(() => createRbxtsCompiler(root)).toThrow(/roblox-ts/);
	});
});
