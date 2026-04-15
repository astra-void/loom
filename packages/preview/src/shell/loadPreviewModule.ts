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

export type PreviewModuleLoadRetryReason = "retryable-optimized-dependency";

export type PreviewModuleLoadRetryInfo = {
	code?: string;
	message: string;
	reason: PreviewModuleLoadRetryReason;
};

export type PreviewModuleLoadMetadata =
	| {
			outcome: "ready";
			retried: false;
			retry: null;
	  }
	| {
			outcome: "recovered";
			retried: true;
			retry: PreviewModuleLoadRetryInfo;
	  }
	| {
			outcome: "failed";
			retried: boolean;
			retry: PreviewModuleLoadRetryInfo | null;
	  };

export type PreviewModuleLoadOptions = {
	onRetry?: (retry: PreviewModuleLoadRetryInfo) => void;
};

export type PreviewWorkspaceModuleLoadResult = {
	loadMetadata: PreviewModuleLoadMetadata;
	module: PreviewWorkspaceModule;
};

const PREVIEW_MODULE_LOAD_METADATA_KEY = Symbol.for(
	"loom-dev.preview.module-load-metadata",
);

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

function createRetryInfo(error: unknown): PreviewModuleLoadRetryInfo {
	const code = getErrorCode(error);

	return {
		...(code ? { code } : {}),
		message: getErrorMessage(error),
		reason: "retryable-optimized-dependency",
	};
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

function attachPreviewModuleLoadMetadata(
	error: unknown,
	loadMetadata: PreviewModuleLoadMetadata,
) {
	const targetError =
		error instanceof Error ? error : new Error(getErrorMessage(error));

	Object.defineProperty(targetError, PREVIEW_MODULE_LOAD_METADATA_KEY, {
		configurable: true,
		value: loadMetadata,
	});

	return targetError;
}

export function getPreviewModuleLoadMetadata(
	error: unknown,
): PreviewModuleLoadMetadata | undefined {
	if (typeof error !== "object" || error === null) {
		return undefined;
	}

	const metadata = (error as Record<PropertyKey, unknown>)[
		PREVIEW_MODULE_LOAD_METADATA_KEY
	];

	if (
		typeof metadata === "object" &&
		metadata !== null &&
		"outcome" in metadata
	) {
		return metadata as PreviewModuleLoadMetadata;
	}

	return undefined;
}

export async function loadPreviewModule(
	importer: PreviewWorkspaceModuleImporter,
	options: PreviewModuleLoadOptions = {},
) {
	try {
		return {
			loadMetadata: {
				outcome: "ready",
				retried: false,
				retry: null,
			},
			module: await importer(),
		} satisfies PreviewWorkspaceModuleLoadResult;
	} catch (error) {
		if (!isRetryablePreviewModuleLoadError(error)) {
			throw attachPreviewModuleLoadMetadata(error, {
				outcome: "failed",
				retried: false,
				retry: null,
			});
		}

		const retry = createRetryInfo(error);
		options.onRetry?.(retry);
		await waitForRetryDelay(PREVIEW_MODULE_RETRY_DELAY_MS);
		try {
			return {
				loadMetadata: {
					outcome: "recovered",
					retried: true,
					retry,
				},
				module: await importer(),
			} satisfies PreviewWorkspaceModuleLoadResult;
		} catch (retryError) {
			throw attachPreviewModuleLoadMetadata(retryError, {
				outcome: "failed",
				retried: true,
				retry,
			});
		}
	}
}
