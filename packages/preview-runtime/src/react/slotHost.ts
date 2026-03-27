import { getPreviewHostComponentHost } from "../hosts/hostComponent";
import { supportedHostJsxNames } from "../hosts/metadata";
import type { HostName } from "../hosts/types";

const DEFAULT_SLOT_HOST: HostName = "frame";

export function resolvePreviewSlotHost(childType: unknown): HostName {
	const taggedHost = getPreviewHostComponentHost(childType);
	if (taggedHost) {
		return taggedHost;
	}

	if (typeof childType === "string") {
		if (childType === "button") {
			return "textbutton";
		}

		if (supportedHostJsxNames.includes(childType)) {
			return childType as HostName;
		}
	}

	return DEFAULT_SLOT_HOST;
}
