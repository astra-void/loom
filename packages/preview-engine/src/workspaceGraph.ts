import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { isFilePathUnderRoot, resolveRealFilePath } from "./pathUtils";
import type { PreviewGraphImportEdge, PreviewSourceTarget } from "./types";

const TRANSFORMABLE_SOURCE_EXTENSIONS = new Set([".ts", ".tsx"]);
const TRACEABLE_SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".d.ts", ".d.tsx"]);
const DEFAULT_COMPILER_OPTIONS: ts.CompilerOptions = {
  jsx: ts.JsxEmit.Preserve,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.NodeJs,
  target: ts.ScriptTarget.ESNext,
};
const DIRECTORY_SCAN_EXCLUDES = new Set([".git", ".lattice-preview-cache", "node_modules"]);
const BUILD_OUTPUT_SEGMENTS = ["build", "dist", "lib", "out", "types"];
const PACKAGE_JSON_FILE_NAME = "package.json";

type WorkspacePackageJson = {
  exports?: unknown;
  main?: string;
  module?: string;
  name?: string;
  source?: string;
  types?: string;
};

export type WorkspaceResolutionDiagnostic = {
  code: "DECLARATION_ONLY_BOUNDARY" | "UNRESOLVED_IMPORT";
  file: string;
  importChain?: string[];
  packageRoot: string;
  phase: "discovery";
  severity: "warning";
  summary: string;
  target: "preview-engine";
};

export type WorkspaceProject = {
  configDir: string;
  configPath: string;
  filePaths: Set<string>;
  outDir?: string;
  packageName?: string;
  packageRoot: string;
  parsedConfig: ts.ParsedCommandLine;
  referencedProjectConfigPaths: string[];
  rootDir: string;
};

type WorkspacePackage = {
  packageJson: WorkspacePackageJson;
  packageName?: string;
  packageRoot: string;
  sourceRoots: string[];
  tsconfigPaths: string[];
};

type WorkspaceFileContext = {
  packageName?: string;
  packageRoot: string;
  project?: WorkspaceProject;
};

export type WorkspaceImportResolution = {
  diagnostic?: WorkspaceResolutionDiagnostic;
  edge: PreviewGraphImportEdge;
  followedFilePath?: string;
};

export type WorkspaceGraphService = {
  collectTransitiveDependencyPaths(filePath: string): string[];
  getFileContext(filePath: string): WorkspaceFileContext;
  getWorkspaceProjects(): WorkspaceProject[];
  listTargetSourceFiles(target: Pick<PreviewSourceTarget, "sourceRoot">): string[];
  resolveImport(options: { importerFilePath: string; specifier: string }): WorkspaceImportResolution | undefined;
  workspaceRoot: string;
};

function isDeclarationFile(filePath: string) {
  return filePath.endsWith(".d.ts") || filePath.endsWith(".d.tsx");
}

export function isTransformableSourceFile(fileName: string) {
  return (
    TRANSFORMABLE_SOURCE_EXTENSIONS.has(path.extname(fileName)) &&
    !fileName.endsWith(".d.ts") &&
    !fileName.endsWith(".d.tsx")
  );
}

function isTraceableSourceFile(fileName: string) {
  return TRACEABLE_SOURCE_EXTENSIONS.has(path.extname(fileName)) || isDeclarationFile(fileName);
}

function listSourceFiles(dirPath: string): string[] {
  if (!fs.existsSync(dirPath)) {
    return [];
  }

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const entryPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...listSourceFiles(entryPath));
      continue;
    }

    if (isTransformableSourceFile(entry.name)) {
      files.push(resolveRealFilePath(entryPath));
    }
  }

  return files.sort((left, right) => left.localeCompare(right));
}

function findWorkspaceRoot(startPaths: string[]) {
  const candidates = startPaths.map((startPath) => resolveRealFilePath(startPath));
  const markerRoots: string[] = [];

  for (const startPath of candidates) {
    let current = startPath;
    while (true) {
      if (fs.existsSync(path.join(current, "pnpm-workspace.yaml")) || fs.existsSync(path.join(current, ".git"))) {
        markerRoots.push(current);
        break;
      }

      const parent = path.dirname(current);
      if (parent === current) {
        markerRoots.push(startPath);
        break;
      }

      current = parent;
    }
  }

  let commonPath = markerRoots[0] ?? process.cwd();
  for (const candidate of markerRoots.slice(1)) {
    while (!isPathEqualOrContained(commonPath, candidate)) {
      const parent = path.dirname(commonPath);
      if (parent === commonPath) {
        return commonPath;
      }

      commonPath = parent;
    }
  }

  return commonPath;
}

