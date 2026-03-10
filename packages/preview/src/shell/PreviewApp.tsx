import type {
  PreviewDefinition,
  PreviewDiagnostic,
  PreviewEntryDescriptor,
  PreviewEntryPayload,
  PreviewEntryStatus,
} from "@lattice-ui/preview-engine";
import {
  AutoMockProvider,
  areViewportsEqual,
  clearPreviewRuntimeIssues,
  createViewportSize,
  createWindowViewport,
  isViewportLargeEnough,
  LayoutProvider,
  measureElementViewport,
  normalizePreviewRuntimeError,
  type PreviewRuntimeIssue,
  pickViewport,
  setPreviewRuntimeIssueContext,
  subscribePreviewRuntimeIssues,
  type ViewportSize,
} from "@lattice-ui/preview-runtime";
import React from "react";
import { PreviewThemeControl } from "./theme";

type PreviewModule = Record<string, unknown> & {
  default?: unknown;
  preview?: PreviewDefinition;
};

type PreviewAppProps = {
  entries: PreviewEntryDescriptor[];
  entryPayloads?: Record<string, PreviewEntryPayload>;
  initialSelectedId?: string;
  loadEntry: (id: string) => Promise<LoadedPreviewEntry>;
  projectName: string;
};

type PreviewCanvasProps = {
  entry: PreviewEntryDescriptor;
  isDebugMode: boolean;
  module: PreviewModule;
  onRenderError: (error: unknown | null) => void;
};

type PreviewNodeRendererProps = {
  entry: PreviewEntryDescriptor;
  module: PreviewModule;
};

type PreviewErrorBoundaryProps = {
  children: React.ReactNode;
  onError: (error: unknown | null) => void;
};

type PreviewErrorBoundaryState = {
  errorMessage: string | null;
};

type LoadedPreviewEntry = {
  module: PreviewModule;
  payload?: PreviewEntryPayload;
};

class PreviewErrorBoundary extends React.Component<PreviewErrorBoundaryProps, PreviewErrorBoundaryState> {
  constructor(props: PreviewErrorBoundaryProps) {
    super(props);
    this.state = {
      errorMessage: null,
    };
  }

  static getDerivedStateFromError(error: unknown): PreviewErrorBoundaryState {
    return {
      errorMessage: error instanceof Error ? error.message : "Unknown preview render error.",
    };
  }

  componentDidCatch(error: unknown) {
    this.props.onError(error);
  }

  render() {
    if (this.state.errorMessage) {
      return (
        <div className="preview-empty">
          <p className="preview-empty-eyebrow">Render error</p>
          <h2>Preview render failed.</h2>
          <p>{this.state.errorMessage}</p>
        </div>
      );
    }

    return this.props.children;
  }
}

function getInitialSelectedId(entries: PreviewEntryDescriptor[], explicitSelectedId?: string) {
  if (explicitSelectedId && entries.some((entry) => entry.id === explicitSelectedId)) {
    return explicitSelectedId;
  }

  if (typeof window !== "undefined") {
    const searchParams = new URLSearchParams(window.location.search);
    const selectedPath = searchParams.get("path");
    if (selectedPath && entries.some((entry) => entry.id === selectedPath)) {
      return selectedPath;
    }
  }

  return entries[0]?.id;
}

