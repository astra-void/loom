declare module "@vitejs/plugin-react" {
  import type { PluginOption } from "vite";

  export default function reactPlugin(options?: unknown): PluginOption | PluginOption[];
}

declare module "vite-plugin-top-level-await" {
  import type { PluginOption } from "vite";

  export default function topLevelAwait(options?: unknown): PluginOption;
}

declare module "vite-plugin-wasm" {
  import type { PluginOption } from "vite";

  export default function wasm(options?: unknown): PluginOption;
}

declare module "*.wasm?url" {
  const url: string;
  export default url;
}
