// @vitest-environment jsdom

import {
	BillboardGui,
	CanvasGroup,
	Color3,
	clearPreviewRuntimeIssues,
	Enum,
	FocusScope,
	Frame,
	game,
	getPreviewLayoutProbeSnapshot,
	getPreviewRuntimeIssues,
	ImageButton,
	isPreviewElement,
	LayoutProvider,
	normalizePreviewRuntimeError,
	type PreviewRuntimeIssue,
	publishPreviewRuntimeIssue,
	ScreenGui,
	Slot,
	SurfaceGui,
	subscribePreviewLayoutProbe,
	subscribePreviewRuntimeIssues,
	TextBox,
	TextButton,
	TextLabel,
	TweenInfo,
	UDim2,
	UIAspectRatioConstraint,
	UICorner,
	UIFlexItem,
	UIGridLayout,
	UIListLayout,
	UIPadding,
	UIScale,
	UISizeConstraint,
	UIStroke,
	UITextSizeConstraint,
	VideoFrame,
	ViewportFrame,
} from "@loom-dev/preview-runtime";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getLocalPlayerGui } from "../../apps/preview-harness/src/test-utils";
import { suppressExpectedConsoleMessages } from "../testLogUtils";
import userEvent from "../testUserEvent";

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
	hostMetadata?: {
		degraded: boolean;
		fullSizeDefault: boolean;
		placeholderBehavior: "none" | "container" | "opaque";
	};
	id: string;
	intrinsicSize?: { height: number; width: number } | null;
	kind?: string;
	layoutModifiers?: Record<string, unknown>;
	layoutOrder?: number;
	layout?: {
		anchorPoint?: { x: number; y: number };
		position?: { x: SerializedAxis; y: SerializedAxis };
		size?: { x: SerializedAxis; y: SerializedAxis };
		sizeConstraintMode?: string;
	};
	name?: string;
	nodeType?: string;
	parentId?: string;
	sourceOrder?: number;
};
type LayoutSessionResult = {
	debug: LayoutDebugPayload;
	dirtyNodeIds: string[];
	rects: Record<string, LayoutRect>;
};
type ComputeDirty = (
	nodes: LayoutNode[],
	viewportWidth: number,
	viewportHeight: number,
) => LayoutSessionResult;
type BridgedHostHandle = HTMLElement & {
	GetChildren(): BridgedHostHandle[];
	GetDescendants(): BridgedHostHandle[];
	IsA(name: string): boolean;
	IsDescendantOf(ancestor: unknown): boolean;
	Parent: { ClassName: string } | undefined;
	ClassName: string;
	Name: string;
};

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

