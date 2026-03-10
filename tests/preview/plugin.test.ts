import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPreviewVitePlugin } from "../../../packages/preview/src/source/plugin";
import type { PreviewPlugin } from "../../../packages/preview/src/source/viteTypes";
import { getHookHandler } from "./hookTestUtils";

const WORKSPACE_INDEX_MODULE_ID = "virtual:lattice-preview-workspace-index";
const temporaryRoots: string[] = [];

type MockServer = ReturnType<typeof createMockServer>;
type TestResolveIdHook = (id: string) => string | undefined;
type TestLoadHook = (id: string) => string | undefined;
type TestConfigureServerHook = (server: MockServer) => void;
type TestHotUpdateHook = (context: { file: string }) => [] | undefined;

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    fs.rmSync(root, { force: true, recursive: true });
  }
});

function createFixtureRoot() {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lattice-preview-plugin-"));
  const sourceRoot = path.join(fixtureRoot, "src");
  temporaryRoots.push(fixtureRoot);
  fs.mkdirSync(sourceRoot, { recursive: true });

  return {
    fixtureRoot,
    sourceRoot,
  };
}

function createPreviewPlugin(fixtureRoot: string, sourceRoot: string): PreviewPlugin {
  const plugins = createPreviewVitePlugin({
    projectName: "Fixture Preview",
    targets: [
      {
        name: "fixture",
        packageName: "@fixtures/plugin",
        packageRoot: fixtureRoot,
        sourceRoot,
      },
    ],
  });

  if (!Array.isArray(plugins)) {
    throw new Error("Expected the preview Vite plugin factory to return a plugin array.");
  }

  const previewPlugin = plugins[1];
  if (!previewPlugin || typeof previewPlugin !== "object" || Array.isArray(previewPlugin)) {
    throw new Error("Expected the preview Vite plugin to be the second object plugin.");
  }

  return previewPlugin as PreviewPlugin;
}

function createMockServer() {
  const watcherHandlers = new Map<string, Array<(filePath: string) => void>>();
  const workspaceModule = { id: "\0virtual:lattice-preview-workspace-index" };

  return {
    emit(event: string, filePath: string) {
      for (const handler of watcherHandlers.get(event) ?? []) {
        handler(filePath);
      }
    },
    moduleGraph: {
      getModuleById: vi.fn((id: string) => (id === workspaceModule.id ? workspaceModule : undefined)),
      invalidateModule: vi.fn(),
    },
    watcher: {
      on: vi.fn((event: string, handler: (filePath: string) => void) => {
        const handlers = watcherHandlers.get(event) ?? [];
        handlers.push(handler);
        watcherHandlers.set(event, handlers);
      }),
    },
    ws: {
      send: vi.fn(),
    },
  };
}

function readWorkspaceEntries(previewPlugin: PreviewPlugin) {
  const resolveId = getHookHandler<TestResolveIdHook>(previewPlugin.resolveId as TestResolveIdHook | undefined);
  const load = getHookHandler<TestLoadHook>(previewPlugin.load as TestLoadHook | undefined);

  const resolvedWorkspaceId = resolveId?.(WORKSPACE_INDEX_MODULE_ID);
  const workspaceModuleCode = load?.(resolvedWorkspaceId ?? WORKSPACE_INDEX_MODULE_ID);
  if (typeof workspaceModuleCode !== "string") {
    throw new Error("Expected the preview workspace index module to load as a string.");
  }

  const workspaceMatch = workspaceModuleCode.match(
    /export const previewWorkspaceIndex = (\{[\s\S]*?\});\nexport const previewEntryPayloads =/,
  );
  if (!workspaceMatch) {
    throw new Error(`Unable to parse preview workspace module:\n${workspaceModuleCode}`);
  }

  return JSON.parse(workspaceMatch[1] ?? "{}").entries as Array<{
    relativePath: string;
    status: string;
    renderTarget: {
      kind: string;
      reason?: string;
      candidates?: string[];
    };
  }>;
}

