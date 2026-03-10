// @vitest-environment jsdom

import {
  Color3,
  clearPreviewRuntimeIssues,
  Frame,
  getPreviewRuntimeIssues,
  LayoutProvider,
  normalizePreviewRuntimeError,
  type PreviewRuntimeIssue,
  publishPreviewRuntimeIssue,
  ScreenGui,
  Slot,
  subscribePreviewRuntimeIssues,
  TextLabel,
  UDim2,
  UICorner,
  UIListLayout,
  UIPadding,
  UIScale,
  UIStroke,
} from "@lattice-ui/preview-runtime";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type LayoutRect = { height: number; width: number; x: number; y: number };
type SerializedAxis = { offset: number; scale: number };
type LayoutDebugPayload = {
  dirtyNodeIds: string[];
  roots: unknown[];
  viewport: {
    height: number;
    width: number;
  };
};
type LayoutNode = {
  id: string;
  intrinsicSize?: { height: number; width: number } | null;
  kind?: string;
  layout?: {
    anchorPoint?: { x: number; y: number };
    position?: { x: SerializedAxis; y: SerializedAxis };
    size?: { x: SerializedAxis; y: SerializedAxis };
  };
  nodeType?: string;
  parentId?: string;
};
type LayoutSessionResult = {
  debug: LayoutDebugPayload;
  dirtyNodeIds: string[];
  rects: Record<string, LayoutRect>;
};
type ComputeDirty = (nodes: LayoutNode[], viewportWidth: number, viewportHeight: number) => LayoutSessionResult;

const layoutEngineMocks = vi.hoisted(() => ({
  computeDirty: vi.fn<ComputeDirty>((_nodes, viewportWidth, viewportHeight) => ({
    debug: {
      dirtyNodeIds: [],
      roots: [],
      viewport: {
        height: viewportHeight,
        width: viewportWidth,
      },
    },
    dirtyNodeIds: [],
    rects: {},
  })),
  createLayoutSession: vi.fn(() => {
    const state = {
      nodes: new Map<string, LayoutNode>(),
      viewport: {
        height: 0,
        width: 0,
      },
    };

    return {
      applyNodes(nodes: LayoutNode[]) {
        for (const node of nodes) {
          state.nodes.set(node.id, JSON.parse(JSON.stringify(node)) as LayoutNode);
        }
      },
      computeDirty() {
        return layoutEngineMocks.computeDirty(
          [...state.nodes.values()].sort((left, right) => left.id.localeCompare(right.id)),
          state.viewport.width,
          state.viewport.height,
        );
      },
      dispose() {},
      removeNodes(nodeIds: string[]) {
        for (const nodeId of nodeIds) {
          state.nodes.delete(nodeId);
        }
      },
      setViewport(viewport: { height: number; width: number }) {
        state.viewport = viewport;
      },
    };
  }),
  init: vi.fn<() => Promise<void>>(() => Promise.resolve(undefined)),
}));

vi.mock("@lattice-ui/layout-engine", () => ({
  createLayoutSession: layoutEngineMocks.createLayoutSession,
  default: layoutEngineMocks.init,
}));

type MockTreeNode = {
  id: string;
  children?: MockTreeNode[];
};

function createMockTreeRoot(nodes: LayoutNode[]): MockTreeNode {
  const childrenByParent = new Map<string, MockTreeNode[]>();
  const nodesById = new Map<string, MockTreeNode>();

  for (const node of nodes) {
    nodesById.set(node.id, { id: node.id, children: [] });
  }

  for (const node of nodes) {
    if (!node.parentId || !nodesById.has(node.parentId)) {
      continue;
    }

    const parentChildren = childrenByParent.get(node.parentId) ?? [];
    const childNode = nodesById.get(node.id);
    if (childNode) {
      parentChildren.push(childNode);
      parentChildren.sort((left, right) => left.id.localeCompare(right.id));
      childrenByParent.set(node.parentId, parentChildren);
    }
  }

  for (const [parentId, children] of childrenByParent.entries()) {
    const parentNode = nodesById.get(parentId);
    if (parentNode) {
      parentNode.children = children;
    }
  }

  const roots = [...nodes.values()]
    .filter((node) => !node.parentId || !nodesById.has(node.parentId))
    .map((node) => nodesById.get(node.id))
    .filter((node): node is MockTreeNode => node !== undefined)
    .sort((left, right) => left.id.localeCompare(right.id));

  return {
    children: roots,
    id: "__root__",
  };
}

