/**
 * `luau-project.ts` — a Rojo project, read the way Rojo reads it.
 *
 * Node-only and side-effect free: it returns the instance tree a Rojo sync
 * would build, with each script pointing at its file, and the Luau plugin
 * (`./luau-plugin.ts`) inlines the sources for the browser. The project comes
 * from `default.project.json` when there is one, and otherwise from the
 * layout `rojo init` creates (`src/client`, `src/server`, `src/shared`), or a
 * bare `src/` of LocalScripts.
 *
 * File rules, as Rojo's: `X.client.luau` is a LocalScript, `X.server.luau` a
 * Script, any other `X.luau` a ModuleScript (`.lua` too); a directory is a
 * Folder, unless it holds an `init*.luau`, which makes the directory itself
 * that script. `*.loom.luau` files are gallery targets, not part of the place,
 * and anything Rojo would need another format for (`.json`, `.rbxm(x)`,
 * `.meta.json`) is left out.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/** One instance of the project tree. `file` is a script's source file. */
export interface LuauFileNode {
	name: string;
	className: string;
	file?: string;
	children?: LuauFileNode[];
}

const SCRIPT_KINDS: ReadonlyArray<
	readonly [suffix: string, className: string]
> = [
	[".server.luau", "Script"],
	[".server.lua", "Script"],
	[".client.luau", "LocalScript"],
	[".client.lua", "LocalScript"],
	[".luau", "ModuleScript"],
	[".lua", "ModuleScript"],
];

/** A gallery target: never part of the place. */
export const LUAU_TARGET_SUFFIX = ".loom.luau";

/** `[name, className]` for a script file, or undefined for anything else. */
function scriptKind(file: string): readonly [string, string] | undefined {
	if (file.endsWith(LUAU_TARGET_SUFFIX)) return undefined;
	for (const [suffix, className] of SCRIPT_KINDS) {
		if (file.endsWith(suffix))
			return [file.slice(0, -suffix.length), className];
	}
	return undefined;
}

/** A directory as Rojo syncs it: a Folder, or the script its `init` file makes it. */
function directoryNode(name: string, dir: string): LuauFileNode {
	const node: LuauFileNode = { name, className: "Folder" };
	const children: LuauFileNode[] = [];
	const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
		a.name.localeCompare(b.name),
	);
	for (const entry of entries) {
		if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
		const path = join(dir, entry.name);
		if (entry.isDirectory()) {
			children.push(directoryNode(entry.name, path));
			continue;
		}
		const kind = scriptKind(entry.name);
		if (kind === undefined) continue;
		const [base, className] = kind;
		if (base === "init") {
			node.className = className;
			node.file = path;
		} else {
			children.push({ name: base, className, file: path });
		}
	}
	if (children.length > 0) node.children = children;
	return node;
}

/** What a `$path` names: a script file, or a directory. */
function pathNode(name: string, path: string): LuauFileNode | undefined {
	if (!existsSync(path)) return undefined;
	if (statSync(path).isDirectory()) return directoryNode(name, path);
	const fileName = path.split(/[\\/]/).pop() ?? path;
	const kind = scriptKind(fileName);
	return kind ? { name, className: kind[1], file: path } : undefined;
}

type ProjectSpec = { [key: string]: unknown };

/**
 * One node of a project file's `tree`. Keys starting with `$` describe the node
 * itself; every other key is a child. Without `$className` or `$path`, the
 * node's class is its name — how Rojo spells a service.
 */
function projectNode(
	name: string,
	spec: ProjectSpec,
	base: string,
): LuauFileNode {
	const fromPath =
		typeof spec.$path === "string"
			? pathNode(name, resolve(base, spec.$path))
			: undefined;
	const node: LuauFileNode = fromPath ?? { name, className: name };
	if (typeof spec.$className === "string") node.className = spec.$className;
	const children = [...(node.children ?? [])];
	for (const [key, value] of Object.entries(spec)) {
		if (key.startsWith("$") || typeof value !== "object" || value === null)
			continue;
		children.push(projectNode(key, value as ProjectSpec, base));
	}
	if (children.length > 0) node.children = children;
	return node;
}

function hasScripts(node: LuauFileNode): boolean {
	return node.file !== undefined || (node.children ?? []).some(hasScripts);
}

/**
 * The place `root` describes, as a `DataModel` tree — or undefined when it is
 * not a Luau project at all (no project file, and no Luau scripts where the
 * Rojo layouts put them), so TypeScript projects are never mistaken for one.
 */
export function readLuauProject(root: string): LuauFileNode | undefined {
	const projectFile = resolve(root, "default.project.json");
	if (existsSync(projectFile)) {
		const project = JSON.parse(readFileSync(projectFile, "utf8")) as {
			tree?: ProjectSpec;
		};
		if (project.tree === undefined) return undefined;
		const tree = projectNode("DataModel", project.tree, dirname(projectFile));
		// A model project (`$className` other than DataModel) has no client to run.
		return tree.className === "DataModel" && hasScripts(tree)
			? tree
			: undefined;
	}

	const src = resolve(root, "src");
	if (!existsSync(src) || !statSync(src).isDirectory()) return undefined;
	const at = (dir: string) => resolve(src, dir);
	const template = ["client", "server", "shared"].some((dir) =>
		existsSync(at(dir)),
	);
	const tree = projectNode(
		"DataModel",
		template
			? {
					$className: "DataModel",
					ReplicatedStorage: { Shared: { $path: at("shared") } },
					ServerScriptService: { Server: { $path: at("server") } },
					StarterPlayer: {
						StarterPlayerScripts: { Client: { $path: at("client") } },
					},
				}
			: {
					$className: "DataModel",
					StarterPlayer: { StarterPlayerScripts: { Client: { $path: src } } },
				},
		root,
	);
	return hasScripts(tree) ? prune(tree) : undefined;
}

/** Drop the template's placeholder nodes whose `$path` did not exist. */
function prune(node: LuauFileNode): LuauFileNode {
	const children = (node.children ?? []).filter(hasScripts).map(prune);
	const out: LuauFileNode = { ...node };
	if (children.length > 0) out.children = children;
	else delete out.children;
	return out;
}

/** Every script file in the tree — what the dev server should watch. */
export function projectFiles(
	node: LuauFileNode,
	into: string[] = [],
): string[] {
	if (node.file !== undefined) into.push(node.file);
	for (const child of node.children ?? []) projectFiles(child, into);
	return into;
}

/**
 * The browser module for the project: `export const project = { tree }`, the
 * tree `@loom-dev/luau` instantiates, with every script's source inlined.
 */
export function generateLuauProjectModule(
	tree: LuauFileNode | undefined,
): string {
	const emit = (node: LuauFileNode): unknown => ({
		name: node.name,
		className: node.className,
		...(node.file !== undefined
			? { source: readFileSync(node.file, "utf8") }
			: {}),
		...(node.children ? { children: node.children.map(emit) } : {}),
	});
	const root = tree
		? emit(tree)
		: { name: "DataModel", className: "DataModel" };
	return `// generated by loom from the Rojo project\nexport const project = ${JSON.stringify({ tree: root })};\n`;
}
