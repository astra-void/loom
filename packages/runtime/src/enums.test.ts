import { describe, expect, it } from "vitest";
import { Enum, EnumItem, enumName, enumTypeName, RobloxEnum } from "./enums";

/** Every enum in the namespace, paired with the key it answers to. */
function namespaceEntries(): [string, RobloxEnum][] {
	return (Object.entries(Enum) as [string, unknown][]).filter(
		(entry): entry is [string, RobloxEnum] => entry[1] instanceof RobloxEnum,
	);
}

/** The items an enum object carries, keyed by the property they sit under. */
function itemEntries(target: RobloxEnum): [string, EnumItem][] {
	return (Object.entries(target) as [string, unknown][]).filter(
		(entry): entry is [string, EnumItem] => entry[1] instanceof EnumItem,
	);
}

describe("EnumItem.Value carries the engine's number", () => {
	it("leads the alignment enums with Center, the way the engine numbers them", () => {
		// The trap this whole change exists for: read positionally, `Left` is 0
		// and a script comparing `.Value` against the engine's 1 gets it backwards.
		expect(Enum.HorizontalAlignment.Center.Value).toBe(0);
		expect(Enum.HorizontalAlignment.Left.Value).toBe(1);
		expect(Enum.HorizontalAlignment.Right.Value).toBe(2);
		expect(Enum.VerticalAlignment.Center.Value).toBe(0);
		expect(Enum.VerticalAlignment.Top.Value).toBe(1);
		expect(Enum.VerticalAlignment.Bottom.Value).toBe(2);
		// …while the text alignments put Center last, so one rule cannot cover both.
		expect(Enum.TextXAlignment.Left.Value).toBe(0);
		expect(Enum.TextXAlignment.Right.Value).toBe(1);
		expect(Enum.TextXAlignment.Center.Value).toBe(2);
		expect(Enum.TextYAlignment.Center.Value).toBe(1);
	});

	it("keeps the holes and the out-of-order tails the engine has", () => {
		// UserInputType skips 5 and 6 outright, and the gamepads start at 12.
		expect(Enum.UserInputType.MouseMovement.Value).toBe(4);
		expect(Enum.UserInputType.Touch.Value).toBe(7);
		expect(Enum.UserInputType.Gamepad1.Value).toBe(12);
		expect(Enum.UserInputType.None.Value).toBe(22);
		// EasingStyle grew Cubic last, so it sits at 10 behind Circular.
		expect(Enum.EasingStyle.Linear.Value).toBe(0);
		expect(Enum.EasingStyle.Sine.Value).toBe(1);
		expect(Enum.EasingStyle.Back.Value).toBe(2);
		expect(Enum.EasingStyle.Quad.Value).toBe(3);
		expect(Enum.EasingStyle.Circular.Value).toBe(9);
		expect(Enum.EasingStyle.Cubic.Value).toBe(10);
		// ScrollingDirection has no zero item and XY is 4, not X | Y.
		expect(Enum.ScrollingDirection.X.Value).toBe(1);
		expect(Enum.ScrollingDirection.Y.Value).toBe(2);
		expect(Enum.ScrollingDirection.XY.Value).toBe(4);
		// The legacy Font list is dense until Unknown, which is parked at 100.
		expect(Enum.Font.Legacy.Value).toBe(0);
		expect(Enum.Font.Jura.Value).toBe(30);
		expect(Enum.Font.ArimoBold.Value).toBe(51);
		expect(Enum.Font.Unknown.Value).toBe(100);
		// FontSize's later sizes were appended, so 28 is 10 and 96 is 14.
		expect(Enum.FontSize.Size48.Value).toBe(9);
		expect(Enum.FontSize.Size28.Value).toBe(10);
		expect(Enum.FontSize.Size96.Value).toBe(14);
		// SortOrder still has its deprecated middle item, so LayoutOrder is 2.
		expect(Enum.SortOrder.Name.Value).toBe(0);
		expect(Enum.SortOrder.Custom.Value).toBe(1);
		expect(Enum.SortOrder.LayoutOrder.Value).toBe(2);
	});

	it("keeps FontWeight on the CSS scale the font code reads", () => {
		expect(Enum.FontWeight.Regular.Value).toBe(400);
		expect(Enum.FontWeight.SemiBold.Value).toBe(600);
		expect(Enum.FontWeight.Heavy.Value).toBe(900);
	});

	it("numbers no enum twice", () => {
		for (const [key, target] of namespaceEntries()) {
			const items = target.GetEnumItems();
			const values = new Set(items.map((item) => item.Value));
			expect(`${key}:${values.size}`).toBe(`${key}:${items.length}`);
		}
	});
});

