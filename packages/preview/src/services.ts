/**
 * `@loom-dev/preview/services` — the browser stand-in for `@rbxts/services`.
 *
 * roblox-ts code imports service singletons as named exports
 * (`import { RunService } from "@rbxts/services"`); the Vite plugin aliases
 * that specifier here. Each export is the same singleton `game.GetService`
 * returns, so preview code and app code always see one instance.
 *
 * The list is wider than the set of services loom implements, and deliberately
 * so. A missing name here is
 *
 *     The requested module "@rbxts/services" does not provide an export named
 *     "MarketplaceService"
 *
 * — a *build* error, which takes down a preview whose only sin was importing a
 * service beside the ones it uses. An exported name that resolves to
 * `GetService`'s stub costs one console warning at startup and then fails
 * precisely, on the line that actually calls into the service, naming the
 * member (see `game.ts`). Loud where the problem is beats fatal where it is
 * not, so the unimplemented services are exported too.
 */
import { getService, type LoomInstance, type Vector2 } from "@loom-dev/runtime";

export const CollectionService: LoomInstance = getService("CollectionService");
export const ContextActionService: LoomInstance = getService(
	"ContextActionService",
);
/**
 * Typed past `LoomInstance`'s `unknown` index for the same reason as
 * {@link LoomHttpService}: app code *calls* these. `PreloadAsync` really does
 * fetch the ids it is given, and returns a promise where Roblox would yield —
 * see `services.ts` in `@loom-dev/runtime`.
 */
export interface LoomContentProvider extends LoomInstance {
	PreloadAsync(
		contentIdList: readonly unknown[],
		callback?: (contentId: string, status: unknown) => void,
	): Promise<void>;
	GetAssetFetchStatus(contentId: string): unknown;
	readonly RequestQueueSize: number;
}
export const ContentProvider = getService(
	"ContentProvider",
) as LoomContentProvider;
export const GuiService: LoomInstance = getService("GuiService");
/**
 * Typed beyond `LoomInstance` because the index signature that carries arbitrary
 * Roblox properties types every method as `unknown`, and app code calls this one
 * directly (`HttpService.GenerateGUID(false)`) rather than reading a property.
 * The declared surface is exactly what the runtime implements — the network
 * methods are absent here on purpose, and throw if reached anyway.
 */
export interface LoomHttpService extends LoomInstance {
	GenerateGUID(wrapInCurlyBraces?: boolean): string;
	JSONEncode(value: unknown): string;
	JSONDecode(value: string): unknown;
}
export const HttpService = getService("HttpService") as LoomHttpService;
export const Players: LoomInstance = getService("Players");
export const RunService: LoomInstance = getService("RunService");
export const TweenService: LoomInstance = getService("TweenService");
export const UserInputService: LoomInstance = getService("UserInputService");
export const Workspace: LoomInstance = getService("Workspace");

/**
 * Typed for the same reason as {@link LoomHttpService}: app code *calls* these,
 * and the index signature would hand it `unknown`. `GetTextSize` measures with
 * the renderer's own fonts, so what a component reserves matches what it paints.
 */
export interface LoomTextService extends LoomInstance {
	GetTextSize(
		text: string,
		fontSize: number,
		font?: unknown,
		frameSize?: Vector2,
	): Vector2;
	GetTextBoundsAsync(params: LoomInstance): Vector2;
}
export const TextService = getService("TextService") as LoomTextService;

/** `AddItem(instance, lifetime)` really does destroy it, on a real timer. */
export interface LoomDebris extends LoomInstance {
	AddItem(instance: LoomInstance, lifetime?: number): void;
}
export const Debris = getService("Debris") as LoomDebris;

/** `SetCore`/`GetCore` are no-ops: a preview has no core UI to toggle. */
export interface LoomStarterGui extends LoomInstance {
	SetCore(name: string, value: unknown): void;
	GetCore(name: string): unknown;
	SetCoreGuiEnabled(coreGuiType: unknown, enabled: boolean): void;
	GetCoreGuiEnabled(coreGuiType: unknown): boolean;
}
export const StarterGui = getService("StarterGui") as LoomStarterGui;

// Container-only services: no behavior to model, just a place instances live.
export const Lighting: LoomInstance = getService("Lighting");
export const ReplicatedFirst: LoomInstance = getService("ReplicatedFirst");
export const ReplicatedStorage: LoomInstance = getService("ReplicatedStorage");
export const ServerScriptService: LoomInstance = getService(
	"ServerScriptService",
);
export const ServerStorage: LoomInstance = getService("ServerStorage");
export const SoundService: LoomInstance = getService("SoundService");
export const StarterPack: LoomInstance = getService("StarterPack");
export const StarterPlayer: LoomInstance = getService("StarterPlayer");
export const Teams: LoomInstance = getService("Teams");

/**
 * Exported, not implemented — the stub half of the policy in this file's
 * header.
 *
 * Every one of these is a service a browser cannot honestly stand in for:
 * purchases, teleports, cross-server messaging, datastores, moderation policy,
 * analytics and the platform's own telemetry all need a Roblox server on the
 * other end, and inventing an answer for `UserOwnsGamePassAsync` would be worse
 * than saying nothing. They resolve to `GetService`'s warned stub, whose
 * unimplemented method calls throw by name, so a UI that merely *imports*
 * `MarketplaceService` alongside the services it really uses still mounts.
 */
export const AnalyticsService: LoomInstance = getService("AnalyticsService");
export const DataStoreService: LoomInstance = getService("DataStoreService");
export const LocalizationService: LoomInstance = getService(
	"LocalizationService",
);
export const LogService: LoomInstance = getService("LogService");
export const MarketplaceService: LoomInstance =
	getService("MarketplaceService");
export const MessagingService: LoomInstance = getService("MessagingService");
export const PolicyService: LoomInstance = getService("PolicyService");
export const Stats: LoomInstance = getService("Stats");
export const TeleportService: LoomInstance = getService("TeleportService");
export const TextChatService: LoomInstance = getService("TextChatService");
