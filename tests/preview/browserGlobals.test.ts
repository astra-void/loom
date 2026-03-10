// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { installPreviewBrowserGlobals } from "../../../packages/preview/src/shell/installPreviewBrowserGlobals";

type PreviewGlobalRecord = typeof globalThis & {
  Enum?: unknown;
};

const globalRecord = globalThis as PreviewGlobalRecord;
const previewGlobalFallbackMarker = Symbol.for("lattice.preview.browserGlobalsFallback");
const initialEnum = globalRecord.Enum;
const globalPrototypeHost = Object.getPrototypeOf(globalThis);
const initialGlobalPrototypeParent = globalPrototypeHost ? Object.getPrototypeOf(globalPrototypeHost) : null;
const windowPrototypeHost = typeof window !== "undefined" ? Object.getPrototypeOf(window) : null;
const initialWindowPrototypeParent = windowPrototypeHost ? Object.getPrototypeOf(windowPrototypeHost) : null;

afterEach(() => {
  if (initialEnum === undefined) {
    delete globalRecord.Enum;
  } else {
    globalRecord.Enum = initialEnum;
  }

  if (globalPrototypeHost && Object.getPrototypeOf(globalPrototypeHost) !== initialGlobalPrototypeParent) {
    Object.setPrototypeOf(globalPrototypeHost, initialGlobalPrototypeParent);
  }

  if (windowPrototypeHost && Object.getPrototypeOf(windowPrototypeHost) !== initialWindowPrototypeParent) {
    Object.setPrototypeOf(windowPrototypeHost, initialWindowPrototypeParent);
  }
});

describe("installPreviewBrowserGlobals", () => {
  it("installs a proxy-backed Enum mock that tolerates arbitrary access", () => {
    delete globalRecord.Enum;

    installPreviewBrowserGlobals();

    const enumRoot = globalRecord.Enum as {
      GetEnums: () => unknown[];
      KeyCode: {
        FromName: (name: string) => { Name: string; Value: number };
        Return: { Name: string; Value: number };
      };
      TextXAlignment: {
        Center: { Name: string; Value: number };
      };
    };

    expect(enumRoot.GetEnums()).toEqual([]);
    expect(enumRoot.KeyCode.Return).toMatchObject({ Name: "Return" });
    expect(enumRoot.KeyCode.Return.Value).toEqual(expect.any(Number));
    expect(enumRoot.KeyCode.FromName("Escape")).toMatchObject({ Name: "Escape" });
    expect(enumRoot.TextXAlignment.Center.Name).toBe("Center");
  });

  it("does not overwrite an existing Enum global", () => {
    const existingEnum = { existing: true };
    globalRecord.Enum = existingEnum;

    installPreviewBrowserGlobals();

    expect(globalRecord.Enum).toBe(existingEnum);
  });

  it("installs a catch-all fallback for arbitrary Roblox globals", () => {
    delete globalRecord.Enum;

    installPreviewBrowserGlobals();

    const result = Function(`
      "use strict";
      return {
        stringSize: "Spell".size(),
        tostringValue: tostring(42),
        tweenInfoType: typeof TweenInfo,
        taskDelayType: typeof task.delay,
        tostringType: typeof tostring,
        tweenInfoInstance: new TweenInfo(0.14),
        service: game.GetService("Players"),
        workspaceValue: workspace,
      };
    `)() as {
      stringSize: number;
      tostringValue: string;
      tweenInfoType: string;
      taskDelayType: string;
      tostringType: string;
      tweenInfoInstance: unknown;
      service: unknown;
      workspaceValue: unknown;
    };

    expect(result.stringSize).toBe(5);
    expect(result.tostringValue).toBe("42");
    expect(result.tweenInfoType).toBe("function");
    expect(result.taskDelayType).toBe("function");
    expect(result.tostringType).toBe("function");
    expect(result.tweenInfoInstance).toBeDefined();
    expect(result.service).toBeDefined();
    expect(result.workspaceValue).toBeDefined();
  });

  it("repairs a marker-only fallback chain on reinstall", () => {
    delete globalRecord.Enum;

    if (!globalPrototypeHost || !windowPrototypeHost) {
      throw new Error("Expected both global and window prototype hosts to exist.");
    }

    Object.setPrototypeOf(
      globalPrototypeHost,
      Object.defineProperty({}, previewGlobalFallbackMarker, {
        configurable: true,
        value: true,
      }),
    );
    Object.setPrototypeOf(
      windowPrototypeHost,
      Object.defineProperty({}, previewGlobalFallbackMarker, {
        configurable: true,
        value: true,
      }),
    );

    installPreviewBrowserGlobals();

    expect(Function(`"use strict"; return typeof tostring === "function" && typeof TweenInfo === "function";`)()).toBe(
      true,
    );
    expect((window as typeof window & { game?: unknown }).game).toBeDefined();
  });

  it("does not stack fallback wrappers across repeated installs", () => {
    if (!globalPrototypeHost) {
      throw new Error("Expected a global prototype host.");
    }

    installPreviewBrowserGlobals();
    const initialFallback = Object.getPrototypeOf(globalPrototypeHost);

    installPreviewBrowserGlobals();

    expect(Object.getPrototypeOf(globalPrototypeHost)).toBe(initialFallback);
  });
});
