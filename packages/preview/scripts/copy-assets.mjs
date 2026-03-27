import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageRoot = path.resolve(__dirname, "..");
const previewRuntimeSourceEntry = path.resolve(
	packageRoot,
	"../preview-runtime/src/index.ts",
);

export function copyDirectoryContents(sourceDir, destinationDir) {
	fs.mkdirSync(destinationDir, { recursive: true });

	for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
		const sourcePath = path.join(sourceDir, entry.name);
		const destinationPath = path.join(destinationDir, entry.name);

		if (entry.isDirectory()) {
			copyDirectoryContents(sourcePath, destinationPath);
			continue;
		}

		if (entry.isFile()) {
			fs.copyFileSync(sourcePath, destinationPath);
		}
	}
}

export function copyPreviewAssets(options = {}) {
	const currentPackageRoot = options.packageRoot ?? packageRoot;
	const sourceShellRootPath = path.join(currentPackageRoot, "src/shell");
	const sourceReactShimsRootPath = path.join(
		currentPackageRoot,
		"src/source/react-shims",
	);
	const distShellRootPath = path.join(currentPackageRoot, "dist/shell");
	const distReactShimsRootPath = path.join(
		currentPackageRoot,
		"dist/source/react-shims",
	);
	const sourceShellIndexHtmlPath = path.join(sourceShellRootPath, "index.html");
	const sourceShellStylesPath = path.join(sourceShellRootPath, "styles.css");
	const distShellIndexHtmlPath = path.join(distShellRootPath, "index.html");
	const distShellStylesPath = path.join(distShellRootPath, "styles.css");
	const distShellEntryPath = path.join(distShellRootPath, "main.js");
	const distPreviewEntryPath = path.join(currentPackageRoot, "dist/index.mjs");

	if (!fs.existsSync(sourceShellIndexHtmlPath)) {
		throw new Error(`Missing preview shell index: ${sourceShellIndexHtmlPath}`);
	}

	if (!fs.existsSync(sourceShellStylesPath)) {
		throw new Error(
			`Missing preview shell stylesheet: ${sourceShellStylesPath}`,
		);
	}

	fs.mkdirSync(distShellRootPath, { recursive: true });
	fs.mkdirSync(distReactShimsRootPath, { recursive: true });

	return build({
		alias: {
			"@loom-dev/preview-runtime": previewRuntimeSourceEntry,
		},
		assetNames: "assets/[name]-[hash]",
		bundle: true,
		entryPoints: [path.join(sourceShellRootPath, "main.tsx")],
		external: [
			"react",
			"react-dom",
			"react-dom/client",
			"virtual:loom-preview-registry",
			"virtual:loom-preview-workspace-index",
		],
		format: "esm",
		jsx: "automatic",
		loader: {
			".wasm": "file",
		},
		outfile: distShellEntryPath,
		platform: "browser",
		sourcemap: false,
		target: "es2021",
	}).then(() => {
		fs.copyFileSync(sourceShellStylesPath, distShellStylesPath);
		fs.writeFileSync(
			distShellIndexHtmlPath,
			fs
				.readFileSync(sourceShellIndexHtmlPath, "utf8")
				.replace("./main.tsx", "./main.js"),
			"utf8",
		);
		fs.writeFileSync(
			distPreviewEntryPath,
			['export * from "./index.js";', ""].join("\n"),
			"utf8",
		);

		copyDirectoryContents(sourceReactShimsRootPath, distReactShimsRootPath);
	});
}

if (
	process.argv[1] &&
	path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	await copyPreviewAssets();
}
