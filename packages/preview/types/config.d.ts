import type {
	PreviewExecutionMode,
	PreviewSourceTarget,
} from "@loom-dev/preview-engine";
export type { PreviewAliasConfig } from "./source/aliasConfig";
export type PreviewTargetDiscoveryContext = {
	configDir: string;
	configFilePath?: string;
	cwd: string;
	workspaceRoot: string;
};
export type PreviewTargetDiscoveryAdapter = {
	discoverTargets: (
		context: PreviewTargetDiscoveryContext,
	) => PreviewSourceTarget[] | Promise<PreviewSourceTarget[]>;
};
export type PreviewConfigServer = {
	fsAllow?: string[];
	host?: string;
	open?: boolean;
	port?: number;
};
export type PreviewConfig = {
	reactAliases?: string[];
	reactRobloxAliases?: string[];
	projectName?: string;
	runtimeModule?: string;
	runtimeAliases?: string[];
	server?: PreviewConfigServer;
	targetDiscovery:
		| PreviewTargetDiscoveryAdapter
		| PreviewTargetDiscoveryAdapter[];
	transformMode?: PreviewExecutionMode;
	workspaceRoot?: string;
};
export type LoadPreviewConfigOptions = {
	configFile?: string;
	cwd?: string;
};
export type PreviewTargetDiscoveryFactoryOptions = {
	exclude?: string[];
	include?: string[];
	name?: string;
	packageName?: string;
	packageRoot?: string;
	sourceDir?: string;
	sourceRoot?: string;
};
export type PreviewWorkspaceTargetDiscoveryOptions = {
	exclude?: string[];
	include?: string[];
	sourceDir?: string;
	workspaceRoot?: string;
};
export type ResolvedPreviewConfig = {
	configDir: string;
	configFilePath?: string;
	cwd: string;
	mode: "config-file" | "config-object" | "package-root";
	reactAliases: string[];
	reactRobloxAliases: string[];
	projectName: string;
	runtimeModule?: string;
	runtimeAliases: string[];
	server: {
		fsAllow: string[];
		host?: string;
		open: boolean;
		port: number;
	};
	targetDiscovery: PreviewTargetDiscoveryAdapter[];
	targets: PreviewSourceTarget[];
	transformMode: PreviewExecutionMode;
	workspaceRoot: string;
};
export declare function resolvePreviewRuntimeModule(
	runtimeModule: string | undefined,
	baseDir: string,
): string | undefined;
export declare function defineConfig(config: PreviewConfig): PreviewConfig;
export declare function createPackageTargetDiscovery(
	options?: PreviewTargetDiscoveryFactoryOptions,
): PreviewTargetDiscoveryAdapter;
export declare function createStaticTargetsDiscovery(
	targets: PreviewSourceTarget[],
): PreviewTargetDiscoveryAdapter;
export declare function createWorkspaceTargetsDiscovery(
	options?: PreviewWorkspaceTargetDiscoveryOptions,
): PreviewTargetDiscoveryAdapter;
export declare function loadPreviewConfig(
	options?: LoadPreviewConfigOptions,
): Promise<ResolvedPreviewConfig>;
export declare function loadPreviewBuildConfig(
	options?: LoadPreviewConfigOptions,
): Promise<ResolvedPreviewConfig>;
export declare function resolvePreviewConfigObject(
	config: PreviewConfig,
	options?: {
		configDir?: string;
		cwd?: string;
	},
): Promise<ResolvedPreviewConfig>;
