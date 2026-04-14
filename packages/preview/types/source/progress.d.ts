export type PreviewProgressWriter = {
    write(chunk: string): unknown;
    isTTY?: boolean;
    getColorDepth?: () => number;
};
export type PreviewProgressScope = "client" | "server";
export type PreviewProgressWriteOptions = {
    scope?: PreviewProgressScope;
};
export declare function writePreviewProgress(writer: PreviewProgressWriter | undefined, message: string, options?: PreviewProgressWriteOptions): void;
export declare function writePreviewTiming(writer: PreviewProgressWriter | undefined, label: string, startedAt: number, options?: PreviewProgressWriteOptions): void;