function readPreviewDefinition(module: PreviewModule) {
  const preview = module.preview;

  if (!preview || typeof preview !== "object") {
    return undefined;
  }

  return preview;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readNestedExport(container: unknown, exportName: string, visited = new Set<unknown>()): unknown {
  if (!isRecord(container) || visited.has(container)) {
    return undefined;
  }

  visited.add(container);
  return exportName in container ? container[exportName] : undefined;
}

function readModuleExport(module: PreviewModule, exportName: "default" | string) {
  if (exportName === "default") {
    return module.default;
  }

  return readNestedExport(module, exportName);
}

function isRenderableComponentExport(value: unknown): boolean {
  return typeof value === "function" || (isRecord(value) && "$$typeof" in value);
}

function describeValue(value: unknown) {
  if (value === undefined) {
    return "undefined";
  }

  if (value === null) {
    return "null";
  }

  if (typeof value === "function") {
    return value.name ? `function ${value.name}` : "function";
  }

  if (Array.isArray(value)) {
    return "array";
  }

  if (isRecord(value)) {
    const keys = Object.keys(value).sort();
    return keys.length > 0 ? `object with keys [${keys.join(", ")}]` : "object";
  }

  return typeof value;
}

function describeModuleExports(module: PreviewModule) {
  const keys = Object.keys(module).sort();
  return `module: [${keys.join(", ") || "(none)"}]`;
}

function getRenderModeLabel(entry: PreviewEntryDescriptor) {
  if (entry.renderTarget.kind === "harness") {
    return "preview.render";
  }

  if (entry.selection.kind === "explicit" && entry.selection.contract === "preview.entry") {
    return "preview.entry";
  }

  if (entry.renderTarget.kind === "component" && entry.renderTarget.exportName === "default") {
    return "default export";
  }

  if (entry.renderTarget.kind === "component") {
    return entry.renderTarget.exportName;
  }

  return "none";
}

function getStatusLabel(status: PreviewEntryStatus) {
  switch (status) {
    case "ready":
      return "ready";
    case "ambiguous":
      return "ambiguous";
    case "blocked_by_layout":
      return "blocked by layout";
    case "blocked_by_runtime":
      return "blocked by runtime";
    case "blocked_by_transform":
      return "blocked by transform";
    case "needs_harness":
      return "needs harness";
  }
}

function formatCandidateExports(candidates: string[]) {
  return candidates.join(", ");
}

function getPrimaryDiscoveryDiagnostic(discoveryDiagnostics: PreviewDiagnostic[]) {
  const priority: Record<string, number> = {
    AMBIGUOUS_COMPONENT_EXPORTS: 0,
    PREVIEW_RENDER_MISSING: 1,
    MISSING_EXPLICIT_PREVIEW_CONTRACT: 2,
    NO_COMPONENT_EXPORTS: 3,
    DECLARATION_ONLY_BOUNDARY: 4,
    UNRESOLVED_IMPORT: 5,
  };

  return [...discoveryDiagnostics].sort((left, right) => {
    const priorityDelta =
      (priority[left.code] ?? Number.MAX_SAFE_INTEGER) - (priority[right.code] ?? Number.MAX_SAFE_INTEGER);
    if (priorityDelta !== 0) {
      return priorityDelta;
    }

    return left.summary.localeCompare(right.summary);
  })[0];
}

function getDiscoveryDiagnostic(discoveryDiagnostics: PreviewDiagnostic[], code: string) {
  return discoveryDiagnostics.find((diagnostic) => diagnostic.code === code);
}

function getNeedsHarnessReasonBody(entry: PreviewEntryDescriptor) {
  if (entry.renderTarget.kind !== "none") {
    return undefined;
  }

  if (entry.renderTarget.reason === "ambiguous-exports") {
    return `Automatic selection found multiple component exports: ${formatCandidateExports(
      entry.renderTarget.candidates ?? entry.candidateExportNames,
    )}. Add \`preview.entry\` or \`preview.render\` to pick the intended preview target.`;
  }

  return "No renderable exported component was found. Add `preview.entry` or `preview.render` for composed demos.";
}

function getEntryEmptyState(entry: PreviewEntryDescriptor, discoveryDiagnostics: PreviewDiagnostic[]) {
  const primaryDiscoveryDiagnostic = getPrimaryDiscoveryDiagnostic(discoveryDiagnostics);
  const missingExplicitDiagnostic = getDiscoveryDiagnostic(discoveryDiagnostics, "MISSING_EXPLICIT_PREVIEW_CONTRACT");
  const previewRenderMissingDiagnostic = getDiscoveryDiagnostic(discoveryDiagnostics, "PREVIEW_RENDER_MISSING");

  if (entry.status === "needs_harness" || entry.status === "ambiguous") {
    if (missingExplicitDiagnostic) {
      return {
        body: missingExplicitDiagnostic.summary,
        eyebrow: "Needs harness",
        title: "Explicit preview contract is required.",
      };
    }

    if (previewRenderMissingDiagnostic) {
      return {
        body:
          `${previewRenderMissingDiagnostic.summary} ` +
          (getNeedsHarnessReasonBody(entry) ??
            "Add `preview.entry` or `preview.render` to make the preview target explicit."),
        eyebrow: "Needs harness",
        title: "The preview export is incomplete.",
      };
    }

    if (entry.renderTarget.kind === "none" && entry.renderTarget.reason === "ambiguous-exports") {
      return {
        body: getNeedsHarnessReasonBody(entry),
        eyebrow: "Needs harness",
        title: "Multiple exported components match this file.",
      };
    }

    if (entry.renderTarget.kind === "none" && entry.renderTarget.reason === "no-component-export") {
      return {
        body: getNeedsHarnessReasonBody(entry),
        eyebrow: "Needs harness",
        title: "This file is not directly previewable yet.",
      };
    }

    return {
      body:
        primaryDiscoveryDiagnostic?.summary ??
        "Add `export const preview = { entry: Component }` or `render: () => ...` when the file needs explicit harnessing.",
      eyebrow: "Needs harness",
      title: "This file is not directly previewable yet.",
    };
  }
}

function isLoadableEntryStatus(status: PreviewEntryStatus) {
  return (
    status === "ready" ||
    status === "blocked_by_transform" ||
    status === "blocked_by_runtime" ||
    status === "blocked_by_layout"
  );
}

function createPreviewNode(entry: PreviewEntryDescriptor, module: PreviewModule) {
  const preview = readPreviewDefinition(module);

  if (entry.renderTarget.kind === "harness") {
    if (!preview?.render || typeof preview.render !== "function") {
      throw new Error(
        "This entry is marked as preview.render but the module does not export a callable preview.render.",
      );
    }

    const Harness = preview.render as React.ComponentType;
    return <Harness />;
  }

  if (entry.renderTarget.kind === "component") {
    const exportValue = readModuleExport(module, entry.renderTarget.exportName);
    if (!isRenderableComponentExport(exportValue)) {
      throw new Error(
        `Expected \`${entry.renderTarget.exportName}\` to be a component export, received ${describeValue(exportValue)}. ` +
          `Available exports: ${describeModuleExports(module)}.`,
      );
    }

    const props =
      entry.renderTarget.usesPreviewProps && preview?.props && typeof preview.props === "object"
        ? preview.props
        : undefined;

    return <AutoMockProvider component={exportValue as React.ComponentType<Record<string, unknown>>} props={props} />;
  }

  return null;
}

function PreviewNodeRenderer(props: PreviewNodeRendererProps) {
  return createPreviewNode(props.entry, props.module);
}

function usePreviewViewport() {
  const viewportRef = React.useRef<HTMLDivElement | null>(null);
  const [viewport, setViewport] = React.useState<ViewportSize>(() => createWindowViewport());
  const lastStableViewportRef = React.useRef<ViewportSize>(viewport);

  React.useLayoutEffect(() => {
    const element = viewportRef.current;
    if (!element) {
      return;
    }

    const update = (nextMeasuredViewport?: ViewportSize | null) => {
      const measuredViewport = nextMeasuredViewport ?? measureElementViewport(element);
      const nextViewport = pickViewport([measuredViewport, lastStableViewportRef.current], createWindowViewport());

      if (isViewportLargeEnough(nextViewport)) {
        lastStableViewportRef.current = nextViewport;
      }

      setViewport((previous) => (areViewportsEqual(previous, nextViewport) ? previous : nextViewport));
    };

    update();

    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver((entries) => {
        const entry = entries.find((candidate) => candidate.target === element) ?? entries[0];
        update(createViewportSize(entry?.contentRect.width, entry?.contentRect.height));
      });
      observer.observe(element);
      return () => {
        observer.disconnect();
      };
    }

    const onWindowResize = () => {
      update();
    };

    window.addEventListener("resize", onWindowResize);
    return () => {
      window.removeEventListener("resize", onWindowResize);
    };
  }, []);

  React.useEffect(() => {
    console.log("Measured Canvas Size:", viewport.width, viewport.height);
  }, [viewport.height, viewport.width]);

  return {
    viewport,
    viewportRef,
  };
}