function readEntryPayload(previewPlugin: PreviewPlugin, entryId: string) {
  const resolveId = getHookHandler<TestResolveIdHook>(previewPlugin.resolveId as TestResolveIdHook | undefined);
  const load = getHookHandler<TestLoadHook>(previewPlugin.load as TestLoadHook | undefined);

  const resolvedEntryId = resolveId?.(`virtual:lattice-preview-entry:${encodeURIComponent(entryId)}`);
  const entryModuleCode = load?.(resolvedEntryId ?? entryId);
  if (typeof entryModuleCode !== "string") {
    throw new Error("Expected the preview entry module to load as a string.");
  }

  const payloadMatch = entryModuleCode.match(/export const __previewEntryPayload = (\{[\s\S]*?\});\n/);
  if (!payloadMatch) {
    throw new Error(`Unable to parse preview entry module:\n${entryModuleCode}`);
  }

  return JSON.parse(payloadMatch[1] ?? "{}") as {
    descriptor: {
      status: string;
    };
    diagnostics: Array<{
      blocking?: boolean;
      code: string;
      phase: string;
      relativeFile: string;
      severity?: string;
    }>;
    transform: {
      mode: string;
      outcome: {
        kind: string;
      };
    };
  };
}

describe("createPreviewVitePlugin", () => {
  it("allows normal hot updates when the registry shape is unchanged", async () => {
    const { fixtureRoot, sourceRoot } = createFixtureRoot();
    const sourceFile = path.join(sourceRoot, "AnimatedSlot.tsx");
    fs.writeFileSync(sourceFile, "export function AnimatedSlot() { return <frame />; }\n", "utf8");

    const previewPlugin = createPreviewPlugin(fixtureRoot, sourceRoot);
    const handleHotUpdate = getHookHandler<TestHotUpdateHook>(
      previewPlugin.handleHotUpdate as TestHotUpdateHook | undefined,
    );

    expect(handleHotUpdate).toBeTypeOf("function");
    expect(handleHotUpdate?.({ file: sourceFile })).toEqual([]);
    expect(handleHotUpdate?.({ file: path.join(fixtureRoot, "README.md") })).toBe(undefined);
  });

  it("refreshes the workspace index and sends custom hmr updates for add, delete, rename, and non-target watcher events", () => {
    const { fixtureRoot, sourceRoot } = createFixtureRoot();
    const sourceFile = path.join(sourceRoot, "AnimatedSlot.tsx");
    const addedFile = path.join(sourceRoot, "FreshSlot.tsx");
    const renamedFile = path.join(sourceRoot, "RenamedSlot.tsx");
    fs.writeFileSync(sourceFile, "export function AnimatedSlot() { return <frame />; }\n", "utf8");

    const previewPlugin = createPreviewPlugin(fixtureRoot, sourceRoot);
    const configureServer = getHookHandler<TestConfigureServerHook>(
      previewPlugin.configureServer as TestConfigureServerHook | undefined,
    );
    const mockServer = createMockServer();

    configureServer?.(mockServer);

    expect(readWorkspaceEntries(previewPlugin).map((entry) => entry.relativePath)).toEqual(["AnimatedSlot.tsx"]);

    fs.writeFileSync(addedFile, "export function FreshSlot() { return <frame />; }\n", "utf8");
    mockServer.emit("add", addedFile);
    expect(readWorkspaceEntries(previewPlugin).map((entry) => entry.relativePath)).toEqual([
      "AnimatedSlot.tsx",
      "FreshSlot.tsx",
    ]);

    fs.renameSync(addedFile, renamedFile);
    mockServer.emit("unlink", addedFile);
    mockServer.emit("add", renamedFile);
    expect(readWorkspaceEntries(previewPlugin).map((entry) => entry.relativePath)).toEqual([
      "AnimatedSlot.tsx",
      "RenamedSlot.tsx",
    ]);

    mockServer.emit("add", path.join(fixtureRoot, "README.md"));
    expect(readWorkspaceEntries(previewPlugin).map((entry) => entry.relativePath)).toEqual([
      "AnimatedSlot.tsx",
      "RenamedSlot.tsx",
    ]);

    fs.rmSync(renamedFile);
    mockServer.emit("unlink", renamedFile);
    expect(readWorkspaceEntries(previewPlugin).map((entry) => entry.relativePath)).toEqual(["AnimatedSlot.tsx"]);

    expect(mockServer.moduleGraph.invalidateModule).toHaveBeenCalledTimes(4);
    expect(mockServer.ws.send).toHaveBeenCalledTimes(4);
    expect(mockServer.ws.send).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "lattice-preview:update",
        type: "custom",
      }),
    );
  });

  it("recomputes entry status and render targets before sending entry-scoped updates", () => {
    const { fixtureRoot, sourceRoot } = createFixtureRoot();
    const sourceFile = path.join(sourceRoot, "AnimatedSlot.tsx");
    fs.writeFileSync(
      sourceFile,
      `
        export function AnimatedSlot() {
          return <frame />;
        }

        export const preview = {
          entry: AnimatedSlot,
        };
      `,
      "utf8",
    );

    const previewPlugin = createPreviewPlugin(fixtureRoot, sourceRoot);
    const configureServer = getHookHandler<TestConfigureServerHook>(
      previewPlugin.configureServer as TestConfigureServerHook | undefined,
    );
    const handleHotUpdate = getHookHandler<TestHotUpdateHook>(
      previewPlugin.handleHotUpdate as TestHotUpdateHook | undefined,
    );
    const mockServer = createMockServer();

    configureServer?.(mockServer);

    expect(readWorkspaceEntries(previewPlugin)).toEqual(
      expect.arrayContaining([expect.objectContaining({ relativePath: "AnimatedSlot.tsx", status: "ready" })]),
    );

    fs.writeFileSync(
      sourceFile,
      `
        export function Alpha() {
          return <frame />;
        }

        export function Beta() {
          return <frame />;
        }
      `,
      "utf8",
    );
    expect(handleHotUpdate?.({ file: sourceFile })).toEqual([]);
    expect(readWorkspaceEntries(previewPlugin)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          relativePath: "AnimatedSlot.tsx",
          status: "ambiguous",
          renderTarget: expect.objectContaining({
            kind: "none",
            reason: "ambiguous-exports",
            candidates: ["Alpha", "Beta"],
          }),
        }),
      ]),
    );

    fs.writeFileSync(sourceFile, "export const value = 1;\n", "utf8");
    expect(handleHotUpdate?.({ file: sourceFile })).toEqual([]);
    expect(readWorkspaceEntries(previewPlugin)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          relativePath: "AnimatedSlot.tsx",
          status: "needs_harness",
          renderTarget: expect.objectContaining({
            kind: "none",
            reason: "no-component-export",
          }),
        }),
      ]),
    );

    fs.writeFileSync(
      sourceFile,
      `
        export default function AnimatedSlot() {
          return <frame />;
        }

        export const preview = {
          render: AnimatedSlot,
        };
      `,
      "utf8",
    );
    expect(handleHotUpdate?.({ file: sourceFile })).toEqual([]);
    expect(readWorkspaceEntries(previewPlugin)).toEqual(
      expect.arrayContaining([expect.objectContaining({ relativePath: "AnimatedSlot.tsx", status: "ready" })]),
    );

    expect(mockServer.moduleGraph.invalidateModule).toHaveBeenCalledTimes(3);
    expect(mockServer.ws.send).toHaveBeenCalledTimes(3);
  });

  it("loads entry payloads with transform diagnostics on demand", () => {
    const { fixtureRoot, sourceRoot } = createFixtureRoot();
    const sourceFile = path.join(sourceRoot, "Broken.tsx");
    fs.writeFileSync(
      sourceFile,
      `
        export function Broken() {
          return <viewportframe />;
        }

        export const preview = {
          entry: Broken,
        };
      `,
      "utf8",
    );

    const previewPlugin = createPreviewPlugin(fixtureRoot, sourceRoot);
    const entryPayload = readEntryPayload(previewPlugin, "fixture:Broken.tsx");

    expect(entryPayload.descriptor.status).toBe("blocked_by_transform");
    expect(entryPayload.transform).toEqual({
      mode: "strict-fidelity",
      outcome: {
        fidelity: "degraded",
        kind: "blocked",
      },
    });
    expect(entryPayload.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          blocking: true,
          code: "UNSUPPORTED_HOST_ELEMENT",
          phase: "transform",
          relativeFile: "src/Broken.tsx",
          severity: "error",
        }),
      ]),
    );
  });
});
