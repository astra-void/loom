import initLayoutEngine, { compute_layout } from "@lattice-ui/layout-engine";
import layoutEngineWasmUrl from "@lattice-ui/layout-engine/layout_engine_bg.wasm?url";
import React from "react";
import { PreviewThemeControl } from "./theme";

type UDim = {
  scale: number;
  offset: number;
};

type UDim2 = {
  x: UDim;
  y: UDim;
};

type Vector2 = {
  x: number;
  y: number;
};

type RobloxNode = {
  id: string;
  node_type: string;
  size: UDim2;
  position: UDim2;
  anchor_point: Vector2;
  children: RobloxNode[];
};

type ComputedRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const VIEWPORT_WIDTH = 1920;
const VIEWPORT_HEIGHT = 1080;

function createMockTree(): RobloxNode {
  return {
    id: "Root",
    node_type: "ScreenGui",
    size: {
      x: { scale: 1, offset: 0 },
      y: { scale: 1, offset: 0 },
    },
    position: {
      x: { scale: 0, offset: 0 },
      y: { scale: 0, offset: 0 },
    },
    anchor_point: { x: 0, y: 0 },
    children: [
      {
        id: "CenterBox",
        node_type: "Frame",
        size: {
          x: { scale: 0, offset: 300 },
          y: { scale: 0, offset: 100 },
        },
        position: {
          x: { scale: 0.5, offset: 0 },
          y: { scale: 0.5, offset: 0 },
        },
        anchor_point: { x: 0.5, y: 0.5 },
        children: [],
      },
    ],
  };
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function isValidWasmMagic(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x00 && bytes[1] === 0x61 && bytes[2] === 0x73 && bytes[3] === 0x6d;
}

function formatHeader(bytes: Uint8Array): string {
  return Array.from(bytes.slice(0, 4))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join(" ");
}

function isComputedRect(value: unknown): value is ComputedRect {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    typeof record.x === "number" &&
    typeof record.y === "number" &&
    typeof record.width === "number" &&
    typeof record.height === "number"
  );
}

function normalizeLayoutResult(raw: unknown): Record<string, ComputedRect> {
  if (!(raw instanceof Map) && !(typeof raw === "object" && raw !== null)) {
    throw new Error(`Unexpected layout result type: ${typeof raw}`);
  }

  const entries =
    raw instanceof Map
      ? (Array.from(raw.entries()) as Array<[string, unknown]>)
      : Object.entries(raw as Record<string, unknown>);

  const normalized: Record<string, ComputedRect> = {};
  for (const [key, value] of entries) {
    if (!isComputedRect(value)) {
      continue;
    }

    normalized[key] = value;
  }

  return normalized;
}

type WasmShellProps = {
  children: React.ReactNode;
  detail: string;
  meta: string;
  status: string;
};

function WasmShell(props: WasmShellProps) {
  return (
    <main className="wasm-shell">
      <header className="wasm-header">
        <div className="wasm-header-copy">
          <p className="section-eyebrow">Wasm playground</p>
          <h1>Layout Engine</h1>
          <p>Smoke-test the layout Wasm bridge with a mock Roblox tree and browser-hosted viewport.</p>
        </div>
        <div className="header-controls">
          <PreviewThemeControl />
          <div className="header-meta">
            <span>{props.status}</span>
            <span>{props.detail}</span>
            <span>{props.meta}</span>
          </div>
        </div>
      </header>
      {props.children}
    </main>
  );
}