function createMockLayoutResult(tree: MockTreeNode) {
  const result: Record<string, { height: number; width: number; x: number; y: number }> = {};

  const visit = (node: MockTreeNode, depth: number) => {
    result[node.id] = {
      height: Math.max(40, 220 - depth * 20),
      width: Math.max(80, 420 - depth * 40),
      x: depth * 11,
      y: depth * 17,
    };

    for (const child of node.children ?? []) {
      visit(child, depth + 1);
    }
  };

  visit(tree, 0);
  return result;
}

function createSessionResult(
  rects: Record<string, LayoutRect>,
  viewportWidth: number,
  viewportHeight: number,
  dirtyNodeIds: string[] = Object.keys(rects),
): LayoutSessionResult {
  return {
    debug: {
      dirtyNodeIds,
      roots: [],
      viewport: {
        height: viewportHeight,
        width: viewportWidth,
      },
    },
    dirtyNodeIds,
    rects,
  };
}

function findNode(nodes: LayoutNode[], nodeId: string) {
  return nodes.find((node) => node.id === nodeId);
}
function DelayedNestedTree() {
  const [isMounted, setIsMounted] = React.useState(false);

  React.useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setIsMounted(true);
    }, 0);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, []);

  if (!isMounted) {
    return null;
  }

  return (
    <ScreenGui Id="delayed-screen">
      <Frame Id="delayed-frame">
        <TextLabel Id="delayed-label" Text="Delayed label" />
      </Frame>
    </ScreenGui>
  );
}

beforeEach(() => {
  layoutEngineMocks.computeDirty.mockReset();
  layoutEngineMocks.computeDirty.mockImplementation((_nodes, viewportWidth, viewportHeight) =>
    createSessionResult({}, viewportWidth, viewportHeight, []),
  );
  layoutEngineMocks.createLayoutSession.mockClear();
  layoutEngineMocks.init.mockReset();
  layoutEngineMocks.init.mockResolvedValue(undefined);
  clearPreviewRuntimeIssues();
});

afterEach(() => {
  cleanup();
});

