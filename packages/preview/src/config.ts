import fs from "node:fs";
import path from "node:path";
import type { PreviewExecutionMode, PreviewSourceTarget } from "@lattice-ui/preview-engine";
import { loadConfigFromFile, searchForWorkspaceRoot } from "vite";

const DEFAULT_CONFIG_FILE_NAME = "lattice.preview.config.ts";
const DEFAULT_PREVIEW_PORT = 4174;
const DEFAULT_SOURCE_DIR_NAME = "src";
const DEFAULT_PROJECT_NAME = "Lattice Preview";
const PACKAGE_JSON_FILE_NAME = "package.json";
const PACKAGE_SCAN_SKIP_DIRS = new Set([
  ".git",
  ".lattice-preview-cache",
  ".next",
  ".turbo",
  "build",
  "dist",
  "generated",
  "node_modules",
  "out",
]);

export type PreviewTargetDiscoveryContext = {
  configDir: string;
  configFilePath?: string;
  cwd: string;
  workspaceRoot: string;
};

export type PreviewTargetDiscoveryAdapter = {
  discoverTargets: (context: PreviewTargetDiscoveryContext) => PreviewSourceTarget[] | Promise<PreviewSourceTarget[]>;
};

export type PreviewConfigServer = {
  fsAllow?: string[];
  host?: string;
  open?: boolean;
  port?: number;
};

export type PreviewConfig = {
  projectName?: string;
  runtimeModule?: string;
  server?: PreviewConfigServer;
  targetDiscovery: PreviewTargetDiscoveryAdapter | PreviewTargetDiscoveryAdapter[];
  transformMode?: PreviewExecutionMode;
  workspaceRoot?: string;
};

export type LoadPreviewConfigOptions = {
  configFile?: string;
  cwd?: string;
};

export type PreviewTargetDiscoveryFactoryOptions = {
  name?: string;
  packageName?: string;
  packageRoot?: string;
  sourceDir?: string;
  sourceRoot?: string;
};

export type PreviewWorkspaceTargetDiscoveryOptions = {
  exclude?: string[];
  include?: string[];
  sourceDir?: string;
  workspaceRoot?: string;
};

export type ResolvedPreviewConfig = {
  configDir: string;
  configFilePath?: string;
  cwd: string;
  mode: "config-file" | "package-root";
  projectName: string;
  runtimeModule?: string;
  server: {
    fsAllow: string[];
    host?: string;
    open: boolean;
    port: number;
  };
  targetDiscovery: PreviewTargetDiscoveryAdapter[];
  targets: PreviewSourceTarget[];
  transformMode: PreviewExecutionMode;
  workspaceRoot: string;
};

type PackageMetadata = {
  name?: string;
};

function isRelativeSpecifier(specifier: string) {
  return specifier.startsWith("./") || specifier.startsWith("../");
}

function resolveMaybeRelativePath(filePath: string, baseDir: string) {
  if (!filePath) {
    return filePath;
  }

  if (path.isAbsolute(filePath) || !isRelativeSpecifier(filePath)) {
    return filePath;
  }

  return path.resolve(baseDir, filePath);
}

function normalizeSlashPath(filePath: string) {
  return filePath.split(path.sep).join("/");
}

function readPackageMetadata(packageRoot: string): PackageMetadata {
  const packageJsonPath = path.join(packageRoot, PACKAGE_JSON_FILE_NAME);
  if (!fs.existsSync(packageJsonPath)) {
    return {};
  }

  return JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as PackageMetadata;
}

function inferTargetName(packageRoot: string, packageName?: string) {
  if (packageName) {
    const segments = packageName.split("/");
    return segments[segments.length - 1] ?? packageName;
  }

  return path.basename(packageRoot);
}

function normalizePreviewTarget(target: PreviewSourceTarget, baseDir: string): PreviewSourceTarget {
  const packageRoot = path.resolve(resolveMaybeRelativePath(target.packageRoot, baseDir));
  const sourceRoot = path.resolve(resolveMaybeRelativePath(target.sourceRoot, baseDir));
  return {
    name: target.name,
    packageName: target.packageName,
    packageRoot,
    sourceRoot,
  };
}