export function WasmTestApp() {
  const [isLoaded, setIsLoaded] = React.useState(false);
  const [layoutResult, setLayoutResult] = React.useState<Record<string, ComputedRect>>({});
  const [error, setError] = React.useState("");

  React.useEffect(() => {
    let cancelled = false;
    let blobUrl: string | null = null;

    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      event.preventDefault();
      setError(`Unhandled rejection: ${toErrorMessage(event.reason)}`);
      setIsLoaded(false);
    };

    const initialize = async () => {
      try {
        const response = await fetch(layoutEngineWasmUrl);
        if (!response.ok) {
          throw new Error(`Failed to fetch Wasm binary (${response.status}) from ${layoutEngineWasmUrl}`);
        }

        const bytes = new Uint8Array(await response.arrayBuffer());
        if (!isValidWasmMagic(bytes)) {
          throw new Error(
            `Invalid Wasm binary header from ${layoutEngineWasmUrl}. Expected 00 61 73 6d, received ${formatHeader(bytes)}`,
          );
        }

        blobUrl = URL.createObjectURL(new Blob([bytes], { type: "application/wasm" }));
        await initLayoutEngine({ module_or_path: blobUrl });

        if (cancelled) {
          return;
        }

        const rawComputed = compute_layout(createMockTree(), VIEWPORT_WIDTH, VIEWPORT_HEIGHT) as unknown;
        const computed = normalizeLayoutResult(rawComputed);

        if (!computed.CenterBox) {
          throw new Error("Layout result does not include `CenterBox`. Check serialization shape from Wasm bridge.");
        }

        if (cancelled) {
          return;
        }

        setLayoutResult(computed);
        setError("");
        setIsLoaded(true);
      } catch (nextError) {
        if (!cancelled) {
          setError(`Wasm engine failed: ${toErrorMessage(nextError)}`);
          setIsLoaded(false);
        }
      }
    };

    window.addEventListener("unhandledrejection", onUnhandledRejection);
    void initialize();

    return () => {
      cancelled = true;
      if (blobUrl) {
        URL.revokeObjectURL(blobUrl);
      }
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
    };
  }, []);

  const renderedNodes = Object.entries(layoutResult).filter(([id]) => id !== "Root");

  if (!isLoaded && !error) {
    return (
      <WasmShell
        detail={`Viewport ${VIEWPORT_WIDTH} x ${VIEWPORT_HEIGHT}`}
        meta="Awaiting Wasm fetch"
        status="Initializing engine"
      >
        <section className="wasm-card">
          <div className="preview-empty preview-empty-centered">
            <p className="preview-empty-eyebrow">Loading</p>
            <h2>Loading Wasm engine.</h2>
            <p>Fetching and validating the layout binary before computing the mock tree.</p>
          </div>
        </section>
      </WasmShell>
    );
  }

  if (error) {
    return (
      <WasmShell
        detail={`Viewport ${VIEWPORT_WIDTH} x ${VIEWPORT_HEIGHT}`}
        meta="Initialization failed"
        status="Wasm error"
      >
        <section className="wasm-card">
          <div className="preview-empty preview-empty-centered">
            <p className="preview-empty-eyebrow">Error</p>
            <h2>Wasm initialization failed.</h2>
            <p>The layout engine could not be booted inside the preview shell.</p>
            <pre className="wasm-error-copy">{error}</pre>
          </div>
        </section>
      </WasmShell>
    );
  }

  return (
    <WasmShell
      detail={`Viewport ${VIEWPORT_WIDTH} x ${VIEWPORT_HEIGHT}`}
      meta={`${renderedNodes.length} node(s) rendered`}
      status="Engine ready"
    >
      <section className="wasm-card">
        <div className="canvas-meta wasm-meta">
          <div>
            <p className="meta-label">Mode</p>
            <p className="meta-value">Mock tree</p>
          </div>
          <div>
            <p className="meta-label">Viewport</p>
            <p className="meta-value">
              {VIEWPORT_WIDTH} x {VIEWPORT_HEIGHT}
            </p>
          </div>
          <div>
            <p className="meta-label">Nodes</p>
            <p className="meta-value">{renderedNodes.length}</p>
          </div>
          <div>
            <p className="meta-label">Wasm</p>
            <p className="meta-value">Validated</p>
          </div>
        </div>
        <div className="wasm-stage">
          <div
            className="wasm-viewport"
            style={{
              height: VIEWPORT_HEIGHT,
              width: VIEWPORT_WIDTH,
            }}
          >
            {renderedNodes.map(([id, rect]) => (
              <div
                className="wasm-node"
                key={id}
                style={{
                  height: rect.height,
                  left: rect.x,
                  top: rect.y,
                  width: rect.width,
                }}
              >
                {id} ({Math.round(rect.x)}, {Math.round(rect.y)})
              </div>
            ))}
          </div>
        </div>
      </section>
    </WasmShell>
  );
}