function isPathEqualOrContained(rootPath: string, candidatePath: string) {
  const normalizedRoot = resolveRealFilePath(rootPath);
  const normalizedCandidate = resolveRealFilePath(candidatePath);
  return (
    normalizedRoot === normalizedCandidate ||
    normalizedCandidate.startsWith(`${normalizedRoot}${path.sep}`) ||
    normalizedRoot.startsWith(`${normalizedCandidate}${path.sep}`)
  );
}

function findNearestPackageRoot(filePath: string) {
  let current = fs.existsSync(filePath) && fs.statSync(filePath).isDirectory() ? filePath : path.dirname(filePath);

  while (true) {
    if (fs.existsSync(path.join(current, PACKAGE_JSON_FILE_NAME))) {
      return resolveRealFilePath(current);
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return resolveRealFilePath(path.dirname(filePath));
    }

    current = parent;
  }
}

function findNearestTsconfig(startPath: string) {
  return ts.findConfigFile(resolveRealFilePath(startPath), ts.sys.fileExists, "tsconfig.json");
}

function parseTsconfig(tsconfigPath: string) {
  const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
  if (configFile.error) {
    const diagnostic = ts.formatDiagnostic(configFile.error, {
      getCanonicalFileName: (value) => value,
      getCurrentDirectory: () => process.cwd(),
      getNewLine: () => "\n",
    });
    throw new Error(`Failed to read TypeScript config ${tsconfigPath}: ${diagnostic}`);
  }

  const parsed = ts.parseJsonConfigFileContent(
    configFile.config,
    ts.sys,
    path.dirname(tsconfigPath),
    undefined,
    tsconfigPath,
  );
  if (parsed.errors.length > 0) {
    const diagnostic = ts.formatDiagnostics(parsed.errors, {
      getCanonicalFileName: (value) => value,
      getCurrentDirectory: () => process.cwd(),
      getNewLine: () => "\n",
    });
    throw new Error(`Failed to parse TypeScript config ${tsconfigPath}: ${diagnostic}`);
  }

  return parsed;
}

function readPackageJson(packageRoot: string): WorkspacePackageJson {
  const packageJsonPath = path.join(packageRoot, PACKAGE_JSON_FILE_NAME);
  try {
    return JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as WorkspacePackageJson;
  } catch {
    return {};
  }
}

function scanWorkspacePackages(workspaceRoot: string) {
  const packages = new Map<string, WorkspacePackage>();

  const visit = (dirPath: string) => {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      if (DIRECTORY_SCAN_EXCLUDES.has(entry.name)) {
        continue;
      }

      const entryPath = path.join(dirPath, entry.name);
      const packageJsonPath = path.join(entryPath, PACKAGE_JSON_FILE_NAME);
      if (fs.existsSync(packageJsonPath)) {
        const packageRoot = resolveRealFilePath(entryPath);
        const packageJson = readPackageJson(packageRoot);
        packages.set(packageRoot, {
          packageJson,
          packageName: packageJson.name,
          packageRoot,
          sourceRoots: [],
          tsconfigPaths: [],
        });
      }

      visit(entryPath);
    }
  };

  visit(resolveRealFilePath(workspaceRoot));
  return packages;
}

function collectPackageExportTargets(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }

  if (Array.isArray(value)) {
    return value.flatMap((entry) => collectPackageExportTargets(entry));
  }

  if (!value || typeof value !== "object") {
    return [];
  }

  const record = value as Record<string, unknown>;
  const preferredKeys = ["source", "types", "import", "module", "default", "require"];
  const preferredTargets = preferredKeys.flatMap((key) => collectPackageExportTargets(record[key]));
  if (preferredTargets.length > 0) {
    return preferredTargets;
  }

  return Object.values(record).flatMap((entry) => collectPackageExportTargets(entry));
}

