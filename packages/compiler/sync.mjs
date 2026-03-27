import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
	compile_tsx as compileTsxWasm,
	initSync,
	setRelativeModuleCandidateChecker as setRelativeModuleCandidateCheckerWasm,
	transformPreviewSource as transformPreviewSourceWasm,
} from "./wasm/compiler.js";

const WASM_BINARY_URL = new URL("./wasm/compiler_bg.wasm", import.meta.url);
const wasmBytes = readFileSync(fileURLToPath(WASM_BINARY_URL));

initSync({ module: wasmBytes });

const PREVIEW_GLOBAL_CALL_PATTERN = /__previewGlobal\("([^"]+)"\)/g;
const UNRESOLVED_FREE_IDENTIFIER_CODE = "UNRESOLVED_FREE_IDENTIFIER";

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

function toTransformDiagnostic(mode, error) {
	const blocking =
		mode === "strict-fidelity" ||
		(typeof error.code === "string" &&
			error.code.startsWith("UNSUPPORTED_COMMONJS_"));

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

function inferTransformOutcome(mode, diagnostics) {
	if (mode === "design-time") {
		return createDefaultTransformOutcome(mode);
	}

	if (diagnostics.some((diagnostic) => diagnostic.blocking)) {
		return {
			fidelity: "degraded",
			kind: "blocked",
		};
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

export function normalizeTransformPreviewSourceResult(result, mode) {
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

function escapeRegExp(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

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

function collectMockDiagnostics(
	sourceText,
	transformedCode,
	options,
	existingDiagnostics,
) {
	const diagnostics = [];
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

export function compile_tsx(code) {
	return compileTsxWasm(code);
}

export function transformPreviewSource(code, options) {
	const { fileExists, ...compilerOptions } = options ?? {};
	const mode =
		typeof compilerOptions.mode === "string"
			? compilerOptions.mode
			: "strict-fidelity";

	let result;

	if (typeof fileExists === "function") {
		setRelativeModuleCandidateCheckerWasm((candidatePath) =>
			Boolean(fileExists(candidatePath)),
		);
		try {
			result = transformPreviewSourceWasm(code, compilerOptions);
		} finally {
			setRelativeModuleCandidateCheckerWasm(null);
		}
	} else {
		setRelativeModuleCandidateCheckerWasm(null);
		result = transformPreviewSourceWasm(code, compilerOptions);
	}

	const diagnostics = Array.isArray(result.errors)
		? result.errors.map((error) => toTransformDiagnostic(mode, error))
		: [];

	if (mode === "mocked" && typeof result.code === "string") {
		diagnostics.push(
			...collectMockDiagnostics(
				code,
				result.code,
				compilerOptions,
				diagnostics,
			),
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

export default {
	compile_tsx,
	normalizeTransformPreviewSourceResult,
	transformPreviewSource,
};
