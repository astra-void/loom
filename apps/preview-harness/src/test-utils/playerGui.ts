import {
	game,
	type PreviewPlayerGui,
	type PreviewPlayersService,
} from "@loom-dev/preview-runtime";

export type PreviewPlayerGuiElement = PreviewPlayerGui & HTMLElement;

function getPlayersService() {
	return game.GetService("Players") as PreviewPlayersService;
}

export function getLocalPlayerGui(): PreviewPlayerGuiElement {
	const localPlayer = getPlayersService().LocalPlayer;
	if (!localPlayer) {
		throw new Error(
			"[preview-harness] LocalPlayer is required to run client-side tests.",
		);
	}

	const playerGuiInstance =
		localPlayer.FindFirstChild("PlayerGui") ??
		localPlayer.WaitForChild("PlayerGui");
	if (!playerGuiInstance?.IsA("BasePlayerGui")) {
		throw new Error(
			"[preview-harness] LocalPlayer.PlayerGui is required to run tests.",
		);
	}

	return playerGuiInstance as PreviewPlayerGuiElement;
}

export function createTestContainer(name: string) {
	const playerGui = getLocalPlayerGui();
	const container = document.createElement("div");
	container.setAttribute("data-preview-test-container", name);
	container.setAttribute("aria-label", name);
	playerGui.appendChild(container);

	return container;
}