describe("EnumItem.EnumType is the enum itself", () => {
	it("returns the object a script can walk back through", () => {
		// `Enum.KeyCode.A.EnumType == Enum.KeyCode` in the engine, and what comes
		// back answers :GetEnumItems() — a dropdown listing an item's siblings
		// used to be handed the string "KeyCode" and had nothing to walk.
		expect(Enum.KeyCode.A.EnumType).toBe(Enum.KeyCode);
		expect(Enum.KeyCode.A.EnumType.GetEnumItems()).toContain(Enum.KeyCode.A);
		expect(Enum.KeyCode.A.EnumType.FromValue(97)).toBe(Enum.KeyCode.A);
	});

	it("still yields the bare type name for encoders, via enumTypeName", () => {
		// The Scene IR carries `{ enumType, name, value }` with enumType a string.
		expect(enumTypeName(Enum.KeyCode.A)).toBe("KeyCode");
		expect(enumTypeName(Enum.KeyCode)).toBe("KeyCode");
		expect(enumTypeName(Enum.SortOrder.LayoutOrder)).toBe("SortOrder");
		// The AutomaticCanvasSize alias reports the type the engine really has.
		expect(enumTypeName(Enum.AutomaticCanvasSize.XY)).toBe("AutomaticSize");
	});

	it("points every item at the enum it is filed under", () => {
		for (const [key, target] of namespaceEntries()) {
			for (const [name, item] of itemEntries(target)) {
				expect(`${key}.${name} -> ${enumTypeName(item)}`).toBe(
					`${key}.${name} -> ${enumTypeName(target)}`,
				);
				expect(item.EnumType).toBe(target);
			}
		}
	});

	it("files every item under its own name (aliases aside)", () => {
		for (const [key, target] of namespaceEntries()) {
			for (const [name, item] of itemEntries(target)) {
				// KeyCode.Unknown is the engine's old spelling of None, kept as an
				// alias; every other property name is the item's own name.
				if (key === "KeyCode" && name === "Unknown") continue;
				expect(`${key}.${name}`).toBe(`${key}.${item.Name}`);
			}
		}
	});

	it("prints the Roblox tostring shapes", () => {
		expect(String(Enum.KeyCode.Space)).toBe("Enum.KeyCode.Space");
		expect(String(Enum.KeyCode)).toBe("Enum.KeyCode");
		expect(`${Enum.SortOrder.Name}`).toBe("Enum.SortOrder.Name");
	});

	it("serialises as its tostring instead of walking the item/enum cycle", () => {
		// EnumType now points at the enum, which points back at every item, so a
		// naive JSON.stringify would throw on the cycle.
		expect(() => JSON.stringify(Enum.KeyCode.A)).not.toThrow();
		expect(JSON.parse(JSON.stringify(Enum.KeyCode.A))).toBe("Enum.KeyCode.A");
	});

	it("keeps the enum's own bookkeeping off the item namespace", () => {
		// `Enum.SortOrder.Name` is an item. Anything the enum stored under a
		// plain `Name` property would shadow it and silently re-sort every list.
		expect(Enum.SortOrder.Name).toBeInstanceOf(EnumItem);
		expect(Enum.SortOrder.Name.Name).toBe("Name");
		expect(Enum.AutomaticCanvasSize).toBe(Enum.AutomaticSize);
	});
});

