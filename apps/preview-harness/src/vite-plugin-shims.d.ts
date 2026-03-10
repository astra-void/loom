declare module "@vitejs/plugin-react" {
  import type { PluginOption } from "vite";

  export interface ReactPluginOptions {
    babel?: unknown;
    include?: unknown;
    exclude?: unknown;
    jsxImportSource?: string;
    jsxRuntime?: "classic" | "automatic";
    fastRefresh?: boolean;
  }

  export default function react(options?: ReactPluginOptions): PluginOption;
}

declare module "vite-plugin-top-level-await" {
  import type { PluginOption } from "vite";

  export interface TopLevelAwaitOptions {
    promiseExportName?: string;
    promiseImportName?: (index: number) => string;
  }

  export default function topLevelAwait(options?: TopLevelAwaitOptions): PluginOption;
}

declare module "vite-plugin-wasm" {
  import type { PluginOption } from "vite";

  export default function wasm(): PluginOption;
}