function splitBarePackageSpecifier(specifier: string) {
  if (specifier.startsWith(".") || specifier.startsWith("/") || specifier.startsWith("#")) {
    return undefined;
  }

  const parts = specifier.split("/");
  if (specifier.startsWith("@")) {
    if (parts.length < 2) {
      return undefined;
    }

    const packageName = `${parts[0]}/${parts[1]}`;
    return {
      packageName,
      subpath: parts.slice(2).join("/"),
    };
  }

  return {
    packageName: parts[0]!,
    subpath: parts.slice(1).join("/"),
  };
}

function dedupeSorted(values: string[]) {
  return [...new Set(values.map((value) => resolveRealFilePath(value)))].sort((left, right) =>
    left.localeCompare(right),
  );
}

function createCandidateFilePaths(basePath: string) {
  const normalized = basePath.replace(/\\/g, "/");
  const extension = path.extname(normalized);
  const withoutExtension = extension ? normalized.slice(0, -extension.length) : normalized;
  const directCandidates = [
    normalized,
    `${withoutExtension}.tsx`,
    `${withoutExtension}.ts`,
    `${withoutExtension}.d.ts`,
    `${withoutExtension}.d.tsx`,
  ];

  const indexCandidates = [
    path.posix.join(normalized, "index.tsx"),
    path.posix.join(normalized, "index.ts"),
    path.posix.join(normalized, "index.d.ts"),
    path.posix.join(normalized, "index.d.tsx"),
  ];

  return dedupeSorted([...directCandidates, ...indexCandidates]);
}

function resolveExistingTraceablePath(candidates: string[], preferTransformable = false) {
  const existingCandidates = candidates.filter((candidate) => fs.existsSync(candidate));
  if (preferTransformable) {
    const transformable = existingCandidates.find((candidate) => isTransformableSourceFile(candidate));
    if (transformable) {
      return resolveRealFilePath(transformable);
    }
  }

  const traceable = existingCandidates.find((candidate) => isTraceableSourceFile(candidate));
  return traceable ? resolveRealFilePath(traceable) : undefined;
}

function uniquePush(values: string[], value: string | undefined) {
  if (!value) {
    return;
  }

  values.push(resolveRealFilePath(value));
}

function createProjectFromParsedConfig(
  packageRoot: string,
  packageName: string | undefined,
  parsedConfig: ts.ParsedCommandLine,
  configPath: string,
) {
  const configDir = resolveRealFilePath(path.dirname(configPath));
  const rootDir = resolveRealFilePath(
    parsedConfig.options.rootDir ? path.resolve(configDir, parsedConfig.options.rootDir) : configDir,
  );
  const outDir = parsedConfig.options.outDir
    ? resolveRealFilePath(path.resolve(configDir, parsedConfig.options.outDir))
    : undefined;

  return {
    configDir,
    configPath: resolveRealFilePath(configPath),
    filePaths: new Set(parsedConfig.fileNames.map((filePath) => resolveRealFilePath(filePath))),
    outDir,
    packageName,
    packageRoot,
    parsedConfig,
    referencedProjectConfigPaths:
      parsedConfig.projectReferences?.map((reference) =>
        resolveRealFilePath(
          path.resolve(
            configDir,
            reference.path,
            ts.sys.fileExists(path.resolve(configDir, reference.path)) ? "" : "tsconfig.json",
          ),
        ),
      ) ?? [],
    rootDir,
  } satisfies WorkspaceProject;
}

