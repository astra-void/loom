import type { HostName } from "./types";

const PREVIEW_HOST_COMPONENT_MARKER = Symbol.for(
	"loom-dev.preview-runtime.hostComponent",
);

type PreviewHostComponentType = {
	[PREVIEW_HOST_COMPONENT_MARKER]?: HostName;
};

export function markPreviewHostComponent<T extends object>(
	component: T,
	host: HostName,
) {
	Object.defineProperty(component, PREVIEW_HOST_COMPONENT_MARKER, {
		configurable: true,
		enumerable: false,
		value: host,
		writable: false,
	});

	return component;
}

export function getPreviewHostComponentHost(type: unknown) {
	if (typeof type !== "object" && typeof type !== "function") {
		return undefined;
	}

	return (type as PreviewHostComponentType)[PREVIEW_HOST_COMPONENT_MARKER];
}
