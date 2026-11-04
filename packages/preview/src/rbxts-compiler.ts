/**
 * `rbxts-compiler.ts` — roblox-ts as a library, compiling into memory.
 *
 * With `runtime: "luau"` a roblox-ts project is not run as JavaScript: its
 * sources are compiled to Luau the way `rbxtsc` would, and the Luau runs in
 * `@loom-dev/luau`'s VM, so every Luau package (React-Lua, Ripple, ...) runs as
 * itself rather than as a port. See docs/design/rbxts-on-luau-vm.md.
 *
 * The compiler is the project's own `roblox-ts`, so the preview compiles
 * exactly as the project's build does. It is driven through its internals
 * (the transform loop of `compileFiles`), because the CLI only writes to disk:
 *
 * - Output stays in memory, keyed by the path `rbxtsc` would write it to, so a
 *   `rbxtsc -w` the user runs beside the preview never fights it for `out/`.
 * - One compiler host lives for the session and caches parsed files. `rbxtsc
 *   -w` builds a fresh host per change and re-parses `@rbxts/types` (~5 MB of
 *   declarations) every time; reusing it is what makes an edit cost ~150 ms.
 * - An edit recompiles the edited file and everything that imports it, the
 *   set `rbxtsc -w` would rebuild too.
 *
 * Node only. roblox-ts and its `typescript` are CommonJS and are loaded from
 * the project with `createRequire`, never bundled.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve, sep } from "node:path";
import { nodeProjectFs, type ProjectFs } from "./luau-project.ts";

/** What one compile pass produced. */
export interface CompileResult {
	/** Files compiled this pass (the edited ones and their importers). */
	readonly compiled: number;
	/** Formatted diagnostics; a file with errors keeps its last good output. */
	readonly errors: readonly string[];
	readonly ms: number;
}

export interface RbxtsCompiler {
	/** The project the compiler was made for. */
	readonly root: string;
	/** Compile every source file. */
	build(): CompileResult;
	/**
	 * Recompile after `changed` (absolute paths) were edited, added or removed,
	 * together with every file that imports them.
	 */
	update(changed: readonly string[]): CompileResult;
	/** Whether `file` is a source this compiler compiles or copies into `out/`. */
	owns(file: string): boolean;
	/**
	 * The filesystem as `rbxtsc` would leave it: `out/` holds the compiled
	 * Luau and `include/` roblox-ts's runtime, whatever is on disk there.
	 */
	readonly fs: ProjectFs;
}

// The handful of roblox-ts / TypeScript internals the compiler touches, typed
// loosely: they are not public API, and the versions vary by project.
// biome-ignore lint/suspicious/noExplicitAny: untyped CommonJS internals
type Any = any;

/** Load the project's roblox-ts, or say how to get one. */
function loadRobloxTs(root: string): {
	load: (path: string) => Any;
	base: string;
} {
	const fromProject = createRequire(resolve(root, "package.json"));
	let pkg: string | undefined;
	// Only a roblox-ts the project itself installed: a node_modules at or above
	// it. Plain resolution would also take one from NODE_PATH (which `pnpm exec`
	// points at its store) and compile with a version the project never chose.
	for (let dir = resolve(root); ; dir = dirname(dir)) {
		if (existsSync(join(dir, "node_modules", "roblox-ts", "package.json"))) {
			pkg = fromProject.resolve("roblox-ts/package.json");
			break;
		}
		if (dirname(dir) === dir) break;
	}
	if (pkg === undefined) {
		throw new Error(
			`loom: runtime "luau" compiles ${root} with its own roblox-ts, but it is not installed there\n` +
				"      (add roblox-ts as a devDependency, as rbxtsc needs anyway)",
		);
	}
	const base = dirname(pkg);
	const fromRobloxTs = createRequire(pkg);
	return {
		base,
		load: (path) =>
			path.startsWith(".")
				? fromRobloxTs(join(base, path))
				: fromRobloxTs(path),
	};
}

/** Whether `file` lies inside `dir` (or is it). */
function within(dir: string, file: string): boolean {
	const rel = relative(dir, file);
	return (
		rel === "" ||
		(!rel.startsWith("..") && !rel.startsWith(sep) && !/^[A-Za-z]:/.test(rel))
	);
}

const LUAU_SOURCE = /\.(luau|lua)$/;

