export interface FrameState {
    readonly now: number;
    readonly deltaTime: number;
    readonly elapsedTime: number;
}
export type FrameSubscriber = (frameState: FrameState) => void;
export declare function subscribeToFrames(subscriber: FrameSubscriber): () => void;
