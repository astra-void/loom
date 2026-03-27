import path from "node:path";
import type { PreviewGraphImportEdge, PreviewGraphTrace } from "./types";

type PreviewGraphWasmModule = {
	createPreviewGraphSession: () => PreviewGraphSessionLike;
};

export type PreviewGraphRecordSnapshot = {
	filePath: string;
	graphEdges: PreviewGraphImportEdge[];
	imports: string[];
	ownerPackageName?: string;
	ownerPackageRoot: string;
	projectConfigPath?: string;
};

type PreviewGraphSessionLike = {
	collectGraphTrace(
		entryFilePath: string,
		selectionTrace: PreviewGraphTrace["selection"],
	): PreviewGraphTrace;
	collectTransitiveDependencyPaths(entryFilePath: string): string[];
	dispose(): void;
	replaceRecords(records: PreviewGraphRecordSnapshot[]): void;
};

let previewGraphWasmModule: PreviewGraphWasmModule | undefined;
let previewGraphWasmInitialized = false;

function resolvePreviewGraphModulePath() {
	const candidatePaths = [
		"@loom-dev/preview-graph",
		path.resolve(__dirname, "../../preview-graph/pkg/preview_graph.js"),
	];

	for (const candidatePath of candidatePaths) {
		try {
			return require.resolve(candidatePath);
		} catch {
			// Try the next candidate.
		}
	}

	throw new Error("Unable to resolve @loom-dev/preview-graph.");
}

function getPreviewGraphWasmModule() {
	if (!previewGraphWasmModule) {
		previewGraphWasmModule = require(
			resolvePreviewGraphModulePath(),
		) as PreviewGraphWasmModule;
	}

	return previewGraphWasmModule;
}

function initializePreviewGraphWasm() {
	if (previewGraphWasmInitialized) {
		return;
	}

	getPreviewGraphWasmModule();
	previewGraphWasmInitialized = true;
}

function withPreviewGraphSession<T>(
	records: PreviewGraphRecordSnapshot[],
	callback: (session: PreviewGraphSessionLike) => T,
) {
	initializePreviewGraphWasm();
	const session = getPreviewGraphWasmModule().createPreviewGraphSession();

	try {
		session.replaceRecords(records);
		return callback(session);
	} finally {
		session.dispose();
	}
}

export function collectGraphTraceWithPreviewGraph(
	records: PreviewGraphRecordSnapshot[],
	entryFilePath: string,
	selectionTrace: PreviewGraphTrace["selection"],
) {
	return withPreviewGraphSession(records, (session) => {
		const trace = session.collectGraphTrace(entryFilePath, selectionTrace);
		return {
			...trace,
			selection: selectionTrace,
		};
	});
}

export function collectTransitiveDependencyPathsWithPreviewGraph(
	records: PreviewGraphRecordSnapshot[],
	entryFilePath: string,
) {
	return withPreviewGraphSession(records, (session) =>
		session.collectTransitiveDependencyPaths(entryFilePath),
	);
}
