import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

function isMusl() {
	if (process.platform !== "linux") {
		return false;
	}

	return !process.report?.getReport()?.header?.glibcVersionRuntime;
}

export function getNativeTarget() {
	if (process.platform === "darwin") {
		if (process.arch === "x64") {
			return "x86_64-apple-darwin";
		}

		if (process.arch === "arm64") {
			return "aarch64-apple-darwin";
		}
	}

	if (process.platform === "linux") {
		const suffix = isMusl() ? "musl" : "gnu";

		if (process.arch === "x64") {
			return `x86_64-unknown-linux-${suffix}`;
		}

		if (process.arch === "arm64") {
			return `aarch64-unknown-linux-${suffix}`;
		}
	}

	if (process.platform === "win32") {
		if (process.arch === "x64") {
			return "x86_64-pc-windows-msvc";
		}

		if (process.arch === "arm64") {
			return "aarch64-pc-windows-msvc";
		}
	}

	throw new Error(
		`Unsupported native target for ${process.platform}-${process.arch}.`,
	);
}

if (
	process.argv[1] &&
	resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	console.log(getNativeTarget());
}