function dedupeTargets(targets: PreviewSourceTarget[], baseDir?: string) {
  const targetsByKey = new Map<string, PreviewSourceTarget>();

  for (const target of targets) {
    const normalizedTarget = baseDir ? normalizePreviewTarget(target, baseDir) : target;
    const key = `${normalizedTarget.name}:${normalizeSlashPath(normalizedTarget.packageRoot)}:${normalizeSlashPath(
      normalizedTarget.sourceRoot,
    )}`;
    if (!targetsByKey.has(key)) {
      targetsByKey.set(key, normalizedTarget);
    }
  }

  return [...targetsByKey.values()].sort((left, right) => {
    if (left.name !== right.name) {
      return left.name.localeCompare(right.name);
    }

    return left.sourceRoot.localeCompare(right.sourceRoot);
  });
}

function escapeRegExp(value: string) {
  return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}

function createGlobMatcher(pattern: string) {
  const normalizedPattern = normalizeSlashPath(pattern);
  let source = "^";

  for (let index = 0; index < normalizedPattern.length; index += 1) {
    const character = normalizedPattern[index];
    const nextCharacter = normalizedPattern[index + 1];

    if (character === "*" && nextCharacter === "*") {
      source += ".*";
      index += 1;
      continue;
    }

    if (character === "*") {
      source += "[^/]*";
      continue;
    }

    source += escapeRegExp(character);
  }

  source += "$";
  return new RegExp(source);
}

function matchesPatterns(value: string, patterns: string[] | undefined) {
  if (!patterns || patterns.length === 0) {
    return false;
  }

  return patterns.some((pattern) => createGlobMatcher(pattern).test(normalizeSlashPath(value)));
}

function isTargetIncluded(target: PreviewSourceTarget, workspaceRoot: string, include?: string[], exclude?: string[]) {
  const relativePackageRoot = normalizeSlashPath(path.relative(workspaceRoot, target.packageRoot));
  const packageName = target.packageName ?? "";
  const candidateValues = [target.name, packageName, relativePackageRoot].filter((value) => value.length > 0);
  if (include && include.length > 0 && !candidateValues.some((value) => matchesPatterns(value, include))) {
    return false;
  }

  if (exclude && exclude.length > 0 && candidateValues.some((value) => matchesPatterns(value, exclude))) {
    return false;
  }

  return true;
}

function scanWorkspacePackageRoots(workspaceRoot: string, packageRoots: string[] = [], visited = new Set<string>()) {
  const resolvedWorkspaceRoot = path.resolve(workspaceRoot);
  if (visited.has(resolvedWorkspaceRoot)) {
    return packageRoots;
  }

  visited.add(resolvedWorkspaceRoot);

  if (fs.existsSync(path.join(resolvedWorkspaceRoot, PACKAGE_JSON_FILE_NAME))) {
    packageRoots.push(resolvedWorkspaceRoot);
  }

  for (const entry of fs.readdirSync(resolvedWorkspaceRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || PACKAGE_SCAN_SKIP_DIRS.has(entry.name)) {
      continue;
    }

    const nextPath = path.join(resolvedWorkspaceRoot, entry.name);
    scanWorkspacePackageRoots(nextPath, packageRoots, visited);
  }

  return packageRoots;
}

function findPreviewConfigPath(startPath: string) {
  let currentPath = path.resolve(startPath);

  while (true) {
    const candidatePath = path.join(currentPath, DEFAULT_CONFIG_FILE_NAME);
    if (fs.existsSync(candidatePath)) {
      return candidatePath;
    }

    const parentPath = path.dirname(currentPath);
    if (parentPath === currentPath) {
      return undefined;
    }

    currentPath = parentPath;
  }
}

async function resolveTargetDiscovery(
  adapters: PreviewTargetDiscoveryAdapter[],
  context: PreviewTargetDiscoveryContext,
) {
  const targets: PreviewSourceTarget[] = [];

  for (const adapter of adapters) {
    const discoveredTargets = await adapter.discoverTargets(context);
    targets.push(...discoveredTargets.map((target) => normalizePreviewTarget(target, context.configDir)));
  }

  return dedupeTargets(targets, context.configDir);
}