const layoutEngineMocks = vi.hoisted(() => ({
	computeDirty: vi.fn<ComputeDirty>(
		(_nodes, viewportWidth, viewportHeight) => ({
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
		}),
	),
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
					state.nodes.set(
						node.id,
						JSON.parse(JSON.stringify(node)) as LayoutNode,
					);
				}
			},
			computeDirty() {
				return layoutEngineMocks.computeDirty(
					[...state.nodes.values()].sort((left, right) =>
						left.id.localeCompare(right.id),
					),
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

let restoreExpectedLogs: (() => void) | undefined;
let rafController: RafController | undefined;

vi.mock("@loom-dev/layout-engine", () => ({
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
	const result: Record<
		string,
		{ height: number; width: number; x: number; y: number }
	> = {};

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
	restoreExpectedLogs = suppressExpectedConsoleMessages({
		error: ["RUNTIME_MOCK_ERROR", "LAYOUT_WASM_COMPUTE_FAILED"],
		warn: ["DEGRADED_HOST_RENDER"],
	});
	layoutEngineMocks.computeDirty.mockReset();
	layoutEngineMocks.computeDirty.mockImplementation(
		(_nodes, viewportWidth, viewportHeight) =>
			createSessionResult({}, viewportWidth, viewportHeight, []),
	);
	layoutEngineMocks.createLayoutSession.mockClear();
	layoutEngineMocks.init.mockReset();
	layoutEngineMocks.init.mockResolvedValue(undefined);
	clearPreviewRuntimeIssues();
});

afterEach(() => {
	restoreExpectedLogs?.();
	restoreExpectedLogs = undefined;
	rafController?.restore();
	rafController = undefined;
	cleanup();
	vi.restoreAllMocks();
});

describe("preview runtime Roblox globals", () => {
	it("exposes a LocalPlayer.PlayerGui container for preview portals", () => {
		const players = game.GetService("Players") as {
			LocalPlayer: {
				FindFirstChild(name: string): unknown;
				PlayerGui: {
					appendChild(node: Node): Node;
					GetFullName(): string;
					GetGuiObjectsAtPosition(x: number, y: number): unknown[];
					IsA(name: string): boolean;
				};
				WaitForChild(name: string): unknown;
			};
		};
		const playerGui = getLocalPlayerGui();

		expect(playerGui).toBe(players.LocalPlayer.PlayerGui);
		expect(playerGui).toBeInstanceOf(HTMLElement);
		expect(isPreviewElement(playerGui, "BasePlayerGui")).toBe(true);
		expect(isPreviewElement(playerGui, "PlayerGui")).toBe(true);
		expect(playerGui.style.pointerEvents).toBe("none");
		expect(players.LocalPlayer.PlayerGui.IsA("BasePlayerGui")).toBe(true);
		expect(players.LocalPlayer.PlayerGui.IsA("PlayerGui")).toBe(true);
		expect(players.LocalPlayer.PlayerGui.GetFullName()).toBe(
			"Players.LocalPlayer.PlayerGui",
		);
		expect(players.LocalPlayer.PlayerGui.GetGuiObjectsAtPosition(0, 0)).toEqual(
			[],
		);
	});
});

describe("preview runtime host mapping", () => {
	it("uses bare preview ids and shows a debug fallback when Wasm output is missing", () => {
		render(
			<Frame
				Position={UDim2.fromOffset(12, 18)}
				Size={UDim2.fromOffset(120, 48)}
			>
				Debug frame
			</Frame>,
		);

		const frame = document.querySelector(
			'[data-preview-host="frame"]',
		) as HTMLElement;
		expect(frame.dataset.previewNodeId).toMatch(/^preview-node-\d+$/);
		expect(frame.dataset.previewNodeId).not.toContain("frame:");
		expect(frame.style.visibility).toBe("visible");
		expect(frame.style.left).toBe("12px");
		expect(frame.style.top).toBe("18px");
		expect(frame.style.width).toBe("120px");
		expect(frame.style.height).toBe("48px");
	});

	it("tweens bridged host properties through the preview render pipeline", async () => {
		rafController = new RafController();

		const { rerender } = render(
			<Frame
				BackgroundColor3={Color3.fromRGB(0, 0, 0)}
				Position={UDim2.fromOffset(10, 20)}
				Size={UDim2.fromOffset(40, 20)}
				ZIndex={1}
			>
				Tween frame
			</Frame>,
		);

		const frame = document.querySelector(
			'[data-preview-host="frame"]',
		) as HTMLElement & {
			BackgroundColor3?: unknown;
			Position?: unknown;
			Size?: unknown;
			Visible?: unknown;
			ZIndex?: unknown;
		};
		const tweenService = game.GetService("TweenService") as {
			Create(
				instance: unknown,
				tweenInfo: TweenInfo,
				goal: Record<string, unknown>,
			): {
				Play(): void;
			};
		};
		const previewEnum = Enum as {
			EasingDirection: {
				In: unknown;
			};
			EasingStyle: {
				Linear: unknown;
			};
		};
		const tween = tweenService.Create(
			frame,
			new TweenInfo(
				0.1,
				previewEnum.EasingStyle.Linear,
				previewEnum.EasingDirection.In,
			),
			{
				BackgroundColor3: Color3.fromRGB(255, 0, 0),
				Position: UDim2.fromOffset(30, 50),
				Size: UDim2.fromOffset(100, 60),
				Visible: false,
				ZIndex: 5,
			},
		);

		expect(frame.Position).toBeDefined();
		expect(frame.Size).toBeDefined();
		expect(frame.BackgroundColor3).toBeDefined();
		expect(frame.Visible).toBeUndefined();
		expect(frame.ZIndex).toBe(1);

		tween.Play();

		await act(async () => {
			await rafController?.step(50);
		});

		await waitFor(() => {
			expect(frame.style.left).toBe("20px");
			expect(frame.style.top).toBe("35px");
			expect(frame.style.width).toBe("70px");
			expect(frame.style.height).toBe("40px");
			expect(frame.style.backgroundColor).toContain("128, 0, 0");
			expect(frame.style.display).not.toBe("none");
			expect(frame.style.zIndex).toBe("3");
		});

		rerender(
			<Frame
				BackgroundColor3={Color3.fromRGB(0, 0, 0)}
				BackgroundTransparency={0.25}
				Position={UDim2.fromOffset(10, 20)}
				Size={UDim2.fromOffset(40, 20)}
				ZIndex={1}
			>
				Tween frame
			</Frame>,
		);

		await act(async () => {
			await rafController?.step(50);
		});

		await waitFor(() => {
			expect(frame.style.left).toBe("30px");
			expect(frame.style.top).toBe("50px");
			expect(frame.style.width).toBe("100px");
			expect(frame.style.height).toBe("60px");
			expect(frame.style.backgroundColor).toContain("255, 0, 0");
			expect(frame.style.display).toBe("none");
			expect(frame.style.zIndex).toBe("5");
		});
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

		const frame = document.querySelector(
			'[data-preview-host="frame"]',
		) as HTMLElement;
		expect(frame.style.width).toBe("120px");
		expect(frame.style.height).toBe("48px");
	});

	it("supports constructible Color3 values and keeps fromRGB rendering stable", () => {
		const backgroundColor = new Color3(1, 0.5, 0);
		const textColor = Color3.fromRGB(10, 20, 30);

		expect(backgroundColor).toBeInstanceOf(Color3);
		expect(backgroundColor.R).toBe(1);
		expect(backgroundColor.G).toBe(0.5);
		expect(backgroundColor.B).toBe(0);

		expect(textColor).toBeInstanceOf(Color3);
		expect(textColor.R).toBeCloseTo(10 / 255);
		expect(textColor.G).toBeCloseTo(20 / 255);
		expect(textColor.B).toBeCloseTo(30 / 255);

		render(
			<Frame
				BackgroundColor3={backgroundColor}
				Size={UDim2.fromOffset(120, 40)}
			>
				<TextLabel Text="Color sample" TextColor3={textColor} />
			</Frame>,
		);

		const frame = document.querySelector(
			'[data-preview-host="frame"]',
		) as HTMLElement;
		const label = document.querySelector(
			'[data-preview-host="textlabel"]',
		) as HTMLElement;

		expect(frame.style.backgroundColor).toContain("255, 128, 0");
		expect(label.style.color).toContain("10, 20, 30");
	});

	it("invokes the slot activated handler when the intrinsic child has no event table", async () => {
		const user = userEvent.setup();
		const slotActivated = vi.fn();

		render(
			<Slot Event={{ Activated: () => slotActivated() }}>
				<button type="button">Trigger</button>
			</Slot>,
		);

		await user.click(screen.getByRole("button", { name: "Trigger" }));
		expect(slotActivated).toHaveBeenCalledTimes(1);
	});

	it("invokes the slot activated handler when the preview child has no event table", async () => {
		const user = userEvent.setup();
		const slotActivated = vi.fn();

		render(
			<Slot Event={{ Activated: () => slotActivated() }} Text="Trigger">
				<TextButton />
			</Slot>,
		);

		await user.click(screen.getByRole("button", { name: "Trigger" }));
		expect(slotActivated).toHaveBeenCalledTimes(1);
	});

	it("upgrades preview intrinsic host strings inside Slot to runtime host components", () => {
		render(
			<Slot Text="Ready">
				<textlabel />
			</Slot>,
		);

		expect(screen.getByText("Ready")).toBeTruthy();
		expect(document.querySelector("textlabel")).toBeNull();
		expect(
			document.querySelector('[data-preview-host="textlabel"]'),
		).toBeTruthy();
	});

	it("renders nothing when Slot receives no child element", () => {
		const { container } = render(
			<Slot Event={{ Activated: () => undefined }}>{null}</Slot>,
		);

		expect(container.firstChild).toBeNull();
	});

	it("keeps controlled textbox text updates silent during prop sync", async () => {
		const user = userEvent.setup();
		const changeCalls: string[] = [];
		const valueSetterSpy = vi.spyOn(HTMLInputElement.prototype, "value", "set");

		function TextBoxHarness(props: { value: string }) {
			return (
				<TextBox
					Change={{
						Text: (textBox) => {
							changeCalls.push(textBox.value);
						},
					}}
					Text={props.value}
				/>
			);
		}

		const { rerender } = render(<TextBoxHarness value="alpha" />);
		const input = screen.getByRole("textbox") as HTMLInputElement;

		expect(input.value).toBe("alpha");

		await user.type(input, "!");

		expect(changeCalls).toEqual(["alpha!"]);
		expect(input.value).toBe("alpha!");

		valueSetterSpy.mockClear();
		rerender(<TextBoxHarness value="beta" />);

		await waitFor(() => {
			expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe(
				"beta",
			);
		});

		expect(valueSetterSpy).toHaveBeenCalledTimes(1);
	});

	it("renders the combobox scene shape without mount-time reentrant state updates", async () => {
		const setterLog = {
			inputValue: [] as string[],
			open: [] as boolean[],
			registryRevision: [] as number[],
			value: [] as string[],
		};

		function ComboboxSceneHarness() {
			const [valueState, rawSetValueState] = React.useState("alpha");
			const [openState, rawSetOpenState] = React.useState(false);
			const [inputValueState, rawSetInputValueState] = React.useState("");
			const [registryRevisionState, rawSetRegistryRevisionState] =
				React.useState(0);

			const setValueState = React.useCallback((nextValue: string) => {
				setterLog.value.push(nextValue);
				rawSetValueState(nextValue);
			}, []);
			const setOpenState = React.useCallback((nextOpen: boolean) => {
				setterLog.open.push(nextOpen);
				rawSetOpenState(nextOpen);
			}, []);
			const setInputValueState = React.useCallback((nextInputValue: string) => {
				setterLog.inputValue.push(nextInputValue);
				rawSetInputValueState(nextInputValue);
			}, []);
			const setRegistryRevision = React.useCallback(
				(nextRevision: number | ((previous: number) => number)) => {
					const resolved =
						typeof nextRevision === "function"
							? nextRevision(registryRevisionState)
							: nextRevision;
					setterLog.registryRevision.push(resolved);
					rawSetRegistryRevisionState(nextRevision);
				},
				[registryRevisionState],
			);

			function ComboboxContentLike() {
				React.useEffect(() => {
					setterLog.registryRevision.push(registryRevisionState);
					setRegistryRevision((revision) => revision + 1);
				}, []);

				return (
					<frame BackgroundTransparency={1} Size={UDim2.fromOffset(320, 128)}>
						<textlabel
							BackgroundTransparency={1}
							Text={`registry:${registryRevisionState}`}
							TextXAlignment={Enum.TextXAlignment.Left}
						/>
					</frame>
				);
			}

			const syncInputFromValue = React.useCallback(() => {
				setInputValueState(valueState);
			}, [setInputValueState, valueState]);

			React.useEffect(() => {
				if (openState) {
					return;
				}

				syncInputFromValue();
			}, [openState, syncInputFromValue]);

			const handleTextChanged = React.useCallback(
				(textBox: HTMLInputElement) => {
					if (textBox.value === inputValueState) {
						return;
					}

					setInputValueState(textBox.value);
					setOpenState(true);
					setValueState(textBox.value);
				},
				[inputValueState, setInputValueState, setOpenState, setValueState],
			);

			return (
				<frame BackgroundTransparency={1} Size={UDim2.fromOffset(940, 560)}>
					<textlabel
						BackgroundTransparency={1}
						Text="Combobox: type-to-filter + enforced selection"
						TextXAlignment={Enum.TextXAlignment.Left}
					/>
					<textlabel
						BackgroundTransparency={1}
						Position={UDim2.fromOffset(0, 34)}
						Text={`Controlled open: ${openState ? "true" : "false"} | value: ${valueState}`}
						TextXAlignment={Enum.TextXAlignment.Left}
					/>
					<frame
						BackgroundTransparency={1}
						Position={UDim2.fromOffset(0, 76)}
						Size={UDim2.fromOffset(900, 220)}
					>
						<Slot
							Active={true}
							Event={{ Activated: () => setOpenState(!openState) }}
							Selectable={false}
						>
							<textbutton
								BackgroundTransparency={1}
								Size={UDim2.fromOffset(320, 40)}
								Text=""
							>
								<textlabel
									BackgroundTransparency={1}
									Position={UDim2.fromOffset(12, 0)}
									Size={UDim2.fromOffset(84, 40)}
									Text="Selected"
									TextXAlignment={Enum.TextXAlignment.Left}
								/>
								<Slot Text={valueState}>
									<textlabel
										BackgroundTransparency={1}
										Position={UDim2.fromOffset(88, 0)}
										Size={UDim2.fromOffset(212, 40)}
										Text={valueState}
										TextXAlignment={Enum.TextXAlignment.Left}
									/>
								</Slot>
							</textbutton>
						</Slot>

						<Slot
							Active={true}
							Change={{ Text: handleTextChanged }}
							ClearTextOnFocus={false}
							PlaceholderText="Type alpha, beta, gamma..."
							Selectable={true}
							Text={inputValueState}
							TextEditable={true}
						>
							<textbox
								BackgroundTransparency={1}
								Size={UDim2.fromOffset(320, 34)}
								TextXAlignment={Enum.TextXAlignment.Left}
							/>
						</Slot>
					</frame>
					{openState ? <ComboboxContentLike /> : undefined}
				</frame>
			);
		}

		render(<ComboboxSceneHarness />);

		await waitFor(() => {
			expect(screen.getByRole("textbox")).toBeTruthy();
		});

		expect(setterLog.inputValue).toEqual(["alpha"]);
		expect(setterLog.open).toEqual([]);
		expect(setterLog.value).toEqual([]);
		expect(setterLog.registryRevision).toEqual([]);
	});

	it("merges slot and child activated handlers from preview children", async () => {
		const user = userEvent.setup();
		const callOrder: string[] = [];
		const childActivated = vi.fn(() => {
			callOrder.push("child");
		});
		const slotActivated = vi.fn(() => {
			callOrder.push("slot");
		});

		render(
			<Slot Event={{ Activated: () => slotActivated() }} Text="Trigger">
				<TextButton Event={{ Activated: () => childActivated() }} />
			</Slot>,
		);

		await user.click(screen.getByRole("button", { name: "Trigger" }));
		expect(childActivated).toHaveBeenCalledTimes(1);
		expect(slotActivated).toHaveBeenCalledTimes(1);
		expect(callOrder).toEqual(["child", "slot"]);
	});

	it("composes refs through preview Slot asChild boundaries", () => {
		const childRef = React.createRef<HTMLInputElement>();
		const slotRef = React.createRef<HTMLInputElement>();

		render(
			<Slot ref={slotRef}>
				<TextBox ref={childRef} Text="Ref sample" />
			</Slot>,
		);

		expect(childRef.current).toBeTruthy();
		expect(slotRef.current).toBeTruthy();
		expect(childRef.current).toBe(slotRef.current);
	});

	it("supports rbxts-react event interop props on preview hosts", async () => {
		const user = userEvent.setup();
		const activated = vi.fn();
		const inputBegan = vi.fn();

		render(
			<TextButton
				__previewReactEventActivated={activated}
				__previewReactEventInputBegan={inputBegan}
				Text="Interop trigger"
			/>,
		);

		const button = screen.getByRole("button", { name: "Interop trigger" });

		await user.click(button);
		expect(activated).toHaveBeenCalledTimes(1);

		activated.mockClear();
		inputBegan.mockClear();
		await user.keyboard("{Enter}");

		expect(activated).toHaveBeenCalledTimes(1);
		expect(inputBegan).toHaveBeenCalledTimes(1);
		expect(inputBegan).toHaveBeenLastCalledWith(
			expect.objectContaining({
				AbsolutePosition: expect.any(Object),
				AbsoluteSize: expect.any(Object),
				IsA: expect.any(Function),
			}),
			expect.objectContaining({
				KeyCode: "Enter",
				UserInputType: "Keyboard",
			}),
		);
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

		const frame = document.querySelector(
			'[data-preview-host="frame"]',
		) as HTMLElement;
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

	it("does not forward preview-only text label props onto the DOM", () => {
		render(
			<TextLabel
				BackgroundTransparency={1}
				Size={UDim2.fromOffset(128, 32)}
				Text="Preview text"
				TextColor3={Color3.fromRGB(15, 30, 45)}
				TextSize={18}
				TextXAlignment="center"
			/>,
		);

		const label = document.querySelector(
			'[data-preview-host="textlabel"]',
		) as HTMLElement;

		expect(label).toBeTruthy();
		expect(label.textContent).toContain("Preview text");
		expect(label.hasAttribute("BackgroundTransparency")).toBe(false);
		expect(label.hasAttribute("Size")).toBe(false);
		expect(label.hasAttribute("TextColor3")).toBe(false);
		expect(label.hasAttribute("TextSize")).toBe(false);
		expect(label.hasAttribute("TextXAlignment")).toBe(false);
	});

	it("renders image buttons as clickable preview buttons with visible images", async () => {
		const user = userEvent.setup();
		const activated = vi.fn();

		render(
			<ImageButton
				Event={{ Activated: () => activated() }}
				Image="https://example.com/preview-button.png"
				Size={UDim2.fromOffset(96, 48)}
			/>,
		);

		const button = document.querySelector(
			'[data-preview-host="imagebutton"]',
		) as HTMLButtonElement;
		const image = button.querySelector("img") as HTMLImageElement;

		expect(button.tagName).toBe("BUTTON");
		expect(image.getAttribute("src")).toBe(
			"https://example.com/preview-button.png",
		);
		expect(isPreviewElement(button, "ImageButton")).toBe(true);
		expect(isPreviewElement(button, "GuiButton")).toBe(true);
		expect(isPreviewElement(button, "GuiObject")).toBe(true);
		expect(isPreviewElement(button, "Instance")).toBe(true);

		await user.click(button);
		expect(activated).toHaveBeenCalledTimes(1);
	});

	it("matches abstract preview host hierarchy through metadata-driven IsA checks", () => {
		render(
			<LayoutProvider debounceMs={0} viewportHeight={480} viewportWidth={640}>
				<ScreenGui Id="abstract-screen">
					<TextLabel Id="abstract-label" Text="Hierarchy" />
				</ScreenGui>
			</LayoutProvider>,
		);

		const screenGui = document.querySelector(
			'[data-preview-host="screengui"]',
		) as HTMLElement;
		const label = document.querySelector(
			'[data-preview-host="textlabel"]',
		) as HTMLElement;

		expect(isPreviewElement(screenGui, "LayerCollector")).toBe(true);
		expect(isPreviewElement(screenGui, "BasePlayerGui")).toBe(true);
		expect(isPreviewElement(screenGui, "GuiObject")).toBe(true);
		expect(isPreviewElement(label, "GuiLabel")).toBe(true);
		expect(isPreviewElement(label, "GuiObject")).toBe(true);
		expect(isPreviewElement(label, "LayerCollector")).toBe(false);
	});

	it("registers frame-like placeholder hosts with metadata-driven full-size fallback layout", async () => {
		render(
			<LayoutProvider debounceMs={0} viewportHeight={480} viewportWidth={640}>
				<ScreenGui>
					<CanvasGroup Id="preview-canvasgroup" />
					<ViewportFrame Id="preview-viewportframe" />
					<VideoFrame Id="preview-videoframe" />
					<SurfaceGui Id="preview-surfacegui" />
					<BillboardGui Id="preview-billboardgui" />
				</ScreenGui>
			</LayoutProvider>,
		);

		await waitFor(() => {
			expect(layoutEngineMocks.computeDirty).toHaveBeenCalled();
		});

		const calls = layoutEngineMocks.computeDirty.mock.calls;
		const lastCall = calls[calls.length - 1];
		expect(lastCall).toBeDefined();
		if (!lastCall) {
			throw new Error("Expected computeDirty to have been called.");
		}

		const [nodes] = lastCall;

		expect(findNode(nodes, "preview-canvasgroup")).toMatchObject({
			hostMetadata: {
				degraded: false,
				fullSizeDefault: true,
				placeholderBehavior: "none",
			},
			nodeType: "CanvasGroup",
			parentId: expect.any(String),
		});
		expect(findNode(nodes, "preview-viewportframe")).toMatchObject({
			hostMetadata: {
				degraded: true,
				fullSizeDefault: true,
				placeholderBehavior: "opaque",
			},
			nodeType: "ViewportFrame",
		});
		expect(findNode(nodes, "preview-videoframe")).toMatchObject({
			hostMetadata: {
				degraded: true,
				fullSizeDefault: true,
				placeholderBehavior: "opaque",
			},
			nodeType: "VideoFrame",
		});
		expect(findNode(nodes, "preview-surfacegui")).toMatchObject({
			hostMetadata: {
				degraded: true,
				fullSizeDefault: true,
				placeholderBehavior: "container",
			},
			nodeType: "SurfaceGui",
		});
		expect(findNode(nodes, "preview-billboardgui")).toMatchObject({
			hostMetadata: {
				degraded: true,
				fullSizeDefault: true,
				placeholderBehavior: "container",
			},
			nodeType: "BillboardGui",
		});

		expect(
			document.querySelector('[data-preview-host="canvasgroup"]'),
		).toBeTruthy();
		expect(
			document.querySelector('[data-preview-host="viewportframe"]'),
		).toBeTruthy();
		expect(
			document.querySelector('[data-preview-host="videoframe"]'),
		).toBeTruthy();
		expect(
			document.querySelector('[data-preview-host="surfacegui"]'),
		).toBeTruthy();
		expect(
			document.querySelector('[data-preview-host="billboardgui"]'),
		).toBeTruthy();
		expect(
			document
				.querySelector('[data-preview-host="canvasgroup"]')
				?.getAttribute("data-preview-degraded"),
		).toBeNull();
		expect(
			document
				.querySelector('[data-preview-host="viewportframe"]')
				?.getAttribute("data-preview-degraded"),
		).toBe("true");
		expect(
			document
				.querySelector('[data-preview-host="viewportframe"]')
				?.getAttribute("data-preview-placeholder-behavior"),
		).toBe("opaque");
		expect(
			document
				.querySelector('[data-preview-host="videoframe"]')
				?.getAttribute("data-preview-degraded"),
		).toBe("true");
		expect(
			document
				.querySelector('[data-preview-host="surfacegui"]')
				?.getAttribute("data-preview-degraded"),
		).toBe("true");
		expect(
			document
				.querySelector('[data-preview-host="surfacegui"]')
				?.getAttribute("data-preview-placeholder-behavior"),
		).toBe("container");
		expect(
			document
				.querySelector('[data-preview-host="billboardgui"]')
				?.getAttribute("data-preview-degraded"),
		).toBe("true");

		await waitFor(() => {
			expect(
				getPreviewRuntimeIssues()
					.filter((issue) => issue.code === "DEGRADED_HOST_RENDER")
					.map((issue) => issue.target)
					.sort(),
			).toEqual(["BillboardGui", "SurfaceGui", "VideoFrame", "ViewportFrame"]);
		});

		expect(
			getPreviewRuntimeIssues()
				.filter((issue) => issue.code === "DEGRADED_HOST_RENDER")
				.every(
					(issue) => issue.blocking === false && issue.severity === "warning",
				),
		).toBe(true);

		expect(
			[...document.querySelectorAll("[data-preview-degraded-label]")]
				.map((node) => node.getAttribute("data-preview-degraded-label"))
				.sort(),
		).toEqual(["BillboardGui", "SurfaceGui", "VideoFrame", "ViewportFrame"]);
		expect(
			document
				.querySelector('[data-preview-host="viewportframe"]')
				?.getAttribute("data-layout-placeholder-behavior"),
		).toBe("opaque");
		expect(
			document
				.querySelector('[data-preview-host="viewportframe"]')
				?.getAttribute("data-layout-size-reason"),
		).toBe("full-size-default");
	});

	it("renders children only for container degraded placeholders", async () => {
		render(
			<LayoutProvider debounceMs={0} viewportHeight={480} viewportWidth={640}>
				<ScreenGui>
					<SurfaceGui Id="preview-surfacegui-children">
						<TextLabel Text="Surface child" />
					</SurfaceGui>
					<ViewportFrame Id="preview-viewportframe-children">
						<TextLabel Text="Viewport child" />
					</ViewportFrame>
				</ScreenGui>
			</LayoutProvider>,
		);

		await waitFor(() => {
			expect(layoutEngineMocks.computeDirty).toHaveBeenCalled();
		});

		expect(screen.getByText("Surface child")).toBeTruthy();
		expect(screen.queryByText("Viewport child")).toBeNull();
		expect(
			document
				.querySelector('[data-preview-host="surfacegui"]')
				?.getAttribute("data-preview-placeholder-behavior"),
		).toBe("container");
		expect(
			document
				.querySelector('[data-preview-host="viewportframe"]')
				?.getAttribute("data-preview-placeholder-behavior"),
		).toBe("opaque");
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
				if (this.dataset.previewHost === "textlabel") {
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

		const scrollWidthSpy = vi
			.spyOn(HTMLElement.prototype, "scrollWidth", "get")
			.mockImplementation(function getWidth(this: HTMLElement) {
				const fontSize = Number.parseFloat(this.style.fontSize || "16");
				const textLength = (this.textContent ?? " ").length;
				return Math.ceil(textLength * fontSize * 0.58);
			});
		const scrollHeightSpy = vi
			.spyOn(HTMLElement.prototype, "scrollHeight", "get")
			.mockImplementation(function getHeight(this: HTMLElement) {
				const fontSize = Number.parseFloat(this.style.fontSize || "16");
				return Math.ceil(fontSize * 1.2);
			});

		try {
			render(
				<TextLabel
					Font={{ Name: "GothamBold" }}
					Size={UDim2.fromOffset(90, 24)}
					Text="Scaled"
					TextScaled={true}
				/>,
			);

			const label = document.querySelector(
				'[data-preview-host="textlabel"]',
			) as HTMLElement;
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

		const container = screen.getByTestId("layout-child")
			.parentElement as HTMLElement;
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

		const screenGui = document.querySelector(
			'[data-preview-host="screengui"]',
		) as HTMLElement;
		expect(screenGui.style.left).toBe("0px");
		expect(screenGui.style.top).toBe("0px");
		expect(screenGui.style.width).toBe("640px");
		expect(screenGui.style.height).toBe("480px");
	});

	it("derives nested scale fallback rects from parent rects when Wasm is unavailable", async () => {
		layoutEngineMocks.init.mockRejectedValue(new Error("init failed"));

		render(
			<LayoutProvider viewportHeight={600} viewportWidth={800}>
				<ScreenGui>
					<Frame Size={UDim2.fromScale(1, 1)}>
						<TextLabel
							AnchorPoint={[0.5, 0.5]}
							Position={[0.5, 0, 0.5, 0]}
							Size={[0, 420, 0, 40]}
							Text="Centered"
						/>
					</Frame>
				</ScreenGui>
			</LayoutProvider>,
		);

		const frame = document.querySelector(
			'[data-preview-host="frame"]',
		) as HTMLElement;
		const label = document.querySelector(
			'[data-preview-host="textlabel"]',
		) as HTMLElement;

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
		layoutEngineMocks.init.mockRejectedValue(new Error("init failed"));

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

			const label = document.querySelector(
				'[data-preview-host="textlabel"]',
			) as HTMLElement;

			await waitFor(() => {
				expect(label.style.width).toBe("88px");
				expect(label.style.height).toBe("24px");
				expect(label.getAttribute("data-layout-size-reason")).toBe(
					"intrinsic-measurement",
				);
				expect(label.getAttribute("data-layout-had-explicit-size")).toBe(
					"false",
				);
				expect(label.getAttribute("data-layout-intrinsic-size-available")).toBe(
					"true",
				);
			});
		} finally {
			getBoundingClientRectSpy.mockRestore();
		}
	});

	it("uses metadata-driven full-size defaults for degraded hosts when Wasm is unavailable", async () => {
		layoutEngineMocks.init.mockRejectedValue(new Error("init failed"));

		render(
			<LayoutProvider viewportHeight={480} viewportWidth={640}>
				<ScreenGui>
					<ViewportFrame Id="fallback-viewportframe" />
				</ScreenGui>
			</LayoutProvider>,
		);

		const viewportFrame = document.querySelector(
			'[data-preview-node-id="fallback-viewportframe"]',
		) as HTMLElement;

		await waitFor(() => {
			expect(viewportFrame.style.position).toBe("absolute");
			expect(viewportFrame.getAttribute("data-layout-size-reason")).toBe(
				"full-size-default",
			);
			expect(
				viewportFrame.getAttribute("data-layout-placeholder-behavior"),
			).toBe("opaque");
		});
	});

	it("applies padding and list layout semantics in provider fallback DOM", async () => {
		layoutEngineMocks.computeDirty.mockImplementation(() => {
			throw new Error("compute failed");
		});

		render(
			<LayoutProvider debounceMs={0} viewportHeight={200} viewportWidth={300}>
				<ScreenGui>
					<Frame Id="list-frame" Size={UDim2.fromOffset(200, 120)}>
						<UIPadding
							PaddingBottom={{ Offset: 10, Scale: 0 }}
							PaddingLeft={{ Offset: 10, Scale: 0 }}
							PaddingRight={{ Offset: 10, Scale: 0 }}
							PaddingTop={{ Offset: 10, Scale: 0 }}
						/>
						<UIListLayout
							FillDirection="vertical"
							HorizontalAlignment="center"
							Padding={{ Offset: 8, Scale: 0 }}
							SortOrder="layout-order"
							VerticalAlignment="center"
						/>
						<TextLabel
							Id="list-second"
							LayoutOrder={2}
							Size={UDim2.fromOffset(40, 20)}
							Text="Second"
						/>
						<TextLabel
							Id="list-first"
							LayoutOrder={1}
							Size={UDim2.fromOffset(60, 30)}
							Text="First"
						/>
					</Frame>
				</ScreenGui>
			</LayoutProvider>,
		);

		const frame = document.querySelector(
			'[data-preview-node-id="list-frame"]',
		) as HTMLElement;
		const first = document.querySelector(
			'[data-preview-node-id="list-first"]',
		) as HTMLElement;
		const second = document.querySelector(
			'[data-preview-node-id="list-second"]',
		) as HTMLElement;

		await waitFor(() => {
			expect(frame.style.paddingLeft).toBe("10px");
			expect(frame.style.paddingTop).toBe("10px");
			expect(first.style.left).toBe("70px");
			expect(first.style.top).toBe("31px");
			expect(first.style.width).toBe("60px");
			expect(first.style.height).toBe("30px");
			expect(second.style.left).toBe("80px");
			expect(second.style.top).toBe("69px");
			expect(second.style.width).toBe("40px");
			expect(second.style.height).toBe("20px");
		});
	});

	it("applies grid placement semantics in provider fallback DOM", async () => {
		layoutEngineMocks.computeDirty.mockImplementation(() => {
			throw new Error("compute failed");
		});

		render(
			<LayoutProvider debounceMs={0} viewportHeight={200} viewportWidth={300}>
				<ScreenGui>
					<Frame Id="grid-frame" Size={UDim2.fromOffset(220, 140)}>
						<UIGridLayout
							CellPadding={{
								X: { Offset: 10, Scale: 0 },
								Y: { Offset: 5, Scale: 0 },
							}}
							CellSize={{
								X: { Offset: 50, Scale: 0 },
								Y: { Offset: 20, Scale: 0 },
							}}
							FillDirection="horizontal"
							FillDirectionMaxCells={3}
							HorizontalAlignment="center"
							StartCorner="top-left"
							VerticalAlignment="center"
						/>
						<Frame Id="grid-1" Size={UDim2.fromOffset(50, 20)} />
						<Frame Id="grid-2" Size={UDim2.fromOffset(50, 20)} />
						<Frame Id="grid-3" Size={UDim2.fromOffset(50, 20)} />
						<Frame Id="grid-4" Size={UDim2.fromOffset(50, 20)} />
					</Frame>
				</ScreenGui>
			</LayoutProvider>,
		);

		const first = document.querySelector(
			'[data-preview-node-id="grid-1"]',
		) as HTMLElement;
		const fourth = document.querySelector(
			'[data-preview-node-id="grid-4"]',
		) as HTMLElement;

		await waitFor(() => {
			expect(first.style.left).toBe("25px");
			expect(first.style.top).toBe("47.5px");
			expect(fourth.style.left).toBe("25px");
			expect(fourth.style.top).toBe("72.5px");
		});
	});
	it("preserves SizeConstraint through host normalization and fallback layout math", async () => {
		let capturedNodes: LayoutNode[] = [];
		layoutEngineMocks.computeDirty.mockImplementation((nodes) => {
			capturedNodes = JSON.parse(JSON.stringify(nodes)) as LayoutNode[];
			throw new Error("compute failed");
		});

		render(
			<LayoutProvider debounceMs={0} viewportHeight={240} viewportWidth={320}>
				<ScreenGui>
					<Frame Id="size-constraint-frame" Size={UDim2.fromOffset(320, 240)}>
						<Frame
							Id="size-constraint-child"
							Position={UDim2.fromOffset(0, 0)}
							Size={UDim2.fromScale(0.25, 0.5)}
							SizeConstraint="RelativeYY"
						/>
					</Frame>
				</ScreenGui>
			</LayoutProvider>,
		);

		const child = document.querySelector(
			'[data-preview-node-id="size-constraint-child"]',
		) as HTMLElement;

		await waitFor(() => {
			expect(capturedNodes.length).toBeGreaterThan(0);
			expect(
				findNode(capturedNodes, "size-constraint-child")?.layout
					?.sizeConstraintMode,
			).toBe("RelativeYY");
			expect(child.style.width).toBe("60px");
			expect(child.style.height).toBe("120px");
		});
	});

	it("applies size, aspect, and text-size constraints in provider fallback DOM", async () => {
		layoutEngineMocks.computeDirty.mockImplementation(() => {
			throw new Error("compute failed");
		});

		render(
			<LayoutProvider debounceMs={0} viewportHeight={240} viewportWidth={320}>
				<ScreenGui>
					<Frame Id="constraint-frame" Size={UDim2.fromOffset(200, 120)}>
						<Frame Id="constrained-box" Size={UDim2.fromOffset(50, 80)}>
							<UISizeConstraint MaxSize={[160, 120]} MinSize={[100, 40]} />
							<UIAspectRatioConstraint AspectRatio={2} DominantAxis="width" />
						</Frame>
						<TextLabel
							Id="constrained-label"
							Position={UDim2.fromOffset(0, 90)}
							Size={UDim2.fromOffset(120, 20)}
							Text="Scaled text"
							TextSize={8}
						>
							<UITextSizeConstraint MaxTextSize={18} MinTextSize={16} />
						</TextLabel>
					</Frame>
				</ScreenGui>
			</LayoutProvider>,
		);

		const box = document.querySelector(
			'[data-preview-node-id="constrained-box"]',
		) as HTMLElement;
		const label = document.querySelector(
			'[data-preview-node-id="constrained-label"]',
		) as HTMLElement;

		await waitFor(() => {
			expect(box.style.width).toBe("100px");
			expect(box.style.height).toBe("50px");
			expect(label.style.fontSize).toBe("16px");
		});
	});

	it("distributes remaining list space through UIFlexItem grow ratios", async () => {
		layoutEngineMocks.computeDirty.mockImplementation(() => {
			throw new Error("compute failed");
		});

		render(
			<LayoutProvider debounceMs={0} viewportHeight={240} viewportWidth={320}>
				<ScreenGui>
					<Frame Id="flex-frame" Size={UDim2.fromOffset(120, 100)}>
						<UIListLayout FillDirection="vertical" VerticalFlex="fill" />
						<Frame Id="flex-first" Size={UDim2.fromOffset(120, 20)}>
							<UIFlexItem FlexMode="grow" GrowRatio={1} />
						</Frame>
						<Frame Id="flex-second" Size={UDim2.fromOffset(120, 20)}>
							<UIFlexItem FlexMode="grow" GrowRatio={2} />
						</Frame>
					</Frame>
				</ScreenGui>
			</LayoutProvider>,
		);

		const first = document.querySelector(
			'[data-preview-node-id="flex-first"]',
		) as HTMLElement;
		const second = document.querySelector(
			'[data-preview-node-id="flex-second"]',
		) as HTMLElement;

		await waitFor(() => {
			expect(first.style.height).toBe("40px");
			expect(second.style.top).toBe("40px");
			expect(second.style.height).toBe("60px");
		});
	});

	it("serializes layout metadata, ordering, and modifiers before calling Wasm", async () => {
		layoutEngineMocks.computeDirty.mockImplementation(
			(nodes, viewportWidth, viewportHeight) => {
				expect(viewportWidth).toBe(800);
				expect(viewportHeight).toBe(600);
				expect(findNode(nodes, "preview-node-screen")).toMatchObject({
					id: "preview-node-screen",
					kind: "root",
					nodeType: "ScreenGui",
				});
				expect(findNode(nodes, "preview-node-frame")).toMatchObject({
					hostMetadata: {
						degraded: false,
						fullSizeDefault: true,
						placeholderBehavior: "none",
					},
					id: "preview-node-frame",
					layout: {
						position: {
							x: { offset: 0, scale: 0 },
							y: { offset: 0, scale: 0 },
						},
					},
					layoutModifiers: {
						list: {
							fillDirection: "vertical",
							horizontalAlignment: "left",
							padding: { Offset: 8, Scale: 0 },
							sortOrder: "name",
							verticalAlignment: "top",
							wraps: false,
						},
						padding: {
							bottom: { Offset: 10, Scale: 0 },
							left: { Offset: 10, Scale: 0 },
							right: { Offset: 10, Scale: 0 },
							top: { Offset: 10, Scale: 0 },
						},
					},
					name: "Container",
					nodeType: "Frame",
					parentId: "preview-node-screen",
					sourceOrder: 0,
				});
				expect(findNode(nodes, "preview-node-label-alpha")).toMatchObject({
					id: "preview-node-label-alpha",
					layout: {
						position: {
							x: { offset: 0, scale: 0 },
							y: { offset: 0, scale: 0 },
						},
						size: {
							x: { offset: 120, scale: 0 },
							y: { offset: 20, scale: 0 },
						},
					},
					layoutModifiers: {
						textSizeConstraint: {
							maxTextSize: 18,
							minTextSize: 16,
						},
					},
					layoutOrder: 2,
					name: "Beta",
					nodeType: "TextLabel",
					parentId: "preview-node-frame",
					sourceOrder: 0,
				});
				expect(findNode(nodes, "preview-node-label-beta")).toMatchObject({
					id: "preview-node-label-beta",
					layout: {
						position: {
							x: { offset: 0, scale: 0 },
							y: { offset: 0, scale: 0 },
						},
						size: {
							x: { offset: 120, scale: 0 },
							y: { offset: 20, scale: 0 },
						},
					},
					layoutOrder: 1,
					name: "Alpha",
					nodeType: "TextLabel",
					parentId: "preview-node-frame",
					sourceOrder: 1,
				});
				expect(
					findNode(nodes, "preview-node-frame")?.layout?.size,
				).toBeUndefined();

				return createSessionResult(
					{
						"preview-node-screen": { height: 600, width: 800, x: 0, y: 0 },
						"preview-node-frame": { height: 600, width: 800, x: 0, y: 0 },
						"preview-node-label-alpha": {
							height: 20,
							width: 120,
							x: 10,
							y: 10,
						},
						"preview-node-label-beta": {
							height: 20,
							width: 120,
							x: 10,
							y: 38,
						},
					},
					viewportWidth,
					viewportHeight,
				);
			},
		);

		render(
			<LayoutProvider debounceMs={0} viewportHeight={600} viewportWidth={800}>
				<ScreenGui Id="preview-node-screen">
					<Frame Id="preview-node-frame" Name="Container">
						<UIPadding
							PaddingBottom={{ Offset: 10, Scale: 0 }}
							PaddingLeft={{ Offset: 10, Scale: 0 }}
							PaddingRight={{ Offset: 10, Scale: 0 }}
							PaddingTop={{ Offset: 10, Scale: 0 }}
						/>
						<UIListLayout
							FillDirection="vertical"
							Padding={{ Offset: 8, Scale: 0 }}
							SortOrder="name"
						/>
						<TextLabel
							Id="preview-node-label-alpha"
							LayoutOrder={2}
							Name="Beta"
							Size={[0, 120, 0, 20]}
							Text="Beta"
						>
							<UITextSizeConstraint MaxTextSize={18} MinTextSize={16} />
						</TextLabel>
						<TextLabel
							Id="preview-node-label-beta"
							LayoutOrder={1}
							Name="Alpha"
							Size={[0, 120, 0, 20]}
							Text="Alpha"
						/>
					</Frame>
				</ScreenGui>
			</LayoutProvider>,
		);

		const frame = document.querySelector(
			'[data-preview-node-id="preview-node-frame"]',
		) as HTMLElement;
		const firstLabel = document.querySelector(
			'[data-preview-node-id="preview-node-label-alpha"]',
		) as HTMLElement;
		const secondLabel = document.querySelector(
			'[data-preview-node-id="preview-node-label-beta"]',
		) as HTMLElement;

		await waitFor(() => {
			expect(frame.style.width).toBe("800px");
			expect(frame.style.height).toBe("600px");
			expect(firstLabel.style.left).toBe("10px");
			expect(firstLabel.style.top).toBe("10px");
			expect(firstLabel.style.width).toBe("120px");
			expect(firstLabel.style.height).toBe("20px");
			expect(secondLabel.style.left).toBe("10px");
			expect(secondLabel.style.top).toBe("38px");
			expect(secondLabel.style.width).toBe("120px");
			expect(secondLabel.style.height).toBe("20px");
		});
	});

	it("forces top-level ScreenGui nodes to fill the viewport in the Wasm tree", async () => {
		render(
			<LayoutProvider debounceMs={0} viewportHeight={480} viewportWidth={640}>
				<ScreenGui
					AnchorPoint={{ X: 1, Y: 1 }}
					Position={UDim2.fromOffset(20, 30)}
					Size={UDim2.fromOffset(40, 50)}
				>
					<Frame
						Position={UDim2.fromOffset(10, 20)}
						Size={UDim2.fromOffset(80, 32)}
					/>
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
			expect(
				nodes.filter((node) => node.parentId === rootNode?.id),
			).toHaveLength(1);
		});
	});

	it("does not call Wasm with an empty tree before delayed children register", async () => {
		const capturedNodeSets: LayoutNode[][] = [];

		layoutEngineMocks.computeDirty.mockImplementation(
			(nodes, viewportWidth, viewportHeight) => {
				capturedNodeSets.push(
					JSON.parse(JSON.stringify(nodes)) as LayoutNode[],
				);
				const tree = createMockTreeRoot(nodes);
				return createSessionResult(
					createMockLayoutResult(tree),
					viewportWidth,
					viewportHeight,
				);
			},
		);

		render(
			<LayoutProvider debounceMs={0} viewportHeight={600} viewportWidth={800}>
				<DelayedNestedTree />
			</LayoutProvider>,
		);

		await waitFor(() => {
			expect(
				document.querySelector('[data-preview-node-id="delayed-label"]'),
			).toBeTruthy();
		});

		expect(capturedNodeSets.every((nodes) => nodes.length > 0)).toBe(true);
	});

	it("waits for nested registrations to settle before calling Wasm in strict mode", async () => {
		const capturedTrees: MockTreeNode[] = [];

		layoutEngineMocks.computeDirty.mockImplementation(
			(nodes, viewportWidth, viewportHeight) => {
				const tree = createMockTreeRoot(nodes);
				capturedTrees.push(JSON.parse(JSON.stringify(tree)) as MockTreeNode);
				return createSessionResult(
					createMockLayoutResult(tree),
					viewportWidth,
					viewportHeight,
				);
			},
		);

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
			expect(
				capturedTrees[capturedTrees.length - 1]?.children?.[0]?.children?.[0]
					?.children?.[0]?.id,
			).toBe("strict-label");
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
		layoutEngineMocks.computeDirty.mockImplementation(
			(nodes, viewportWidth, viewportHeight) => {
				expect(nodes).toHaveLength(2);
				expect(findNode(nodes, "preview-node-100")?.id).toBe(
					"preview-node-100",
				);
				expect(findNode(nodes, "preview-node-200")?.parentId).toBe(
					"preview-node-100",
				);

				return createSessionResult(
					{
						"screengui:preview-node-100": {
							height: 240,
							width: 320,
							x: 0,
							y: 0,
						},
						"frame:preview-node-200": { height: 32, width: 80, x: 11, y: 22 },
					},
					viewportWidth,
					viewportHeight,
				);
			},
		);

		render(
			<LayoutProvider debounceMs={0} viewportHeight={480} viewportWidth={640}>
				<ScreenGui Id="screengui:preview-node-100">
					<Frame
						Id="frame:preview-node-200"
						ParentId="screengui:preview-node-100"
					/>
				</ScreenGui>
			</LayoutProvider>,
		);

		const screenGui = document.querySelector(
			'[data-preview-host="screengui"]',
		) as HTMLElement;
		const frame = document.querySelector(
			'[data-preview-host="frame"]',
		) as HTMLElement;

		expect(screenGui.dataset.previewNodeId).toBe("preview-node-100");
		expect(frame.dataset.previewNodeId).toBe("preview-node-200");

		await waitFor(() => {
			expect(frame.style.left).toBe("11px");
			expect(frame.style.top).toBe("22px");
			expect(frame.style.width).toBe("80px");
			expect(frame.style.height).toBe("32px");
		});
	});

	it("does not reset the layout probe store between normal provider updates", async () => {
		const snapshots: ReturnType<typeof getPreviewLayoutProbeSnapshot>[] = [];
		const unsubscribe = subscribePreviewLayoutProbe((snapshot) => {
			snapshots.push(snapshot);
		});
		const rendered = render(
			<LayoutProvider debounceMs={0} viewportHeight={240} viewportWidth={320}>
				<ScreenGui>
					<Frame Id="probe-frame" Size={UDim2.fromOffset(80, 32)} />
				</ScreenGui>
			</LayoutProvider>,
		);

		try {
			await waitFor(() => {
				expect(getPreviewLayoutProbeSnapshot()).toMatchObject({
					isReady: true,
					viewport: { height: 240, width: 320 },
					viewportReady: true,
				});
			});

			snapshots.length = 0;
			rendered.rerender(
				<LayoutProvider debounceMs={0} viewportHeight={480} viewportWidth={640}>
					<ScreenGui>
						<Frame Id="probe-frame" Size={UDim2.fromOffset(80, 32)} />
					</ScreenGui>
				</LayoutProvider>,
			);

			await waitFor(() => {
				expect(getPreviewLayoutProbeSnapshot()).toMatchObject({
					viewport: { height: 480, width: 640 },
					viewportReady: true,
				});
			});

			expect(snapshots.length).toBeGreaterThan(0);
			expect(
				snapshots.some((snapshot) => snapshot.viewportReady === false),
			).toBe(false);
		} finally {
			unsubscribe();
			rendered.unmount();
		}
	});

	it("resets the layout probe store when LayoutProvider unmounts", async () => {
		const snapshots: ReturnType<typeof getPreviewLayoutProbeSnapshot>[] = [];
		const unsubscribe = subscribePreviewLayoutProbe((snapshot) => {
			snapshots.push(snapshot);
		});
		const rendered = render(
			<LayoutProvider debounceMs={0} viewportHeight={240} viewportWidth={320}>
				<ScreenGui>
					<Frame Id="probe-unmount" Size={UDim2.fromOffset(80, 32)} />
				</ScreenGui>
			</LayoutProvider>,
		);

		try {
			await waitFor(() => {
				expect(getPreviewLayoutProbeSnapshot()).toMatchObject({
					isReady: true,
					viewport: { height: 240, width: 320 },
					viewportReady: true,
				});
			});

			snapshots.length = 0;
			rendered.unmount();

			await waitFor(() => {
				expect(getPreviewLayoutProbeSnapshot()).toMatchObject({
					error: null,
					isReady: false,
					viewport: { height: 0, width: 0 },
					viewportReady: false,
				});
			});

			expect(snapshots).toEqual([
				expect.objectContaining({
					error: null,
					isReady: false,
					viewport: { height: 0, width: 0 },
					viewportReady: false,
				}),
			]);
		} finally {
			unsubscribe();
		}
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
			blocking: true,
			code: "LAYOUT_VALIDATION_ERROR",
			codeFrame: undefined,
			details: undefined,
			entryId: "fixture:Broken.tsx",
			file: "/virtual/Broken.tsx",
			importChain: undefined,
			kind: "LayoutValidationError",
			phase: "layout",
			relativeFile: "src/Broken.tsx",
			severity: "error",
			summary: "Unexpected layout session result type: string",
			symbol: undefined,
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
		expect(snapshots[snapshots.length - 1]).toEqual(getPreviewRuntimeIssues());
	});
});

describe("preview runtime fidelity gaps", () => {
	it("excludes invisible hosts from rendering and layout registration", async () => {
		let latestNodes: LayoutNode[] = [];
		layoutEngineMocks.computeDirty.mockImplementation(
			(nodes, viewportWidth, viewportHeight) => {
				latestNodes = nodes;
				return createSessionResult({}, viewportWidth, viewportHeight);
			},
		);

		render(
			<LayoutProvider debounceMs={0} viewportHeight={240} viewportWidth={320}>
				<ScreenGui Id="visible-screen">
					<Frame Id="hidden-parent" Visible={false}>
						<TextLabel Id="hidden-child" Text="Hidden" />
					</Frame>
				</ScreenGui>
			</LayoutProvider>,
		);

		await waitFor(() => {
			expect(latestNodes.length).toBeGreaterThan(0);
		});

		expect(findNode(latestNodes, "hidden-child")).toBeUndefined();
		expect(
			document.querySelector('[data-preview-node-id="hidden-child"]'),
		).toBeNull();
	});

	it("measures automatic-size text hosts and exposes content-driven bounds", async () => {
		let latestNodes: LayoutNode[] = [];
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

		layoutEngineMocks.computeDirty.mockImplementation(
			(nodes, viewportWidth, viewportHeight) => {
				latestNodes = nodes;
				return createSessionResult(
					{
						"auto-screen": {
							height: viewportHeight,
							width: viewportWidth,
							x: 0,
							y: 0,
						},
						"auto-label": { height: 24, width: 90, x: 0, y: 0 },
					},
					viewportWidth,
					viewportHeight,
				);
			},
		);

		try {
			render(
				<LayoutProvider debounceMs={0} viewportHeight={240} viewportWidth={320}>
					<ScreenGui Id="auto-screen">
						<TextLabel
							AutomaticSize="xy"
							Id="auto-label"
							Size={UDim2.fromOffset(90, 24)}
							Text="Automatic size"
						/>
					</ScreenGui>
				</LayoutProvider>,
			);

			const label = document.querySelector(
				'[data-preview-node-id="auto-label"]',
			) as HTMLElement;

			await waitFor(() => {
				expect(label.style.width).toBe("auto");
				expect(label.style.height).toBe("auto");
				expect(findNode(latestNodes, "auto-label")?.intrinsicSize).toEqual({
					height: 24,
					width: 88,
				});
			});
		} finally {
			getBoundingClientRectSpy.mockRestore();
		}
	});

	it("tracks GuiService.SelectedObject from preview pointer interactions", async () => {
		const guiService = game.GetService("GuiService") as {
			SelectedObject:
				| {
						ClassName: string;
						IsDescendantOf(ancestor: unknown): boolean;
						Name: string;
						Parent: { ClassName: string } | undefined;
				  }
				| undefined;
		};

		render(<TextButton Size={UDim2.fromOffset(120, 40)} Text="Select me" />);

		const button = document.querySelector(
			'[data-preview-host="textbutton"]',
		) as HTMLElement;
		const text = button.querySelector(".preview-host-text") as HTMLElement;

		guiService.SelectedObject = null as unknown as never;
		expect(guiService.SelectedObject).toBeUndefined();

		guiService.SelectedObject = button;
		expect(guiService.SelectedObject).toMatchObject({
			ClassName: "TextButton",
		});
		expect(guiService.SelectedObject?.IsA("GuiObject")).toBe(true);
		expect(guiService.SelectedObject?.IsDescendantOf(document.body)).toBe(true);
		expect(guiService.SelectedObject?.IsDescendantOf(button)).toBe(true);

		fireEvent.mouseDown(text);

		await waitFor(() =>
			expect(guiService.SelectedObject).toMatchObject({
				ClassName: "TextButton",
			}),
		);
		expect(guiService.SelectedObject?.IsDescendantOf(document.body)).toBe(true);
	});

	it("bridges forwarded host refs into Roblox-like gui objects", async () => {
		const ref = React.createRef<
			HTMLElement & {
				FindFirstAncestorOfClass(className: string): unknown;
				FindFirstAncestorWhichIsA(className: string): unknown;
				GetChildren(): unknown[];
				GetDescendants(): unknown[];
				IsA(name: string): boolean;
				IsDescendantOf(ancestor: unknown): boolean;
				Parent: { ClassName: string } | undefined;
			}
		>();

		render(
			<TextButton
				ref={ref}
				Size={UDim2.fromOffset(120, 40)}
				Text="Ref bridge"
			/>,
		);

		await waitFor(() => {
			expect(ref.current).toBeDefined();
		});

		expect(ref.current).toMatchObject({
			className: "preview-host preview-textbutton",
		});
		expect(ref.current?.Parent).toMatchObject({
			ClassName: "ScreenGui",
		});
		expect(ref.current?.IsA("GuiObject")).toBe(true);
		expect(ref.current?.IsA("GuiButton")).toBe(true);
		expect(ref.current?.IsDescendantOf(ref.current?.Parent)).toBe(true);
		expect(ref.current?.FindFirstAncestorOfClass("ScreenGui")).toMatchObject({
			ClassName: "ScreenGui",
		});
		expect(
			ref.current?.FindFirstAncestorWhichIsA("LayerCollector"),
		).toMatchObject({
			ClassName: "ScreenGui",
		});
	});

	it("bridges host subtree traversal through wrappers for focus scopes", async () => {
		const ref = React.createRef<BridgedHostHandle>();

		render(
			<ScreenGui ref={ref}>
				<FocusScope active trapped>
					<Frame Name="outer-frame">
						<TextButton Name="inner-button" />
					</Frame>
				</FocusScope>
			</ScreenGui>,
		);

		await waitFor(() => {
			expect(ref.current).toBeDefined();
		});

		const root = ref.current;
		expect(root).toBeDefined();

		const rootChildren = root ? root.GetChildren() : [];
		const rootDescendants = root ? root.GetDescendants() : [];

		expect(rootChildren).toHaveLength(1);
		expect(rootDescendants).toHaveLength(2);
		expect(rootChildren[0]).toMatchObject({
			ClassName: "Frame",
			Name: "outer-frame",
		});
		expect(rootDescendants[0]).toMatchObject({
			ClassName: "Frame",
			Name: "outer-frame",
		});
		expect(rootDescendants[1]).toMatchObject({
			ClassName: "TextButton",
			Name: "inner-button",
		});
		expect(rootChildren[0]?.IsA("GuiObject")).toBe(true);
		expect(rootChildren[0]?.IsDescendantOf(root)).toBe(true);
		expect(rootChildren[0]?.Parent).toMatchObject({
			ClassName: "ScreenGui",
		});

		const outerFrame = rootChildren[0];
		const outerChildren = outerFrame ? outerFrame.GetChildren() : [];
		const outerDescendants = outerFrame ? outerFrame.GetDescendants() : [];

		expect(outerChildren).toHaveLength(1);
		expect(outerDescendants).toHaveLength(1);
		expect(outerChildren[0]).toMatchObject({
			ClassName: "TextButton",
			Name: "inner-button",
		});
		expect(outerChildren[0]?.IsA("GuiButton")).toBe(true);
		expect(outerChildren[0]?.IsDescendantOf(root)).toBe(true);
		expect(outerChildren[0]?.Parent).toMatchObject({
			ClassName: "ScreenGui",
		});
	});
});
