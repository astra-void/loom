// @vitest-environment jsdom

import {
  Enum,
  game,
  RunService,
  type SetupRobloxEnvironmentTarget,
  setupRobloxEnvironment,
  task,
  TweenInfo,
  workspace,
} from "@loom-dev/preview-runtime";
import { afterEach, describe, expect, it, vi } from "vitest";

class RafController {
  private readonly callbacks = new Map<number, FrameRequestCallback>();
  private readonly originalCancelAnimationFrame = globalThis.cancelAnimationFrame;
  private readonly originalRequestAnimationFrame = globalThis.requestAnimationFrame;
  private readonly performanceNowMock = vi.spyOn(performance, "now").mockImplementation(() => this.now);
  private nextHandle = 1;
  private now = 0;

  public constructor() {
    globalThis.requestAnimationFrame = (callback: FrameRequestCallback) => {
      const handle = this.nextHandle++;
      this.callbacks.set(handle, callback);
      return handle;
    };

    globalThis.cancelAnimationFrame = (handle: number) => {
      this.callbacks.delete(handle);
    };
  }

  public get pendingCount() {
    return this.callbacks.size;
  }

  public async step(milliseconds: number) {
    this.now += milliseconds;

    const callbacks = [...this.callbacks.values()];
    this.callbacks.clear();

    for (const callback of callbacks) {
      callback(this.now);
    }

    await Promise.resolve();
  }

  public restore() {
    this.performanceNowMock.mockRestore();
    globalThis.requestAnimationFrame = this.originalRequestAnimationFrame;
    globalThis.cancelAnimationFrame = this.originalCancelAnimationFrame;
  }
}

let rafController: RafController | undefined;