describe("Enum.KeyCode covers a keyboard", () => {
	it("gives the digit row its ASCII codes", () => {
		const digits = [
			Enum.KeyCode.Zero,
			Enum.KeyCode.One,
			Enum.KeyCode.Two,
			Enum.KeyCode.Three,
			Enum.KeyCode.Four,
			Enum.KeyCode.Five,
			Enum.KeyCode.Six,
			Enum.KeyCode.Seven,
			Enum.KeyCode.Eight,
			Enum.KeyCode.Nine,
		];
		expect(digits.map((item) => item.Value)).toEqual([
			48, 49, 50, 51, 52, 53, 54, 55, 56, 57,
		]);
		expect(digits.map((item) => item.Name)).toEqual([
			"Zero",
			"One",
			"Two",
			"Three",
			"Four",
			"Five",
			"Six",
			"Seven",
			"Eight",
			"Nine",
		]);
	});

	it("gives every letter its lowercase ASCII code", () => {
		const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
		for (let i = 0; i < letters.length; i++) {
			const name = letters[i] as string;
			const item = (Enum.KeyCode as unknown as Record<string, EnumItem>)[name];
			expect(item?.Name).toBe(name);
			expect(item?.Value).toBe(97 + i);
		}
	});

	it("has the modifiers, with right before left as the engine numbers them", () => {
		expect(Enum.KeyCode.CapsLock.Value).toBe(301);
		expect(Enum.KeyCode.RightShift.Value).toBe(303);
		expect(Enum.KeyCode.LeftShift.Value).toBe(304);
		expect(Enum.KeyCode.RightControl.Value).toBe(305);
		expect(Enum.KeyCode.LeftControl.Value).toBe(306);
		expect(Enum.KeyCode.RightAlt.Value).toBe(307);
		expect(Enum.KeyCode.LeftAlt.Value).toBe(308);
		expect(Enum.KeyCode.RightMeta.Value).toBe(309);
		expect(Enum.KeyCode.LeftMeta.Value).toBe(310);
	});

	it("has the gamepad block at 1000+, X and Y before A and B", () => {
		expect(Enum.KeyCode.ButtonX.Value).toBe(1000);
		expect(Enum.KeyCode.ButtonY.Value).toBe(1001);
		expect(Enum.KeyCode.ButtonA.Value).toBe(1002);
		expect(Enum.KeyCode.ButtonB.Value).toBe(1003);
		expect(Enum.KeyCode.ButtonR1.Value).toBe(1004);
		expect(Enum.KeyCode.ButtonL1.Value).toBe(1005);
		expect(Enum.KeyCode.ButtonR2.Value).toBe(1006);
		expect(Enum.KeyCode.ButtonL2.Value).toBe(1007);
		expect(Enum.KeyCode.ButtonR3.Value).toBe(1008);
		expect(Enum.KeyCode.ButtonL3.Value).toBe(1009);
		expect(Enum.KeyCode.ButtonStart.Value).toBe(1010);
		expect(Enum.KeyCode.ButtonSelect.Value).toBe(1011);
		expect(Enum.KeyCode.DPadLeft.Value).toBe(1012);
		expect(Enum.KeyCode.DPadRight.Value).toBe(1013);
		expect(Enum.KeyCode.DPadUp.Value).toBe(1014);
		expect(Enum.KeyCode.DPadDown.Value).toBe(1015);
		expect(Enum.KeyCode.Thumbstick1.Value).toBe(1016);
		expect(Enum.KeyCode.Thumbstick2.Value).toBe(1017);
	});

	it("has the editing keys, arrows, keypad and function row", () => {
		expect(Enum.KeyCode.Backspace.Value).toBe(8);
		expect(Enum.KeyCode.Tab.Value).toBe(9);
		expect(Enum.KeyCode.Return.Value).toBe(13);
		expect(Enum.KeyCode.Escape.Value).toBe(27);
		expect(Enum.KeyCode.Space.Value).toBe(32);
		expect(Enum.KeyCode.Delete.Value).toBe(127);
		expect(Enum.KeyCode.Up.Value).toBe(273);
		expect(Enum.KeyCode.Down.Value).toBe(274);
		expect(Enum.KeyCode.Right.Value).toBe(275);
		expect(Enum.KeyCode.Left.Value).toBe(276);
		expect(Enum.KeyCode.Home.Value).toBe(278);
		expect(Enum.KeyCode.PageDown.Value).toBe(281);
		expect(Enum.KeyCode.KeypadZero.Value).toBe(256);
		expect(Enum.KeyCode.KeypadNine.Value).toBe(265);
		expect(Enum.KeyCode.KeypadEnter.Value).toBe(271);
		expect(Enum.KeyCode.F1.Value).toBe(282);
		expect(Enum.KeyCode.F12.Value).toBe(293);
	});

	it("has the punctuation a text field produces", () => {
		expect(Enum.KeyCode.Quote.Value).toBe(39);
		expect(Enum.KeyCode.Comma.Value).toBe(44);
		expect(Enum.KeyCode.Minus.Value).toBe(45);
		expect(Enum.KeyCode.Period.Value).toBe(46);
		expect(Enum.KeyCode.Slash.Value).toBe(47);
		expect(Enum.KeyCode.Semicolon.Value).toBe(59);
		expect(Enum.KeyCode.Equals.Value).toBe(61);
		expect(Enum.KeyCode.LeftBracket.Value).toBe(91);
		expect(Enum.KeyCode.BackSlash.Value).toBe(92);
		expect(Enum.KeyCode.RightBracket.Value).toBe(93);
		expect(Enum.KeyCode.Backquote.Value).toBe(96);
	});

	it("keeps Unknown as an alias of the engine's None, not a second item", () => {
		expect(Enum.KeyCode.None.Value).toBe(0);
		expect(Enum.KeyCode.Unknown).toBe(Enum.KeyCode.None);
		expect(Enum.KeyCode.Unknown.Name).toBe("None");
		const names = Enum.KeyCode.GetEnumItems().map((item) => item.Name);
		expect(names).not.toContain("Unknown");
		expect(names.filter((name) => name === "None")).toHaveLength(1);
	});
});

