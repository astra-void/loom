export const RELEASE_TAG_PATTERN =
	/^v(?<version>\d+\.\d+\.\d+)(?:-(?<prerelease>[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/u;

export const PUBLIC_RELEASE_PACKAGES = [
	{
		directory: "packages/compiler",
		name: "@loom-dev/compiler",
	},
	{
		directory: "packages/layout-engine",
		name: "@loom-dev/layout-engine",
	},
	{
		directory: "packages/preview-analysis",
		name: "@loom-dev/preview-analysis",
	},
	{
		directory: "packages/preview-engine",
		name: "@loom-dev/preview-engine",
	},
	{
		directory: "packages/preview-runtime",
		name: "@loom-dev/preview-runtime",
	},
	{
		directory: "packages/preview",
		name: "@loom-dev/preview",
	},
	{
		directory: "packages/cli",
		name: "loom-dev",
	},
];

export const WORKSPACE_PUBLISH_ORDER = [
	"@loom-dev/layout-engine",
	"@loom-dev/preview-analysis",
	"@loom-dev/preview-runtime",
	"@loom-dev/preview-engine",
	"@loom-dev/preview",
	"loom-dev",
];
