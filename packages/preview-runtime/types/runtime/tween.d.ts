export type PreviewTweenInfoLike = {
	readonly DelayTime: number;
	readonly EasingDirection: unknown;
	readonly EasingStyle: unknown;
	readonly RepeatCount: number;
	readonly Reverses: boolean;
	readonly Time: number;
};
export type PreviewTweenPlaybackStates = {
	readonly Begin: unknown;
	readonly Cancelled: unknown;
	readonly Completed: unknown;
	readonly Delayed: unknown;
	readonly Paused: unknown;
	readonly Playing: unknown;
};
export type PreviewTweenController = {
	readonly playbackState: unknown;
	cancel(): void;
	destroy(): void;
	pause(): void;
	play(): void;
};
type PreviewTweenControllerOptions = {
	goal: Record<string, unknown>;
	instance: unknown;
	onCompleted(playbackState: unknown): void;
	playbackStates: PreviewTweenPlaybackStates;
	tweenInfo: PreviewTweenInfoLike;
};
export declare function createPreviewTweenController(
	options: PreviewTweenControllerOptions,
): PreviewTweenController;
export declare function destroyTweensForTarget(target: unknown): void;
