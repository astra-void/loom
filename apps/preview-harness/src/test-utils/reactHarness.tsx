import type React from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import type { PreviewPlayerGuiElement } from "./playerGui";
import { createTestContainer, getLocalPlayerGui } from "./playerGui";

export type ReactHarness = {
	playerGui: PreviewPlayerGuiElement;
	container: HTMLDivElement;
	render: (tree: React.ReactNode) => void;
	cleanup: () => void;
};

export async function waitForEffects(steps = 2) {
	for (let index = 0; index < steps; index++) {
		await Promise.resolve();
	}
}

export function createReactHarness(
	name = "LoomPreviewHarnessRoot",
): ReactHarness {
	const playerGui = getLocalPlayerGui();
	const container = createTestContainer(name);
	const root = createRoot(container);

	return {
		playerGui,
		container,
		render: (tree) => {
			flushSync(() => {
				root.render(tree);
			});
		},
		cleanup: () => {
			flushSync(() => {
				root.unmount();
			});
			container.remove();
		},
	};
}

export function withReactHarness(
	name: string,
	callback: (harness: ReactHarness) => void,
) {
	const harness = createReactHarness(name);
	try {
		callback(harness);
	} finally {
		harness.cleanup();
	}
}