describe("Enum.CoreGuiType", () => {
	it("exists at all, so SetCoreGuiEnabled can be spelled", () => {
		// A preview has no CoreGui to switch off, but an app that hides the
		// backpack on boot crashed on `Enum.CoreGuiType.Backpack` being undefined.
		expect(Enum.CoreGuiType.PlayerList.Value).toBe(0);
		expect(Enum.CoreGuiType.Health.Value).toBe(1);
		expect(Enum.CoreGuiType.Backpack.Value).toBe(2);
		expect(Enum.CoreGuiType.Chat.Value).toBe(3);
		expect(Enum.CoreGuiType.All.Value).toBe(4);
		expect(Enum.CoreGuiType.EmotesMenu.Value).toBe(5);
		expect(Enum.CoreGuiType.SelfView.Value).toBe(6);
		expect(Enum.CoreGuiType.Captures.Value).toBe(7);
		expect(enumTypeName(Enum.CoreGuiType.All)).toBe("CoreGuiType");
	});
});

describe("reflection", () => {
	it("hands GetEnumItems out in engine order, as a fresh array", () => {
		const first = Enum.UserInputState.GetEnumItems();
		expect(first.map((item) => item.Name)).toEqual([
			"Begin",
			"Change",
			"End",
			"Cancel",
			"None",
		]);
		const second = Enum.UserInputState.GetEnumItems();
		expect(second).not.toBe(first);
		first.length = 0;
		expect(Enum.UserInputState.GetEnumItems()).toHaveLength(5);
	});

	it("finds items by name and by value, and nils out otherwise", () => {
		expect(Enum.FontSize.FromName("Size28")).toBe(Enum.FontSize.Size28);
		expect(Enum.FontSize.FromValue(10)).toBe(Enum.FontSize.Size28);
		expect(Enum.KeyCode.FromName("Nope")).toBeUndefined();
		expect(Enum.KeyCode.FromValue(999)).toBeUndefined();
	});

	it("lists every enum once through Enum.GetEnums()", () => {
		const enums = Enum.GetEnums();
		for (const target of enums) expect(target).toBeInstanceOf(RobloxEnum);
		expect(enums).toContain(Enum.KeyCode);
		expect(enums).toContain(Enum.CoreGuiType);
		expect(enums).toContain(Enum.AutomaticSize);
		// AutomaticSize answers to two keys but is one object, so it lists once.
		expect(
			enums.filter((target) => target === Enum.AutomaticSize),
		).toHaveLength(1);
		expect(new Set(enums).size).toBe(enums.length);
		// Every enum reachable off the namespace is in the list.
		for (const [, target] of namespaceEntries())
			expect(enums).toContain(target);
	});
});

describe("enumName", () => {
	it("reads the item name off either spelling, and nothing else", () => {
		expect(enumName(Enum.AutomaticSize.XY)).toBe("XY");
		expect(enumName("XY")).toBe("XY");
		expect(enumName("")).toBeUndefined();
		expect(enumName(undefined)).toBeUndefined();
		expect(enumName(3)).toBeUndefined();
	});
});