function PreviewCanvas(props: PreviewCanvasProps) {
  const preview = readPreviewDefinition(props.module);
  const { viewport, viewportRef } = usePreviewViewport();
  const subtitle =
    props.entry.renderTarget.kind === "harness"
      ? "Custom harness"
      : props.entry.renderTarget.kind === "component" && props.entry.renderTarget.usesPreviewProps
        ? "Component render with preview.props"
        : "Component render";

  return (
    <div className="preview-canvas">
      <div className="canvas-meta">
        <div>
          <p className="meta-label">Target</p>
          <p className="meta-value">{props.entry.targetName}</p>
        </div>
        <div>
          <p className="meta-label">Render</p>
          <p className="meta-value">{getRenderModeLabel(props.entry)}</p>
        </div>
        <div>
          <p className="meta-label">Mode</p>
          <p className="meta-value">{subtitle}</p>
        </div>
        <div>
          <p className="meta-label">Title</p>
          <p className="meta-value">{preview?.title ?? props.entry.title}</p>
        </div>
      </div>
      <div className="preview-stage">
        <div
          className="preview-stage-viewport"
          data-debug-mode={props.isDebugMode ? "true" : undefined}
          data-preview-stage-height={viewport.height}
          data-preview-stage-width={viewport.width}
          ref={viewportRef}
        >
          <LayoutProvider viewportHeight={viewport.height} viewportWidth={viewport.width}>
            <PreviewErrorBoundary key={props.entry.id} onError={props.onRenderError}>
              <PreviewNodeRenderer entry={props.entry} module={props.module} />
            </PreviewErrorBoundary>
          </LayoutProvider>
        </div>
      </div>
    </div>
  );
}

