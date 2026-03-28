const DEFAULT_RUNTIME_ALIASES: string[] = [];

const DEFAULT_REACT_ALIASES = ["@rbxts/react"];
const DEFAULT_REACT_ROBLOX_ALIASES = ["@rbxts/react-roblox"];
const DEFAULT_NON_MOCKABLE_SPECIFIERS = [
	"react",
	"react-dom",
	"react-dom/client",
	"react-dom/server",
	"react/jsx-dev-runtime",
	"react/jsx-runtime",
	...DEFAULT_REACT_ALIASES,
	...DEFAULT_REACT_ROBLOX_ALIASES,
];

const INTERNAL_PREVIEW_PACKAGE_NAMES = new Set([
	"@loom-dev/preview",
	"@loom-dev/preview-engine",
	"@loom-dev/preview-runtime",
]);

export type PreviewAliasConfig = {
	reactAliases?: string[];
	reactRobloxAliases?: string[];
	runtimeAliases?: string[];
};

export type ReactShimMode = "browser" | "node";

function dedupeAliases(...groups: Array<readonly string[] | undefined>) {
	return [...new Set(groups.flatMap((group) => group ?? []))];
}

export function resolvePreviewRuntimeAliases(runtimeAliases?: string[]) {
	return dedupeAliases(DEFAULT_RUNTIME_ALIASES, runtimeAliases);
}

export function resolvePreviewReactAliases(reactAliases?: string[]) {
	return dedupeAliases(DEFAULT_REACT_ALIASES, reactAliases);
}

export function resolvePreviewReactRobloxAliases(
	reactRobloxAliases?: string[],
) {
	return dedupeAliases(DEFAULT_REACT_ROBLOX_ALIASES, reactRobloxAliases);
}

export function resolvePreviewAliasConfig(config: PreviewAliasConfig = {}) {
	return {
		reactAliases: resolvePreviewReactAliases(config.reactAliases),
		reactRobloxAliases: resolvePreviewReactRobloxAliases(
			config.reactRobloxAliases,
		),
		runtimeAliases: resolvePreviewRuntimeAliases(config.runtimeAliases),
	};
}

export function createRuntimeAliasSet(runtimeAliases?: string[]) {
	return new Set(resolvePreviewRuntimeAliases(runtimeAliases));
}

export function createNonMockableSpecifiers(config: PreviewAliasConfig = {}) {
	return new Set([
		...DEFAULT_NON_MOCKABLE_SPECIFIERS,
		...resolvePreviewReactAliases(config.reactAliases),
		...resolvePreviewReactRobloxAliases(config.reactRobloxAliases),
	]);
}

export function createReactShimSpecifierMap(options: {
	mode: ReactShimMode;
	reactAliases?: string[];
	reactRobloxAliases?: string[];
	resolveReactRobloxShimEntry: (mode: ReactShimMode) => string;
	resolveReactShimEntry: (fileName: string, mode: ReactShimMode) => string;
}) {
	const reactAliases = resolvePreviewReactAliases(options.reactAliases);
	const reactRobloxAliases = resolvePreviewReactRobloxAliases(
		options.reactRobloxAliases,
	);
	const entries = new Map<string, string>([
		[
			"react-dom/client",
			options.resolveReactShimEntry("react-dom-client.js", options.mode),
		],
		[
			"react-dom/server",
			options.resolveReactShimEntry("react-dom-server.js", options.mode),
		],
		["react-dom", options.resolveReactShimEntry("react-dom.js", options.mode)],
		[
			"react/jsx-dev-runtime",
			options.resolveReactShimEntry("react-jsx-dev-runtime.js", options.mode),
		],
		[
			"react/jsx-runtime",
			options.resolveReactShimEntry("react-jsx-runtime.js", options.mode),
		],
		["react", options.resolveReactShimEntry("react.js", options.mode)],
		["@rbxts/react", options.resolveReactShimEntry("react.js", options.mode)],
		["@rbxts/react-roblox", options.resolveReactRobloxShimEntry(options.mode)],
	]);

	for (const alias of reactAliases) {
		entries.set(alias, options.resolveReactShimEntry("react.js", options.mode));
	}

	for (const alias of reactRobloxAliases) {
		entries.set(alias, options.resolveReactRobloxShimEntry(options.mode));
	}

	return entries;
}

export function isInternalPreviewPackageName(packageName?: string) {
	return packageName != null && INTERNAL_PREVIEW_PACKAGE_NAMES.has(packageName);
}
