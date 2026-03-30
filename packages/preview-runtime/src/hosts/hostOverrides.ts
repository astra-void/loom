import * as React from "react";
import { PREVIEW_HOST_DATA_ATTRIBUTE } from "../internal/previewAttributes";
import {
	findMockAncestorOfClass,
	findMockAncestorWhichIsA,
	getMockParent,
	type MockInstanceLike,
} from "../runtime/mockInstance";
import { destroyTweensForTarget } from "../runtime/tween";
import {
	getPreviewHostMetadataByJsxName,
	previewHostMatchesType,
} from "./metadata";

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
	"AbsoluteCanvasSize",
	"AbsoluteWindowSize",
	"AnchorPoint",
	"BackgroundColor3",
	"BackgroundTransparency",
	"CanvasPosition",
	"CanvasSize",
	"Name",
	"Parent",
	"Position",
	"Size",
	"Text",
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
	propertyListeners: Map<string, Set<HostOverrideListener>>;
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
	notifyPropertyChange(nodeId: string, property: string): void;
	subscribe(nodeId: string, listener: HostOverrideListener): () => void;
	subscribeProperty(
		nodeId: string,
		property: string,
		listener: HostOverrideListener,
	): () => void;
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
	ClassName?: string;
	FindFirstAncestorOfClass?: (
		className: string,
	) => MockInstanceLike | undefined;
	FindFirstAncestorWhichIsA?: (
		className: string,
	) => MockInstanceLike | undefined;
	GetChildren?: () => PreviewHostElement[];
	GetDescendants?: () => PreviewHostElement[];
	GetFullName?: () => string;
	GetPropertyChangedSignal?: (property: string) => PreviewPropertyChangedSignal;
	IsA?: (name: string) => boolean;
	IsDescendantOf?: (ancestor: unknown) => boolean;
	Name?: string;
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

	const emitProperty = (nodeId: string, property: string) => {
		const entry = entries.get(nodeId);
		if (!entry) {
			return;
		}

		const listeners = entry.propertyListeners.get(property);
		if (!listeners) {
			return;
		}

		for (const listener of listeners) {
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
			propertyListeners: new Map(),
			snapshot: emptySnapshot,
		};
		entries.set(nodeId, created);
		return created;
	};

	return {
		clearNode(nodeId) {
			entries.delete(nodeId);
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
			emitProperty(nodeId, property);
		},
		notifyPropertyChange(nodeId, property) {
			emitProperty(nodeId, property);
		},
		subscribe(nodeId, listener) {
			const entry = ensureEntry(nodeId);
			entry.listeners.add(listener);
			return () => {
				entry.listeners.delete(listener);
				if (
					entry.listeners.size === 0 &&
					entry.propertyListeners.size === 0 &&
					entry.snapshot === emptySnapshot
				) {
					entries.delete(nodeId);
				}
			};
		},
		subscribeProperty(nodeId, property, listener) {
			const entry = ensureEntry(nodeId);
			const listeners = entry.propertyListeners.get(property) ?? new Set();
			listeners.add(listener);
			entry.propertyListeners.set(property, listeners);
			return () => {
				listeners.delete(listener);
				if (listeners.size === 0) {
					entry.propertyListeners.delete(property);
				}
				if (
					entry.listeners.size === 0 &&
					entry.propertyListeners.size === 0 &&
					entry.snapshot === emptySnapshot
				) {
					entries.delete(nodeId);
				}
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

function getPreviewHostJsxName(element: PreviewHostElement) {
	return (
		element.getAttribute(PREVIEW_HOST_DATA_ATTRIBUTE) ??
		element.dataset.previewHost ??
		undefined
	);
}

function getPreviewHostClassName(element: PreviewHostElement) {
	const host = getPreviewHostJsxName(element);
	if (!host) {
		return "Instance";
	}

	return getPreviewHostMetadataByJsxName(host)?.runtimeName ?? host;
}

function getPreviewHostName(
	element: PreviewHostElement,
	state: HostBridgeState,
) {
	const bridgedName = state.getBaseValue("Name");
	if (typeof bridgedName === "string" && bridgedName.length > 0) {
		return bridgedName;
	}

	return (
		element.getAttribute("data-preview-node-id") ??
		element.getAttribute("aria-label") ??
		getPreviewHostClassName(element)
	);
}

function isPreviewHostElement(value: unknown): value is PreviewHostElement {
	return (
		typeof HTMLElement !== "undefined" &&
		value instanceof HTMLElement &&
		getPreviewHostJsxName(value as PreviewHostElement) !== undefined
	);
}

function getPreviewHostAncestor(
	element: PreviewHostElement,
	boundary: PreviewHostElement,
) {
	let current = element.parentElement;
	while (current) {
		if (current === boundary) {
			return boundary;
		}

		if (isPreviewHostElement(current)) {
			return current;
		}

		current = current.parentElement;
	}

	return undefined;
}

function collectPreviewHostDescendants(
	element: PreviewHostElement,
): PreviewHostElement[] {
	const descendants = Array.from(
		element.querySelectorAll<HTMLElement>(`[${PREVIEW_HOST_DATA_ATTRIBUTE}]`),
	);

	return descendants.filter(
		(descendant): descendant is PreviewHostElement => descendant !== element,
	);
}

function collectPreviewHostChildren(
	element: PreviewHostElement,
): PreviewHostElement[] {
	const descendants = collectPreviewHostDescendants(element);
	return descendants.filter(
		(descendant) => getPreviewHostAncestor(descendant, element) === element,
	);
}

function isPreviewDescendantOf(value: unknown, ancestor: unknown) {
	let current: unknown = value;
	while (current !== undefined) {
		if (current === ancestor) {
			return true;
		}

		current = getMockParent(current);
	}

	if (typeof HTMLElement !== "undefined" && ancestor instanceof HTMLElement) {
		return ancestor.contains(value as Node);
	}

	return false;
}

function definePreviewHostBridgeMethod(
	element: PreviewHostElement,
	property:
		| "ClassName"
		| "FindFirstAncestorOfClass"
		| "FindFirstAncestorWhichIsA"
		| "GetChildren"
		| "GetDescendants"
		| "GetFullName"
		| "IsA"
		| "IsDescendantOf",
	descriptor: PropertyDescriptor,
) {
	if (hasOwn(element, property)) {
		return;
	}

	Object.defineProperty(element, property, descriptor);
}

export function clearPreviewHostOverrides(nodeId: string) {
	getHostOverrideStore().clearNode(nodeId);
}

export function notifyPreviewHostPropertyChanged(
	nodeId: string,
	property: string,
) {
	getHostOverrideStore().notifyPropertyChange(nodeId, property);
}

export function subscribePreviewHostPropertyChanged(
	nodeId: string,
	property: string,
	listener: HostOverrideListener,
) {
	return getHostOverrideStore().subscribeProperty(nodeId, property, listener);
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
				return collectPreviewHostChildren(previewElement);
			},
			writable: true,
		});
	}

	if (!hasOwn(previewElement, "GetDescendants")) {
		Object.defineProperty(previewElement, "GetDescendants", {
			configurable: true,
			enumerable: false,
			value() {
				return collectPreviewHostDescendants(previewElement);
			},
			writable: true,
		});
	}

	if (!hasOwn(previewElement, "GetPropertyChangedSignal")) {
		Object.defineProperty(previewElement, "GetPropertyChangedSignal", {
			configurable: true,
			enumerable: false,
			value(property: string) {
				return {
					Connect(listener?: (...args: unknown[]) => void) {
						let connected = true;
						const disconnect = subscribePreviewHostPropertyChanged(
							nodeId,
							property,
							() => {
								if (!connected) {
									return;
								}

								listener?.();
							},
						);

						return {
							Connected: true,
							Disconnect() {
								if (!connected) {
									return;
								}

								connected = false;
								disconnect();
							},
						};
					},
				};
			},
			writable: true,
		});
	}

	definePreviewHostBridgeProperty(previewElement, "Name", state);

	definePreviewHostBridgeMethod(previewElement, "ClassName", {
		configurable: true,
		enumerable: false,
		get() {
			return getPreviewHostClassName(previewElement);
		},
	});

	definePreviewHostBridgeMethod(previewElement, "IsA", {
		configurable: true,
		enumerable: false,
		value(typeName: string) {
			if (typeName === "Instance") {
				return true;
			}

			const host = getPreviewHostJsxName(previewElement);
			if (!host) {
				return false;
			}

			return previewHostMatchesType(host, typeName, "isa");
		},
		writable: true,
	});

	definePreviewHostBridgeMethod(previewElement, "IsDescendantOf", {
		configurable: true,
		enumerable: false,
		value(ancestor: unknown) {
			return isPreviewDescendantOf(previewElement, ancestor);
		},
		writable: true,
	});

	definePreviewHostBridgeMethod(previewElement, "FindFirstAncestorOfClass", {
		configurable: true,
		enumerable: false,
		value(className: string) {
			return findMockAncestorOfClass(previewElement, className);
		},
		writable: true,
	});

	definePreviewHostBridgeMethod(previewElement, "FindFirstAncestorWhichIsA", {
		configurable: true,
		enumerable: false,
		value(className: string) {
			return findMockAncestorWhichIsA(previewElement, className);
		},
		writable: true,
	});

	definePreviewHostBridgeMethod(previewElement, "GetFullName", {
		configurable: true,
		enumerable: false,
		value() {
			const segments: string[] = [];
			let current: unknown = previewElement;

			while (current !== undefined) {
				if (current && typeof current === "object") {
					const name =
						current === previewElement
							? getPreviewHostName(previewElement, state)
							: (() => {
									const record = current as {
										ClassName?: unknown;
										Name?: unknown;
									};
									return typeof record.Name === "string" &&
										record.Name.length > 0
										? record.Name
										: typeof record.ClassName === "string" &&
												record.ClassName.length > 0
											? record.ClassName
											: undefined;
								})();
					if (name) {
						segments.unshift(name);
					}
				}

				current = getMockParent(current);
			}

			return segments.join(".");
		},
		writable: true,
	});

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