function mapResolvedPathToSourceCandidates(
  resolvedFilePath: string,
  project: WorkspaceProject | undefined,
  workspacePackage: WorkspacePackage | undefined,
) {
  const candidates: string[] = [];
  const normalizedResolvedPath = resolveRealFilePath(resolvedFilePath);

  if (isTraceableSourceFile(normalizedResolvedPath)) {
    uniquePush(candidates, normalizedResolvedPath);
  }

  const extension = path.extname(normalizedResolvedPath);
  const withoutExtension = extension ? normalizedResolvedPath.slice(0, -extension.length) : normalizedResolvedPath;
  uniquePush(candidates, `${withoutExtension}.tsx`);
  uniquePush(candidates, `${withoutExtension}.ts`);

  if (isDeclarationFile(normalizedResolvedPath)) {
    const withoutDeclaration = normalizedResolvedPath.replace(/\.d\.tsx?$/, "");
    uniquePush(candidates, `${withoutDeclaration}.tsx`);
    uniquePush(candidates, `${withoutDeclaration}.ts`);
  }

  if (project?.outDir && isFilePathUnderRoot(project.outDir, normalizedResolvedPath)) {
    const relativeFromOutDir = path.relative(project.outDir, normalizedResolvedPath);
    const rootCandidate = path.join(project.rootDir, relativeFromOutDir);
    candidates.push(...createCandidateFilePaths(rootCandidate));
  }

  if (workspacePackage) {
    for (const sourceRoot of workspacePackage.sourceRoots) {
      for (const segment of BUILD_OUTPUT_SEGMENTS) {
        const buildSegmentPrefix = `${workspacePackage.packageRoot}${path.sep}${segment}${path.sep}`;
        if (!normalizedResolvedPath.startsWith(buildSegmentPrefix)) {
          continue;
        }

        const relativeFromBuildDir = path.relative(
          path.join(workspacePackage.packageRoot, segment),
          normalizedResolvedPath,
        );
        candidates.push(...createCandidateFilePaths(path.join(sourceRoot, relativeFromBuildDir)));
      }
    }
  }

  return dedupeSorted(candidates);
}

function resolveWorkspacePackageSpecifier(
  workspacePackage: WorkspacePackage,
  specifier: string,
  subpath: string,
  project: WorkspaceProject | undefined,
) {
  const candidates: string[] = [];
  const exportsValue =
    typeof workspacePackage.packageJson.exports === "object" && workspacePackage.packageJson.exports !== undefined
      ? ((workspacePackage.packageJson.exports as Record<string, unknown>)[subpath ? `./${subpath}` : "."] ??
        (subpath ? undefined : workspacePackage.packageJson.exports))
      : workspacePackage.packageJson.exports;

  for (const exportTarget of collectPackageExportTargets(exportsValue)) {
    const absoluteTarget = path.resolve(workspacePackage.packageRoot, exportTarget);
    candidates.push(...mapResolvedPathToSourceCandidates(absoluteTarget, project, workspacePackage));
  }

  if (!subpath) {
    for (const packageField of [
      workspacePackage.packageJson.source,
      workspacePackage.packageJson.types,
      workspacePackage.packageJson.module,
      workspacePackage.packageJson.main,
    ]) {
      if (typeof packageField === "string") {
        candidates.push(
          ...mapResolvedPathToSourceCandidates(
            path.resolve(workspacePackage.packageRoot, packageField),
            project,
            workspacePackage,
          ),
        );
      }
    }
  }

  const targetBases =
    subpath.length > 0
      ? workspacePackage.sourceRoots.flatMap((sourceRoot) => [
          path.join(sourceRoot, subpath),
          path.join(workspacePackage.packageRoot, subpath),
        ])
      : workspacePackage.sourceRoots.flatMap((sourceRoot) => [
          path.join(sourceRoot, "index"),
          path.join(sourceRoot, specifier.split("/").pop() ?? "index"),
        ]);

  for (const targetBase of targetBases) {
    candidates.push(...createCandidateFilePaths(targetBase));
  }

  return resolveExistingTraceablePath(dedupeSorted(candidates), true);
}

