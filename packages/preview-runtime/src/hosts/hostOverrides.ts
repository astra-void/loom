import * as React from "react";
import { destroyTweensForTarget } from "../runtime/tween";

const HOST_BRIDGE_STATE_KEY = Symbol.for(
	"loom-dev.preview-runtime.hostBridgeState",
);
const HOST_OVERRIDE_STORE_KEY = Symbol.for(
	"loom-dev.preview-runtime.hostOverrideStore",
);

const emptySnapshot = Object.freeze({}) as Readonly<Record<string, unknown>>;

export const bridgedPreviewHostProperties = [
	"AbsolutePosition",
	"AbsoluteSize",
	"AbsoluteWindowSize",
	"AnchorPoint",
	"BackgroundColor3",
	"BackgroundTransparency",
	"CanvasPosition",
	"CanvasSize",
	"Parent",
	"Position",
	"Size",
	"TextBounds",
	"TextColor3",
	"TextSize",
	"Visible",
	"ZIndex",
] as const;

type BridgedPreviewHostProperty = (typeof bridgedPreviewHostProperties)[number];

type HostOverrideListener = () => void;

type HostOverrideEntry = {
	listeners: Set<HostOverrideListener>;
	snapshot: Readonly<Record<string, unknown>>;
};

type HostOverrideStore = {
	clearNode(nodeId: string): void;
	getSnapshot(nodeId: string): Readonly<Record<string, unknown>>;
	readValue(
		nodeId: string,
		property: string,
	): { hasValue: boolean; value: unknown };
	setValue(nodeId: string, property: string, value: unknown): void;
	subscribe(nodeId: string, listener: HostOverrideListener): () => void;
};

type HostBridgeState = {
	getBaseValue(property: string): unknown;
	nodeId: string;
};

type GlobalHostOverrideStore = typeof globalThis & {
	[HOST_OVERRIDE_STORE_KEY]?: HostOverrideStore;
};

type PreviewSignalConnection = {
	Connected: boolean;
	Disconnect(): void;
};

type PreviewPropertyChangedSignal = {
	Connect(listener?: (...args: unknown[]) => void): PreviewSignalConnection;
};

type PreviewHostElement = HTMLElement & {
	[HOST_BRIDGE_STATE_KEY]?: HostBridgeState;
	GetChildren?: () => unknown[];
	GetPropertyChangedSignal?: (property: string) => PreviewPropertyChangedSignal;
};

function hasOwn(value: object, property: PropertyKey) {
	return Object.getOwnPropertyDescriptor(value, property) !== undefined;
}

function createHostOverrideStore(): HostOverrideStore {
	const entries = new Map<string, HostOverrideEntry>();

	const emit = (nodeId: string) => {
		const entry = entries.get(nodeId);
		if (!entry) {
			return;
		}

		for (const listener of entry.listeners) {
			listener();
		}
	};

	const ensureEntry = (nodeId: string) => {
		const existing = entries.get(nodeId);
		if (existing) {
			return existing;
		}

		const created: HostOverrideEntry = {
			listeners: new Set(),
			snapshot: emptySnapshot,
		};
		entries.set(nodeId, created);
		return created;
	};

	const maybeDeleteEntry = (nodeId: string) => {
		const entry = entries.get(nodeId);
		if (!entry) {
			return;
		}

		if (entry.listeners.size === 0 && entry.snapshot === emptySnapshot) {
			entries.delete(nodeId);
		}
	};

	return {
		clearNode(nodeId) {
			const entry = entries.get(nodeId);
			if (!entry || entry.snapshot === emptySnapshot) {
				maybeDeleteEntry(nodeId);
				return;
			}

			entry.snapshot = emptySnapshot;
			emit(nodeId);
			maybeDeleteEntry(nodeId);
		},
		getSnapshot(nodeId) {
			return entries.get(nodeId)?.snapshot ?? emptySnapshot;
		},
		readValue(nodeId, property) {
			const snapshot = entries.get(nodeId)?.snapshot;
			if (!snapshot) {
				return {
					hasValue: false,
					value: undefined,
				};
			}

			return {
				hasValue: hasOwn(snapshot, property),
				value: snapshot[property],
			};
		},
		setValue(nodeId, property, value) {
			const entry = ensureEntry(nodeId);
			const current = entry.snapshot;
			if (hasOwn(current, property) && Object.is(current[property], value)) {
				return;
			}

			entry.snapshot = {
				...current,
				[property]: value,
			};
			emit(nodeId);
		},
		subscribe(nodeId, listener) {
			const entry = ensureEntry(nodeId);
			entry.listeners.add(listener);
			return () => {
				entry.listeners.delete(listener);
				maybeDeleteEntry(nodeId);
			};
		},
	};
}

