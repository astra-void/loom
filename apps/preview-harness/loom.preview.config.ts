import path from "node:path";
import { fileURLToPath } from "node:url";
import { createStaticTargetsDiscovery, definePreviewConfig } from "../../packages/preview/src/config";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workspaceRoot = path.resolve(__dirname, "../..");

export default definePreviewConfig({
  projectName: "Loom Preview",
  server: {
    port: 4174,
  },
  transformMode: "compatibility",
  targetDiscovery: createStaticTargetsDiscovery([
    {
      include: ["preview-targets/**/*.tsx"],
      name: "preview-shell",
      packageName: "@loom-dev/preview",
      packageRoot: path.resolve(workspaceRoot, "packages/preview"),
      sourceRoot: path.resolve(workspaceRoot, "packages/preview/src/shell"),
    },
    {
      include: ["preview-targets/**/*.tsx"],
      name: "runtime-hosts",
      packageName: "@loom-dev/preview-runtime",
      packageRoot: path.resolve(workspaceRoot, "packages/preview-runtime"),
      sourceRoot: path.resolve(workspaceRoot, "packages/preview-runtime/src/hosts"),
    },
    {
      name: "runtime-preview",
      packageName: "@loom-dev/preview-runtime",
      packageRoot: path.resolve(workspaceRoot, "packages/preview-runtime"),
      sourceRoot: path.resolve(workspaceRoot, "packages/preview-runtime/src/preview"),
    },
  ]),
  workspaceRoot,
});