function createWorkspaceGraphServiceContext(targets: PreviewSourceTarget[], workspaceRoot?: string) {
  const resolvedWorkspaceRoot = resolveRealFilePath(
    workspaceRoot ?? findWorkspaceRoot(targets.map((target) => target.packageRoot)),
  );
  const workspacePackages = scanWorkspacePackages(resolvedWorkspaceRoot);

  for (const target of targets) {
    const packageRoot = resolveRealFilePath(target.packageRoot);
    const sourceRoot = resolveRealFilePath(target.sourceRoot);
    const existingPackage = workspacePackages.get(packageRoot) ?? {
      packageJson: readPackageJson(packageRoot),
      packageName: target.packageName,
      packageRoot,
      sourceRoots: [],
      tsconfigPaths: [],
    };

    existingPackage.packageName ??= target.packageName ?? target.name;
    existingPackage.sourceRoots.push(sourceRoot);
    workspacePackages.set(packageRoot, existingPackage);
  }

  const projectMap = new Map<string, WorkspaceProject>();
  const pendingConfigPaths: string[] = [];
  const seenPending = new Set<string>();

  const queueConfigPath = (configPath: string | undefined) => {
    if (!configPath) {
      return;
    }

    const normalizedConfigPath = resolveRealFilePath(configPath);
    if (seenPending.has(normalizedConfigPath)) {
      return;
    }

    seenPending.add(normalizedConfigPath);
    pendingConfigPaths.push(normalizedConfigPath);
  };

  for (const target of targets) {
    queueConfigPath(findNearestTsconfig(target.sourceRoot));
  }

  for (const workspacePackage of workspacePackages.values()) {
    const packageConfigPath = findNearestTsconfig(workspacePackage.packageRoot);
    if (packageConfigPath) {
      workspacePackage.tsconfigPaths.push(resolveRealFilePath(packageConfigPath));
      queueConfigPath(packageConfigPath);
    }
  }

  while (pendingConfigPaths.length > 0) {
    const nextConfigPath = pendingConfigPaths.pop();
    if (!nextConfigPath || projectMap.has(nextConfigPath)) {
      continue;
    }

    const parsedConfig = parseTsconfig(nextConfigPath);
    const packageRoot = findNearestPackageRoot(nextConfigPath);
    const workspacePackage = workspacePackages.get(packageRoot);
    const project = createProjectFromParsedConfig(
      packageRoot,
      workspacePackage?.packageName,
      parsedConfig,
      nextConfigPath,
    );
    projectMap.set(project.configPath, project);

    if (workspacePackage) {
      workspacePackage.sourceRoots.push(project.rootDir);
      workspacePackage.tsconfigPaths.push(project.configPath);
    }

    for (const referencePath of project.referencedProjectConfigPaths) {
      queueConfigPath(referencePath);
    }
  }

  const projects = [...projectMap.values()].sort((left, right) => left.configPath.localeCompare(right.configPath));
  const projectsByFilePath = new Map<string, WorkspaceProject>();

  for (const project of projects) {
    for (const filePath of project.filePaths) {
      const existing = projectsByFilePath.get(filePath);
      if (!existing || existing.configDir.length < project.configDir.length) {
        projectsByFilePath.set(filePath, project);
      }
    }
  }

  const packagesByName = new Map<string, WorkspacePackage>();
  const workspacePackageList = [...workspacePackages.values()]
    .map((workspacePackage) => ({
      ...workspacePackage,
      sourceRoots: dedupeSorted(
        workspacePackage.sourceRoots.length > 0
          ? workspacePackage.sourceRoots
          : [path.join(workspacePackage.packageRoot, "src")],
      ),
      tsconfigPaths: dedupeSorted(workspacePackage.tsconfigPaths),
    }))
    .sort((left, right) => right.packageRoot.length - left.packageRoot.length);

  for (const workspacePackage of workspacePackageList) {
    if (workspacePackage.packageName) {
      packagesByName.set(workspacePackage.packageName, workspacePackage);
    }
  }

  return {
    packagesByName,
    projects,
    projectsByFilePath,
    workspacePackageList,
    workspaceRoot: resolvedWorkspaceRoot,
  };
}

function getWorkspacePackageForFile(workspacePackageList: WorkspacePackage[], filePath: string) {
  const normalizedFilePath = resolveRealFilePath(filePath);
  return workspacePackageList.find((workspacePackage) =>
    isFilePathUnderRoot(workspacePackage.packageRoot, normalizedFilePath),
  );
}

