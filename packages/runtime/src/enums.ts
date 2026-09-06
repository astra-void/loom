/**
 * `enums.ts` — the Roblox `Enum` namespace (the subset loom needs).
 *
 * Layout enums (FillDirection, SortOrder, …) plus the input/interaction enums
 * the interactive runtime dispatches (UserInputType, KeyCode, UserInputState).
 * The layout engine and the event code key on `Name`, which stays the
 * authoritative half across the wasm boundary — but `Value` is now the engine's
 * own number rather than a declaration index, because scripts compare it,
 * serialise it and switch on it. Roblox does not number enums positionally:
 * `HorizontalAlignment.Center` is 0 and `Left` is 1, `KeyCode.A` is 97,
 * `UserInputType.Touch` is 7 with 5 and 6 skipped, `EasingStyle.Cubic` is 10
 * and `Font.Unknown` is 100. Every number below is the engine's, read off the
 * published enum reference rather than counted.
 */

/**
 * A Roblox `Enum` — the namespace object itself (`Enum.KeyCode`), not one of
 * its items.
 *
 * It exists because {@link EnumItem.EnumType} has to return it: in the engine
 * `Enum.KeyCode.A.EnumType == Enum.KeyCode` is true and what comes back answers
 * `:GetEnumItems()`. loom used to hand back the bare string `"KeyCode"`, so a
 * script that walked an item back to its enum — a dropdown listing the siblings
 * of the value it was handed, a validator checking membership — got a string
 * with no members on it.
 *
 * The items live on the object under their own names, so the enum keeps nothing
 * of its own there: `Enum.SortOrder.Name` is an *item* (the engine's default
 * sort), and a `Name` property would shadow it with a string and quietly
 * re-sort every list in the preview. The type name and the item list are
 * `#private` instead, which also keeps them out of `Object.keys`, `for…in` and
 * `JSON.stringify` — an enum still serialises as its items and nothing else.
 */
export class RobloxEnum<E extends string = string> {
	readonly #typeName: E;
	readonly #items: readonly EnumItem<E>[];

	constructor(typeName: E, values: Record<string, number>) {
		this.#typeName = typeName;
		const items: EnumItem<E>[] = [];
		const byName: Record<string, EnumItem<E>> = {};
		for (const [name, value] of Object.entries(values)) {
			const item = new EnumItem<E>(this, name, value);
			items.push(item);
			byName[name] = item;
		}
		this.#items = items;
		Object.assign(this, byName);
	}

	/**
	 * The bare type name (`"KeyCode"`). A static, because every *instance* name
	 * on an enum is a name an item could take; {@link enumTypeName} is the
	 * friendlier way in.
	 */
	static nameOf(target: RobloxEnum): string {
		return target.#typeName;
	}

	/**
	 * Every item of this enum, in the engine's declaration order — a fresh array
	 * each call, as in Roblox, so a caller that sorts or reverses the result
	 * cannot reorder the enum itself.
	 */
	GetEnumItems(): EnumItem<E>[] {
		return [...this.#items];
	}

	/** `Enum.KeyCode:FromName("A")`; `undefined` (Luau `nil`) when nothing matches. */
	FromName(name: string): EnumItem<E> | undefined {
		return this.#items.find((item) => item.Name === name);
	}

	/** `Enum.KeyCode:FromValue(97)`; `undefined` (Luau `nil`) when nothing matches. */
	FromValue(value: number): EnumItem<E> | undefined {
		return this.#items.find((item) => item.Value === value);
	}

	/** Roblox `tostring(Enum.KeyCode)` shape: `Enum.<Type>`. */
	toString(): string {
		return `Enum.${this.#typeName}`;
	}
}

/**
 * A Roblox `Enum` item, e.g. `Enum.FillDirection.Vertical`. Generic over its enum
 * type so adapter props can constrain to one enum (`EnumItem<"FillDirection">`).
 */
export class EnumItem<T extends string = string> {
	constructor(
		readonly EnumType: RobloxEnum<T>,
		readonly Name: string,
		readonly Value: number,
	) {}

	/** Roblox `tostring(enumItem)` shape: `Enum.<Type>.<Name>`. */
	toString(): string {
		return `Enum.${RobloxEnum.nameOf(this.EnumType)}.${this.Name}`;
	}

