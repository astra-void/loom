import fs from "node:fs";
import path from "node:path";
import type { PreviewExecutionMode } from "@lattice-ui/preview-engine";
import { searchForWorkspaceRoot } from "vite";
import type { LoadPreviewConfigOptions, PreviewConfig, ResolvedPreviewConfig } from "../config";
import { loadPreviewConfig, resolvePreviewConfigObject } from "../config";
import { createAutoMockPropsPlugin } from "./autoMockPlugin";
import { createPreviewVitePlugin } from "./plugin";
import type { ReactPluginModule, ViteModule, ViteTopLevelAwaitPluginModule, ViteWasmPluginModule } from "./viteTypes";

const DEFAULT_PORT = 4174;

export type StartPreviewServerOptions = {
  configFile?: string;
  cwd?: string;
  packageName: string;
  packageRoot: string;
  port?: number;
  runtimeModule?: string;
  sourceRoot: string;
  transformMode?: PreviewExecutionMode;
};

export type StartPreviewServerInput =
  | LoadPreviewConfigOptions
  | PreviewConfig
  | ResolvedPreviewConfig
  | StartPreviewServerOptions;

function resolvePreviewPackageEntry(candidates: string[], label: string) {
  const matchedPath = candidates.find((candidate) => fs.existsSync(candidate));
  if (!matchedPath) {
    throw new Error(`Unable to resolve ${label} entry.`);
  }

  return matchedPath;
}

function resolveShellRoot() {
  return resolvePreviewPackageEntry(
    [path.resolve(__dirname, "../shell"), path.resolve(__dirname, "../../src/shell")],
    "preview shell root",
  );
}

function resolvePreviewRuntimeRootEntry() {
  return resolvePreviewPackageEntry(
    [
      path.resolve(__dirname, "../../../preview-runtime/src/index.ts"),
      path.resolve(__dirname, "../../../preview-runtime/dist/index.js"),
    ],
    "preview runtime root",
  );
}

function isResolvedPreviewConfig(value: StartPreviewServerInput): value is ResolvedPreviewConfig {
  return typeof value === "object" && value !== null && "targets" in value && Array.isArray(value.targets);
}

function isShorthandServerOptions(value: StartPreviewServerInput): value is StartPreviewServerOptions {
  return typeof value === "object" && value !== null && "packageRoot" in value && "sourceRoot" in value;
}

function isPreviewConfig(value: StartPreviewServerInput): value is PreviewConfig {
  return typeof value === "object" && value !== null && "targetDiscovery" in value;
}

export async function resolvePreviewServerConfig(
  options: StartPreviewServerInput = {},
): Promise<ResolvedPreviewConfig> {
  if (isResolvedPreviewConfig(options)) {
    return options;
  }

  if (isPreviewConfig(options)) {
    return resolvePreviewConfigObject(options);
  }

  if (isShorthandServerOptions(options)) {
    const workspaceRoot = path.resolve(searchForWorkspaceRoot(options.packageRoot));
    return {
      configDir: path.resolve(options.packageRoot),
      cwd: path.resolve(options.cwd ?? options.packageRoot),
      mode: "package-root",
      projectName: options.packageName,
      runtimeModule: options.runtimeModule,
      server: {
        fsAllow: [path.resolve(options.packageRoot), path.resolve(options.sourceRoot), workspaceRoot],
        open: false,
        port: options.port ?? DEFAULT_PORT,
      },
      targetDiscovery: [],
      targets: [
        {
          name: options.packageName,
          packageName: options.packageName,
          packageRoot: path.resolve(options.packageRoot),
          sourceRoot: path.resolve(options.sourceRoot),
        },
      ],
      transformMode: options.transformMode ?? "strict-fidelity",
      workspaceRoot,
    };
  }

  return loadPreviewConfig(options);
}

export async function startPreviewServer(options: StartPreviewServerInput = {}) {
  const resolvedConfig = await resolvePreviewServerConfig(options);
  const vite = (await import("vite")) as unknown as ViteModule;
  const reactPlugin = ((await import("@vitejs/plugin-react")) as unknown as ReactPluginModule).default;
  const wasmPlugin = ((await import("vite-plugin-wasm")) as unknown as ViteWasmPluginModule).default;
  const topLevelAwaitPlugin = (
    (await import("vite-plugin-top-level-await")) as unknown as ViteTopLevelAwaitPluginModule
  ).default;

  const shellRoot = resolveShellRoot();
  const previewRuntimeRootEntry = resolvedConfig.runtimeModule ?? resolvePreviewRuntimeRootEntry();
  const previewPlugin = createPreviewVitePlugin({
    projectName: resolvedConfig.projectName,
    runtimeModule: previewRuntimeRootEntry,
    targets: resolvedConfig.targets,
    transformMode: resolvedConfig.transformMode,
  });

  const server = await vite.createServer({
    appType: "spa",
    assetsInclude: ["**/*.wasm"],
    configFile: false,
    optimizeDeps: {
      exclude: ["@lattice-ui/layout-engine", "layout-engine"],
    },
    plugins: [
      createAutoMockPropsPlugin({ targets: resolvedConfig.targets }),
      previewPlugin,
      reactPlugin(),
      wasmPlugin(),
      topLevelAwaitPlugin(),
    ],
    resolve: {
      alias: [
        {
          find: "@lattice-ui/preview-runtime",
          replacement: previewRuntimeRootEntry,
        },
      ],
    },
    root: shellRoot,
    server: {
      fs: {
        allow: [shellRoot, ...resolvedConfig.server.fsAllow],
      },
      host: resolvedConfig.server.host,
      open: resolvedConfig.server.open,
      port: resolvedConfig.server.port,
    },
  });

  await server.listen();
  process.stdout.write(`Previewing ${resolvedConfig.projectName} from ${resolvedConfig.workspaceRoot}\n`);
  server.printUrls();

  return server;
}
