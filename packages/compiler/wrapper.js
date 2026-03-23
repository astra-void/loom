const { existsSync, readFileSync } = require("node:fs");
const { resolve } = require("node:path");

/**
 * @typedef {"strict-fidelity" | "compatibility" | "mocked" | "design-time"} PreviewTransformMode
 * @typedef {"error" | "info" | "warning"} PreviewTransformSeverity
 *
 * @typedef {object} UnsupportedPatternError
 * @property {string} code
 * @property {string} message
 * @property {string} file
 * @property {number} line
 * @property {number} column
 * @property {string | undefined} [symbol]
 * @property {string} target
 *
 * @typedef {object} PreviewTransformDiagnostic
 * @property {boolean} blocking
 * @property {string} code
 * @property {string | undefined} [details]
 * @property {string} file
 * @property {number} line
 * @property {number} column
 * @property {PreviewTransformSeverity} severity
 * @property {string} summary
 * @property {string | undefined} [symbol]
 * @property {string} target
 *
 * @typedef {object} PreviewTransformOutcome
 * @property {"preserved" | "degraded" | "metadata-only"} fidelity
 * @property {"ready" | "compatibility" | "mocked" | "blocked" | "design-time"} kind
 *
 * @typedef {object} TransformPreviewSourceOptions
 * @property {string} filePath
 * @property {PreviewTransformMode | undefined} [mode]
 * @property {string} runtimeModule
 * @property {string} target
 *
 * @typedef {object} TransformPreviewSourceResultInput
 * @property {string | null | undefined} [code]
 * @property {UnsupportedPatternError[] | undefined} [errors]
 * @property {PreviewTransformDiagnostic[] | undefined} [diagnostics]
 * @property {PreviewTransformOutcome | undefined} [outcome]
 *
 * @typedef {object} NormalizedTransformPreviewSourceResult
 * @property {string | undefined} [code]
 * @property {PreviewTransformDiagnostic[]} diagnostics
 * @property {PreviewTransformOutcome} outcome
 *
 * @typedef {object} TransformPreviewSourceResult
 * @property {string | null} code
 * @property {UnsupportedPatternError[]} errors
 * @property {PreviewTransformDiagnostic[]} diagnostics
 * @property {PreviewTransformOutcome} outcome
 *
 * @typedef {typeof import("./index.js")} NativeCompilerModule
 * @typedef {Omit<NativeCompilerModule, "transformPreviewSource"> & {
 * 	normalizeTransformPreviewSourceResult(result: TransformPreviewSourceResultInput, mode: PreviewTransformMode): NormalizedTransformPreviewSourceResult;
 * 	transformPreviewSource(code: string, options: TransformPreviewSourceOptions): TransformPreviewSourceResult;
 * }} CompilerModule
 */

/**
 * @returns {NativeCompilerModule | null}
 */
function loadLocalNativeBinding() {
	if (process.env.NAPI_RS_NATIVE_LIBRARY_PATH) {
		return null;
	}

	const manifestPath = resolve(__dirname, ".native", "manifest.json");
	if (!existsSync(manifestPath)) {
		return null;
	}

	try {
		const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
		if (typeof manifest.entry !== "string" || manifest.entry.length === 0) {
			return null;
		}

		// Local development builds write a stable manifest entry that points at the
		// current host-native binary inside `.native/local`.
		return require(resolve(__dirname, manifest.entry));
	} catch {
		return null;
	}
}

/** @type {NativeCompilerModule} */
const native = loadLocalNativeBinding() ?? require("./index.js");

const PREVIEW_GLOBAL_CALL_PATTERN = /__previewGlobal\("([^"]+)"\)/g;
const UNRESOLVED_FREE_IDENTIFIER_CODE = "UNRESOLVED_FREE_IDENTIFIER";

/**
 * @param {string} value
 * @returns {string}
 */