	/**
	 * `EnumType` points at the enum and the enum points back at every item, so
	 * a plain `JSON.stringify` of a live property would walk that cycle and
	 * throw where it used to print an object. Serialise the way `tostring` does
	 * instead — the Scene IR builds its enum prop by hand in `datatypes.ts`, so
	 * nothing load-bearing goes through here.
	 */
	toJSON(): string {
		return this.toString();
	}
}

/**
 * The item name behind an enum-valued property, however it was written.
 *
 * The engine takes the bare string wherever it takes the item —
 * `AutomaticSize = "XY"` is `Enum.AutomaticSize.XY`, and roblox-ts's own React
 * typings offer both — so a reader that insists on an `EnumItem` silently drops
 * half the ways the property is spelled. `@loom-dev/scene` has always accepted
 * either; this is the same courtesy for code reading a *live instance*, where
 * the value has not been through the encoder yet.
 *
 * Anything else — a Binding, a number, undefined — is `undefined`, which is
 * what "this property does not name an item" was before.
 */
export function enumName(value: unknown): string | undefined {
	if (value instanceof EnumItem) return value.Name;
	if (typeof value === "string" && value !== "") return value;
	return undefined;
}

/**
 * The bare type name behind an item or an enum — `"KeyCode"`, not the
 * `"Enum.KeyCode"` that `tostring` gives.
 *
 * Encoders want exactly this: the Scene IR carries an enum prop as
 * `{ enumType, name, value }` with `enumType` a plain string, and `EnumType`
 * itself is now the enum object rather than that string.
 */
export function enumTypeName(value: EnumItem | RobloxEnum): string {
	return RobloxEnum.nameOf(value instanceof EnumItem ? value.EnumType : value);
}

/**
 * Builds one enum: the object, its items, and the back-pointer each item keeps
 * to it.
 *
 * Every value is written out per item instead of being counted from position,
 * because the engine's numbering is not positional often enough that inferring
 * it is how `.Value` went wrong in the first place.
 */
function makeEnum<E extends string, T extends Record<string, number>>(
	typeName: E,
	values: T,
): RobloxEnum<E> & { [K in keyof T]: EnumItem<E> } {
	return new RobloxEnum(typeName, values) as RobloxEnum<E> & {
		[K in keyof T]: EnumItem<E>;
	};
}

// `AutomaticCanvasSize` has no enum of its own in Roblox — the property reads
// `Enum.AutomaticSize` — so both keys alias one item set.
const automaticSize = makeEnum("AutomaticSize", {
	None: 0,
	X: 1,
	Y: 2,
	XY: 3,
});

/**
 * `Enum.KeyCode`, in engine order, which is SDL's: the printable keys carry
 * their ASCII code (`A` is 97, `Zero` is 48), the keypad and the navigation
 * cluster sit at 256+, the function keys at 282+, the modifiers at 300+ and the
 * gamepad at 1000+. A keyboard-driven UI needs the digits, the modifiers and
 * the letters to *exist* before it can compare against them; before this, half
 * of `Enum.KeyCode` was `undefined`.
 *
 * Left out: `World0`–`World95` (160–255, SDL's international keys) and the
 * 1018+ block (thumbstick directions and the mouse/trackpad aliases). Nothing a
 * browser can deliver produces them, and a wrong number is worse than a missing
 * one — they can be added from the engine reference the day something needs them.
 */
const keyCodeItems = makeEnum("KeyCode", {
	None: 0,
	Backspace: 8,
	Tab: 9,
	Clear: 12,
	Return: 13,
	Pause: 19,
	Escape: 27,
	Space: 32,
	QuotedDouble: 34,
	Hash: 35,
	Dollar: 36,
	Percent: 37,
	Ampersand: 38,
	Quote: 39,
	LeftParenthesis: 40,
	RightParenthesis: 41,
	Asterisk: 42,
	Plus: 43,
	Comma: 44,
	Minus: 45,
	Period: 46,
	Slash: 47,
	Zero: 48,
	One: 49,
	Two: 50,
	Three: 51,
	Four: 52,
	Five: 53,
	Six: 54,
	Seven: 55,
	Eight: 56,
	Nine: 57,
	Colon: 58,
	Semicolon: 59,
	LessThan: 60,
	Equals: 61,
	GreaterThan: 62,
	Question: 63,
	At: 64,
	LeftBracket: 91,
	BackSlash: 92,
	RightBracket: 93,
	Caret: 94,
	Underscore: 95,
	Backquote: 96,
	A: 97,
	B: 98,
	C: 99,
	D: 100,
	E: 101,
	F: 102,
	G: 103,
	H: 104,
	I: 105,
	J: 106,
	K: 107,
	L: 108,
	M: 109,
	N: 110,
	O: 111,
	P: 112,
	Q: 113,
	R: 114,
	S: 115,
	T: 116,
	U: 117,
	V: 118,
	W: 119,
	X: 120,
	Y: 121,
	Z: 122,
	LeftCurly: 123,
	Pipe: 124,
	RightCurly: 125,
	Tilde: 126,
	Delete: 127,
	KeypadZero: 256,
	KeypadOne: 257,
	KeypadTwo: 258,
	KeypadThree: 259,
	KeypadFour: 260,
	KeypadFive: 261,
	KeypadSix: 262,
	KeypadSeven: 263,
	KeypadEight: 264,
	KeypadNine: 265,
	KeypadPeriod: 266,
	KeypadDivide: 267,
	KeypadMultiply: 268,
	KeypadMinus: 269,
	KeypadPlus: 270,
	KeypadEnter: 271,
	KeypadEquals: 272,
	Up: 273,
	Down: 274,
	Right: 275,
	Left: 276,
	Insert: 277,
	Home: 278,
	End: 279,
	PageUp: 280,
	PageDown: 281,
	F1: 282,
	F2: 283,
	F3: 284,
	F4: 285,
	F5: 286,
	F6: 287,
	F7: 288,
	F8: 289,
	F9: 290,
	F10: 291,
	F11: 292,
	F12: 293,
	F13: 294,
	F14: 295,
	F15: 296,
	NumLock: 300,
	CapsLock: 301,
	ScrollLock: 302,
	RightShift: 303,
	LeftShift: 304,
	RightControl: 305,
	LeftControl: 306,
	RightAlt: 307,
	LeftAlt: 308,
	RightMeta: 309,
	LeftMeta: 310,
	LeftSuper: 311,
	RightSuper: 312,
	Mode: 313,
	Compose: 314,
	Help: 315,
	Print: 316,
	SysReq: 317,
	Break: 318,
	Menu: 319,
	Power: 320,
	Euro: 321,
	Undo: 322,
	ButtonX: 1000,
	ButtonY: 1001,
	ButtonA: 1002,
	ButtonB: 1003,
	ButtonR1: 1004,
	ButtonL1: 1005,
	ButtonR2: 1006,
	ButtonL2: 1007,
	ButtonR3: 1008,
	ButtonL3: 1009,
	ButtonStart: 1010,
	ButtonSelect: 1011,
	DPadLeft: 1012,
	DPadRight: 1013,
	DPadUp: 1014,
	DPadDown: 1015,
	Thumbstick1: 1016,
	Thumbstick2: 1017,
});

/**
 * `Enum.KeyCode.Unknown` is no longer an engine member: the engine renamed the
 * zero item to `None`. loom shipped `Unknown`, and `input.ts` still spells its
 * "this input carries no key" default that way, so keep the old name as an
 * alias of the real item rather than as a second item — it stays out of
 * `GetEnumItems()`, and `Enum.KeyCode.Unknown == Enum.KeyCode.None` is true, so
 * code written against either spelling compares equal.
 */
const keyCode = Object.assign(keyCodeItems, { Unknown: keyCodeItems.None });

/**
 * Every enum, keyed by the name it answers to under `Enum`. Split out from the
 * exported namespace only so `GetEnums` can read the list without TypeScript
 * chasing `Enum`'s own type through its own initializer.
 */
const namespaces = {
	FillDirection: makeEnum("FillDirection", { Horizontal: 0, Vertical: 1 }),
	/** `Center` is 0 here, not `Left` — the engine leads with the middle. */
	HorizontalAlignment: makeEnum("HorizontalAlignment", {
		Center: 0,
		Left: 1,
		Right: 2,
	}),
	VerticalAlignment: makeEnum("VerticalAlignment", {
		Center: 0,
		Top: 1,
		Bottom: 2,
	}),
	/**
	 * The engine's default on every `UIGridStyleLayout` is `Name`, not
	 * `LayoutOrder` — a list that never sets it flows alphabetically. `Custom`
	 * is the engine's deprecated third item; it is here so a script that names
	 * it does not read `undefined`, and loom's layout only special-cases `Name`.
	 */
	SortOrder: makeEnum("SortOrder", { Name: 0, Custom: 1, LayoutOrder: 2 }),
	/** `UITableLayout.MajorAxis`: are the direct children rows, or columns? */
	TableMajorAxis: makeEnum("TableMajorAxis", { RowMajor: 0, ColumnMajor: 1 }),
	AutomaticSize: automaticSize,
	AutomaticCanvasSize: automaticSize,
	DominantAxis: makeEnum("DominantAxis", { Width: 0, Height: 1 }),
	AspectType: makeEnum("AspectType", {
		FitWithinMaxSize: 0,
		ScaleWithParentSize: 1,
	}),
	StartCorner: makeEnum("StartCorner", {
		TopLeft: 0,
		TopRight: 1,
		BottomLeft: 2,
		BottomRight: 3,
	}),
	/** `Center` is 2 here, unlike the alignment enums above. */
	TextXAlignment: makeEnum("TextXAlignment", { Left: 0, Right: 1, Center: 2 }),
	TextYAlignment: makeEnum("TextYAlignment", { Top: 0, Center: 1, Bottom: 2 }),
	ApplyStrokeMode: makeEnum("ApplyStrokeMode", { Contextual: 0, Border: 1 }),
	/**
	 * `GuiObject.BorderMode` — which side of the frame's edge the 1px border is
	 * drawn on. `Outline` (the default) puts it wholly outside the frame, so it
	 * costs no content space; `Inset` puts it wholly inside; `Middle` straddles.
	 * The renderer needs the distinction because CSS `border` always grows the
	 * box, which none of the three do.
	 */
	BorderMode: makeEnum("BorderMode", { Outline: 0, Middle: 1, Inset: 2 }),
	/**
	 * `Player.MembershipType`. A preview has no real account behind it, so the
	 * fake `Player` reports `None` — but profile UI still branches on this, and
	 * the branch has to compare against real enum items.
	 */
	MembershipType: makeEnum("MembershipType", {
		None: 0,
		BuildersClub: 1,
		TurboBuildersClub: 2,
		OutrageousBuildersClub: 3,
		Premium: 4,
	}),
	/** `ContentProvider:GetAssetFetchStatus` / `.AssetFetchStatusChanged`. */
	AssetFetchStatus: makeEnum("AssetFetchStatus", {
		Success: 0,
		Failure: 1,
		None: 2,
		Loading: 3,
		TimedOut: 4,
	}),
	/** `Players:GetUserThumbnailAsync` — which portrait the CDN should cut. */
	ThumbnailType: makeEnum("ThumbnailType", {
		HeadShot: 0,
		AvatarBust: 1,
		AvatarThumbnail: 2,
	}),
	/**
	 * The companion size argument. The names are Roblox's (`Size48x48`), and the
	 * values are declaration order in the engine, not the pixel count.
	 */
	ThumbnailSize: makeEnum("ThumbnailSize", {
		Size48x48: 0,
		Size180x180: 1,
		Size420x420: 2,
		Size60x60: 3,
		Size100x100: 4,
		Size150x150: 5,
		Size352x352: 6,
	}),
	/**
	 * `UIListLayout.HorizontalFlex` / `.VerticalFlex` — how leftover space along
	 * an axis is distributed. On the fill axis every value applies; on the cross
	 * axis only `Fill` (stretch) means anything.
	 */
	UIFlexAlignment: makeEnum("UIFlexAlignment", {
		None: 0,
		Fill: 1,
		SpaceAround: 2,
		SpaceBetween: 3,
		SpaceEvenly: 4,
	}),
	/** `UIFlexItem.FlexMode` — how one child takes part in that distribution. */
	UIFlexMode: makeEnum("UIFlexMode", {
		None: 0,
		Grow: 1,
		Shrink: 2,
		Fill: 3,
		Custom: 4,
	}),
	/**
	 * The modern `Font` datatype's weight axis. Values are Roblox's own (and
	 * CSS's) 100–900 scale, not declaration indices.
	 */
	FontWeight: makeEnum("FontWeight", {
		Thin: 100,
		ExtraLight: 200,
		Light: 300,
		Regular: 400,
		Medium: 500,
		SemiBold: 600,
		Bold: 700,
		ExtraBold: 800,
		Heavy: 900,
	}),
	FontStyle: makeEnum("FontStyle", { Normal: 0, Italic: 1 }),
	/**
	 * The legacy `Font` enum (`TextLabel.Font`), superseded by `FontFace`.
	 *
	 * The engine's whole list, in the engine's own order. It used to be the
	 * sixteen names loom happened to paint, so `Enum.Font.Jura` was `undefined`
	 * in a preview and the scene that read it crashed before it drew anything.
	 * `Unknown` is 100, not 52 — the engine parked it well past the families.
	 */
	Font: makeEnum("Font", {
		Legacy: 0,
		Arial: 1,
		ArialBold: 2,
		SourceSans: 3,
		SourceSansBold: 4,
		SourceSansLight: 5,
		SourceSansItalic: 6,
		Bodoni: 7,
		Garamond: 8,
		Cartoon: 9,
		Code: 10,
		Highway: 11,
		SciFi: 12,
		Arcade: 13,
		Fantasy: 14,
		Antique: 15,
		SourceSansSemibold: 16,
		Gotham: 17,
		GothamMedium: 18,
		GothamBold: 19,
		GothamBlack: 20,
		AmaticSC: 21,
		Bangers: 22,
		Creepster: 23,
		DenkOne: 24,
		Fondamento: 25,
		FredokaOne: 26,
		GrenzeGotisch: 27,
		IndieFlower: 28,
		JosefinSans: 29,
		Jura: 30,
		Kalam: 31,
		LuckiestGuy: 32,
		Merriweather: 33,
		Michroma: 34,
		Nunito: 35,
		Oswald: 36,
		PatrickHand: 37,
		PermanentMarker: 38,
		Roboto: 39,
		RobotoCondensed: 40,
		RobotoMono: 41,
		Sarpanch: 42,
		SpecialElite: 43,
		TitilliumWeb: 44,
		Ubuntu: 45,
		BuilderSans: 46,
		BuilderSansMedium: 47,
		BuilderSansBold: 48,
		BuilderSansExtraBold: 49,
		Arimo: 50,
		ArimoBold: 51,
		Unknown: 100,
	}),
	/**
	 * 5 and 6 are holes in the engine's numbering, and the gamepads run 12–19 —
	 * which is why `Gamepad1` was 7 here while the engine calls it 12. The full
	 * list is present so `input.UserInputType == Enum.UserInputType.Gamepad2`
	 * compares against something.
	 */
	UserInputType: makeEnum("UserInputType", {
		MouseButton1: 0,
		MouseButton2: 1,
		MouseButton3: 2,
		MouseWheel: 3,
		MouseMovement: 4,
		Touch: 7,
		Keyboard: 8,
		Focus: 9,
		Accelerometer: 10,
		Gyro: 11,
		Gamepad1: 12,
		Gamepad2: 13,
		Gamepad3: 14,
		Gamepad4: 15,
		Gamepad5: 16,
		Gamepad6: 17,
		Gamepad7: 18,
		Gamepad8: 19,
		TextInput: 20,
		InputMethod: 21,
		None: 22,
	}),
	KeyCode: keyCode,
	UserInputState: makeEnum("UserInputState", {
		Begin: 0,
		Change: 1,
		End: 2,
		Cancel: 3,
		None: 4,
	}),
	/**
	 * `StarterGui:SetCoreGuiEnabled(coreGuiType, enabled)` takes one of these.
	 * A preview has no CoreGui to switch off, but the call has to be spellable
	 * or the app crashes on boot — and `All` is 4, after the four it covers.
	 */
	CoreGuiType: makeEnum("CoreGuiType", {
		PlayerList: 0,
		Health: 1,
		Backpack: 2,
		Chat: 3,
		All: 4,
		EmotesMenu: 5,
		SelfView: 6,
		Captures: 7,
		AvatarSwitcher: 8,
		ExperienceShop: 9,
	}),
	ZIndexBehavior: makeEnum("ZIndexBehavior", { Global: 0, Sibling: 1 }),
	ScreenInsets: makeEnum("ScreenInsets", {
		None: 0,
		DeviceSafeInsets: 1,
		CoreUISafeInsets: 2,
		TopbarSafeInsets: 3,
	}),
	SelectionBehavior: makeEnum("SelectionBehavior", { Escape: 0, Stop: 1 }),
	/**
	 * `Sine` and `Back` come before `Quad` in the engine's numbering, and
	 * `Cubic` is 10 — it was added after the rest, so it sits at the end
	 * however early it reads in the list.
	 */
	EasingStyle: makeEnum("EasingStyle", {
		Linear: 0,
		Sine: 1,
		Back: 2,
		Quad: 3,
		Quart: 4,
		Quint: 5,
		Bounce: 6,
		Elastic: 7,
		Exponential: 8,
		Circular: 9,
		Cubic: 10,
	}),
	EasingDirection: makeEnum("EasingDirection", { In: 0, Out: 1, InOut: 2 }),
	/** `Tween.PlaybackState`, and the argument `Tween.Completed` carries. */
	PlaybackState: makeEnum("PlaybackState", {
		Begin: 0,
		Delayed: 1,
		Playing: 2,
		Paused: 3,
		Completed: 4,
		Cancelled: 5,
	}),
	TextTruncate: makeEnum("TextTruncate", { None: 0, AtEnd: 1, SplitWord: 2 }),
	ElasticBehavior: makeEnum("ElasticBehavior", {
		WhenScrollable: 0,
		Always: 1,
		Never: 2,
	}),
	/** No zero item, and `XY` is 4 rather than the `X | Y` a reader would guess. */
	ScrollingDirection: makeEnum("ScrollingDirection", { X: 1, Y: 2, XY: 4 }),
	ScrollBarInset: makeEnum("ScrollBarInset", {
		None: 0,
		ScrollBar: 1,
		Always: 2,
	}),
	// Declared in Roblox's own order (28/32/42/60/96 were appended after 48), so
	// the names read the same in both, and 28 really is 10. The pixel size lives
	// in the name, not in `Value` — `@loom-dev/scene`'s `fontSizeToPx` parses it.
	FontSize: makeEnum("FontSize", {
		Size8: 0,
		Size9: 1,
		Size10: 2,
		Size11: 3,
		Size12: 4,
		Size14: 5,
		Size18: 6,
		Size24: 7,
		Size36: 8,
		Size48: 9,
		Size28: 10,
		Size32: 11,
		Size42: 12,
		Size60: 13,
		Size96: 14,
	}),
	/** `ImageLabel.ScaleType` — all five are painted. */
	ScaleType: makeEnum("ScaleType", {
		Stretch: 0,
		Slice: 1,
		Tile: 2,
		Fit: 3,
		Crop: 4,
	}),
	/**
	 * `ImageLabel.ResampleMode`: `Pixelated` turns off smoothing when an image is
	 * scaled up (CSS `image-rendering: pixelated`).
	 */
	ResamplerMode: makeEnum("ResamplerMode", { Default: 0, Pixelated: 1 }),
	BorderStrokePosition: makeEnum("BorderStrokePosition", {
		Outer: 0,
		Center: 1,
		Inner: 2,
	}),
};

/** The Roblox `Enum` namespace (layout + input subset). */
export const Enum = {
	...namespaces,
	/**
	 * Roblox's `Enum:GetEnums()` — reflection, which is how a devtools panel or
	 * a property-grid finds out what an enum-valued property will accept.
	 *
	 * Declaration order, not the engine's alphabetical one; nothing should
	 * depend on either. `AutomaticSize` appears once even though the namespace
	 * answers to it under two names, because the two keys are one object.
	 */
	GetEnums(): RobloxEnum[] {
		return [...new Set<RobloxEnum>(Object.values(namespaces))];
	},
};
