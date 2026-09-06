/**
 * `registry.ts` — the class hierarchy behind `Instance.IsA`.
 *
 * A flat child → parent map covering the GUI classes loom renders plus the
 * service classnames the fake `game` tree exposes. `isA` walks the chain up to
 * `Instance` (always true). Unknown classes are treated as direct `Instance`
 * subclasses with a one-time warning, so a preview never crashes on a class
 * the registry hasn't met yet.
 *
 * That fallback is also what makes a missing entry dangerous rather than merely
 * noisy: nothing throws, the class simply answers `false` to every `IsA` an app
 * cares about — `IsA("GuiObject")`, `IsA("ValueBase")` — while the preview goes
 * on looking fine. So the parentage below follows Roblox's own class dump link
 * for link, *including* the abstract classes nothing ever constructs
 * (`GuiBase`, `GuiLabel`, `SurfaceGuiBase`, `ValueBase`): those are precisely
 * the names `IsA` gets asked about, and they only exist to be asked about.
 */

const CLASS_PARENTS: Record<string, string> = {
	// GUI object tree. `GuiBase` is the shared root of Roblox's 2d and 3d GUI
	// classes; loom models only the 2d half, but `IsA("GuiBase")` still has to
	// answer true for everything hanging under it.
	GuiBase: "Instance",
	GuiBase2d: "GuiBase",
	GuiObject: "GuiBase2d",
	Frame: "GuiObject",
	ScrollingFrame: "GuiObject",
	CanvasGroup: "GuiObject",
	GuiButton: "GuiObject",
	TextButton: "GuiButton",
	ImageButton: "GuiButton",
	// `GuiLabel` is abstract, so nothing constructs one — but it is the class a
	// "display-only widget?" check names, and Roblox parents both label classes
	// to it. Hanging TextLabel/ImageLabel straight off GuiObject still answered
	// `IsA("GuiObject")` correctly, which is why the gap hid for so long; what
	// it got wrong was `IsA("GuiLabel")`, silently, in the direction that makes
	// an app skip its own labels.
	GuiLabel: "GuiObject",
	TextLabel: "GuiLabel",
	ImageLabel: "GuiLabel",
	TextBox: "GuiObject",
	VideoFrame: "GuiObject",
	ViewportFrame: "GuiObject",
	// Layer collectors and player containers.
	LayerCollector: "GuiBase2d",
	ScreenGui: "LayerCollector",
	// SurfaceGui is not a direct LayerCollector: Roblox splits the adornee/face
	// half into `SurfaceGuiBase` and hangs SurfaceGui off that.
	SurfaceGuiBase: "LayerCollector",
	SurfaceGui: "SurfaceGuiBase",
	BillboardGui: "LayerCollector",
	BasePlayerGui: "Instance",
	PlayerGui: "BasePlayerGui",
	// Non-GUI tree participants.
	Folder: "Instance",
	// App-owned signals: `Event` / `Fire` are answered in `./instance.ts`.
	BindableEvent: "Instance",
	Camera: "Instance",
	Player: "Instance",
	ServiceProvider: "Instance",
	DataModel: "ServiceProvider",
	// Value objects. loom paints none of these — they are a `Value` property and
	// a `Changed` signal — but roblox-ts apps park shared state in them, so
	// `new Instance("IntValue")` is ordinary GUI-app code. Without the family
	// every one of them was an unknown class: a warning per mount, and an
	// `IsA("ValueBase")` that said false.
	ValueBase: "Instance",
	BoolValue: "ValueBase",
	BrickColorValue: "ValueBase",
	CFrameValue: "ValueBase",
	Color3Value: "ValueBase",
	DoubleConstrainedValue: "ValueBase",
	IntConstrainedValue: "ValueBase",
	IntValue: "ValueBase",
	NumberValue: "ValueBase",
	ObjectValue: "ValueBase",
	RayValue: "ValueBase",
	StringValue: "ValueBase",
	Vector3Value: "ValueBase",
	// UI modifier components.
	UIBase: "Instance",
	UIComponent: "UIBase",
	UICorner: "UIComponent",
	UIPadding: "UIComponent",
	UIStroke: "UIComponent",
	UIShadow: "UIComponent",
	UIGradient: "UIComponent",
	UIScale: "UIComponent",
	UIFlexItem: "UIComponent",
	UILayout: "UIComponent",
	UIGridStyleLayout: "UILayout",
	UIListLayout: "UIGridStyleLayout",
	UIGridLayout: "UIGridStyleLayout",
	UIPageLayout: "UIGridStyleLayout",
	UITableLayout: "UIGridStyleLayout",
	UIConstraint: "UIComponent",
	UISizeConstraint: "UIConstraint",
	UITextSizeConstraint: "UIConstraint",
	UIAspectRatioConstraint: "UIConstraint",
	// Tweening.
	TweenBase: "Instance",
	Tween: "TweenBase",
	// Service classnames (`game.GetService` singletons).
	GuiService: "Instance",
	RunService: "Instance",
	TweenService: "Instance",
	UserInputService: "Instance",
	Players: "Instance",
	// `workspace` is a Model underneath (WorldRoot adds the spatial-query half),
	// and `workspace:IsA("Model")` is true in Roblox. loom renders no 3d tree, so
	// these three links exist for exactly one reason: to keep that answer honest
	// for code that walks `game` generically.
	PVInstance: "Instance",
	Model: "PVInstance",
	WorldRoot: "Model",
	Workspace: "WorldRoot",
	ContextActionService: "Instance",
	HttpService: "Instance",
	CollectionService: "Instance",
	TextService: "Instance",
	Debris: "Instance",
	Lighting: "Instance",
	ReplicatedFirst: "Instance",
	ReplicatedStorage: "Instance",
	ServerScriptService: "Instance",
	ServerStorage: "Instance",
	SoundService: "Instance",
	StarterGui: "BasePlayerGui",
	StarterPack: "Instance",
	StarterPlayer: "Instance",
	Teams: "Instance",
	GetTextBoundsParams: "Instance",
	// `ContentProvider` is a service loom actually implements, so leaving it out
	// would make its very first use log an "unknown class" warning about loom's
	// own code. The rest are services an app can legitimately `GetService`
	// without loom implementing them: registering the classname keeps the
	// warning for a genuine typo instead of firing on every real service name.
	ContentProvider: "Instance",
	MarketplaceService: "Instance",
	TextChatService: "Instance",
	LocalizationService: "Instance",
	LogService: "Instance",
	Stats: "Instance",
	TeleportService: "Instance",
	MessagingService: "Instance",
	DataStoreService: "Instance",
	MemoryStoreService: "Instance",
	PolicyService: "Instance",
	AnalyticsService: "Instance",
	BadgeService: "Instance",
	GroupService: "Instance",
	InsertService: "Instance",
	PathfindingService: "Instance",
	ProximityPromptService: "Instance",
	HapticService: "Instance",
	VRService: "Instance",
	UserService: "Instance",
	AvatarEditorService: "Instance",
	VoiceChatService: "Instance",
	CoreGui: "BasePlayerGui",
};

const warnedUnknown = new Set<string>();

/** The registered superclass of `className` (warns once for unknown classes). */
export function classParent(className: string): string | undefined {
	if (className === "Instance") return undefined;
	const parent = CLASS_PARENTS[className];
	if (parent !== undefined) return parent;
	if (!warnedUnknown.has(className)) {
		warnedUnknown.add(className);
		console.warn(
			`[loom] unknown class "${className}" — treating it as a direct Instance subclass`,
		);
	}
	return "Instance";
}

/** Yield `className` and each superclass up to (and including) `Instance`. */
export function* classChain(className: string): Generator<string, void> {
	let current: string | undefined = className;
	while (current !== undefined) {
		yield current;
		current = classParent(current);
	}
}

/** Roblox `Instance.IsA` semantics: `target` may be any ancestor class. */
export function isA(className: string, target: string): boolean {
	if (target === "Instance") return true;
	for (const cls of classChain(className)) {
		if (cls === target) return true;
	}
	return false;
}
