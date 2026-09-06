/**
 * The class map is only ever wrong in one direction: a missing link does not
 * throw, it makes `IsA` answer `false` where Roblox answers `true`, and an app
 * that filters its own children by class then quietly renders nothing. So these
 * assert the *shape of the chain* — the abstract links included — rather than
 * "the class is known", which the unknown-class fallback would satisfy anyway.
 */
import { describe, expect, it, vi } from "vitest";
import { classChain, classParent, isA } from "./registry";

/** The chain as an array; the generator's order is part of the contract. */
const chain = (className: string): string[] => [...classChain(className)];

/**
 * Runs `body` with `console.warn` captured into a live array it can inspect as
 * it goes — the warn-once behaviour is only observable *between* two lookups,
 * so a spy checked after the fact would not see it.
 */
function withWarnings(body: (warnings: string[]) => void): void {
	const warnings: string[] = [];
	const spy = vi
		.spyOn(console, "warn")
		.mockImplementation((...args: unknown[]) => {
			warnings.push(args.map(String).join(" "));
		});
	try {
		body(warnings);
	} finally {
		spy.mockRestore();
	}
}

describe("classChain", () => {
	it("walks a class up to Instance in order", () => {
		expect(chain("TextButton")).toEqual([
			"TextButton",
			"GuiButton",
			"GuiObject",
			"GuiBase2d",
			"GuiBase",
			"Instance",
		]);
	});

	it("stops at Instance, which has no parent", () => {
		expect(classParent("Instance")).toBeUndefined();
		expect(chain("Instance")).toEqual(["Instance"]);
	});
});

describe("the GuiLabel branch", () => {
	// Roblox: GuiObject -> GuiLabel -> TextLabel / ImageLabel. Parenting the two
	// label classes straight to GuiObject kept `IsA("GuiObject")` right and
	// `IsA("GuiLabel")` wrong, which is the failure this branch exists to stop.
	it("puts both label classes under GuiLabel", () => {
		expect(classParent("TextLabel")).toBe("GuiLabel");
		expect(classParent("ImageLabel")).toBe("GuiLabel");
		expect(classParent("GuiLabel")).toBe("GuiObject");
		expect(chain("TextLabel")).toEqual([
			"TextLabel",
			"GuiLabel",
			"GuiObject",
			"GuiBase2d",
			"GuiBase",
			"Instance",
		]);
	});

	it("answers IsA GuiLabel for labels only", () => {
		expect(isA("TextLabel", "GuiLabel")).toBe(true);
		expect(isA("ImageLabel", "GuiLabel")).toBe(true);
		// A button is a GuiObject sibling, not a label — the classic mixup.
		expect(isA("TextButton", "GuiLabel")).toBe(false);
		expect(isA("ImageButton", "GuiLabel")).toBe(false);
		expect(isA("TextBox", "GuiLabel")).toBe(false);
		expect(isA("Frame", "GuiLabel")).toBe(false);
		// …and GuiLabel is not itself a button.
		expect(isA("GuiLabel", "GuiButton")).toBe(false);
	});

	it("keeps every answer the old flat chain already gave", () => {
		for (const cls of ["TextLabel", "ImageLabel"]) {
			expect(isA(cls, "GuiObject")).toBe(true);
			expect(isA(cls, "GuiBase2d")).toBe(true);
			expect(isA(cls, "Instance")).toBe(true);
			expect(isA(cls, "LayerCollector")).toBe(false);
		}
		// The rest of the GuiObject tree is untouched by the insertion.
		expect(isA("TextButton", "GuiButton")).toBe(true);
		expect(isA("ScrollingFrame", "GuiObject")).toBe(true);
		expect(isA("CanvasGroup", "GuiObject")).toBe(true);
		expect(isA("ViewportFrame", "GuiObject")).toBe(true);
		expect(isA("VideoFrame", "GuiObject")).toBe(true);
	});
});