afterEach(() => {
  rafController?.restore();
  rafController = undefined;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe.sequential("@loom-dev/preview-runtime", () => {
  it("provides a deep Enum proxy with stable Name and Value access", () => {
    const previewEnum = Enum as Record<string, any>;

    expect(previewEnum.KeyCode.Return.Name).toBe("Return");
    expect(previewEnum.KeyCode.Return.EnumType.Name).toBe("KeyCode");
    expect(previewEnum.TextXAlignment.Center.Name).toBe("Center");
    expect(previewEnum.TextXAlignment.FromName("Left").Name).toBe("Left");
    expect(previewEnum.TextXAlignment.FromValue(7).Value).toBe(7);
    expect(String(previewEnum.KeyCode.Return)).toBe("Enum.KeyCode.Return");
    expect(previewEnum.KeyCode.Return.Value).toBeTypeOf("number");
  });

  it("shares one RAF loop between task.wait and RunService listeners", async () => {
    rafController = new RafController();

    const renderStepped = vi.fn();
    const connection = RunService.RenderStepped.Connect(renderStepped);
    const waitPromise = task.wait(0.03);

    expect(rafController.pendingCount).toBe(1);

    await rafController.step(16);

    expect(renderStepped).toHaveBeenCalledWith(0.016);
    expect(rafController.pendingCount).toBe(1);

    await rafController.step(18);

    await expect(waitPromise).resolves.toBeCloseTo(0.034, 3);

    connection.Disconnect();

    expect(rafController.pendingCount).toBe(0);
  });

  it("fires RenderStepped, Stepped, and Heartbeat every frame with delta time", async () => {
    rafController = new RafController();

    const order: string[] = [];
    const renderConnection = RunService.RenderStepped.Connect((deltaTime: number) => {
      order.push(`render:${deltaTime.toFixed(3)}`);
    });
    const steppedConnection = RunService.Stepped.Connect((time: number, deltaTime: number) => {
      order.push(`stepped:${time.toFixed(3)}:${deltaTime.toFixed(3)}`);
    });
    const heartbeatConnection = RunService.Heartbeat.Connect((deltaTime: number) => {
      order.push(`heartbeat:${deltaTime.toFixed(3)}`);
    });

    await rafController.step(20);

    expect(order).toEqual(["render:0.020", "stepped:0.020:0.020", "heartbeat:0.020"]);
    expect(RunService.IsClient()).toBe(true);
    expect(RunService.IsServer()).toBe(false);

    renderConnection.Disconnect();
    steppedConnection.Disconnect();
    heartbeatConnection.Disconnect();
  });

  it("uses RAF timing for task.wait and keeps spawn and defer isolated", async () => {
    rafController = new RafController();

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const events: string[] = [];

    const waitPromise = task.wait();

    task.spawn((label: string) => {
      events.push(label);
    }, "spawned");
    task.spawn(() => {
      throw new Error("spawn failure");
    });
    task.defer((label: string) => {
      events.push(label);
    }, "deferred");

    expect(events).toEqual(["spawned"]);

    await Promise.resolve();

    expect(events).toEqual(["spawned", "deferred"]);

    await rafController.step(16);

    await expect(waitPromise).resolves.toBeCloseTo(0.016, 3);
    expect(events).toEqual(["spawned", "deferred"]);
    expect(errorSpy).toHaveBeenCalledOnce();
  });

  it("uses window timers for task.delay and lets task.cancel abort pending callbacks", () => {
    vi.useFakeTimers();

    const delayed = vi.fn();
    const cancelled = vi.fn();

    task.delay(0.025, delayed, "delayed");
    const cancelledHandle = task.delay(0.05, cancelled, "cancelled");
    task.cancel(cancelledHandle);

    vi.advanceTimersByTime(24);
    expect(delayed).not.toHaveBeenCalled();
    expect(cancelled).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(delayed).toHaveBeenCalledWith("delayed");
    expect(cancelled).not.toHaveBeenCalled();
  });

  it("setupRobloxEnvironment installs globals without overwriting an existing target", () => {
    const existingTask = {} as typeof task;
    const target: SetupRobloxEnvironmentTarget = {
      task: existingTask,
    };

    setupRobloxEnvironment(target);

    expect(target.Enum).toBe(Enum);
    expect(target.RunService).toBe(RunService);
    expect(target.task).toBe(existingTask);
    expect(target.game).toBe(game);
    expect(target.TweenInfo).toBe(TweenInfo);
    expect(target.workspace).toBe(workspace);
  });

  it("provides focused GetService semantics for common preview services", () => {
    setupRobloxEnvironment();

    const players = game.GetService("Players") as {
      GetPlayers(): unknown[];
      LocalPlayer: { Name: string };
    };
    const userInputService = game.GetService("UserInputService") as {
      GetFocusedTextBox(): HTMLElement | null;
      GetLastInputType(): string;
      KeyboardEnabled: boolean;
      MouseEnabled: boolean;
    };
    const guiService = game.GetService("GuiService") as {
      GetGuiInset(): readonly [{ X: number; Y: number }, { X: number; Y: number }];
      IsTenFootInterface(): boolean;
    };
    const unknownService = game.GetService("AnalyticsService");
    const input = document.createElement("input");
    input.dataset.previewHost = "textbox";
    document.body.append(input);
    input.focus();

    expect(game.GetService("RunService")).toBe(RunService);
    expect(players.LocalPlayer.Name).toBe("LocalPlayer");
    expect(players.GetPlayers()).toEqual([players.LocalPlayer]);
    expect(userInputService.KeyboardEnabled).toBe(true);
    expect(userInputService.MouseEnabled).toBe(true);
    expect(userInputService.GetLastInputType()).toBe("MouseButton1");
    expect(userInputService.GetFocusedTextBox()).toBe(input);
    expect(guiService.GetGuiInset()).toEqual([
      { X: 0, Y: 0 },
      { X: 0, Y: 0 },
    ]);
    expect(guiService.IsTenFootInterface()).toBe(false);
    expect(game.GetService("AnalyticsService")).toBe(unknownService);
    expect(workspace).toBe(game.GetService("Workspace"));
  });

  it("applies tween goals immediately and fires Completed on preview tweens", () => {
    setupRobloxEnvironment();

    const tweenService = game.GetService("TweenService") as {
      Create(instance: unknown, tweenInfo: TweenInfo, goal: Record<string, unknown>): {
        Completed: { Connect(listener: (state: unknown) => void): void };
        Play(): void;
      };
    };
    const target = {
      Position: 1,
      Visible: false,
    };
    const tweenInfo = new TweenInfo(0.15);
    const completed = vi.fn();
    const tween = tweenService.Create(target, tweenInfo, {
      Position: 2,
      Visible: true,
    });

    tween.Completed.Connect((state) => {
      completed(String(state));
    });
    tween.Play();

    expect(tweenInfo.Time).toBe(0.15);
    expect(target).toEqual({
      Position: 2,
      Visible: true,
    });
    expect(completed).toHaveBeenCalledWith("Enum.PlaybackState.Completed");
  });

  it("installs Luau-style globals and prototype helpers", () => {
    setupRobloxEnvironment();
    const previewGlobal = globalThis as typeof globalThis & {
      print?: (...args: unknown[]) => void;
      tostring?: (value: unknown) => string;
    };

    expect(previewGlobal.tostring?.(1)).toBe("1");
    expect("Spell".size()).toBe(5);
    expect("Spell".sub(2, 4)).toBe("pel");
    expect([1, 2, 3].size()).toBe(3);
    expect(typeof previewGlobal.print).toBe("function");
  });
});