async function resolvePreviewConfigValue(
  config: PreviewConfig,
  options: {
    configDir: string;
    configFilePath?: string;
    cwd: string;
  },
): Promise<ResolvedPreviewConfig> {
  const targetDiscovery = Array.isArray(config.targetDiscovery) ? config.targetDiscovery : [config.targetDiscovery];
  const workspaceRoot = path.resolve(
    resolveMaybeRelativePath(config.workspaceRoot ?? searchForWorkspaceRoot(options.configDir), options.configDir),
  );
  const targets = await resolveTargetDiscovery(targetDiscovery, {
    configDir: options.configDir,
    configFilePath: options.configFilePath,
    cwd: options.cwd,
    workspaceRoot,
  });

  if (targets.length === 0) {
    throw new Error(
      `Preview config did not resolve any targets${options.configFilePath ? `: ${options.configFilePath}` : "."}`,
    );
  }

  return {
    configDir: options.configDir,
    configFilePath: options.configFilePath,
    cwd: options.cwd,
    mode: options.configFilePath ? "config-file" : "config-file",
    projectName: config.projectName ?? createDefaultProjectName(targets),
    runtimeModule: resolveRuntimeModule(config.runtimeModule, options.configDir),
    server: {
      fsAllow: resolveFsAllow(config.server?.fsAllow, options.configDir, targets, workspaceRoot),
      host: config.server?.host,
      open: config.server?.open ?? false,
      port: config.server?.port ?? DEFAULT_PREVIEW_PORT,
    },
    targetDiscovery,
    targets,
    transformMode: config.transformMode ?? "strict-fidelity",
    workspaceRoot,
  };
}

function createDefaultProjectName(targets: PreviewSourceTarget[]) {
  if (targets.length === 1) {
    return targets[0]?.packageName ?? targets[0]?.name ?? DEFAULT_PROJECT_NAME;
  }

  return DEFAULT_PROJECT_NAME;
}

function resolveRuntimeModule(runtimeModule: string | undefined, baseDir: string) {
  if (!runtimeModule) {
    return undefined;
  }

  return resolveMaybeRelativePath(runtimeModule, baseDir);
}

function resolveFsAllow(
  configFsAllow: string[] | undefined,
  baseDir: string,
  targets: PreviewSourceTarget[],
  workspaceRoot: string,
) {
  const explicitAllow = (configFsAllow ?? []).map((entry) => path.resolve(resolveMaybeRelativePath(entry, baseDir)));
  return [
    ...new Set([
      workspaceRoot,
      ...explicitAllow,
      ...targets.flatMap((target) => [target.packageRoot, target.sourceRoot]),
    ]),
  ].sort((left, right) => left.localeCompare(right));
}

function normalizePackageRootFallback(cwd: string): ResolvedPreviewConfig {
  const packageRoot = path.resolve(cwd);
  const packageJsonPath = path.join(packageRoot, PACKAGE_JSON_FILE_NAME);
  const sourceRoot = path.join(packageRoot, DEFAULT_SOURCE_DIR_NAME);

  if (!fs.existsSync(packageJsonPath)) {
    throw new Error(
      `lattice preview must be run from a package root or a directory with ${DEFAULT_CONFIG_FILE_NAME}: ${packageRoot}`,
    );
  }

  if (!fs.existsSync(sourceRoot) || !fs.statSync(sourceRoot).isDirectory()) {
    throw new Error(`Preview source directory does not exist: ${sourceRoot}`);
  }

  const packageJson = readPackageMetadata(packageRoot);
  const packageName = packageJson.name ?? path.basename(packageRoot);
  const workspaceRoot = path.resolve(searchForWorkspaceRoot(packageRoot));
  const targets = [
    {
      name: packageName,
      packageName,
      packageRoot,
      sourceRoot,
    },
  ];

  return {
    configDir: packageRoot,
    cwd,
    mode: "package-root",
    projectName: packageName,
    server: {
      fsAllow: resolveFsAllow(undefined, packageRoot, targets, workspaceRoot),
      open: false,
      port: DEFAULT_PREVIEW_PORT,
    },
    targetDiscovery: [createPackageTargetDiscovery({ packageName, packageRoot, sourceRoot, name: packageName })],
    targets,
    transformMode: "strict-fidelity",
    workspaceRoot,
  };
}

