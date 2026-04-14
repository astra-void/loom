import type { HostName } from "./types";
export declare function markPreviewHostComponent<T extends object>(component: T, host: HostName): T;
export declare function getPreviewHostComponentHost(type: unknown): HostName | undefined;