export function PreviewApp(props: PreviewAppProps) {
  const [selectedId, setSelectedId] = React.useState(() =>
    getInitialSelectedId(props.entries, props.initialSelectedId),
  );
  const [isDebugMode, setIsDebugMode] = React.useState(false);
  const [loadedEntry, setLoadedEntry] = React.useState<LoadedPreviewEntry | undefined>();
  const [loadIssue, setLoadIssue] = React.useState<PreviewRuntimeIssue | null>(null);
  const [renderIssue, setRenderIssue] = React.useState<PreviewRuntimeIssue | null>(null);
  const [runtimeIssues, setRuntimeIssues] = React.useState<PreviewRuntimeIssue[]>([]);
  const selectedEntry = props.entries.find((entry) => entry.id === selectedId) ?? props.entries[0];
  const selectedEntryPayload =
    (selectedEntry ? props.entryPayloads?.[selectedEntry.id] : undefined) ?? loadedEntry?.payload;
  const selectedEntryDiscoveryDiagnostics =
    selectedEntry == null
      ? []
      : (selectedEntryPayload?.diagnostics.filter((diagnostic) => diagnostic.phase === "discovery") ?? []);
  const selectedEntryDiagnostics =
    selectedEntryPayload?.diagnostics.filter((diagnostic) => diagnostic.phase !== "discovery") ?? [];
  const selectedEntryBlockingDiagnostics = selectedEntryDiagnostics.filter(
    (diagnostic) => diagnostic.blocking ?? diagnostic.severity !== "warning",
  );
  const emptyState = selectedEntry ? getEntryEmptyState(selectedEntry, selectedEntryDiscoveryDiagnostics) : undefined;

  React.useEffect(() => {
    if (!selectedEntry || typeof window === "undefined") {
      return;
    }

    const url = new URL(window.location.href);
    url.searchParams.set("path", selectedEntry.id);
    window.history.replaceState({}, "", url);
  }, [selectedEntry]);

  React.useEffect(() => {
    const unsubscribe = subscribePreviewRuntimeIssues((issues) => {
      setRuntimeIssues(issues);
    });

    return () => {
      unsubscribe();
    };
  }, []);

  React.useEffect(() => {
    clearPreviewRuntimeIssues();
    setPreviewRuntimeIssueContext(
      selectedEntry
        ? {
            entryId: selectedEntry.id,
            file: selectedEntry.sourceFilePath,
            relativeFile: selectedEntry.relativePath,
            target: selectedEntry.targetName,
          }
        : null,
    );
    setLoadIssue(null);
    setRenderIssue(null);

    return () => {
      setPreviewRuntimeIssueContext(null);
    };
  }, [selectedEntry]);

  React.useEffect(() => {
    if (!selectedEntry || !isLoadableEntryStatus(selectedEntry.status)) {
      setLoadedEntry(undefined);
      setLoadIssue(null);
      setRenderIssue(null);
      return;
    }

    let cancelled = false;
    setLoadedEntry(undefined);
    setLoadIssue(null);
    setRenderIssue(null);

    props
      .loadEntry(selectedEntry.id)
      .then((entryResult) => {
        if (!cancelled) {
          setLoadedEntry(entryResult);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setLoadIssue(
            normalizePreviewRuntimeError(
              {
                code: "MODULE_LOAD_ERROR",
                kind: "ModuleLoadError",
                phase: "runtime",
                summary: `Preview module failed to load: ${error instanceof Error ? error.message : String(error)}`,
              },
              error,
            ),
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, [props, selectedEntry]);

  return (
    <main className="preview-shell">
      <aside className="preview-sidebar">
        <div className="sidebar-header">
          <p className="sidebar-eyebrow">Lattice Preview</p>
          <h1>{props.projectName}</h1>
          <p>Compiler-driven preview for transformed `@rbxts/react` source files.</p>
        </div>
        <nav aria-label="Preview entries" className="sidebar-list">
          {props.entries.map((entry) => (
            <button
              className={`sidebar-item ${entry.id === selectedEntry?.id ? "is-selected" : ""}`}
              key={entry.id}
              onClick={() => React.startTransition(() => setSelectedId(entry.id))}
              type="button"
            >
              <span className={`status-pill status-${entry.status}`}>{getStatusLabel(entry.status)}</span>
              <span className="sidebar-item-copy">
                <span className="sidebar-item-title">{entry.title}</span>
                <span className="sidebar-item-target">{entry.targetName}</span>
                <span className="sidebar-item-path">{entry.relativePath}</span>
              </span>
            </button>
          ))}
        </nav>
      </aside>

      <section className="preview-main">
        {selectedEntry ? (
          <>
            <header className="preview-header">
              <div>
                <p className="section-eyebrow">Selected file</p>
                <h2>{selectedEntry.title}</h2>
              </div>
              <div className="header-controls">
                <PreviewThemeControl />
                <label className="debug-toggle">
                  <input
                    checked={isDebugMode}
                    onChange={(event) => setIsDebugMode(event.target.checked)}
                    type="checkbox"
                  />
                  <span>Debug mode</span>
                </label>
                <div className="header-meta">
                  <span>{selectedEntry.targetName}</span>
                  <span>{selectedEntry.relativePath}</span>
                  <span>
                    {selectedEntry.selection.kind === "explicit"
                      ? "Explicit preview contract"
                      : "Unresolved preview contract"}
                  </span>
                </div>
              </div>
            </header>

            <section className="preview-card">
              {selectedEntry.status === "ready" ? (
                loadedEntry ? (
                  selectedEntryBlockingDiagnostics.length > 0 ? (
                    <div className="preview-empty">
                      <p className="preview-empty-eyebrow">Diagnostics</p>
                      <h2>Transform diagnostics are blocking this preview.</h2>
                      <p>Fix the unsupported patterns below, then save again.</p>
                    </div>
                  ) : (
                    <PreviewCanvas
                      entry={selectedEntry}
                      isDebugMode={isDebugMode}
                      module={loadedEntry.module}
                      onRenderError={(error) => {
                        if (error == null) {
                          setRenderIssue(null);
                          return;
                        }

                        setRenderIssue(
                          normalizePreviewRuntimeError(
                            {
                              code: "RENDER_ERROR",
                              kind: "TransformExecutionError",
                              phase: "runtime",
                              summary: error instanceof Error ? error.message : String(error),
                            },
                            error,
                          ),
                        );
                      }}
                    />
                  )
                ) : loadIssue ? (
                  <div className="preview-empty">
                    <p className="preview-empty-eyebrow">Load error</p>
                    <h2>Preview module failed to load.</h2>
                    <p>{loadIssue.summary}</p>
                  </div>
                ) : (
                  <div className="preview-empty">
                    <p className="preview-empty-eyebrow">Loading</p>
                    <h2>Preparing transformed source.</h2>
                    <p>The selected `@rbxts/react` module is being compiled into the web preview runtime.</p>
                  </div>
                )
              ) : selectedEntry.status === "blocked_by_transform" ? (
                loadedEntry ? (
                  <div className="preview-empty">
                    <p className="preview-empty-eyebrow">Transform blocked</p>
                    <h2>This preview is blocked by transform mode.</h2>
                    <p>Fix the blocking diagnostics below or opt into a non-default transform mode.</p>
                  </div>
                ) : loadIssue ? (
                  <div className="preview-empty">
                    <p className="preview-empty-eyebrow">Load error</p>
                    <h2>Preview diagnostics could not be loaded.</h2>
                    <p>{loadIssue.summary}</p>
                  </div>
                ) : (
                  <div className="preview-empty">
                    <p className="preview-empty-eyebrow">Loading</p>
                    <h2>Preparing transform diagnostics.</h2>
                    <p>The selected entry is blocked, but its diagnostics are still loading.</p>
                  </div>
                )
              ) : selectedEntry.status === "blocked_by_runtime" || selectedEntry.status === "blocked_by_layout" ? (
                <div className="preview-empty">
                  <p className="preview-empty-eyebrow">Runtime blocked</p>
                  <h2>Preview execution is blocked.</h2>
                  <p>Review the runtime and layout issues below.</p>
                </div>
              ) : (
                <div className="preview-empty">
                  <p className="preview-empty-eyebrow">{emptyState?.eyebrow}</p>
                  <h2>{emptyState?.title}</h2>
                  <p>{emptyState?.body}</p>
                </div>
              )}
            </section>

            <section className="diagnostics-card">
              <div className="diagnostics-header">
                <div>
                  <p className="section-eyebrow">Diagnostics</p>
                  <h3>Source analysis</h3>
                </div>
                <div className="diagnostics-summary">
                  <span>
                    {selectedEntryBlockingDiagnostics.length +
                      runtimeIssues.length +
                      (renderIssue ? 1 : 0) +
                      (loadIssue ? 1 : 0)}{" "}
                    blocking issue(s)
                  </span>
                  <span>{selectedEntryDiscoveryDiagnostics.length} discover note(s)</span>
                  {renderIssue ? <span>render error</span> : undefined}
                  {loadIssue ? <span>load error</span> : undefined}
                </div>
              </div>
              {selectedEntryDiagnostics.length === 0 &&
              selectedEntryDiscoveryDiagnostics.length === 0 &&
              runtimeIssues.length === 0 &&
              !renderIssue &&
              !loadIssue ? (
                <p className="diagnostics-empty">No diagnostics for this entry.</p>
              ) : (
                <div className="diagnostics-list">
                  {selectedEntryDiagnostics.map((diagnostic) => (
                    <article
                      className="diagnostic-item"
                      key={`${diagnostic.relativeFile}:${diagnostic.code}:${diagnostic.summary}`}
                    >
                      <p className="diagnostic-code">{diagnostic.code}</p>
                      <p className="diagnostic-message">{diagnostic.summary}</p>
                      <p className="diagnostic-location">{diagnostic.relativeFile}</p>
                    </article>
                  ))}
                  {selectedEntryDiscoveryDiagnostics.map((diagnostic) => (
                    <article
                      className="diagnostic-item diagnostic-item-discovery"
                      key={`${diagnostic.relativeFile}:${diagnostic.code}:${diagnostic.summary}`}
                    >
                      <p className="diagnostic-code">{diagnostic.code}</p>
                      <p className="diagnostic-message">{diagnostic.summary}</p>
                      <p className="diagnostic-location">{diagnostic.relativeFile}</p>
                    </article>
                  ))}
                  {runtimeIssues.map((issue, index) => (
                    <article
                      className="diagnostic-item diagnostic-item-runtime"
                      key={`${issue.code}:${issue.kind}:${issue.relativeFile}:${index}`}
                    >
                      <p className="diagnostic-code">{issue.code}</p>
                      <p className="diagnostic-message">{issue.summary}</p>
                      <p className="diagnostic-location">
                        {issue.relativeFile}:{issue.kind}:{index + 1}
                      </p>
                    </article>
                  ))}
                  {loadIssue ? (
                    <article className="diagnostic-item diagnostic-item-runtime">
                      <p className="diagnostic-code">{loadIssue.code}</p>
                      <p className="diagnostic-message">{loadIssue.summary}</p>
                    </article>
                  ) : undefined}
                  {renderIssue ? (
                    <article className="diagnostic-item diagnostic-item-runtime">
                      <p className="diagnostic-code">{renderIssue.code}</p>
                      <p className="diagnostic-message">{renderIssue.summary}</p>
                    </article>
                  ) : undefined}
                </div>
              )}
            </section>
          </>
        ) : (
          <section className="preview-card preview-card-empty">
            <div className="preview-empty">
              <p className="preview-empty-eyebrow">Empty project</p>
              <h2>No previewable source files were found.</h2>
              <p>Add `src/**/*.tsx` files to one of the configured preview targets.</p>
            </div>
          </section>
        )}
      </section>
    </main>
  );
}