describe("preview runtime host mapping", () => {
  it("uses bare preview ids and shows a debug fallback when Wasm output is missing", () => {
    render(
      <Frame Position={UDim2.fromOffset(12, 18)} Size={UDim2.fromOffset(120, 48)}>
        Debug frame
      </Frame>,
    );

    const frame = document.querySelector('[data-preview-host="frame"]') as HTMLElement;
    expect(frame.dataset.previewNodeId).toMatch(/^preview-node-\d+$/);
    expect(frame.dataset.previewNodeId).not.toContain("frame:");
    expect(frame.style.visibility).toBe("visible");
    expect(frame.style.left).toBe("12px");
    expect(frame.style.top).toBe("18px");
    expect(frame.style.width).toBe("120px");
    expect(frame.style.height).toBe("48px");
  });

  it("supports Roblox-style UDim2 construction and add chaining", () => {
    const position = UDim2.fromScale(0.5, 0.5).add(UDim2.fromOffset(12, 18));
    const size = new UDim2(0, 120, 0, 48);

    expect(position).toBeInstanceOf(UDim2);
    expect(position.X.Scale).toBe(0.5);
    expect(position.X.Offset).toBe(12);
    expect(position.Y.Scale).toBe(0.5);
    expect(position.Y.Offset).toBe(18);

    render(
      <Frame Position={position} Size={size}>
        Chained frame
      </Frame>,
    );

    const frame = document.querySelector('[data-preview-host="frame"]') as HTMLElement;
    expect(frame.style.width).toBe("120px");
    expect(frame.style.height).toBe("48px");
  });

  it("merges slot and child activated handlers", async () => {
    const user = userEvent.setup();
    const childActivated = vi.fn();
    const slotActivated = vi.fn();

    render(
      <Slot Event={{ Activated: () => slotActivated() }}>
        <button onClick={() => childActivated()} type="button">
          Trigger
        </button>
      </Slot>,
    );

    await user.click(screen.getByRole("button", { name: "Trigger" }));
    expect(childActivated).toHaveBeenCalledTimes(1);
    expect(slotActivated).toHaveBeenCalledTimes(1);
  });

  it("hoists decorator hosts into parent CSS without leaking preview-only props to the DOM", () => {
    render(
      <Frame Size={UDim2.fromOffset(120, 40)}>
        <UIListLayout FillDirection="vertical" SortOrder="layout-order" />
        <UIPadding PaddingLeft="10px" />
        <UICorner CornerRadius={{ Offset: 14, Scale: 0 }} />
        <UIScale Scale={1.25} />
        <UIStroke Color={Color3.fromRGB(10, 20, 30)} Thickness={1} />
        <TextLabel Text="Hello preview" TextXAlignment="left" />
      </Frame>,
    );

    const frame = document.querySelector('[data-preview-host="frame"]') as HTMLElement;
    expect(screen.getByText("Hello preview")).toBeTruthy();
    expect(frame.style.borderRadius).toBe("14px");
    expect(frame.style.transform).toContain("scale(1.25)");
    expect(frame.style.boxShadow).toContain("inset 0 0 0 1px");
    expect(document.querySelector('[data-preview-host="uicorner"]')).toBeNull();
    expect(document.querySelector('[data-preview-host="uistroke"]')).toBeNull();
    expect(document.querySelector('[data-preview-host="uiscale"]')).toBeNull();
    expect(document.querySelector("[filldirection]")).toBeNull();
    expect(document.querySelector("[scale]")).toBeNull();
  });

  it("maps Roblox fonts and scales text into the host bounds", async () => {
    const originalResizeObserver = globalThis.ResizeObserver;

    class MockResizeObserver {
      public constructor(private readonly callback: ResizeObserverCallback) {}

      public disconnect() {}

      public observe(target: Element) {
        this.callback(
          [
            {
              contentRect: { height: 24, width: 90 } as DOMRectReadOnly,
              target,
            } as ResizeObserverEntry,
          ],
          this as unknown as ResizeObserver,
        );
      }

      public unobserve() {}
    }

    globalThis.ResizeObserver = MockResizeObserver as typeof ResizeObserver;

    const getBoundingClientRectSpy = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function getBoundingClientRect(this: HTMLElement) {
        const element = this;
        if (element.dataset.previewHost === "textlabel") {
          return {
            bottom: 24,
            height: 24,
            left: 0,
            right: 90,
            toJSON: () => ({}),
            top: 0,
            width: 90,
            x: 0,
            y: 0,
          } as DOMRect;
        }

        return {
          bottom: 0,
          height: 0,
          left: 0,
          right: 0,
          toJSON: () => ({}),
          top: 0,
          width: 0,
          x: 0,
          y: 0,
        } as DOMRect;
      });

    const scrollWidthSpy = vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockImplementation(function getWidth(
      this: HTMLElement,
    ) {
      const element = this;
      const fontSize = Number.parseFloat(element.style.fontSize || "16");
      const textLength = (element.textContent ?? " ").length;
      return Math.ceil(textLength * fontSize * 0.58);
    });
    const scrollHeightSpy = vi
      .spyOn(HTMLElement.prototype, "scrollHeight", "get")
      .mockImplementation(function getHeight(this: HTMLElement) {
        const element = this;
        const fontSize = Number.parseFloat(element.style.fontSize || "16");
        return Math.ceil(fontSize * 1.2);
      });

    try {
      render(
        <TextLabel Font={{ Name: "GothamBold" }} Size={UDim2.fromOffset(90, 24)} Text="Scaled" TextScaled={true} />,
      );

      const label = document.querySelector('[data-preview-host="textlabel"]') as HTMLElement;
      await waitFor(() => {
        expect(Number.parseFloat(label.style.fontSize)).toBeGreaterThan(0);
      });

      expect(label.style.fontFamily).toContain("Gotham");
      expect(label.style.fontWeight).toBe("700");
    } finally {
      globalThis.ResizeObserver = originalResizeObserver;
      getBoundingClientRectSpy.mockRestore();
      scrollWidthSpy.mockRestore();
      scrollHeightSpy.mockRestore();
    }
  });

  it("renders a viewport-filling layout provider container", () => {
    render(
      <LayoutProvider>
        <div data-testid="layout-child" />
      </LayoutProvider>,
    );

    const container = screen.getByTestId("layout-child").parentElement as HTMLElement;
    expect(container.dataset.previewLayoutProvider).toBe("");
    expect(container.style.display).toBe("block");
    expect(container.style.width).toBe("100%");
    expect(container.style.height).toBe("100%");
    expect(container.style.minHeight).toBe("500px");
  });

  it("uses the resolved viewport for ScreenGui fallback rects while Wasm layout is pending", () => {
    render(
      <LayoutProvider viewportHeight={480} viewportWidth={640}>
        <ScreenGui />
      </LayoutProvider>,
    );

    const screenGui = document.querySelector('[data-preview-host="screengui"]') as HTMLElement;
    expect(screenGui.style.left).toBe("0px");
    expect(screenGui.style.top).toBe("0px");
    expect(screenGui.style.width).toBe("640px");
    expect(screenGui.style.height).toBe("480px");
  });

  it("derives nested scale fallback rects from parent rects when Wasm is unavailable", async () => {
    layoutEngineMocks.init.mockRejectedValueOnce(new Error("init failed"));

    render(
      <LayoutProvider viewportHeight={600} viewportWidth={800}>
        <ScreenGui>
          <Frame Size={UDim2.fromScale(1, 1)}>
            <TextLabel AnchorPoint={[0.5, 0.5]} Position={[0.5, 0, 0.5, 0]} Size={[0, 420, 0, 40]} Text="Centered" />
          </Frame>
        </ScreenGui>
      </LayoutProvider>,
    );

    const frame = document.querySelector('[data-preview-host="frame"]') as HTMLElement;
    const label = document.querySelector('[data-preview-host="textlabel"]') as HTMLElement;

    await waitFor(() => {
      expect(frame.style.left).toBe("0px");
      expect(frame.style.top).toBe("0px");
      expect(frame.style.width).toBe("800px");
      expect(frame.style.height).toBe("600px");
      expect(label.style.left).toBe("190px");
      expect(label.style.top).toBe("280px");
      expect(label.style.width).toBe("420px");
      expect(label.style.height).toBe("40px");
    });
  });

  it("uses measurable host bounds in provider fallback layout when size is omitted", async () => {
    layoutEngineMocks.init.mockRejectedValueOnce(new Error("init failed"));

    const getBoundingClientRectSpy = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function getBoundingClientRect(this: HTMLElement) {
        if (this.dataset.previewHost === "textlabel") {
          return {
            bottom: 24,
            height: 24,
            left: 0,
            right: 88,
            toJSON: () => ({}),
            top: 0,
            width: 88,
            x: 0,
            y: 0,
          } as DOMRect;
        }

        return {
          bottom: 0,
          height: 0,
          left: 0,
          right: 0,
          toJSON: () => ({}),
          top: 0,
          width: 0,
          x: 0,
          y: 0,
        } as DOMRect;
      });

    try {
      render(
        <LayoutProvider viewportHeight={480} viewportWidth={640}>
          <ScreenGui>
            <TextLabel Text="Measured fallback" />
          </ScreenGui>
        </LayoutProvider>,
      );

      const label = document.querySelector('[data-preview-host="textlabel"]') as HTMLElement;

      await waitFor(() => {
        expect(label.style.width).toBe("88px");
        expect(label.style.height).toBe("24px");
      });
    } finally {
      getBoundingClientRectSpy.mockRestore();
    }
  });
  it("serializes frame defaults and textlabel layout props before calling Wasm", async () => {
    layoutEngineMocks.computeDirty.mockImplementation((nodes, viewportWidth, viewportHeight) => {
      expect(viewportWidth).toBe(800);
      expect(viewportHeight).toBe(600);
      expect(findNode(nodes, "preview-node-screen")).toMatchObject({
        id: "preview-node-screen",
        kind: "root",
        nodeType: "ScreenGui",
      });
      expect(findNode(nodes, "preview-node-frame")).toMatchObject({
        id: "preview-node-frame",
        layout: {
          position: {
            x: { offset: 0, scale: 0 },
            y: { offset: 0, scale: 0 },
          },
          size: {
            x: { offset: 0, scale: 1 },
            y: { offset: 0, scale: 1 },
          },
        },
        nodeType: "Frame",
        parentId: "preview-node-screen",
      });
      expect(findNode(nodes, "preview-node-label")).toMatchObject({
        id: "preview-node-label",
        layout: {
          anchorPoint: { x: 0.5, y: 0.5 },
          position: {
            x: { offset: 0, scale: 0.5 },
            y: { offset: 0, scale: 0.5 },
          },
          size: {
            x: { offset: 420, scale: 0 },
            y: { offset: 40, scale: 0 },
          },
        },
        nodeType: "TextLabel",
      });

      return createSessionResult(
        {
          "preview-node-screen": { height: 600, width: 800, x: 0, y: 0 },
          "preview-node-frame": { height: 600, width: 800, x: 0, y: 0 },
          "preview-node-label": { height: 40, width: 420, x: 190, y: 280 },
        },
        viewportWidth,
        viewportHeight,
      );
    });

    render(
      <LayoutProvider debounceMs={0} viewportHeight={600} viewportWidth={800}>
        <ScreenGui Id="preview-node-screen">
          <Frame Id="preview-node-frame">
            <TextLabel
              AnchorPoint={[0.5, 0.5]}
              Id="preview-node-label"
              Position={[0.5, 0, 0.5, 0]}
              Size={[0, 420, 0, 40]}
              Text="Centered"
            />
          </Frame>
        </ScreenGui>
      </LayoutProvider>,
    );

    const frame = document.querySelector('[data-preview-node-id="preview-node-frame"]') as HTMLElement;
    const label = document.querySelector('[data-preview-node-id="preview-node-label"]') as HTMLElement;

    await waitFor(() => {
      expect(frame.style.width).toBe("800px");
      expect(frame.style.height).toBe("600px");
      expect(label.style.left).toBe("190px");
      expect(label.style.top).toBe("280px");
      expect(label.style.width).toBe("420px");
      expect(label.style.height).toBe("40px");
    });
  });

  it("forces top-level ScreenGui nodes to fill the viewport in the Wasm tree", async () => {
    render(
      <LayoutProvider debounceMs={0} viewportHeight={480} viewportWidth={640}>
        <ScreenGui AnchorPoint={{ X: 1, Y: 1 }} Position={UDim2.fromOffset(20, 30)} Size={UDim2.fromOffset(40, 50)}>
          <Frame Position={UDim2.fromOffset(10, 20)} Size={UDim2.fromOffset(80, 32)} />
        </ScreenGui>
      </LayoutProvider>,
    );

    await waitFor(() => {
      expect(layoutEngineMocks.computeDirty).toHaveBeenCalled();
      const calls = layoutEngineMocks.computeDirty.mock.calls;
      const lastCall = calls[calls.length - 1];
      expect(lastCall).toBeDefined();
      if (!lastCall) {
        throw new Error("Expected computeDirty to have been called.");
      }
      const [nodes, viewportWidth, viewportHeight] = lastCall;

      expect(viewportWidth).toBe(640);
      expect(viewportHeight).toBe(480);
      const rootNode = nodes.find((node) => node.kind === "root");
      expect(rootNode).toMatchObject({
        kind: "root",
        layout: {
          anchorPoint: { x: 0, y: 0 },
          position: {
            x: { offset: 0, scale: 0 },
            y: { offset: 0, scale: 0 },
          },
          size: {
            x: { offset: 0, scale: 1 },
            y: { offset: 0, scale: 1 },
          },
        },
        nodeType: "ScreenGui",
      });
      expect(nodes.filter((node) => node.parentId === rootNode?.id)).toHaveLength(1);
    });
  });

  it("does not call Wasm with an empty tree before delayed children register", async () => {
    const capturedNodeSets: LayoutNode[][] = [];

    layoutEngineMocks.computeDirty.mockImplementation((nodes, viewportWidth, viewportHeight) => {
      capturedNodeSets.push(JSON.parse(JSON.stringify(nodes)) as LayoutNode[]);
      const tree = createMockTreeRoot(nodes);
      return createSessionResult(createMockLayoutResult(tree), viewportWidth, viewportHeight);
    });

    render(
      <LayoutProvider debounceMs={0} viewportHeight={600} viewportWidth={800}>
        <DelayedNestedTree />
      </LayoutProvider>,
    );

    await waitFor(() => {
      expect(document.querySelector('[data-preview-node-id="delayed-label"]')).toBeTruthy();
    });

    expect(capturedNodeSets.every((nodes) => nodes.length > 0)).toBe(true);
  });

  it("waits for nested registrations to settle before calling Wasm in strict mode", async () => {
    const capturedTrees: MockTreeNode[] = [];

    layoutEngineMocks.computeDirty.mockImplementation((nodes, viewportWidth, viewportHeight) => {
      const tree = createMockTreeRoot(nodes);
      capturedTrees.push(JSON.parse(JSON.stringify(tree)) as MockTreeNode);
      return createSessionResult(createMockLayoutResult(tree), viewportWidth, viewportHeight);
    });

    render(
      <React.StrictMode>
        <LayoutProvider debounceMs={0} viewportHeight={600} viewportWidth={800}>
          <ScreenGui Id="strict-screen">
            <Frame Id="strict-frame">
              <TextLabel Id="strict-label" Text="Strict label" />
            </Frame>
          </ScreenGui>
        </LayoutProvider>
      </React.StrictMode>,
    );

    await waitFor(() => {
      expect(capturedTrees.length).toBeGreaterThan(0);
      expect(capturedTrees[capturedTrees.length - 1]?.children?.[0]?.children?.[0]?.children?.[0]?.id).toBe(
        "strict-label",
      );
    });

    expect(
      capturedTrees.every(
        (tree) =>
          tree.children?.length === 1 &&
          tree.children[0]?.id === "strict-screen" &&
          tree.children[0]?.children?.length === 1 &&
          tree.children[0]?.children[0]?.id === "strict-frame" &&
          tree.children[0]?.children[0]?.children?.length === 1 &&
          tree.children[0]?.children[0]?.children?.[0]?.id === "strict-label",
      ),
    ).toBe(true);
  });

  it("normalizes nested registry ids and legacy Wasm result keys", async () => {
    layoutEngineMocks.computeDirty.mockImplementation((nodes, viewportWidth, viewportHeight) => {
      expect(nodes).toHaveLength(2);
      expect(findNode(nodes, "preview-node-100")?.id).toBe("preview-node-100");
      expect(findNode(nodes, "preview-node-200")?.parentId).toBe("preview-node-100");

      return createSessionResult(
        {
          "screengui:preview-node-100": { height: 240, width: 320, x: 0, y: 0 },
          "frame:preview-node-200": { height: 32, width: 80, x: 11, y: 22 },
        },
        viewportWidth,
        viewportHeight,
      );
    });

    render(
      <LayoutProvider debounceMs={0} viewportHeight={480} viewportWidth={640}>
        <ScreenGui Id="screengui:preview-node-100">
          <Frame Id="frame:preview-node-200" ParentId="screengui:preview-node-100" />
        </ScreenGui>
      </LayoutProvider>,
    );

    const screenGui = document.querySelector('[data-preview-host="screengui"]') as HTMLElement;
    const frame = document.querySelector('[data-preview-host="frame"]') as HTMLElement;

    expect(screenGui.dataset.previewNodeId).toBe("preview-node-100");
    expect(frame.dataset.previewNodeId).toBe("preview-node-200");

    await waitFor(() => {
      expect(frame.style.left).toBe("11px");
      expect(frame.style.top).toBe("22px");
      expect(frame.style.width).toBe("80px");
      expect(frame.style.height).toBe("32px");
    });
  });

  it("normalizes runtime issues with the public taxonomy", () => {
    const issue = normalizePreviewRuntimeError(
      {
        code: "LAYOUT_VALIDATION_ERROR",
        entryId: "fixture:Broken.tsx",
        file: "/virtual/Broken.tsx",
        kind: "LayoutValidationError",
        phase: "layout",
        relativeFile: "src/Broken.tsx",
        summary: "Unexpected layout session result type: string",
        target: "fixture",
      },
      new Error("Unexpected layout session result type: string"),
    );

    expect(issue).toEqual({
      code: "LAYOUT_VALIDATION_ERROR",
      entryId: "fixture:Broken.tsx",
      file: "/virtual/Broken.tsx",
      kind: "LayoutValidationError",
      phase: "layout",
      relativeFile: "src/Broken.tsx",
      summary: "Unexpected layout session result type: string",
      target: "fixture",
    });
  });

  it("publishes runtime issues through the shared reporter", () => {
    const snapshots: PreviewRuntimeIssue[][] = [];
    const unsubscribe = subscribePreviewRuntimeIssues((issues) => {
      snapshots.push(issues);
    });

    publishPreviewRuntimeIssue({
      code: "RUNTIME_MOCK_ERROR",
      entryId: "fixture:Broken.tsx",
      file: "/virtual/Broken.tsx",
      kind: "RuntimeMockError",
      phase: "runtime",
      relativeFile: "src/Broken.tsx",
      summary: "Mock resolution failed.",
      target: "fixture",
    });

    unsubscribe();

    expect(getPreviewRuntimeIssues()).toEqual([
      {
        code: "RUNTIME_MOCK_ERROR",
        entryId: "fixture:Broken.tsx",
        file: "/virtual/Broken.tsx",
        kind: "RuntimeMockError",
        phase: "runtime",
        relativeFile: "src/Broken.tsx",
        summary: "Mock resolution failed.",
        target: "fixture",
      },
    ]);
    expect(snapshots.at(-1)).toEqual(getPreviewRuntimeIssues());
  });
});