export function createRbxtsCompiler(root: string): RbxtsCompiler {
	const { load, base } = loadRobloxTs(root);
	const ts: Any = load("typescript");
	const constants = load("./out/Shared/constants.js");
	const { createProjectData } = load(
		"./out/Project/functions/createProjectData.js",
	);
	const { createProgramFactory } = load(
		"./out/Project/functions/createProgramFactory.js",
	);
	const { createPathTranslator } = load(
		"./out/Project/functions/createPathTranslator.js",
	);
	const { getParsedCommandLine } = load(
		"./out/Project/functions/getParsedCommandLine.js",
	);
	const { getChangedFilePaths } = load(
		"./out/Project/functions/getChangedFilePaths.js",
	);
	const { createNodeModulesPathMapping } = load(
		"./out/Project/functions/createNodeModulesPathMapping.js",
	);
	const { getCustomPreEmitDiagnostics } = load(
		"./out/Project/util/getCustomPreEmitDiagnostics.js",
	);
	const { MultiTransformState, TransformState, transformSourceFile } = load(
		"./out/TSTransformer/index.js",
	);
	const { DiagnosticService } = load(
		"./out/TSTransformer/classes/DiagnosticService.js",
	);
	const { createTransformServices } = load(
		"./out/TSTransformer/util/createTransformServices.js",
	);
	const { renderAST } = load("@roblox-ts/luau-ast");
	const { RojoResolver } = load("@roblox-ts/rojo-resolver");

	const tsconfig = resolve(root, "tsconfig.json");
	if (!existsSync(tsconfig))
		throw new Error(
			`loom: runtime "luau" needs ${tsconfig} to compile the project`,
		);
	const data: Any = createProjectData(tsconfig, {
		...constants.DEFAULT_PROJECT_OPTIONS,
		includePath: "",
	});
	if (data.rojoConfigPath === undefined)
		throw new Error(
			`loom: runtime "luau" runs ${root} as a Rojo place, but it has no project file\n` +
				"      (add a default.project.json, as rbxtsc needs for a game)",
		);
	const includeDir: string = data.projectOptions.includePath;
	const runtimeInclude: string =
		constants.INCLUDE_PATH ?? join(base, "include");

	let parsed: Any = getParsedCommandLine(data);
	const options: Any = parsed.options;
	const outDir: string = resolve(options.outDir ?? join(root, "out"));
	const rootDirs: string[] = (
		options.rootDirs ?? [options.rootDir ?? join(root, "src")]
	).map((dir: string) => resolve(dir));
	const unsupported =
		Array.isArray(options.plugins) && options.plugins.length > 0
			? ["loom: tsconfig transformer plugins are not run by the preview yet"]
			: [];

	// One host for the session; parsed files are reused until their mtime moves.
	const host: Any = ts.createIncrementalCompilerHost(options);
	const parsedFiles = new Map<
		string,
		{ mtime: number | undefined; file: Any }
	>();
	const getSourceFile = host.getSourceFile.bind(host);
	host.getSourceFile = (fileName: string, ...rest: unknown[]) => {
		const mtime = statSync(fileName, { throwIfNoEntry: false })?.mtimeMs;
		const hit = parsedFiles.get(fileName);
		if (hit && hit.mtime === mtime) return hit.file;
		const file = getSourceFile(fileName, ...rest);
		parsedFiles.set(fileName, { mtime, file });
		return file;
	};
	const createProgram = createProgramFactory(data, options);
	let program: Any;
	let pathTranslator: Any;
	function refresh(): void {
		// An explicit (possibly undefined) old program: the factory's default
		// would read the project's tsbuildinfo and think nothing changed.
		program = createProgram(parsed.fileNames, options, host, program ?? null);
		pathTranslator = createPathTranslator(program, data);
	}

	// What the transform needs besides the program, as compileFiles builds it.
	const rojoResolver: Any = RojoResolver.fromPath(data.rojoConfigPath);
	const pkgRojoResolvers = (options.typeRoots ?? []).map(
		RojoResolver.synthetic,
	);
	const nodeModulesPathMapping = createNodeModulesPathMapping(
		options.typeRoots ?? [],
	);
	const projectType =
		data.projectOptions.type ??
		(data.isPackage
			? constants.ProjectType.Package
			: rojoResolver.isGame
				? constants.ProjectType.Game
				: constants.ProjectType.Model);
	const runtimeLibRbxPath = rojoResolver.getRbxPathFromFilePath(
		join(includeDir, "RuntimeLib.lua"),
	);

	/** Compiled Luau by the absolute path rbxtsc would write it to. */
	const outputs = new Map<string, string>();

	const formatHost = {
		getCanonicalFileName: (f: string) => f,
		getCurrentDirectory: () => root,
		getNewLine: () => "\n",
	};
	const format = (diagnostics: Any[]): string[] =>
		diagnostics
			.filter((d) => d.category === ts.DiagnosticCategory.Error)
			.map((d) => ts.formatDiagnostic(d, formatHost).trim());

	function compile(sourceFiles: Any[]): CompileResult {
		const started = performance.now();
		const tsProgram = program.getProgram();
		const typeChecker = tsProgram.getTypeChecker();
		const services = createTransformServices(typeChecker);
		const multiTransformState = new MultiTransformState();
		const errors: string[] = [...unsupported];
		let compiled = 0;
		for (const file of sourceFiles) {
			const sourceFile = tsProgram.getSourceFile(file.fileName);
			if (!sourceFile) continue;
			const pre = format([
				...ts.getPreEmitDiagnostics(tsProgram, sourceFile),
				...getCustomPreEmitDiagnostics(data, sourceFile),
			]);
			if (pre.length > 0) {
				errors.push(...pre);
				continue;
			}
			DiagnosticService.flush();
			const state = new TransformState(
				tsProgram,
				data,
				services,
				pathTranslator,
				multiTransformState,
				options,
				rojoResolver,
				pkgRojoResolvers,
				nodeModulesPathMapping,
				runtimeLibRbxPath,
				typeChecker,
				projectType,
				sourceFile,
			);
			const luau = transformSourceFile(state, sourceFile);
			const transformErrors = format(DiagnosticService.flush());
			if (transformErrors.length > 0) {
				errors.push(...transformErrors);
				continue;
			}
			outputs.set(
				pathTranslator.getOutputPath(sourceFile.fileName),
				renderAST(luau),
			);
			compiled++;
		}
		virtual = undefined;
		return { compiled, errors, ms: performance.now() - started };
	}

	/** The compilable sources among a set of file names (no .d.ts, no JSON). */
	function sources(fileNames: Iterable<string>): Any[] {
		const out: Any[] = [];
		for (const name of fileNames) {
			const file = program.getSourceFile(name);
			if (file && !file.isDeclarationFile && !ts.isJsonSourceFile(file))
				out.push(file);
		}
		return out;
	}

	/** A source the build compiles (`.ts`/`.tsx`) or copies (`.luau`/`.lua`). */
	function owns(file: string): boolean {
		const compiles = /\.tsx?$/.test(file) && !file.endsWith(".d.ts");
		return (
			(compiles || LUAU_SOURCE.test(file)) &&
			rootDirs.some((dir) => within(dir, file))
		);
	}

	// --- the filesystem as rbxtsc leaves it --------------------------------

	/**
	 * Every file the build puts under `out/` and `include/`, by absolute path,
	 * with where its text comes from: compiled Luau, a Luau source the build
	 * copies over from a root dir, or roblox-ts's own runtime.
	 */
	let virtual: Map<string, () => string> | undefined;
	function virtualFiles(): Map<string, () => string> {
		if (virtual) return virtual;
		const files = new Map<string, () => string>();
		for (const [path, source] of outputs) files.set(path, () => source);
		for (const dir of rootDirs) {
			const walk = (at: string): void => {
				if (!existsSync(at)) return;
				for (const entry of readdirSync(at, { withFileTypes: true })) {
					const path = join(at, entry.name);
					if (entry.isDirectory()) walk(path);
					else if (LUAU_SOURCE.test(entry.name))
						files.set(join(outDir, relative(dir, path)), () =>
							readFileSync(path, "utf8"),
						);
				}
			};
			walk(dir);
		}
		if (existsSync(runtimeInclude)) {
			for (const name of readdirSync(runtimeInclude))
				files.set(join(includeDir, name), () =>
					readFileSync(join(runtimeInclude, name), "utf8"),
				);
		}
		virtual = files;
		return files;
	}

	const shadowed = [outDir, includeDir];
	const isShadowed = (path: string): boolean =>
		shadowed.some((dir) => within(dir, path));

	function isDirectory(path: string): boolean {
		if (!isShadowed(path))
			return existsSync(path) && statSync(path).isDirectory();
		if (shadowed.includes(path)) return true;
		const prefix = path + sep;
		for (const file of virtualFiles().keys())
			if (file.startsWith(prefix)) return true;
		return false;
	}

	const fs: ProjectFs = {
		exists: (path) =>
			isShadowed(path)
				? isDirectory(path) || virtualFiles().has(path)
				: existsSync(path),
		isDirectory,
		readdir(dir) {
			if (!isShadowed(dir)) return nodeProjectFs.readdir(dir);
			const prefix = dir + sep;
			const entries = new Map<string, boolean>();
			for (const file of virtualFiles().keys()) {
				if (!file.startsWith(prefix)) continue;
				const [name, ...rest] = file.slice(prefix.length).split(sep);
				if (name !== undefined)
					entries.set(name, (entries.get(name) ?? false) || rest.length > 0);
			}
			return [...entries].map(([name, isDirectory]) => ({ name, isDirectory }));
		},
		readFile(path) {
			if (!isShadowed(path)) return readFileSync(path, "utf8");
			const read = virtualFiles().get(path);
			if (read === undefined)
				throw new Error(`loom: no compiled output at ${path}`);
			return read();
		},
	};

	return {
		root,
		fs,
		owns,
		build() {
			refresh();
			return compile(sources(parsed.fileNames));
		},
		update(changed) {
			// A file added or removed changes the root file set itself.
			parsed = getParsedCommandLine(data);
			const live = new Set<string>(parsed.fileNames);
			for (const file of changed) {
				if (!live.has(file)) {
					try {
						outputs.delete(pathTranslator.getOutputPath(file));
					} catch {
						// not a file the translator maps: nothing was emitted for it
					}
					parsedFiles.delete(file);
				}
			}
			refresh();
			const affected = getChangedFilePaths(
				program,
				[...changed].filter((f) => live.has(f)),
			);
			return compile(sources(affected));
		},
	};
}
