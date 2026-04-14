export interface RBXScriptConnection {
    readonly Connected: boolean;
    Disconnect(): void;
}
export interface RBXScriptSignal<TArgs extends readonly unknown[] = readonly unknown[]> {
    Connect(listener: (...args: TArgs) => void): RBXScriptConnection;
}
export interface PreviewRunService {
    readonly RenderStepped: RBXScriptSignal<[deltaTime: number]>;
    readonly Heartbeat: RBXScriptSignal<[deltaTime: number]>;
    readonly Stepped: RBXScriptSignal<[time: number, deltaTime: number]>;
    IsClient(): true;
    IsServer(): false;
}
export declare const RunService: PreviewRunService;
export default RunService;
