import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageRoot = path.resolve(__dirname, "..");
const sourceShellRoot = path.join(packageRoot, "src/shell");
const distShellRoot = path.join(packageRoot, "dist/shell");

const sourceShellIndexHtml = path.join(sourceShellRoot, "index.html");
const sourceShellStyles = path.join(sourceShellRoot, "styles.css");
const distShellIndexHtml = path.join(distShellRoot, "index.html");
const distShellStyles = path.join(distShellRoot, "styles.css");
const distShellEntry = path.join(distShellRoot, "main.js");
const distPreviewEntry = path.join(packageRoot, "dist/index.mjs");
const previewRuntimeSourceEntry = path.resolve(packageRoot, "../preview-runtime/src/index.ts");

if (!fs.existsSync(sourceShellIndexHtml)) {
  throw new Error(`Missing preview shell index: ${sourceShellIndexHtml}`);
}

if (!fs.existsSync(sourceShellStyles)) {
  throw new Error(`Missing preview shell stylesheet: ${sourceShellStyles}`);
}

fs.mkdirSync(distShellRoot, { recursive: true });

await build({
  alias: {
    "@lattice-ui/preview-runtime": previewRuntimeSourceEntry,
  },
  assetNames: "assets/[name]-[hash]",
  bundle: true,
  entryPoints: [path.join(sourceShellRoot, "main.tsx")],
  external: [
    "react",
    "react-dom",
    "react-dom/client",
    "virtual:lattice-preview-registry",
    "virtual:lattice-preview-workspace-index",
  ],
  format: "esm",
  jsx: "automatic",
  loader: {
    ".wasm": "file",
  },
  outfile: distShellEntry,
  platform: "browser",
  sourcemap: false,
  target: "es2021",
});

fs.copyFileSync(sourceShellStyles, distShellStyles);
fs.writeFileSync(
  distShellIndexHtml,
  fs.readFileSync(sourceShellIndexHtml, "utf8").replace("./main.tsx", "./main.js"),
  "utf8",
);
fs.writeFileSync(distPreviewEntry, ['export * from "./index.js";', ""].join("\n"), "utf8");