export function createWorkspaceGraphService(options: {
  targets: PreviewSourceTarget[];
  workspaceRoot?: string;
}): WorkspaceGraphService {
  const context = createWorkspaceGraphServiceContext(options.targets, options.workspaceRoot);
  const specifierCache = new Map<string, string[]>();
  const dependencyMemo = new Map<string, string[]>();

  const getProjectForFile = (filePath: string) => {
    const normalizedFilePath = resolveRealFilePath(filePath);
    const exactProject = context.projectsByFilePath.get(normalizedFilePath);
    if (exactProject) {
      return exactProject;
    }

    return context.projects
      .filter((project) => isFilePathUnderRoot(project.configDir, normalizedFilePath))
      .sort((left, right) => right.configDir.length - left.configDir.length)[0];
  };

  const getFileContext = (filePath: string): WorkspaceFileContext => {
    const normalizedFilePath = resolveRealFilePath(filePath);
    const workspacePackage = getWorkspacePackageForFile(context.workspacePackageList, normalizedFilePath);
    const packageRoot = workspacePackage?.packageRoot ?? findNearestPackageRoot(normalizedFilePath);
    const packageName = workspacePackage?.packageName ?? readPackageJson(packageRoot).name;

    return {
      packageName,
      packageRoot,
      project: getProjectForFile(normalizedFilePath),
    };
  };

  const listTargetSourceFiles = (target: Pick<PreviewSourceTarget, "sourceRoot">) => {
    const sourceRoot = resolveRealFilePath(target.sourceRoot);
    const projectFiles = dedupeSorted(
      context.projects.flatMap((project) =>
        [...project.filePaths].filter(
          (filePath) => isTransformableSourceFile(filePath) && isFilePathUnderRoot(sourceRoot, filePath),
        ),
      ),
    );

    if (projectFiles.length > 0) {
      return projectFiles;
    }

    return listSourceFiles(sourceRoot);
  };

  const getModuleSpecifiers = (filePath: string) => {
    const normalizedFilePath = resolveRealFilePath(filePath);
    const cachedSpecifiers = specifierCache.get(normalizedFilePath);
    if (cachedSpecifiers) {
      return cachedSpecifiers;
    }

    if (!fs.existsSync(normalizedFilePath)) {
      specifierCache.set(normalizedFilePath, []);
      return [];
    }

    const sourceText = fs.readFileSync(normalizedFilePath, "utf8");
    const scriptKind = normalizedFilePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
    const sourceFile = ts.createSourceFile(normalizedFilePath, sourceText, ts.ScriptTarget.Latest, true, scriptKind);
    const specifiers = new Set<string>();

    const visit = (node: ts.Node): void => {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
        if (ts.isStringLiteralLike(node.moduleSpecifier)) {
          specifiers.add(node.moduleSpecifier.text);
        }
      }

      if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
        const expression = node.moduleReference.expression;
        if (expression && ts.isStringLiteralLike(expression)) {
          specifiers.add(expression.text);
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
    const nextSpecifiers = [...specifiers].sort((left, right) => left.localeCompare(right));
    specifierCache.set(normalizedFilePath, nextSpecifiers);
    return nextSpecifiers;
  };

  const createExternalEdge = (options: {
    importerFilePath: string;
    importerProject?: WorkspaceProject;
    resolvedFilePath?: string;
    specifier: string;
  }) =>
    ({
      crossesPackageBoundary: false,
      importerFile: options.importerFilePath,
      importerProjectConfigPath: options.importerProject?.configPath,
      ...(options.resolvedFilePath ? { originalResolvedFile: options.resolvedFilePath } : {}),
      resolution: "stopped" as const,
      resolutionKind: "external-dependency" as const,
      specifier: options.specifier,
      stopReason: "external-dependency",
    }) satisfies PreviewGraphImportEdge;

  const resolveToTraceableWorkspacePath = (options: {
    importerProject?: WorkspaceProject;
    rawResolvedFilePath: string;
    specifier: string;
  }) => {
    const normalizedResolvedPath = resolveRealFilePath(options.rawResolvedFilePath);
    const resolvedPackage = getWorkspacePackageForFile(context.workspacePackageList, normalizedResolvedPath);
    const resolvedProject = getProjectForFile(normalizedResolvedPath);
    const mappedSource = resolveExistingTraceablePath(
      mapResolvedPathToSourceCandidates(normalizedResolvedPath, resolvedProject, resolvedPackage),
      true,
    );

    if (mappedSource && isTransformableSourceFile(mappedSource)) {
      return {
        followedFilePath: mappedSource,
        resolutionKind:
          mappedSource === normalizedResolvedPath
            ? ("source-file" as const)
            : resolvedProject &&
                resolvedProject.outDir &&
                isFilePathUnderRoot(resolvedProject.outDir, normalizedResolvedPath)
              ? ("project-reference-source" as const)
              : ("workspace-package" as const),
      };
    }

    if (mappedSource && isTraceableSourceFile(mappedSource)) {
      return {
        followedFilePath: mappedSource,
        resolutionKind: "declaration-file" as const,
      };
    }

    if (isTraceableSourceFile(normalizedResolvedPath)) {
      return {
        followedFilePath: normalizedResolvedPath,
        resolutionKind: isDeclarationFile(normalizedResolvedPath)
          ? ("declaration-file" as const)
          : ("source-file" as const),
      };
    }

    const bareSpecifier = splitBarePackageSpecifier(options.specifier);
    if (bareSpecifier) {
      const workspacePackage = context.packagesByName.get(bareSpecifier.packageName);
      if (workspacePackage) {
        const packageResolution = resolveWorkspacePackageSpecifier(
          workspacePackage,
          options.specifier,
          bareSpecifier.subpath,
          getProjectForFile(workspacePackage.packageRoot),
        );
        if (packageResolution) {
          return {
            followedFilePath: packageResolution,
            resolutionKind: "workspace-package" as const,
          };
        }
      }
    }

    return undefined;
  };

  const resolveImport = (options: {
    importerFilePath: string;
    specifier: string;
  }): WorkspaceImportResolution | undefined => {
    const importerFilePath = resolveRealFilePath(options.importerFilePath);
    const importerContext = getFileContext(importerFilePath);
    const compilerOptions = importerContext.project?.parsedConfig.options ?? DEFAULT_COMPILER_OPTIONS;
    const resolution = ts.resolveModuleName(options.specifier, importerFilePath, compilerOptions, ts.sys);
    const rawResolvedFilePath = resolution.resolvedModule?.resolvedFileName
      ? resolveRealFilePath(resolution.resolvedModule.resolvedFileName)
      : undefined;

    if (!rawResolvedFilePath) {
      const bareSpecifier = splitBarePackageSpecifier(options.specifier);
      if (bareSpecifier) {
        const workspacePackage = context.packagesByName.get(bareSpecifier.packageName);
        if (workspacePackage) {
          const packageResolution = resolveWorkspacePackageSpecifier(
            workspacePackage,
            options.specifier,
            bareSpecifier.subpath,
            getProjectForFile(workspacePackage.packageRoot),
          );
          if (packageResolution) {
            const resolvedContext = getFileContext(packageResolution);
            return {
              edge: {
                crossesPackageBoundary: importerContext.packageRoot !== resolvedContext.packageRoot,
                importerFile: importerFilePath,
                importerProjectConfigPath: importerContext.project?.configPath,
                resolution: "resolved",
                resolutionKind: "workspace-package",
                resolvedFile: packageResolution,
                resolvedProjectConfigPath: resolvedContext.project?.configPath,
                specifier: options.specifier,
              },
              followedFilePath: packageResolution,
            };
          }

          return {
            diagnostic: {
              code: "DECLARATION_ONLY_BOUNDARY",
              file: importerFilePath,
              importChain: [importerFilePath],
              packageRoot: importerContext.packageRoot,
              phase: "discovery",
              severity: "warning",
              summary:
                `Preview graph reached ${JSON.stringify(options.specifier)}, but the workspace package could not be mapped ` +
                "back to a traceable source file.",
              target: "preview-engine",
            },
            edge: {
              crossesPackageBoundary: false,
              importerFile: importerFilePath,
              importerProjectConfigPath: importerContext.project?.configPath,
              resolution: "stopped",
              specifier: options.specifier,
              stopReason: "declaration-only-boundary",
            },
          };
        }

        return {
          edge: createExternalEdge({
            importerFilePath,
            importerProject: importerContext.project,
            specifier: options.specifier,
          }),
        };
      }

      return {
        diagnostic: {
          code: "UNRESOLVED_IMPORT",
          file: importerFilePath,
          importChain: [importerFilePath],
          packageRoot: importerContext.packageRoot,
          phase: "discovery",
          severity: "warning",
          summary: `Preview graph could not resolve ${JSON.stringify(options.specifier)} from ${importerFilePath}.`,
          target: "preview-engine",
        },
        edge: {
          crossesPackageBoundary: false,
          importerFile: importerFilePath,
          importerProjectConfigPath: importerContext.project?.configPath,
          resolution: "stopped",
          specifier: options.specifier,
          stopReason: "unresolved-import",
        },
      };
    }

    if (!isFilePathUnderRoot(context.workspaceRoot, rawResolvedFilePath)) {
      return {
        edge: createExternalEdge({
          importerFilePath,
          importerProject: importerContext.project,
          resolvedFilePath: rawResolvedFilePath,
          specifier: options.specifier,
        }),
      };
    }

    const normalizedResolution = resolveToTraceableWorkspacePath({
      importerProject: importerContext.project,
      rawResolvedFilePath,
      specifier: options.specifier,
    });
    if (!normalizedResolution?.followedFilePath) {
      return {
        diagnostic: {
          code: "DECLARATION_ONLY_BOUNDARY",
          file: importerFilePath,
          importChain: [importerFilePath],
          packageRoot: importerContext.packageRoot,
          phase: "discovery",
          severity: "warning",
          summary:
            `Preview graph resolved ${JSON.stringify(options.specifier)} inside the workspace (${rawResolvedFilePath}) ` +
            "but could not map it back to a traceable source file.",
          target: "preview-engine",
        },
        edge: {
          crossesPackageBoundary: false,
          importerFile: importerFilePath,
          importerProjectConfigPath: importerContext.project?.configPath,
          originalResolvedFile: rawResolvedFilePath,
          resolution: "stopped",
          specifier: options.specifier,
          stopReason: "declaration-only-boundary",
        },
      };
    }

    const resolvedContext = getFileContext(normalizedResolution.followedFilePath);
    return {
      edge: {
        crossesPackageBoundary: importerContext.packageRoot !== resolvedContext.packageRoot,
        importerFile: importerFilePath,
        importerProjectConfigPath: importerContext.project?.configPath,
        ...(rawResolvedFilePath !== normalizedResolution.followedFilePath
          ? { originalResolvedFile: rawResolvedFilePath }
          : {}),
        resolution: "resolved",
        resolutionKind: normalizedResolution.resolutionKind,
        resolvedFile: normalizedResolution.followedFilePath,
        resolvedProjectConfigPath: resolvedContext.project?.configPath,
        specifier: options.specifier,
      },
      followedFilePath: normalizedResolution.followedFilePath,
    };
  };

  const collectTransitiveDependencyPaths = (filePath: string) => {
    const normalizedFilePath = resolveRealFilePath(filePath);
    const cachedDependencies = dependencyMemo.get(normalizedFilePath);
    if (cachedDependencies) {
      return cachedDependencies;
    }

    if (!fs.existsSync(normalizedFilePath) || !isTraceableSourceFile(normalizedFilePath)) {
      dependencyMemo.set(normalizedFilePath, []);
      return [];
    }

    const visited = new Set<string>();
    const dependencies = new Set<string>();

    const visit = (nextFilePath: string) => {
      const normalizedNextFilePath = resolveRealFilePath(nextFilePath);
      if (
        visited.has(normalizedNextFilePath) ||
        !fs.existsSync(normalizedNextFilePath) ||
        !isTraceableSourceFile(normalizedNextFilePath)
      ) {
        return;
      }

      visited.add(normalizedNextFilePath);

      for (const specifier of getModuleSpecifiers(normalizedNextFilePath)) {
        const resolution = resolveImport({
          importerFilePath: normalizedNextFilePath,
          specifier,
        });
        if (!resolution?.followedFilePath) {
          continue;
        }

        dependencies.add(resolution.followedFilePath);
        visit(resolution.followedFilePath);
      }
    };

    visit(normalizedFilePath);
    const sortedDependencies = [...dependencies].sort((left, right) => left.localeCompare(right));
    dependencyMemo.set(normalizedFilePath, sortedDependencies);
    return sortedDependencies;
  };

  return {
    collectTransitiveDependencyPaths,
    getFileContext,
    getWorkspaceProjects() {
      return context.projects;
    },
    listTargetSourceFiles,
    resolveImport,
    workspaceRoot: context.workspaceRoot,
  };
}
