// @vitest-environment jsdom

import type { PreviewDiagnostic, PreviewEntryDescriptor, PreviewEntryPayload } from "@lattice-ui/preview-engine";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PreviewApp } from "../../../packages/preview/src/shell/PreviewApp";
import { PreviewThemeProvider } from "../../../packages/preview/src/shell/theme";
import { PREVIEW_ENGINE_PROTOCOL_VERSION } from "../../../packages/preview-engine/src/types";

afterEach(() => {
  cleanup();
});

function createEntryDescriptor(
  overrides: Partial<PreviewEntryDescriptor> & Pick<PreviewEntryDescriptor, "id" | "relativePath" | "title">,
): PreviewEntryDescriptor {
  return {
    candidateExportNames: [],
    capabilities: {
      supportsHotUpdate: true,
      supportsLayoutDebug: true,
      supportsPropsEditing: true,
      supportsRuntimeMock: true,
    },
    diagnosticsSummary: {
      byPhase: {
        discovery: 0,
        layout: 0,
        runtime: 0,
        transform: 0,
      },
      hasBlocking: false,
      total: 0,
    },
    hasDefaultExport: false,
    hasPreviewExport: false,
    id: overrides.id,
    packageName: overrides.packageName ?? "@fixtures/preview-shell",
    relativePath: overrides.relativePath,
    renderTarget:
      overrides.renderTarget ??
      ({
        exportName: "default",
        kind: "component",
        usesPreviewProps: false,
      } as const),
    selection:
      overrides.selection ??
      ({
        contract: "preview.entry",
        kind: "explicit",
      } as const),
    sourceFilePath: overrides.sourceFilePath ?? `/virtual/${overrides.id}`,
    status: overrides.status ?? "ready",
    targetName: overrides.targetName ?? "fixture",
    title: overrides.title,
    ...overrides,
  };
}

function createDiagnostic(
  overrides: Partial<PreviewDiagnostic> & Pick<PreviewDiagnostic, "code" | "phase" | "summary">,
): PreviewDiagnostic {
  return {
    code: overrides.code,
    entryId: overrides.entryId ?? "fixture:entry",
    file: overrides.file ?? "/virtual/fixture.tsx",
    phase: overrides.phase,
    relativeFile: overrides.relativeFile ?? "src/fixture.tsx",
    severity: overrides.severity ?? "warning",
    summary: overrides.summary,
    target: overrides.target ?? "fixture",
    ...overrides,
  };
}

function createPayload(entry: PreviewEntryDescriptor, diagnostics: PreviewDiagnostic[] = []): PreviewEntryPayload {
  return {
    descriptor: entry,
    diagnostics,
    graphTrace: {
      boundaryHops: [],
      imports: [],
      selection: {
        importChain: [],
        symbolChain: [],
      },
    },
    protocolVersion: PREVIEW_ENGINE_PROTOCOL_VERSION,
    runtimeAdapter: {
      kind: "react-dom",
      moduleId: "virtual:lattice-preview-runtime",
    },
    transform: {
      mode: "compatibility",
      outcome:
        entry.status === "blocked_by_transform"
          ? {
              fidelity: "degraded",
              kind: "blocked",
            }
          : {
              fidelity: "preserved",
              kind: "ready",
            },
    },
  };
}

function createLoadedEntry(
  entry: PreviewEntryDescriptor,
  module: Record<string, unknown>,
  diagnostics: PreviewDiagnostic[] = [],
) {
  return Promise.resolve({
    module,
    payload: createPayload(entry, diagnostics),
  });
}

const checkboxEntry = createEntryDescriptor({
  candidateExportNames: ["CheckboxRoot"],
  id: "Checkbox/CheckboxRoot.tsx",
  packageName: "@lattice-ui/checkbox",
  relativePath: "Checkbox/CheckboxRoot.tsx",
  renderTarget: {
    exportName: "CheckboxRoot",
    kind: "component",
    usesPreviewProps: false,
  },
  selection: {
    contract: "preview.entry",
    kind: "explicit",
  },
  targetName: "checkbox",
  title: "Checkbox Root",
});

const dialogEntry = createEntryDescriptor({
  hasPreviewExport: true,
  id: "DialogRoot.tsx",
  packageName: "@fixtures/source-preview",
  relativePath: "DialogRoot.tsx",
  renderTarget: {
    contract: "preview.render",
    kind: "harness",
  },
  selection: {
    contract: "preview.render",
    kind: "explicit",
  },
  title: "Dialog Root",
});