function escapeRegExp(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * @param {PreviewTransformMode} mode
 * @returns {PreviewTransformOutcome}
 */
function createDefaultTransformOutcome(mode) {
	if (mode === "design-time") {
		return {
			fidelity: "metadata-only",
			kind: "design-time",
		};
	}

	return {
		fidelity: "preserved",
		kind: "ready",
	};
}

/**
 * @param {PreviewTransformMode} mode
 * @param {UnsupportedPatternError} error
 * @returns {PreviewTransformDiagnostic}
 */
function toTransformDiagnostic(mode, error) {
	const blocking = mode === "strict-fidelity";

	return {
		blocking,
		code: error.code,
		column: error.column,
		details: error.message,
		file: error.file,
		line: error.line,
		severity: blocking ? "error" : "warning",
		summary: error.message,
		...(error.symbol ? { symbol: error.symbol } : {}),
		target: error.target,
	};
}

/**
 * @param {PreviewTransformMode} mode
 * @param {PreviewTransformDiagnostic[]} diagnostics
 * @returns {PreviewTransformOutcome}
 */
function inferTransformOutcome(mode, diagnostics) {
	if (mode === "design-time") {
		return createDefaultTransformOutcome(mode);
	}

	if (diagnostics.length === 0) {
		return createDefaultTransformOutcome(mode);
	}

	if (mode === "strict-fidelity") {
		return {
			fidelity: "degraded",
			kind: "blocked",
		};
	}

	return {
		fidelity: "degraded",
		kind: mode === "mocked" ? "mocked" : "compatibility",
	};
}

/**
 * @param {TransformPreviewSourceResultInput} result
 * @param {PreviewTransformMode} mode
 * @returns {NormalizedTransformPreviewSourceResult}
 */
function normalizeTransformPreviewSourceResult(result, mode) {
	const diagnostics = Array.isArray(result.diagnostics)
		? result.diagnostics
		: Array.isArray(result.errors)
			? result.errors.map((error) => toTransformDiagnostic(mode, error))
			: [];
	const outcome = result.outcome ?? inferTransformOutcome(mode, diagnostics);

	return {
		code:
			outcome.kind === "blocked" || outcome.kind === "design-time"
				? undefined
				: typeof result.code === "string"
					? result.code
					: undefined,
		diagnostics,
		outcome,
	};
}

/**
 * @param {string} sourceText
 * @param {string} identifier
 * @returns {{ column: number; line: number }}
 */
function findIdentifierLocation(sourceText, identifier) {
	const match = new RegExp(`\\b${escapeRegExp(identifier)}\\b`).exec(
		sourceText,
	);
	if (!match) {
		return {
			column: 1,
			line: 1,
		};
	}

	const prefix = sourceText.slice(0, match.index);
	const lines = prefix.split(/\r?\n/);

	return {
		column: lines[lines.length - 1].length + 1,
		line: lines.length,
	};
}

/**
 * @param {string} sourceText
 * @param {string} transformedCode
 * @param {TransformPreviewSourceOptions} options
 * @param {PreviewTransformDiagnostic[]} existingDiagnostics
 * @returns {PreviewTransformDiagnostic[]}
 */
function collectMockDiagnostics(
	sourceText,
	transformedCode,
	options,
	existingDiagnostics,
) {
	/** @type {PreviewTransformDiagnostic[]} */
	const diagnostics = [];
	/** @type {Set<string>} */
	const seenSymbols = new Set();
	const unresolvedSymbols = new Set(
		existingDiagnostics
			.filter(
				(diagnostic) =>
					diagnostic.code === UNRESOLVED_FREE_IDENTIFIER_CODE &&
					typeof diagnostic.symbol === "string",
			)
			.map((diagnostic) => diagnostic.symbol),
	);

	for (const match of transformedCode.matchAll(PREVIEW_GLOBAL_CALL_PATTERN)) {
		const symbol = match[1];
		if (!symbol || seenSymbols.has(symbol) || unresolvedSymbols.has(symbol)) {
			continue;
		}

		seenSymbols.add(symbol);
		const location = findIdentifierLocation(sourceText, symbol);
		diagnostics.push({
			blocking: false,
			code: "RUNTIME_MOCK_GLOBAL",
			column: location.column,
			details: `Preview will mock the runtime global \`${symbol}\` in the browser environment.`,
			file: options.filePath,
			line: location.line,
			severity: "warning",
			summary: `Preview will mock the runtime global \`${symbol}\`.`,
			symbol,
			target: options.target,
		});
	}

	return diagnostics;
}

/**
 * @param {string} code
 * @param {TransformPreviewSourceOptions} options
 * @returns {TransformPreviewSourceResult}
 */
function transformPreviewSource(code, options) {
	/** @type {PreviewTransformMode} */
	const mode =
		typeof options.mode === "string" ? options.mode : "strict-fidelity";
	const result = native.transformPreviewSource(code, options);
	const diagnostics = Array.isArray(result.errors)
		? result.errors.map((error) => toTransformDiagnostic(mode, error))
		: [];

	if (mode === "mocked" && typeof result.code === "string") {
		diagnostics.push(
			...collectMockDiagnostics(code, result.code, options, diagnostics),
		);
	}

	const normalized = normalizeTransformPreviewSourceResult(
		{
			...result,
			diagnostics,
		},
		mode,
	);

	return {
		...result,
		code: normalized.code ?? null,
		diagnostics: normalized.diagnostics,
		outcome: normalized.outcome,
	};
}

/** @type {CompilerModule} */
const compiler = {
	...native,
	normalizeTransformPreviewSourceResult,
	transformPreviewSource,
};

module.exports = compiler;
