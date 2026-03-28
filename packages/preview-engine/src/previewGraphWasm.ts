import type {
	PreviewDiagnostic,
	PreviewEntryDescriptor,
	PreviewGraphImportEdge,
	PreviewGraphTrace,
	PreviewWorkspaceIndex,
} from "./types";

type PreviewGraphWasmModule = {
	createPreviewGraphSession: () => PreviewGraphSessionLike;
	createWorkspaceDiscoverySession: (
		projectName: string,
		protocolVersion: number,
		resolveImport: (
			importerFilePath: string,
			specifier: string,
		) => WorkspaceImportResolution | undefined,
	) => WorkspaceDiscoverySessionLike;
};

export type PreviewGraphRecordSnapshot = {
	filePath: string;
	graphEdges: PreviewGraphImportEdge[];
	imports: string[];
	ownerPackageName?: string;
	ownerPackageRoot: string;
	projectConfigPath?: string;
};

export type PreviewSourceTargetSnapshot = {
	exclude?: string[];
	include?: string[];
	name: string;
	packageName?: string;
	packageRoot: string;
	sourceRoot: string;
};

export type WorkspaceFileSnapshot = {
	isEntryCandidate?: boolean;
	filePath: string;
	ownerPackageName?: string;
	ownerPackageRoot: string;
	projectConfigPath?: string;
	relativePath: string;
	sourceText: string;
	target: PreviewSourceTargetSnapshot;
};

export type WorkspaceResolutionDiagnostic = {
	code: string;
	file: string;
	importChain?: string[];
	packageRoot: string;
	phase: string;
	severity: string;
	summary: string;
	target: string;
};

export type WorkspaceImportResolution = {
	diagnostic?: WorkspaceResolutionDiagnostic;
	edge: PreviewGraphImportEdge;
	followedFilePath?: string;
};

export type WorkspaceDiscoveryEntryState = {
	dependencyPaths: string[];
	descriptor: PreviewEntryDescriptor;
	discoveryDiagnostics: PreviewDiagnostic[];
	graphTrace: PreviewGraphTrace;
	packageRoot: string;
	previewHasProps: boolean;
	target: PreviewSourceTargetSnapshot;
};

