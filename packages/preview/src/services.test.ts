import { game } from "@loom-dev/runtime";
import { describe, expect, it } from "vitest";
import * as services from "./services.ts";

/**
 * The alias module and the runtime's service registry can drift: a service can
 * be implemented in `@loom-dev/runtime` and forgotten here, and the miss only
 * surfaces in a consumer's browser as
 *
 *     The requested module "@rbxts/services" does not provide an export named
 *     "HttpService"
 *
 * — which is how loom's own `HttpService` gap was reported. This list is the
 * reviewed contract: the services loom means to expose to `@rbxts/services`.
 * Adding a browser-meaningful service to the runtime means adding it in both
 * places, and this test is what says so.
 *
 * Deliberately *not* every service `@rbxts/services` declares. It is the ones
 * loom implements plus the handful roblox-ts UI code imports so routinely that
 * a missing export would take down a preview over a service it barely touches
 * (see the module's own header for why those resolve to a throwing stub rather
 * than being absent). Everything past that list stays out: hundreds of silent
 * stubs would trade a loud missing-export error for scenes that quietly do
 * nothing.
 */
const BROWSER_SUPPORTED_SERVICES = [
	"AnalyticsService",
	"CollectionService",
	"ContentProvider",
	"ContextActionService",
	"DataStoreService",
	"Debris",
	"GuiService",
	"HttpService",
	"Lighting",
	"LocalizationService",
	"LogService",
	"MarketplaceService",
	"MessagingService",
	"Players",
	"PolicyService",
	"ReplicatedFirst",
	"ReplicatedStorage",
	"RunService",
	"ServerScriptService",
	"ServerStorage",
	"SoundService",
	"StarterGui",
	"StarterPack",
	"StarterPlayer",
	"Stats",
	"Teams",
	"TeleportService",
	"TextChatService",
	"TextService",
	"TweenService",
	"UserInputService",
	"Workspace",
] as const;

/**
 * The exports that are stubs rather than implementations: `GetService` has no
 * factory for them, so they warn once at import and refuse their own method
 * calls by name. Listed here so the split is reviewed rather than incidental —
 * moving a name off this list means loom grew a real implementation.
 */
const STUBBED_SERVICES = [
	"AnalyticsService",
	"DataStoreService",
	"LocalizationService",
	"LogService",
	"MarketplaceService",
	"MessagingService",
	"PolicyService",
	"Stats",
	"TeleportService",
	"TextChatService",
] as const;

describe("the @rbxts/services alias module", () => {
	it.each(
		BROWSER_SUPPORTED_SERVICES,
	)("exports %s as the very singleton game.GetService returns", (name) => {
		const exported = (services as unknown as Record<string, unknown>)[name];
		expect(exported).toBeDefined();
		expect(exported).toBe(game.GetService(name));
	});

	it("exports exactly the reviewed list — nothing more, nothing forgotten", () => {
		expect(Object.keys(services).sort()).toEqual([
			...BROWSER_SUPPORTED_SERVICES,
		]);
	});

	it("hands out real service instances, not plain objects", () => {
		for (const name of BROWSER_SUPPORTED_SERVICES) {
			const service = (services as unknown as Record<string, ServiceShape>)[
				name
			] as ServiceShape;
			expect(service.ClassName).toBe(name);
			expect(service.GetFullName()).toBe(name);
			expect(service.IsA("Instance")).toBe(true);
		}
	});

	it.each(
		STUBBED_SERVICES,
	)("%s is a stub whose unimplemented calls throw by name", (name) => {
		const service = (services as unknown as Record<string, ServiceShape>)[
			name
		] as ServiceShape;
		// The whole reason these are exported at all: importing one, and
		// reading properties off it, must not take the preview down.
		expect(service.ClassName).toBe(name);
		expect(service.SomeUnimplementedProperty).toBeUndefined();
		// Calling into it fails precisely, naming the service and the member,
		// instead of dying later on an `undefined` result.
		const call = service.GetSomethingImpossible as () => unknown;
		expect(call).toBeTypeOf("function");
		expect(call).toThrow(
			new RegExp(`\\[loom\\] ${name}:GetSomethingImpossible\\(\\)`),
		);
	});

	it("gives ContentProvider a real preloader rather than a stub", () => {
		// The one newly exported service loom actually implements — proof that
		// the stub policy above is a policy and not a blanket.
		expect(services.ContentProvider.PreloadAsync).toBeTypeOf("function");
		expect(services.ContentProvider.GetAssetFetchStatus).toBeTypeOf("function");
		expect(services.ContentProvider.RequestQueueSize).toBe(0);
	});
});

interface ServiceShape {
	readonly ClassName: string;
	GetFullName(): string;
	IsA(className: string): boolean;
	readonly SomeUnimplementedProperty: unknown;
	readonly GetSomethingImpossible: unknown;
}