function normalizePreviewConfig(value: unknown) {
  if (!value || typeof value !== "object") {
    throw new Error(`Preview config must export an object created by definePreviewConfig().`);
  }

  if (!("targetDiscovery" in value)) {
    throw new Error(`Preview config must define \`targetDiscovery\`.`);
  }

  return value as PreviewConfig;
}

export function definePreviewConfig(config: PreviewConfig) {
  return config;
}

export function createPackageTargetDiscovery(
  options: PreviewTargetDiscoveryFactoryOptions = {},
): PreviewTargetDiscoveryAdapter {
  return {
    discoverTargets(context) {
      const packageRoot = path.resolve(
        resolveMaybeRelativePath(options.packageRoot ?? context.configDir, context.configDir),
      );
      const sourceRoot = path.resolve(
        resolveMaybeRelativePath(
          options.sourceRoot ?? path.join(packageRoot, options.sourceDir ?? DEFAULT_SOURCE_DIR_NAME),
          context.configDir,
        ),
      );
      const packageMetadata = readPackageMetadata(packageRoot);
      const packageName = options.packageName ?? packageMetadata.name;

      return [
        {
          name: options.name ?? packageName ?? path.basename(packageRoot),
          packageName,
          packageRoot,
          sourceRoot,
        },
      ];
    },
  };
}

export function createStaticTargetsDiscovery(targets: PreviewSourceTarget[]): PreviewTargetDiscoveryAdapter {
  return {
    discoverTargets(context) {
      return targets.map((target) => normalizePreviewTarget(target, context.configDir));
    },
  };
}

export function createWorkspaceTargetsDiscovery(
  options: PreviewWorkspaceTargetDiscoveryOptions = {},
): PreviewTargetDiscoveryAdapter {
  return {
    discoverTargets(context) {
      const workspaceRoot = path.resolve(
        resolveMaybeRelativePath(options.workspaceRoot ?? context.workspaceRoot, context.configDir),
      );
      const packageRoots = scanWorkspacePackageRoots(workspaceRoot);
      const targets = packageRoots.flatMap((packageRoot) => {
        const packageMetadata = readPackageMetadata(packageRoot);
        const sourceRoot = path.join(packageRoot, options.sourceDir ?? DEFAULT_SOURCE_DIR_NAME);
        if (!fs.existsSync(sourceRoot) || !fs.statSync(sourceRoot).isDirectory()) {
          return [];
        }

        const target = {
          name: inferTargetName(packageRoot, packageMetadata.name),
          packageName: packageMetadata.name,
          packageRoot,
          sourceRoot,
        } satisfies PreviewSourceTarget;

        return isTargetIncluded(target, workspaceRoot, options.include, options.exclude) ? [target] : [];
      });

      return dedupeTargets(targets, workspaceRoot);
    },
  };
}

export async function loadPreviewConfig(options: LoadPreviewConfigOptions = {}): Promise<ResolvedPreviewConfig> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const explicitConfigPath = options.configFile ? path.resolve(options.configFile) : undefined;
  const discoveredConfigPath = explicitConfigPath ?? findPreviewConfigPath(cwd);

  if (!discoveredConfigPath) {
    return normalizePackageRootFallback(cwd);
  }

  const configFilePath = path.resolve(discoveredConfigPath);
  const configDir = path.dirname(configFilePath);
  const loadedConfig = await loadConfigFromFile(
    {
      command: "serve",
      isPreview: false,
      mode: "development",
    },
    configFilePath,
    configDir,
  );
  if (!loadedConfig) {
    throw new Error(`Unable to load preview config: ${configFilePath}`);
  }

  const config = normalizePreviewConfig(loadedConfig.config);
  return resolvePreviewConfigValue(config, {
    configDir,
    configFilePath,
    cwd,
  });
}

export async function resolvePreviewConfigObject(
  config: PreviewConfig,
  options: {
    configDir?: string;
    cwd?: string;
  } = {},
): Promise<ResolvedPreviewConfig> {
  const configDir = path.resolve(options.configDir ?? options.cwd ?? process.cwd());
  return resolvePreviewConfigValue(config, {
    configDir,
    cwd: path.resolve(options.cwd ?? process.cwd()),
  });
}
