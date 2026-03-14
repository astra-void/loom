// @vitest-environment jsdom

import {
	Color3,
	Enum,
	game,
	RunService,
	type SetupRobloxEnvironmentTarget,
	setupRobloxEnvironment,
	TweenInfo,
	task,
	UDim2,
	Vector2,
	workspace,
} from "@loom-dev/preview-runtime";
import { afterEach, describe, expect, it, vi } from "vitest";

class RafController {
	private readonly callbacks = new Map<number, FrameRequestCallback>();
	private readonly originalCancelAnimationFrame =
		globalThis.cancelAnimationFrame;
	private readonly originalRequestAnimationFrame =
		globalThis.requestAnimationFrame;
	private readonly performanceNowMock = vi
		.spyOn(performance, "now")
		.mockImplementation(() => this.now);
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

type TestPreviewEnumMember = {
	EnumType: {
		Name: string;
	};
	Name: string;
	Value: number;
};

type TestPreviewEnum = {
	EasingDirection: {
		In: TestPreviewEnumMember;
		Out: TestPreviewEnumMember;
	};
	EasingStyle: {
		Linear: TestPreviewEnumMember;
		Quad: TestPreviewEnumMember;
	};
	KeyCode: {
		Return: TestPreviewEnumMember;
	};
	TextXAlignment: {
		Center: TestPreviewEnumMember;
		FromName(name: string): TestPreviewEnumMember;
		FromValue(value: number): TestPreviewEnumMember;
	};
};

const previewEnum = Enum as unknown as TestPreviewEnum;

afterEach(() => {
	rafController?.restore();
	rafController = undefined;
	document.body.innerHTML = "";
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe.sequential("@loom-dev/preview-runtime", () => {
	it("provides a deep Enum proxy with stable Name and Value access", () => {
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
		const renderConnection = RunService.RenderStepped.Connect(
			(deltaTime: number) => {
				order.push(`render:${deltaTime.toFixed(3)}`);
			},
		);
		const steppedConnection = RunService.Stepped.Connect(
			(time: number, deltaTime: number) => {
				order.push(`stepped:${time.toFixed(3)}:${deltaTime.toFixed(3)}`);
			},
		);
		const heartbeatConnection = RunService.Heartbeat.Connect(
			(deltaTime: number) => {
				order.push(`heartbeat:${deltaTime.toFixed(3)}`);
			},
		);

		await rafController.step(20);

		expect(order).toEqual([
			"render:0.020",
			"stepped:0.020:0.020",
			"heartbeat:0.020",
		]);
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
		const existingColor3 = {} as typeof Color3;
		const existingTask = {} as typeof task;
		const target: SetupRobloxEnvironmentTarget = {
			Color3: existingColor3,
			task: existingTask,
		};

		setupRobloxEnvironment(target);

		expect(target.Color3).toBe(existingColor3);
		expect(target.Enum).toBe(Enum);
		expect(target.RunService).toBe(RunService);
		expect(target.task).toBe(existingTask);
		expect(target.game).toBe(game);
		expect(target.TweenInfo).toBe(TweenInfo);
		expect(target.workspace).toBe(workspace);
	});

	it("setupRobloxEnvironment installs Color3 on the global target", () => {
		setupRobloxEnvironment();

		expect((globalThis as { Color3?: typeof Color3 }).Color3).toBe(Color3);
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
			GetGuiInset(): readonly [
				{ X: number; Y: number },
				{ X: number; Y: number },
			];
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

	it("emits deterministic focus and input signals for UserInputService", () => {
		setupRobloxEnvironment();

		const userInputService = game.GetService("UserInputService") as {
			InputBegan: { Connect(listener: (event: Event) => void): void };
			LastInputTypeChanged: {
				Connect(listener: (inputType: string) => void): void;
			};
			TextBoxFocusReleased: {
				Connect(listener: (element: HTMLElement | null) => void): void;
			};
			TextBoxFocused: {
				Connect(listener: (element: HTMLElement | null) => void): void;
			};
		};
		const inputEvents: string[] = [];
		const lastInputTypes: string[] = [];
		const focusEvents: string[] = [];
		const textbox = document.createElement("input");
		textbox.dataset.previewHost = "textbox";
		document.body.append(textbox);

		userInputService.InputBegan.Connect((event) => {
			inputEvents.push(event.type);
		});
		userInputService.LastInputTypeChanged.Connect((inputType) => {
			lastInputTypes.push(inputType);
		});
		userInputService.TextBoxFocused.Connect((element) => {
			focusEvents.push(`focused:${element?.tagName ?? "null"}`);
		});
		userInputService.TextBoxFocusReleased.Connect((element) => {
			focusEvents.push(`released:${element?.tagName ?? "null"}`);
		});

		textbox.focus();
		textbox.blur();
		window.dispatchEvent(new MouseEvent("mousedown", { button: 0 }));
		window.dispatchEvent(new KeyboardEvent("keydown", { key: "A" }));

		expect(focusEvents).toEqual(["focused:INPUT", "released:INPUT"]);
		expect(inputEvents).toEqual(["mousedown", "keydown"]);
		expect(lastInputTypes.slice(-1)).toEqual(["Keyboard"]);
	});

	it("advances preview tweens over time and fires Completed once", async () => {
		rafController = new RafController();
		setupRobloxEnvironment();

		const tweenService = game.GetService("TweenService") as {
			Create(
				instance: unknown,
				tweenInfo: TweenInfo,
				goal: Record<string, unknown>,
			): {
				Completed: { Connect(listener: (state: unknown) => void): void };
				PlaybackState: unknown;
				Play(): void;
			};
		};
		const target = {
			Position: 0,
			Visible: false,
		};
		const tweenInfo = new TweenInfo(
			0.1,
			previewEnum.EasingStyle.Linear,
			previewEnum.EasingDirection.In,
		);
		const completed = vi.fn();
		const tween = tweenService.Create(target, tweenInfo, {
			Position: 10,
			Visible: true,
		});

		tween.Completed.Connect((state) => {
			completed(String(state));
		});
		tween.Play();

		expect(String(tween.PlaybackState)).toBe("Enum.PlaybackState.Playing");

		await rafController.step(50);

		expect(tweenInfo.Time).toBe(0.1);
		expect(target.Position).toBeCloseTo(5, 3);
		expect(target.Visible).toBe(false);

		await rafController.step(50);

		expect(target).toEqual({
			Position: 10,
			Visible: true,
		});
		expect(String(tween.PlaybackState)).toBe("Enum.PlaybackState.Completed");
		expect(completed).toHaveBeenCalledTimes(1);
		expect(completed).toHaveBeenCalledWith("Enum.PlaybackState.Completed");
	});

	it("supports pause, cancel, and replay from the current tweened value", async () => {
		rafController = new RafController();
		setupRobloxEnvironment();

		const tweenService = game.GetService("TweenService") as {
			Create(
				instance: unknown,
				tweenInfo: TweenInfo,
				goal: Record<string, unknown>,
			): {
				Cancel(): void;
				Completed: { Connect(listener: (state: unknown) => void): void };
				Destroy(): void;
				Pause(): void;
				PlaybackState: unknown;
				Play(): void;
			};
		};
		const target = {
			Position: 0,
		};
		const completedStates: string[] = [];
		const tween = tweenService.Create(
			target,
			new TweenInfo(
				0.1,
				previewEnum.EasingStyle.Linear,
				previewEnum.EasingDirection.In,
			),
			{
				Position: 10,
			},
		);

		tween.Completed.Connect((state) => {
			completedStates.push(String(state));
		});

		tween.Play();
		await rafController.step(40);
		expect(target.Position).toBeCloseTo(4, 3);

		tween.Pause();
		expect(String(tween.PlaybackState)).toBe("Enum.PlaybackState.Paused");

		await rafController.step(40);
		expect(target.Position).toBeCloseTo(4, 3);

		tween.Play();
		await rafController.step(10);
		expect(target.Position).toBeCloseTo(5, 3);

		tween.Cancel();
		expect(String(tween.PlaybackState)).toBe("Enum.PlaybackState.Cancelled");

		await rafController.step(50);
		expect(target.Position).toBeCloseTo(5, 3);

		tween.Play();
		expect(String(tween.PlaybackState)).toBe("Enum.PlaybackState.Playing");

		await rafController.step(50);
		expect(target.Position).toBeCloseTo(7.5, 3);

		await rafController.step(50);
		expect(target.Position).toBeCloseTo(10, 3);
		expect(String(tween.PlaybackState)).toBe("Enum.PlaybackState.Completed");
		expect(completedStates).toEqual([
			"Enum.PlaybackState.Cancelled",
			"Enum.PlaybackState.Completed",
		]);
	});

	it("supports repeat and reverse cycles before completing", async () => {
		rafController = new RafController();
		setupRobloxEnvironment();

		const tweenService = game.GetService("TweenService") as {
			Create(
				instance: unknown,
				tweenInfo: TweenInfo,
				goal: Record<string, unknown>,
			): {
				Completed: { Connect(listener: (state: unknown) => void): void };
				PlaybackState: unknown;
				Play(): void;
			};
		};
		const target = {
			Position: 0,
		};
		const completed = vi.fn();
		const tween = tweenService.Create(
			target,
			new TweenInfo(
				0.05,
				previewEnum.EasingStyle.Linear,
				previewEnum.EasingDirection.In,
				1,
				true,
			),
			{
				Position: 10,
			},
		);

		tween.Completed.Connect((state) => {
			completed(String(state));
		});
		tween.Play();

		await rafController.step(50);
		expect(target.Position).toBeCloseTo(10, 3);
		expect(String(tween.PlaybackState)).toBe("Enum.PlaybackState.Playing");

		await rafController.step(50);
		expect(target.Position).toBeCloseTo(0, 3);

		await rafController.step(50);
		expect(target.Position).toBeCloseTo(10, 3);

		await rafController.step(50);
		expect(target.Position).toBeCloseTo(0, 3);
		expect(String(tween.PlaybackState)).toBe("Enum.PlaybackState.Completed");
		expect(completed).toHaveBeenCalledWith("Enum.PlaybackState.Completed");
	});

	it("cancels overlapping tween properties and interpolates preview-safe value types", async () => {
		rafController = new RafController();
		setupRobloxEnvironment();

		const tweenService = game.GetService("TweenService") as {
			Create(
				instance: unknown,
				tweenInfo: TweenInfo,
				goal: Record<string, unknown>,
			): {
				Completed: { Connect(listener: (state: unknown) => void): void };
				PlaybackState: unknown;
				Play(): void;
			};
		};
		const target = {
			Position: 0,
			Size: UDim2.fromOffset(0, 0),
			Tint: Color3.fromRGB(0, 0, 0),
			Velocity: new Vector2(0, 0),
		};
		const firstStates: string[] = [];
		const secondStates: string[] = [];
		const firstTween = tweenService.Create(
			target,
			new TweenInfo(
				0.1,
				previewEnum.EasingStyle.Linear,
				previewEnum.EasingDirection.In,
			),
			{
				Position: 10,
			},
		);
		const secondTween = tweenService.Create(
			target,
			new TweenInfo(
				0.1,
				previewEnum.EasingStyle.Linear,
				previewEnum.EasingDirection.In,
			),
			{
				Position: 20,
				Size: UDim2.fromOffset(100, 40),
				Tint: Color3.fromRGB(255, 128, 0),
				Velocity: new Vector2(12, 8),
			},
		);

		firstTween.Completed.Connect((state) => {
			firstStates.push(String(state));
		});
		secondTween.Completed.Connect((state) => {
			secondStates.push(String(state));
		});

		firstTween.Play();
		await rafController.step(50);
		expect(target.Position).toBeCloseTo(5, 3);

		secondTween.Play();
		expect(String(firstTween.PlaybackState)).toBe(
			"Enum.PlaybackState.Cancelled",
		);
		expect(firstStates).toEqual(["Enum.PlaybackState.Cancelled"]);

		await rafController.step(50);
		expect(target.Position).toBeCloseTo(12.5, 3);
		expect(target.Size.X.Offset).toBeCloseTo(50, 3);
		expect(target.Size.Y.Offset).toBeCloseTo(20, 3);
		expect(target.Tint.R).toBeCloseTo(0.5, 3);
		expect(target.Tint.G).toBeCloseTo(0.25098, 3);
		expect(target.Velocity.X).toBeCloseTo(6, 3);
		expect(target.Velocity.Y).toBeCloseTo(4, 3);

		await rafController.step(50);
		expect(target.Position).toBeCloseTo(20, 3);
		expect(target.Size.X.Offset).toBeCloseTo(100, 3);
		expect(target.Size.Y.Offset).toBeCloseTo(40, 3);
		expect(target.Velocity.X).toBeCloseTo(12, 3);
		expect(target.Velocity.Y).toBeCloseTo(8, 3);
		expect(secondStates).toEqual(["Enum.PlaybackState.Completed"]);
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