function getHostOverrideStore() {
	const globalRecord = globalThis as GlobalHostOverrideStore;
	if (!globalRecord[HOST_OVERRIDE_STORE_KEY]) {
		globalRecord[HOST_OVERRIDE_STORE_KEY] = createHostOverrideStore();
	}

	return globalRecord[HOST_OVERRIDE_STORE_KEY];
}

function definePreviewHostBridgeProperty(
	element: PreviewHostElement,
	property: BridgedPreviewHostProperty,
	state: HostBridgeState,
) {
	if (hasOwn(element, property)) {
		return;
	}

	Object.defineProperty(element, property, {
		configurable: true,
		enumerable: false,
		get() {
			const entry = getHostOverrideStore().readValue(state.nodeId, property);
			if (entry.hasValue) {
				return entry.value;
			}

			return state.getBaseValue(property);
		},
		set(value: unknown) {
			getHostOverrideStore().setValue(state.nodeId, property, value);
		},
	});
}

export function clearPreviewHostOverrides(nodeId: string) {
	getHostOverrideStore().clearNode(nodeId);
}

export function installPreviewHostPropertyBridge(
	element: HTMLElement,
	nodeId: string,
	getBaseValue: (property: string) => unknown,
) {
	const previewElement = element as PreviewHostElement;
	let state = previewElement[HOST_BRIDGE_STATE_KEY];
	if (!state) {
		state = {
			getBaseValue,
			nodeId,
		};
		Object.defineProperty(previewElement, HOST_BRIDGE_STATE_KEY, {
			configurable: true,
			enumerable: false,
			value: state,
			writable: true,
		});
	}

	state.getBaseValue = getBaseValue;
	state.nodeId = nodeId;

	if (!hasOwn(previewElement, "GetChildren")) {
		Object.defineProperty(previewElement, "GetChildren", {
			configurable: true,
			enumerable: false,
			value() {
				return [];
			},
			writable: true,
		});
	}

	if (!hasOwn(previewElement, "GetPropertyChangedSignal")) {
		Object.defineProperty(previewElement, "GetPropertyChangedSignal", {
			configurable: true,
			enumerable: false,
			value() {
				return {
					Connect() {
						const connection = {
							Connected: true,
							Disconnect() {
								connection.Connected = false;
							},
						};

						return connection;
					},
				};
			},
			writable: true,
		});
	}

	for (const property of bridgedPreviewHostProperties) {
		definePreviewHostBridgeProperty(previewElement, property, state);
	}
}

export function usePreviewHostOverrides(nodeId: string) {
	return React.useSyncExternalStore(
		(listener) => getHostOverrideStore().subscribe(nodeId, listener),
		() => getHostOverrideStore().getSnapshot(nodeId),
		() => getHostOverrideStore().getSnapshot(nodeId),
	);
}

export function cleanupPreviewHostBridge(
	element: HTMLElement | null,
	nodeId: string,
) {
	if (element) {
		destroyTweensForTarget(element);
	}

	clearPreviewHostOverrides(nodeId);
}
