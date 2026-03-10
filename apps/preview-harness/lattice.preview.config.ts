import path from "node:path";
import { fileURLToPath } from "node:url";
import { createStaticTargetsDiscovery, definePreviewConfig } from "../../packages/preview/src/config";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workspaceRoot = path.resolve(__dirname, "../..");

export default definePreviewConfig({
  projectName: "Lattice Preview",
  server: {
    port: 4174,
  },
  targetDiscovery: createStaticTargetsDiscovery([
    {
      name: "checkbox",
      packageName: "@lattice-ui/checkbox",
      packageRoot: path.resolve(workspaceRoot, "packages/checkbox"),
      sourceRoot: path.resolve(workspaceRoot, "packages/checkbox/src"),
    },
    {
      name: "switch",
      packageName: "@lattice-ui/switch",
      packageRoot: path.resolve(workspaceRoot, "packages/switch"),
      sourceRoot: path.resolve(workspaceRoot, "packages/switch/src"),
    },
    {
      name: "dialog",
      packageName: "@lattice-ui/dialog",
      packageRoot: path.resolve(workspaceRoot, "packages/dialog"),
      sourceRoot: path.resolve(workspaceRoot, "packages/dialog/src"),
    },
  ]),
  workspaceRoot,
});
