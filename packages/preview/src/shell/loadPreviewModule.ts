import type { PreviewEntryPayload } from "@loom-dev/preview-engine";

const PREVIEW_MODULE_RETRY_DELAY_MS = 80;
const RETRYABLE_PREVIEW_MODULE_LOAD_ERROR_CODES = new Set([
	"ERR_OUTDATED_OPTIMIZED_DEP",
]);
const RETRYABLE_PREVIEW_MODULE_LOAD_MESSAGE_SNIPPETS = [
	"new version of the pre-bundle",
	"Failed to fetch dynamically imported module",
	"Importing a module script failed",
	"error loading dynamically imported module",
];

export type PreviewWorkspaceModule = Record<string, unknown> & {
	__previewEntryPayload?: PreviewEntryPayload;
};

export type PreviewWorkspaceModuleImporter =
	() => Promise<PreviewWorkspaceModule>;

function getErrorCode(error: unknown) {
	if (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		typeof error.code === "string"
	) {
		return error.code;
	}

	return null;
}

function getErrorMessage(error: unknown) {
	if (error instanceof Error) {
		return error.message;
	}

	return String(error);
}

function isRetryablePreviewModuleLoadError(error: unknown) {
	const code = getErrorCode(error);
	if (code && RETRYABLE_PREVIEW_MODULE_LOAD_ERROR_CODES.has(code)) {
		return true;
	}

	const message = getErrorMessage(error);
	return RETRYABLE_PREVIEW_MODULE_LOAD_MESSAGE_SNIPPETS.some((snippet) =>
		message.includes(snippet),
	);
}

function waitForRetryDelay(delayMs: number) {
	return new Promise<void>((resolve) => {
		globalThis.setTimeout(resolve, delayMs);
	});
}

export async function loadPreviewModule(
	importer: PreviewWorkspaceModuleImporter,
) {
	try {
		return await importer();
	} catch (error) {
		if (!isRetryablePreviewModuleLoadError(error)) {
			throw error;
		}

		await waitForRetryDelay(PREVIEW_MODULE_RETRY_DELAY_MS);
		return importer();
	}
}
