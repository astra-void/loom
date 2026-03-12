import { robloxMock, setupRobloxEnvironment } from "@loom-dev/preview-runtime";

const robloxMockRecord = robloxMock as unknown as Record<PropertyKey, unknown>;

const previewGlobalFallbackMarker = Symbol.for(
	"loom.preview.browserGlobalsFallback",
);
const previewGlobalFallbackMetadata = Symbol.for(
	"loom.preview.browserGlobalsFallbackMetadata",
);

type PropertyBag = Record<PropertyKey, unknown>;

type PreviewGlobalFallbackMetadata = {
	basePrototype: object | null;
};

type PreviewGlobalRestoreEntry = {
	descriptor?: PropertyDescriptor;
	hadOwnProperty: boolean;
	key: PropertyKey;
	target: object;
};

type PrototypeRestoreEntry = {
	parent: object | null;
	prototypeHost: object;
};

const previewRuntimePolyfillsMarker = Symbol.for(
	"loom.preview.runtimePolyfillsInstalled",
);
const previewRuntimeEnumKey = Symbol.for("loom-dev.preview-runtime.Enum");
const previewRuntimeFrameSchedulerKey = Symbol.for(
	"loom-dev.preview-runtime.frameScheduler",
);
const previewRuntimeReporterKey = Symbol.for(
	"loom-dev.preview-runtime.reporter",
);
const previewRuntimeRunServiceKey = Symbol.for(
	"loom-dev.preview-runtime.RunService",
);
const previewRuntimeServicesKey = Symbol.for(
	"loom-dev.preview-runtime.services",
);
const previewRuntimeTweenInfoKey = Symbol.for(
	"loom-dev.preview-runtime.TweenInfo",
);
const previewRuntimeUserInputTrackerKey = Symbol.for(
	"loom-dev.preview-runtime.userInputTracker",
);

const previewGlobalPropertyKeys = [
	"Enum",
	"RunService",
	"TweenInfo",
	"game",
	"print",
	"task",
	"tostring",
	"workspace",
	previewRuntimePolyfillsMarker,
	previewRuntimeEnumKey,
	previewRuntimeFrameSchedulerKey,
	previewRuntimeReporterKey,
	previewRuntimeRunServiceKey,
	previewRuntimeServicesKey,
	previewRuntimeTweenInfoKey,
	previewRuntimeUserInputTrackerKey,
] as const;

function isObjectLike(value: unknown): value is object {
	return (
		(typeof value === "object" && value !== null) || typeof value === "function"
	);
}

function getPrototype(value: object): object | null {
	const prototype = Object.getPrototypeOf(value) as unknown;
	return isObjectLike(prototype) ? prototype : null;
}

function getObjectProperty(container: object, property: PropertyKey) {
	return (container as PropertyBag)[property];
}

function snapshotTargetProperties(
	target: object,
	keys: readonly PropertyKey[],
): PreviewGlobalRestoreEntry[] {
	return keys.map((key) => {
		const descriptor = Object.getOwnPropertyDescriptor(target, key);
		return {
			descriptor,
			hadOwnProperty: descriptor !== undefined,
			key,
			target,
		};
	});
}

function restoreTargetProperties(entries: PreviewGlobalRestoreEntry[]) {
	for (const entry of entries.reverse()) {
		if (!entry.hadOwnProperty) {
			delete (entry.target as PropertyBag)[entry.key];
			continue;
		}

		if (entry.descriptor) {
			Object.defineProperty(entry.target, entry.key, entry.descriptor);
		}
	}
}

function snapshotPrototypeRestoreEntry(
	target: object,
): PrototypeRestoreEntry | null {
	const prototypeHost = getPrototype(target);
	if (!prototypeHost) {
		return null;
	}

	return {
		parent: getPrototype(prototypeHost),
		prototypeHost,
	};
}

function restorePrototypeParent(entry: PrototypeRestoreEntry | null) {
	if (!entry) {
		return;
	}

	if (Object.getPrototypeOf(entry.prototypeHost) === entry.parent) {
		return;
	}

	try {
		Object.setPrototypeOf(entry.prototypeHost, entry.parent);
	} catch {
		// Ignore environments that do not allow prototype restoration.
	}
}

