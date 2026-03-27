import React from "react";
import { afterEach, describe, expect, it } from "vitest";

const PREVIEW_INTRINSIC_HOSTS_SYMBOL = Symbol.for(
	"loom-dev.preview-runtime.intrinsic-hosts",
);

afterEach(() => {
	delete (
		globalThis as typeof globalThis & {
			[PREVIEW_INTRINSIC_HOSTS_SYMBOL]?: Record<string, unknown>;
		}
	)[PREVIEW_INTRINSIC_HOSTS_SYMBOL];
});

describe("browser react shims", () => {
	it("maps preview intrinsic hosts in createElement", async () => {
		const hostComponent = () => null;
		(
			globalThis as typeof globalThis & {
				[PREVIEW_INTRINSIC_HOSTS_SYMBOL]?: Record<string, unknown>;
			}
		)[PREVIEW_INTRINSIC_HOSTS_SYMBOL] = {
			textlabel: hostComponent,
		};

		const reactShim = await import(
			"../../packages/preview/src/source/react-shims/browser/react.js"
		);
		const element = reactShim.createElement("textlabel", { Text: "ready" });

		expect(element.type).toBe(hostComponent);
	});

	it("exposes rbxts-react compatible Event and Change maps", async () => {
		const reactShim = await import(
			"../../packages/preview/src/source/react-shims/browser/react.js"
		);

		expect(reactShim.default.Event.Activated).toBe(
			"__previewReactEventActivated",
		);
		expect(reactShim.default.Event.FocusLost).toBe(
			"__previewReactEventFocusLost",
		);
		expect(reactShim.default.Event.InputBegan).toBe(
			"__previewReactEventInputBegan",
		);
		expect(reactShim.default.Change.Text).toBe("__previewReactChangeText");
	});

	it("re-exports React internal named exports without relying on CJS named export synthesis", async () => {
		const reactShim = await import(
			"../../packages/preview/src/source/react-shims/browser/react.js"
		);

		expect(
			reactShim.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE,
		).toBe(
			(
				React as typeof React & {
					__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE?: unknown;
				}
			).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE,
		);
		expect(reactShim.__COMPILER_RUNTIME).toBe(
			(React as typeof React & { __COMPILER_RUNTIME?: unknown })
				.__COMPILER_RUNTIME,
		);
	});

	it("maps preview intrinsic hosts in jsx runtime", async () => {
		const hostComponent = () => null;
		(
			globalThis as typeof globalThis & {
				[PREVIEW_INTRINSIC_HOSTS_SYMBOL]?: Record<string, unknown>;
			}
		)[PREVIEW_INTRINSIC_HOSTS_SYMBOL] = {
			textlabel: hostComponent,
		};

		const jsxRuntimeShim = await import(
			"../../packages/preview/src/source/react-shims/browser/react-jsx-runtime.js"
		);
		const element = jsxRuntimeShim.jsx("textlabel", { Text: "ready" });

		expect(element.type).toBe(hostComponent);
	});
});