function renderPreviewApp(app: React.ReactElement) {
  return render(<PreviewThemeProvider>{app}</PreviewThemeProvider>);
}

describe("preview shell", () => {
  it("renders direct-export preview entries", async () => {
    renderPreviewApp(
      <PreviewApp
        entries={[checkboxEntry]}
        initialSelectedId={checkboxEntry.id}
        loadEntry={() =>
          createLoadedEntry(checkboxEntry, {
            CheckboxRoot: () => <button type="button">Unchecked</button>,
          })
        }
        projectName="@lattice-ui/preview-smoke"
      />,
    );

    expect(await screen.findByRole("button", { name: /unchecked/i })).toBeTruthy();
  });

  it("renders harness-based previews from the preview export contract", async () => {
    renderPreviewApp(
      <PreviewApp
        entries={[dialogEntry]}
        initialSelectedId={dialogEntry.id}
        loadEntry={() =>
          createLoadedEntry(dialogEntry, {
            preview: {
              render: () => (
                <div>
                  <p>Dialog Preview</p>
                  <button type="button">Close</button>
                </div>
              ),
            },
          })
        }
        projectName="@lattice-ui/preview-smoke"
      />,
    );

    expect(await screen.findByText("Dialog Preview")).toBeTruthy();
    expect(screen.getByRole("button", { name: /close/i })).toBeTruthy();
  });

  it("shows compatibility-mode transform diagnostics without blocking the preview", async () => {
    const brokenEntry = createEntryDescriptor({
      candidateExportNames: ["Broken"],
      id: "Broken.tsx",
      relativePath: "Broken.tsx",
      renderTarget: {
        exportName: "Broken",
        kind: "component",
        usesPreviewProps: false,
      },
      selection: {
        contract: "preview.entry",
        kind: "explicit",
      },
      targetName: "broken",
      title: "Broken",
    });

    renderPreviewApp(
      <PreviewApp
        entries={[brokenEntry]}
        initialSelectedId="Broken.tsx"
        loadEntry={() =>
          createLoadedEntry(
            brokenEntry,
            {
              Broken: () => <button type="button">Broken preview</button>,
            },
            [
              createDiagnostic({
                blocking: false,
                code: "UNSUPPORTED_GLOBAL",
                entryId: brokenEntry.id,
                file: "/virtual/Broken.tsx",
                phase: "transform",
                relativeFile: "src/Broken.tsx",
                severity: "warning",
                summary: "The Roblox `game` global is not supported by preview generation.",
                target: "roblox",
              }),
            ],
          )
        }
        projectName="@lattice-ui/preview-smoke"
      />,
    );

    expect(await screen.findByRole("button", { name: "Broken preview" })).toBeTruthy();
    expect(screen.getByText("UNSUPPORTED_GLOBAL")).toBeTruthy();
  });

  it("shows blocked-by-transform guidance without rendering the canvas", async () => {
    const blockedEntry = createEntryDescriptor({
      candidateExportNames: ["Blocked"],
      id: "Blocked.tsx",
      relativePath: "Blocked.tsx",
      renderTarget: {
        exportName: "Blocked",
        kind: "component",
        usesPreviewProps: false,
      },
      selection: {
        contract: "preview.entry",
        kind: "explicit",
      },
      status: "blocked_by_transform",
      title: "Blocked",
    });
    const loadEntry = vi.fn(() =>
      createLoadedEntry(blockedEntry, {}, [
        createDiagnostic({
          blocking: true,
          code: "UNSUPPORTED_HOST_ELEMENT",
          entryId: blockedEntry.id,
          file: "/virtual/Blocked.tsx",
          phase: "transform",
          relativeFile: "src/Blocked.tsx",
          severity: "error",
          summary: "Host element viewportframe is not supported by preview generation.",
        }),
      ]),
    );

    renderPreviewApp(
      <PreviewApp
        entries={[blockedEntry]}
        initialSelectedId="Blocked.tsx"
        loadEntry={loadEntry}
        projectName="@lattice-ui/preview-smoke"
      />,
    );

    expect(await screen.findByText("This preview is blocked by transform mode.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Blocked preview" })).toBeNull();
    expect(loadEntry).toHaveBeenCalledTimes(1);
  });

  it("shows harness guidance without loading modules for non-previewable entries", () => {
    const loadEntry = vi.fn(() => Promise.reject(new Error("should not load")));
    const harnessEntry = createEntryDescriptor({
      candidateExportNames: [],
      hasPreviewExport: true,
      id: "Checkbox/CheckboxIndicator.tsx",
      packageName: "@lattice-ui/checkbox",
      relativePath: "Checkbox/CheckboxIndicator.tsx",
      renderTarget: {
        kind: "none",
        reason: "no-component-export",
      },
      selection: {
        kind: "unresolved",
        reason: "no-component-export",
      },
      status: "needs_harness",
      targetName: "checkbox",
      title: "Checkbox Indicator",
    });

    renderPreviewApp(
      <PreviewApp
        entries={[harnessEntry]}
        entryPayloads={{
          [harnessEntry.id]: createPayload(harnessEntry, [
            createDiagnostic({
              code: "PREVIEW_RENDER_MISSING",
              entryId: harnessEntry.id,
              file: "/virtual/CheckboxIndicator.tsx",
              phase: "discovery",
              relativeFile: "src/Checkbox/CheckboxIndicator.tsx",
              summary:
                "The file exports `preview`, but it does not define a usable `preview.entry` or callable `preview.render`.",
            }),
          ]),
        }}
        initialSelectedId="Checkbox/CheckboxIndicator.tsx"
        loadEntry={loadEntry}
        projectName="@lattice-ui/preview-smoke"
      />,
    );

    expect(screen.getByText("The preview export is incomplete.")).toBeTruthy();
    expect(screen.getByText("PREVIEW_RENDER_MISSING")).toBeTruthy();
    expect(loadEntry).not.toHaveBeenCalled();
  });

  it("shows ambiguous guidance with concrete candidates", () => {
    const loadEntry = vi.fn(() => Promise.reject(new Error("should not load")));
    const ambiguousEntry = createEntryDescriptor({
      candidateExportNames: ["Alpha", "Beta"],
      id: "Ambiguous.tsx",
      packageName: "@fixtures/ambiguous",
      relativePath: "Ambiguous.tsx",
      renderTarget: {
        candidates: ["Alpha", "Beta"],
        kind: "none",
        reason: "ambiguous-exports",
      },
      selection: {
        kind: "unresolved",
        reason: "ambiguous-exports",
      },
      status: "ambiguous",
      title: "Ambiguous",
    });

    renderPreviewApp(
      <PreviewApp
        entries={[ambiguousEntry]}
        entryPayloads={{
          [ambiguousEntry.id]: createPayload(ambiguousEntry, [
            createDiagnostic({
              code: "AMBIGUOUS_COMPONENT_EXPORTS",
              entryId: ambiguousEntry.id,
              file: "/virtual/Ambiguous.tsx",
              phase: "discovery",
              relativeFile: "src/Ambiguous.tsx",
              summary: "Multiple component exports need explicit disambiguation: Alpha, Beta.",
            }),
          ]),
        }}
        initialSelectedId="Ambiguous.tsx"
        loadEntry={loadEntry}
        projectName="@lattice-ui/preview-smoke"
      />,
    );

    expect(screen.getByText("Multiple exported components match this file.")).toBeTruthy();
    expect(screen.getByText(/Automatic selection found multiple component exports: Alpha, Beta\./)).toBeTruthy();
    expect(screen.getByText("AMBIGUOUS_COMPONENT_EXPORTS")).toBeTruthy();
    expect(loadEntry).not.toHaveBeenCalled();
  });

  it("shows no-component guidance without falling back to ambiguous messaging", () => {
    const loadEntry = vi.fn(() => Promise.reject(new Error("should not load")));
    const harnessOnlyEntry = createEntryDescriptor({
      candidateExportNames: [],
      id: "HarnessOnly.tsx",
      packageName: "@fixtures/harness-only",
      relativePath: "HarnessOnly.tsx",
      renderTarget: {
        kind: "none",
        reason: "no-component-export",
      },
      selection: {
        kind: "unresolved",
        reason: "no-component-export",
      },
      status: "needs_harness",
      title: "Harness Only",
    });

    renderPreviewApp(
      <PreviewApp
        entries={[harnessOnlyEntry]}
        entryPayloads={{
          [harnessOnlyEntry.id]: createPayload(harnessOnlyEntry, [
            createDiagnostic({
              code: "NO_COMPONENT_EXPORTS",
              entryId: harnessOnlyEntry.id,
              file: "/virtual/HarnessOnly.tsx",
              phase: "discovery",
              relativeFile: "src/HarnessOnly.tsx",
              summary: "No exported component candidates were found for preview entry selection.",
            }),
          ]),
        }}
        initialSelectedId="HarnessOnly.tsx"
        loadEntry={loadEntry}
        projectName="@lattice-ui/preview-smoke"
      />,
    );

    expect(screen.getByText("This file is not directly previewable yet.")).toBeTruthy();
    expect(
      screen.getByText(
        "No renderable exported component was found. Add `preview.entry` or `preview.render` for composed demos.",
      ),
    ).toBeTruthy();
    expect(loadEntry).not.toHaveBeenCalled();
  });

  it("shows an empty-project state when there are no eligible preview entries", () => {
    renderPreviewApp(
      <PreviewApp entries={[]} loadEntry={() => Promise.reject(new Error("should not load"))} projectName="Empty" />,
    );

    expect(screen.getByText("No previewable source files were found.")).toBeTruthy();
  });

  it("clears load errors when the user selects another ready entry", async () => {
    const user = userEvent.setup();
    const brokenEntry = createEntryDescriptor({
      id: "Broken.tsx",
      relativePath: "Broken.tsx",
      title: "Broken",
    });
    const workingEntry = createEntryDescriptor({
      id: "Working.tsx",
      relativePath: "Working.tsx",
      title: "Working",
    });

    renderPreviewApp(
      <PreviewApp
        entries={[brokenEntry, workingEntry]}
        initialSelectedId={brokenEntry.id}
        loadEntry={(id) =>
          id === brokenEntry.id
            ? Promise.reject(new Error("Intentional load failure."))
            : createLoadedEntry(workingEntry, {
                default: () => <button type="button">Healthy preview</button>,
              })
        }
        projectName="@lattice-ui/preview-smoke"
      />,
    );

    expect(await screen.findByText("Preview module failed to load.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /working/i }));
    expect(await screen.findByRole("button", { name: "Healthy preview" })).toBeTruthy();
  });

  it("clears render errors when the user switches to another entry", async () => {
    const user = userEvent.setup();
    const crashingEntry = createEntryDescriptor({
      id: "Crash.tsx",
      relativePath: "Crash.tsx",
      title: "Crash",
    });
    const workingEntry = createEntryDescriptor({
      id: "Okay.tsx",
      relativePath: "Okay.tsx",
      title: "Okay",
    });

    renderPreviewApp(
      <PreviewApp
        entries={[crashingEntry, workingEntry]}
        initialSelectedId={crashingEntry.id}
        loadEntry={(id) =>
          createLoadedEntry(id === crashingEntry.id ? crashingEntry : workingEntry, {
            default:
              id === crashingEntry.id
                ? () => {
                    throw new Error("Intentional render failure.");
                  }
                : () => <button type="button">Recovered preview</button>,
          })
        }
        projectName="@lattice-ui/preview-smoke"
      />,
    );

    expect(await screen.findByText("Preview render failed.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /okay/i }));
    expect(await screen.findByRole("button", { name: "Recovered preview" })).toBeTruthy();
  });

  it("does not recover from stale registry export names with module export inference", async () => {
    const staleEntry = createEntryDescriptor({
      candidateExportNames: ["LoadoutEditor"],
      id: "LoadoutEditor.tsx",
      packageName: "@fixtures/stale-registry",
      relativePath: "LoadoutEditor.tsx",
      renderTarget: {
        exportName: "LoadoutEditor",
        kind: "component",
        usesPreviewProps: false,
      },
      selection: {
        contract: "preview.entry",
        kind: "explicit",
      },
      title: "Loadout Editor",
    });

    renderPreviewApp(
      <PreviewApp
        entries={[staleEntry]}
        initialSelectedId="LoadoutEditor.tsx"
        loadEntry={() =>
          createLoadedEntry(staleEntry, {
            AnimatedSlot: () => <button type="button">Recovered stale export</button>,
          })
        }
        projectName="@lattice-ui/preview-smoke"
      />,
    );

    expect(await screen.findByText("Preview render failed.")).toBeTruthy();
    expect(screen.getAllByText(/Expected `LoadoutEditor` to be a component export/i)).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "Recovered stale export" })).toBeNull();
  });
});
