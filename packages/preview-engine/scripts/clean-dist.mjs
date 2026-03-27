import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageRoot = path.resolve(__dirname, "..");
const distDir = path.join(packageRoot, "dist");
const sourceRoot = path.join(packageRoot, "src");

function removeGeneratedJavaScriptFiles(directory) {
	for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
		const entryPath = path.join(directory, entry.name);
		if (entry.isDirectory()) {
			removeGeneratedJavaScriptFiles(entryPath);
			continue;
		}

		if (entry.isFile() && entry.name.endsWith(".js")) {
			fs.rmSync(entryPath, { force: true });
		}
	}
}

if (fs.existsSync(distDir)) {
	fs.rmSync(distDir, { force: true, recursive: true });
}
removeGeneratedJavaScriptFiles(sourceRoot);