function clonePrototypeSurface(prototype: object | null): object | null {
	if (!prototype) {
		return null;
	}

	const clonedPrototype: PropertyBag = {};
	Object.setPrototypeOf(clonedPrototype, getPrototype(prototype));

	for (const property of Object.getOwnPropertyNames(prototype)) {
		const descriptor = Object.getOwnPropertyDescriptor(prototype, property);
		if (descriptor) {
			Object.defineProperty(clonedPrototype, property, descriptor);
		}
	}

	for (const symbol of Object.getOwnPropertySymbols(prototype)) {
		if (
			symbol === previewGlobalFallbackMarker ||
			symbol === previewGlobalFallbackMetadata
		) {
			continue;
		}

		const descriptor = Object.getOwnPropertyDescriptor(prototype, symbol);
		if (descriptor) {
			Object.defineProperty(clonedPrototype, symbol, descriptor);
		}
	}

	return clonedPrototype;
}

function getFallbackMetadata(
	fallback: object | null,
): PreviewGlobalFallbackMetadata | undefined {
	if (!fallback) {
		return undefined;
	}

	const metadata = getObjectProperty(fallback, previewGlobalFallbackMetadata);
	if (
		!metadata ||
		typeof metadata !== "object" ||
		!("basePrototype" in metadata)
	) {
		return undefined;
	}

	const basePrototype = (metadata as { basePrototype?: unknown }).basePrototype;
	return {
		basePrototype: isObjectLike(basePrototype) ? basePrototype : null,
	};
}

function canResolvePreviewFallbackGlobals(fallback: object | null) {
	if (!fallback) {
		return false;
	}

	return (
		getObjectProperty(fallback, previewGlobalFallbackMarker) === true &&
		getObjectProperty(fallback, "game") !== undefined &&
		getObjectProperty(fallback, "task") !== undefined &&
		getObjectProperty(fallback, "tostring") !== undefined &&
		getObjectProperty(fallback, "TweenInfo") !== undefined
	);
}

function createMissingGlobalFallback(basePrototype: object | null): object {
	const fallbackMetadata: PreviewGlobalFallbackMetadata = { basePrototype };
	const fallbackTarget: PropertyBag = {};
	Object.setPrototypeOf(fallbackTarget, basePrototype ?? Object.prototype);

	Object.defineProperty(fallbackTarget, previewGlobalFallbackMetadata, {
		configurable: false,
		enumerable: false,
		value: fallbackMetadata,
		writable: false,
	});

	return new Proxy<PropertyBag>(fallbackTarget, {
		get(target, property) {
			if (property === previewGlobalFallbackMarker) {
				return true;
			}

			if (property === previewGlobalFallbackMetadata) {
				return fallbackMetadata;
			}

			if (property in target) {
				return target[property];
			}

			if (typeof property !== "string") {
				return undefined;
			}

			return robloxMockRecord[property];
		},
		has(target, property) {
			if (typeof property === "string") {
				return true;
			}

			return property in target;
		},
	});
}

function installMissingGlobalFallback(target: object) {
	const prototypeHost = getPrototype(target);
	if (!prototypeHost) {
		return;
	}

	const currentFallback = getPrototype(prototypeHost);
	if (canResolvePreviewFallbackGlobals(currentFallback)) {
		return;
	}

	const fallbackMetadata = getFallbackMetadata(currentFallback);
	const basePrototype =
		fallbackMetadata?.basePrototype ?? clonePrototypeSurface(currentFallback);

	try {
		Object.setPrototypeOf(
			prototypeHost,
			createMissingGlobalFallback(basePrototype),
		);
	} catch {
		// Ignore environments that do not allow prototype mutation on the global host.
	}
}

export function installPreviewBrowserGlobals() {
	const restoreEntries = snapshotTargetProperties(
		globalThis,
		previewGlobalPropertyKeys,
	);
	const prototypeRestoreEntry = snapshotPrototypeRestoreEntry(globalThis);
	const shouldSnapshotWindow =
		typeof window !== "undefined" && window !== globalThis;
	const windowRestoreEntries = shouldSnapshotWindow
		? snapshotTargetProperties(window, previewGlobalPropertyKeys)
		: [];
	const windowPrototypeRestoreEntry = shouldSnapshotWindow
		? snapshotPrototypeRestoreEntry(window)
		: null;

	setupRobloxEnvironment();
	installMissingGlobalFallback(globalThis);

	if (typeof window !== "undefined") {
		installMissingGlobalFallback(window);
	}

	return () => {
		restoreTargetProperties(windowRestoreEntries);
		restoreTargetProperties(restoreEntries);
		restorePrototypeParent(windowPrototypeRestoreEntry);
		restorePrototypeParent(prototypeRestoreEntry);
	};
}
