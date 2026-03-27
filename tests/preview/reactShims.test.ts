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