describe("the ValueBase family", () => {
	const VALUE_CLASSES = [
		"BoolValue",
		"BrickColorValue",
		"CFrameValue",
		"Color3Value",
		"DoubleConstrainedValue",
		"IntConstrainedValue",
		"IntValue",
		"NumberValue",
		"ObjectValue",
		"RayValue",
		"StringValue",
		"Vector3Value",
	];

	it("parents every value object to ValueBase", () => {
		for (const cls of VALUE_CLASSES) {
			expect(chain(cls)).toEqual([cls, "ValueBase", "Instance"]);
			expect(isA(cls, "ValueBase")).toBe(true);
			expect(isA(cls, "Instance")).toBe(true);
		}
		expect(classParent("ValueBase")).toBe("Instance");
	});

	it("resolves them without the unknown-class warning", () => {
		// The gap that made this matter: `new Instance("IntValue")` warned on
		// every mount and then answered false to the one question a state holder
		// gets asked.
		withWarnings((warnings) => {
			for (const cls of VALUE_CLASSES) {
				expect(isA(cls, "ValueBase")).toBe(true);
			}
			expect(warnings).toEqual([]);
		});
	});

	it("does not make a value object a GUI object", () => {
		expect(isA("IntValue", "GuiObject")).toBe(false);
		expect(isA("ObjectValue", "GuiBase2d")).toBe(false);
		// Nor is a GUI object a value holder, despite both having `.Value`-ish
		// props in app code.
		expect(isA("TextBox", "ValueBase")).toBe(false);
		expect(isA("StringValue", "IntValue")).toBe(false);
	});
});

describe("layer collectors", () => {
	it("routes SurfaceGui through SurfaceGuiBase", () => {
		expect(chain("SurfaceGui")).toEqual([
			"SurfaceGui",
			"SurfaceGuiBase",
			"LayerCollector",
			"GuiBase2d",
			"GuiBase",
			"Instance",
		]);
		// ScreenGui and BillboardGui are LayerCollector siblings, not surfaces.
		expect(isA("ScreenGui", "SurfaceGuiBase")).toBe(false);
		expect(isA("BillboardGui", "LayerCollector")).toBe(true);
	});

	it("keeps collectors off the GuiObject branch", () => {
		expect(isA("ScreenGui", "GuiBase2d")).toBe(true);
		expect(isA("ScreenGui", "GuiObject")).toBe(false);
		// PlayerGui is a container, not a rendered 2d object at all.
		expect(isA("PlayerGui", "BasePlayerGui")).toBe(true);
		expect(isA("PlayerGui", "GuiBase2d")).toBe(false);
		expect(isA("StarterGui", "BasePlayerGui")).toBe(true);
	});
});

describe("non-GUI branches", () => {
	it("keeps the UI modifier chain intact", () => {
		expect(chain("UIListLayout")).toEqual([
			"UIListLayout",
			"UIGridStyleLayout",
			"UILayout",
			"UIComponent",
			"UIBase",
			"Instance",
		]);
		expect(isA("UITextSizeConstraint", "UIConstraint")).toBe(true);
		expect(isA("UICorner", "UILayout")).toBe(false);
		expect(isA("UICorner", "UIComponent")).toBe(true);
		expect(isA("UIListLayout", "GuiObject")).toBe(false);
	});

	it("gives workspace its real Model ancestry", () => {
		expect(chain("Workspace")).toEqual([
			"Workspace",
			"WorldRoot",
			"Model",
			"PVInstance",
			"Instance",
		]);
		expect(isA("Workspace", "Model")).toBe(true);
		expect(isA("Workspace", "GuiObject")).toBe(false);
	});

	it("keeps services resolvable and silent", () => {
		withWarnings((warnings) => {
			for (const cls of [
				"RunService",
				"TweenService",
				"UserInputService",
				"CollectionService",
				"ContextActionService",
				"HttpService",
				"TextService",
				"GuiService",
				"Players",
				"Lighting",
				"ReplicatedStorage",
				"Debris",
			]) {
				// A miss walks the whole chain, so an unregistered service warns here.
				expect(isA(cls, "GuiObject")).toBe(false);
			}
			expect(isA("DataModel", "ServiceProvider")).toBe(true);
			expect(isA("Tween", "TweenBase")).toBe(true);
			expect(warnings).toEqual([]);
		});
	});
});

describe("the unknown-class fallback", () => {
	it("treats an unknown class as a direct Instance subclass, warning once", () => {
		withWarnings((warnings) => {
			expect(chain("NotARobloxClassAtAll")).toEqual([
				"NotARobloxClassAtAll",
				"Instance",
			]);
			expect(warnings).toHaveLength(1);
			expect(warnings[0]).toContain("NotARobloxClassAtAll");
			// Repeat lookups stay silent — a per-frame walk must not spam.
			expect(isA("NotARobloxClassAtAll", "GuiObject")).toBe(false);
			expect(warnings).toHaveLength(1);
			// …but a *different* unknown class still gets its own warning.
			expect(isA("AlsoNotARobloxClass", "GuiObject")).toBe(false);
			expect(warnings).toHaveLength(2);
		});
	});

	it("answers IsA Instance without walking, so it never warns", () => {
		withWarnings((warnings) => {
			expect(isA("StillNotARobloxClass", "Instance")).toBe(true);
			expect(warnings).toEqual([]);
		});
	});
});