export type WorkspaceDiscoverySnapshot = {
	entries: WorkspaceDiscoveryEntryState[];
	workspaceIndex: PreviewWorkspaceIndex;
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

type WorkspaceDiscoverySessionLike = {
	buildWorkspaceDiscovery(): WorkspaceDiscoverySnapshot;
	dispose(): void;
	replaceRecords(records: WorkspaceFileSnapshot[]): void;
};

let previewGraphWasmModule: PreviewGraphWasmModule | undefined;
let previewGraphWasmInitialized = false;
let previewGraphWasmSessionLogged = false;
let previewGraphWorkspaceDiscoverySessionLogged = false;

function getPreviewAnalysisErrorMessage(
	error: unknown,
	fallbackMessage: string,
) {
	if (typeof error === "string" && error.trim().length > 0) {
		return error;
	}

	if (
		error &&
		typeof error === "object" &&
		"message" in error &&
		typeof (error as { message?: unknown }).message === "string"
	) {
		const message = (error as { message: string }).message.trim();
		if (message.length > 0) {
			return message;
		}
	}

	if (error != null) {
		try {
			const serialized = JSON.stringify(error);
			if (serialized && serialized !== "{}") {
				return `${fallbackMessage}: ${serialized}`;
			}
		} catch {
			// Fall through to String(error).
		}

		const detail = String(error).trim();
		if (detail.length > 0 && detail !== "[object Object]") {
			return `${fallbackMessage}: ${detail}`;
		}
	}

	return fallbackMessage;
}

export function normalizePreviewAnalysisError(
	error: unknown,
	fallbackMessage: string,
) {
	if (error instanceof Error) {
		return error;
	}

	const normalizedError: Error & { cause?: unknown } = new Error(
		getPreviewAnalysisErrorMessage(error, fallbackMessage),
	);
	normalizedError.cause = error;
	return normalizedError;
}

function normalizePreviewAnalysisValue<T>(value: T): T {
	if (value instanceof Map) {
		const normalized: Record<string, unknown> = {};
		for (const [key, entry] of value.entries()) {
			normalized[key] = normalizePreviewAnalysisValue(entry);
		}

		return normalized as T;
	}

	if (Array.isArray(value)) {
		return value.map((entry) => normalizePreviewAnalysisValue(entry)) as T;
	}

	if (value && typeof value === "object") {
		const normalized: Record<string, unknown> = {};
		for (const [key, entry] of Object.entries(
			value as Record<string, unknown>,
		)) {
			normalized[key] = normalizePreviewAnalysisValue(entry);
		}

		return normalized as T;
	}

	return value;
}

export function resolvePreviewGraphModulePath(
	resolveModule: (specifier: string) => string = require.resolve,
) {
	try {
		return resolveModule("@loom-dev/preview-analysis");
	} catch {
		throw new Error(
			"Unable to resolve @loom-dev/preview-analysis. Build @loom-dev/preview-analysis before running preview-harness.",
		);
	}
}

function getPreviewGraphWasmModule() {
	if (!previewGraphWasmModule) {
		const timingEnabled = process.env.LOOM_PREVIEW_TIMINGS === "1";
		const startedAt = timingEnabled ? Date.now() : 0;
		previewGraphWasmModule = require(
			resolvePreviewGraphModulePath(),
		) as PreviewGraphWasmModule;
		if (timingEnabled) {
			console.info(
				`[preview] preview-analysis wasm module loaded: ${Date.now() - startedAt}ms`,
			);
		}
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
	const timingEnabled = process.env.LOOM_PREVIEW_TIMINGS === "1";
	const sessionStartedAt = timingEnabled ? Date.now() : 0;
	initializePreviewGraphWasm();
	const session = getPreviewGraphWasmModule().createPreviewGraphSession();
	if (timingEnabled && !previewGraphWasmSessionLogged) {
		previewGraphWasmSessionLogged = true;
		console.info(
			`[preview] preview-analysis session created: ${Date.now() - sessionStartedAt}ms`,
		);
	}

	try {
		session.replaceRecords(records);
		return callback(session);
	} catch (error) {
		throw normalizePreviewAnalysisError(
			error,
			"preview-analysis preview graph session failed",
		);
	} finally {
		session.dispose();
	}
}

function withWorkspaceDiscoverySession<T>(
	records: WorkspaceFileSnapshot[],
	projectName: string,
	protocolVersion: number,
	resolveImport: (
		importerFilePath: string,
		specifier: string,
	) => WorkspaceImportResolution | undefined,
	callback: (session: WorkspaceDiscoverySessionLike) => T,
) {
	const timingEnabled = process.env.LOOM_PREVIEW_TIMINGS === "1";
	const sessionStartedAt = timingEnabled ? Date.now() : 0;
	initializePreviewGraphWasm();
	const session = getPreviewGraphWasmModule().createWorkspaceDiscoverySession(
		projectName,
		protocolVersion,
		resolveImport,
	);
	if (timingEnabled && !previewGraphWorkspaceDiscoverySessionLogged) {
		previewGraphWorkspaceDiscoverySessionLogged = true;
		console.info(
			`[preview] preview-analysis workspace discovery session created: ${Date.now() - sessionStartedAt}ms`,
		);
	}

	try {
		session.replaceRecords(records);
		return callback(session);
	} catch (error) {
		throw normalizePreviewAnalysisError(
			error,
			"preview-analysis workspace discovery session failed",
		);
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
		return normalizePreviewAnalysisValue({
			...trace,
			selection: selectionTrace,
		});
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

export function buildWorkspaceDiscoveryWithPreviewGraph(
	records: WorkspaceFileSnapshot[],
	projectName: string,
	protocolVersion: number,
	resolveImport: (
		importerFilePath: string,
		specifier: string,
	) => WorkspaceImportResolution | undefined,
) {
	const timingEnabled = process.env.LOOM_PREVIEW_TIMINGS === "1";
	const startedAt = timingEnabled ? Date.now() : 0;
	const discovery = withWorkspaceDiscoverySession(
		records,
		projectName,
		protocolVersion,
		resolveImport,
		(session) => session.buildWorkspaceDiscovery(),
	);

	if (timingEnabled) {
		console.info(
			`[preview] preview-analysis workspace discovery built: ${Date.now() - startedAt}ms`,
		);
	}

	return normalizePreviewAnalysisValue(discovery);
}
