import type { PreviewSourceTarget } from "@loom-dev/preview-engine";
import { type TsconfigParseCache } from "./tsconfigUtils";
type Plugin = import("vite").Plugin;
export type CreateAutoMockPropsPluginOptions = {
    targets: PreviewSourceTarget[];
    tsconfigParseCache?: TsconfigParseCache;
};
export declare function createAutoMockPropsPlugin(options: CreateAutoMockPropsPluginOptions): Plugin;
export {};
