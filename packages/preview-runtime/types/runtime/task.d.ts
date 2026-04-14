export type TaskCallback<TArgs extends readonly unknown[] = readonly unknown[]> = (...args: TArgs) => void;
export type TaskHandle = ReturnType<typeof globalThis.setTimeout>;
export declare function wait(seconds?: number): Promise<number>;
export declare function delay<TArgs extends readonly unknown[]>(seconds: number, callback: TaskCallback<TArgs>, ...args: TArgs): number;
export declare function spawn<TArgs extends readonly unknown[], TResult>(callback: (...args: TArgs) => TResult, ...args: TArgs): TResult | undefined;
export declare function defer<TArgs extends readonly unknown[]>(callback: TaskCallback<TArgs>, ...args: TArgs): void;
export declare function cancel(handle: unknown): void;
export interface TaskLibrary {
    readonly cancel: typeof cancel;
    readonly wait: typeof wait;
    readonly delay: typeof delay;
    readonly spawn: typeof spawn;
    readonly defer: typeof defer;
}
export declare const task: TaskLibrary;
export default task;
