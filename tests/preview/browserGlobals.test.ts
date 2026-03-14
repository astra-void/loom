// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { installPreviewBrowserGlobals } from "../../packages/preview/src/shell/installPreviewBrowserGlobals";

type PreviewGlobalRecord = typeof globalThis & {
	Enum?: unknown;
	TweenInfo?: new (...args: unknown[]) => unknown;
	Vector3?: new (x: number, y: number, z: number) => { Z: number };
	game?: unknown;
	math?: {
		clamp: (value: number, min: number, max: number) => number;
		max: (...values: number[]) => number;
	};
	warn?: (...args: unknown[]) => void;
	workspace?: unknown;
};

const globalRecord = globalThis as PreviewGlobalRecord;
const previewGlobalFallbackMarker = Symbol.for(
	"loom.preview.browserGlobalsFallback",
);
const initialEnum = globalRecord.Enum;
const initialGame = globalRecord.game;
const initialMath = globalRecord.math;
const initialTweenInfo = globalRecord.TweenInfo;
const initialVector3 = globalRecord.Vector3;
const initialWarn = globalRecord.warn;
const initialWorkspace = globalRecord.workspace;
const globalPrototypeHost = Object.getPrototypeOf(globalThis);
const initialGlobalPrototypeParent = globalPrototypeHost
	? Object.getPrototypeOf(globalPrototypeHost)
	: null;
const windowPrototypeHost =
	typeof window !== "undefined" ? Object.getPrototypeOf(window) : null;
const initialWindowPrototypeParent = windowPrototypeHost
	? Object.getPrototypeOf(windowPrototypeHost)
	: null;

afterEach(() => {
	vi.restoreAllMocks();

	if (initialEnum === undefined) {
		delete globalRecord.Enum;
	} else {
		globalRecord.Enum = initialEnum;
	}

	if (initialGame === undefined) {
		delete globalRecord.game;
	} else {
		globalRecord.game = initialGame;
	}

	if (initialMath === undefined) {
		delete globalRecord.math;
	} else {
		globalRecord.math = initialMath;
	}

	if (initialTweenInfo === undefined) {
		delete globalRecord.TweenInfo;
	} else {
		globalRecord.TweenInfo = initialTweenInfo;
	}

	if (initialVector3 === undefined) {
		delete globalRecord.Vector3;
	} else {
		globalRecord.Vector3 = initialVector3;
	}

	if (initialWarn === undefined) {
		delete globalRecord.warn;
	} else {
		globalRecord.warn = initialWarn;
	}

	if (initialWorkspace === undefined) {
		delete globalRecord.workspace;
	} else {
		globalRecord.workspace = initialWorkspace;
	}

	if (
		globalPrototypeHost &&
		Object.getPrototypeOf(globalPrototypeHost) !== initialGlobalPrototypeParent
	) {
		Object.setPrototypeOf(globalPrototypeHost, initialGlobalPrototypeParent);
	}

	if (
		windowPrototypeHost &&
		Object.getPrototypeOf(windowPrototypeHost) !== initialWindowPrototypeParent
	) {
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
		expect(enumRoot.KeyCode.FromName("Escape")).toMatchObject({
			Name: "Escape",
		});
		expect(enumRoot.TextXAlignment.Center.Name).toBe("Center");
	});

	it("does not overwrite an existing Enum global", () => {
		const existingEnum = { existing: true };
		globalRecord.Enum = existingEnum;

		installPreviewBrowserGlobals();

		expect(globalRecord.Enum).toBe(existingEnum);
	});

	it("installs preview-safe focused globals for game, TweenInfo, and workspace", () => {
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
        tweenInfoTime: new TweenInfo(0.14).Time,
        localPlayerName: game.GetService("Players").LocalPlayer.Name,
        playerCount: game.GetService("Players").GetPlayers().length,
        lastInputType: game.GetService("UserInputService").GetLastInputType(),
        guiInset: game.GetService("GuiService").GetGuiInset(),
        workspaceMatches: workspace === game.GetService("Workspace"),
      };
    `)() as {
			stringSize: number;
			tostringValue: string;
			tweenInfoType: string;
			taskDelayType: string;
			tostringType: string;
			tweenInfoTime: number;
			localPlayerName: string;
			playerCount: number;
			lastInputType: string;
			guiInset: readonly [{ X: number; Y: number }, { X: number; Y: number }];
			workspaceMatches: boolean;
		};

		expect(result.stringSize).toBe(5);
		expect(result.tostringValue).toBe("42");
		expect(result.tweenInfoType).toBe("function");
		expect(result.taskDelayType).toBe("function");
		expect(result.tostringType).toBe("function");
		expect(result.tweenInfoTime).toBe(0.14);
		expect(result.localPlayerName).toBe("LocalPlayer");
		expect(result.playerCount).toBe(1);
		expect(result.lastInputType).toBe("MouseButton1");
		expect(result.guiInset).toEqual([
			{ X: 0, Y: 0 },
			{ X: 0, Y: 0 },
		]);
		expect(result.workspaceMatches).toBe(true);
	});

	it("installs warn, math, and Vector3 globals", () => {
		delete globalRecord.Enum;
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

		installPreviewBrowserGlobals();

		const result = Function(`
      "use strict";
      warn("preview", 7);
      return {
        mathClamp: math.clamp(-2, 0, 4),
        mathMax: math.max(1, 3, 2),
        vectorZ: new Vector3(1, 2, 3).Z,
        warnType: typeof warn,
      };
    `)() as {
			mathClamp: number;
			mathMax: number;
			vectorZ: number;
			warnType: string;
		};

		expect(result.warnType).toBe("function");
		expect(result.mathClamp).toBe(0);
		expect(result.mathMax).toBe(3);
		expect(result.vectorZ).toBe(3);
		expect(warnSpy).toHaveBeenCalledWith("preview", 7);
	});

	it("keeps unknown globals absent while exposing known preview globals", () => {
		delete globalRecord.Enum;

		installPreviewBrowserGlobals();

		expect(
			(window as typeof window & Record<string, unknown>).MissingPreviewGlobal,
		).toBeUndefined();
		expect("MissingPreviewGlobal" in window).toBe(false);
		expect(
			Function('"use strict"; return typeof MissingPreviewGlobal;')(),
		).toBe("undefined");
		expect("game" in window).toBe(true);
		expect((window as typeof window & { game?: unknown }).game).toBeDefined();
	});

	it("repairs a marker-only fallback chain on reinstall", () => {
		delete globalRecord.Enum;

		if (!globalPrototypeHost || !windowPrototypeHost) {
			throw new Error(
				"Expected both global and window prototype hosts to exist.",
			);
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

		expect(
			Function(
				`"use strict"; return typeof tostring === "function" && typeof TweenInfo === "function";`,
			)(),
		).toBe(true);
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
