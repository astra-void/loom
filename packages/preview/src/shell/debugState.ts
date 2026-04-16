import type {
	PreviewModuleLoadMetadata,
	PreviewModuleLoadRetryInfo,
} from "./loadPreviewModule";

export const PREVIEW_DEBUG_EVENT_LIMIT = 8;

export type PreviewDebugEventKind =
	| "entry-payload-applied"
	| "hot-update-received"
	| "module-failed"
	| "module-recovered"
	| "module-retry-scheduled"
	| "runtime-issues-updated"
	| "workspace-snapshot-reloaded";

export type PreviewDebugEvent = {
	detail?: string;
	id: string;
	kind: PreviewDebugEventKind;
	label: string;
	sequence: number;
	timestamp: number;
};

export type PreviewHotConnectionState =
	| "connected"
	| "disconnected"
	| "unavailable"
	| "unknown";

export type PreviewHotDebugState = {
	available: boolean;
	connection: PreviewHotConnectionState;
	lastUpdateAt?: number;
	sendAvailable: boolean;
	updateListener: "none" | "subscribed";
	updateSequence: number;
};

export const defaultPreviewHotDebugState: PreviewHotDebugState = {
	available: false,
	connection: "unavailable",
	sendAvailable: false,
	updateListener: "none",
	updateSequence: 0,
};

export type PreviewModuleLoadDebugState = {
	entryId?: string;
	message?: string;
	outcome?: PreviewModuleLoadMetadata["outcome"];
	retried: boolean;
	retry: PreviewModuleLoadRetryInfo | null;
	state: "failed" | "idle" | "loading" | "not-loadable" | "ready" | "retrying";
};

export function appendPreviewDebugEvent(
	events: PreviewDebugEvent[],
	event: PreviewDebugEvent,
) {
	return [...events, event].slice(-PREVIEW_DEBUG_EVENT_LIMIT);
}
