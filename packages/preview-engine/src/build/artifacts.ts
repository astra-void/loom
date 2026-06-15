import fs from "node:fs";
import path from "node:path";
import type { PreviewBuiltArtifact, PreviewEntryPayload } from "../types";
import type { PreviewLayoutSchemaSidecar } from "./cache";
import { normalizeRelativePath } from "./fsUtils";

export function createPreviewLayoutSchema(
	payload: PreviewEntryPayload,
): PreviewLayoutSchemaSidecar {
	return {
		descriptor: payload.descriptor,
		diagnosticsSummary: payload.descriptor.diagnosticsSummary,
		entryId: payload.descriptor.id,
		graphTrace: payload.graphTrace,
		runtimeAdapter: payload.runtimeAdapter,
		supportsLayoutDebug: payload.descriptor.capabilities.supportsLayoutDebug,
		transform: payload.transform,
	};
}

export function getMetadataMaterializedRelativePath(
	kind: "entry-metadata" | "layout-schema",
	relativePath: string,
) {
	const suffix =
		kind === "entry-metadata" ? ".preview-entry.json" : ".preview-layout.json";
	const namespace =
		kind === "entry-metadata" ? "entry-metadata" : "layout-schema";
	return normalizeRelativePath(
		path.posix.join(".preview-engine", namespace, `${relativePath}${suffix}`),
	);
}

export function createMaterializedFilePath(
	outDir: string,
	relativePath: string,
) {
	const normalizedRelativePath = normalizeRelativePath(relativePath);
	if (
		normalizedRelativePath.startsWith("../") ||
		path.isAbsolute(normalizedRelativePath)
	) {
		throw new Error(
			`Preview materialization path escaped the output directory: ${relativePath}`,
		);
	}

	return path.join(outDir, normalizedRelativePath);
}

export function removeEmptyParentDirectories(
	rootDir: string,
	filePath: string,
) {
	let currentDir = path.dirname(filePath);
	while (currentDir.startsWith(rootDir) && currentDir !== rootDir) {
		const entries = fs.existsSync(currentDir) ? fs.readdirSync(currentDir) : [];
		if (entries.length > 0) {
			return;
		}

		fs.rmdirSync(currentDir);
		currentDir = path.dirname(currentDir);
	}
}

export async function runWithConcurrency<T>(
	limit: number,
	values: T[],
	worker: (value: T) => Promise<void>,
) {
	const concurrency = Math.max(1, limit);
	const iterator = values.values();

	async function runNext(): Promise<void> {
		const nextValue = iterator.next();
		if (nextValue.done) {
			return;
		}

		await worker(nextValue.value);
		await runNext();
	}

	await Promise.all(
		Array.from({ length: Math.min(concurrency, values.length) }, () =>
			runNext(),
		),
	);
}

export function sortBuiltArtifacts(artifacts: PreviewBuiltArtifact[]) {
	return [...artifacts].sort((left, right) => {
		if (left.kind !== right.kind) {
			return left.kind.localeCompare(right.kind);
		}

		if (left.targetName !== right.targetName) {
			return left.targetName.localeCompare(right.targetName);
		}

		return left.relativePath.localeCompare(right.relativePath);
	});
}
