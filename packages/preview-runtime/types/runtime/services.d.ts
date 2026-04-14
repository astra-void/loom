import { type MockInstanceLike } from "./mockInstance";
import { type RBXScriptSignal } from "./RunService";
export interface PreviewGame {
	readonly ClassName: "DataModel";
	readonly Name: "game";
	readonly Workspace: PreviewWorkspace;
	FindService(name: string): unknown;
	GetFullName(): string;
	GetService(name: string): unknown;
	IsA(name: string): boolean;
}
export interface PreviewWorkspace {
	readonly ClassName: "Workspace";
	readonly Name: "Workspace";
	GetFullName(): string;
	IsA(name: string): boolean;
}
export interface PreviewPlayer {
	readonly ClassName: "Player";
	readonly DisplayName: "LocalPlayer";
	readonly Name: "LocalPlayer";
	readonly PlayerGui: PreviewPlayerGui;
	readonly UserId: 0;
	FindFirstChild(name: string): PreviewPlayerGui | undefined;
	GetFullName(): string;
	IsA(name: string): boolean;
	WaitForChild(name: string): PreviewPlayerGui;
}
export type PreviewGuiHitObject = {
	readonly ClassName: string;
	readonly Name: string;
	readonly Parent: MockInstanceLike | undefined;
	FindFirstAncestorOfClass(className: string): MockInstanceLike | undefined;
	FindFirstAncestorWhichIsA(className: string): MockInstanceLike | undefined;
	GetFullName(): string;
	IsA(name: string): boolean;
	IsDescendantOf(ancestor: unknown): boolean;
};
export type PreviewPlayerGui = {
	ClassName: "PlayerGui";
	FindFirstChild(name: string): PreviewPlayerGui | undefined;
	GetFullName(): string;
	GetGuiObjectsAtPosition(x: number, y: number): PreviewGuiHitObject[];
	IsA(name: string): boolean;
	IsDescendantOf(ancestor: unknown): boolean;
	Name: "PlayerGui";
	Parent: MockInstanceLike | undefined;
	WaitForChild(name: string): PreviewPlayerGui;
};
export interface PreviewPlayersService {
	readonly ClassName: "Players";
	readonly LocalPlayer: PreviewPlayer;
	readonly Name: "Players";
	readonly PlayerAdded: RBXScriptSignal<[player: PreviewPlayer]>;
	readonly PlayerRemoving: RBXScriptSignal<[player: PreviewPlayer]>;
	FindFirstChild(name: string): PreviewPlayer | undefined;
	GetFullName(): string;
	GetPlayers(): PreviewPlayer[];
	IsA(name: string): boolean;
}
export interface PreviewUserInputService {
	readonly ClassName: "UserInputService";
	readonly GamepadEnabled: false;
	readonly InputBegan: RBXScriptSignal<[event: Event]>;
	readonly InputChanged: RBXScriptSignal<[event: Event]>;
	readonly InputEnded: RBXScriptSignal<[event: Event]>;
	readonly KeyboardEnabled: true;
	readonly LastInputTypeChanged: RBXScriptSignal<[lastInputType: string]>;
	readonly MouseEnabled: true;
	readonly MouseIconEnabled: true;
	readonly Name: "UserInputService";
	readonly TextBoxFocusReleased: RBXScriptSignal<
		[element: HTMLElement | undefined]
	>;
	readonly TextBoxFocused: RBXScriptSignal<[element: HTMLElement | undefined]>;
	readonly TouchEnabled: false;
	readonly VREnabled: false;
	GetFocusedTextBox(): HTMLElement | undefined;
	GetFullName(): string;
	GetLastInputType(): string;
	IsA(name: string): boolean;
}
export interface PreviewGuiService {
	readonly ClassName: "GuiService";
	SelectedObject: PreviewGuiHitObject | undefined;
	readonly Name: "GuiService";
	GetFullName(): string;
	GetGuiInset(): readonly [
		{
			X: 0;
			Y: 0;
		},
		{
			X: 0;
			Y: 0;
		},
	];
	IsA(name: string): boolean;
	IsTenFootInterface(): false;
}
export interface PreviewTween {
	readonly Completed: RBXScriptSignal<[playbackState: unknown]>;
	readonly Instance: unknown;
	readonly PlaybackState: unknown;
	readonly TweenInfo: TweenInfo;
	Cancel(): void;
	Destroy(): void;
	Pause(): void;
	Play(): void;
}
export interface PreviewTweenService {
	readonly ClassName: "TweenService";
	readonly Name: "TweenService";
	Create(
		instance: unknown,
		tweenInfo: TweenInfo,
		goal: Record<string, unknown>,
	): PreviewTween;
	GetFullName(): string;
	IsA(name: string): boolean;
}
export declare function resetPreviewRuntimeServiceState(): void;
export declare class TweenInfo {
	readonly DelayTime: number;
	readonly EasingDirection: unknown;
	readonly EasingStyle: unknown;
	readonly RepeatCount: number;
	readonly Reverses: boolean;
	readonly Time: number;
	constructor(
		time?: number,
		easingStyle?: unknown,
		easingDirection?: unknown,
		repeatCount?: number,
		reverses?: boolean,
		delayTime?: number,
	);
}
export declare function getGame(): PreviewGame;
export declare function getWorkspace(): PreviewWorkspace;
export declare function getTweenInfoConstructor(): typeof TweenInfo;
export declare const game: PreviewGame;
export declare const workspace: PreviewWorkspace;
