import { promises as fs } from "node:fs";
export type CliPreviewTransformMode = "strict-fidelity" | "compatibility";
export type CliBuildTransformMode =
	| "strict-fidelity"
	| "compatibility"
	| "mocked"
	| "design-time";
export type CliPreviewBuildArtifactKind =
	| "module"
	| "entry-metadata"
	| "layout-schema";
export type CliCheckFailOn = "error" | "warning";
export type CliCheckFormat = "json" | "pretty";
export interface CliOutputWriter {
	write(chunk: string): unknown;
}
export interface CliPreviewTarget {
	exclude?: string[];
	include?: string[];
	name: string;
	packageName?: string;
	packageRoot: string;
	sourceRoot: string;
}
export interface CliResolvedPreviewConfig {
	configDir: string;
	configFilePath?: string;
	cwd: string;
	mode: "config-file" | "config-object" | "package-root";
	projectName: string;
	runtimeModule?: string;
	server: {
		fsAllow: string[];
		host?: string;
		open: boolean;
		port: number;
	};
	targetDiscovery?: unknown[];
	targets: CliPreviewTarget[];
	transformMode: string;
	workspaceRoot: string;
}
export interface CliPreviewHeadlessSession {
	dispose(): void;
	getSnapshot(): unknown;
	run(options?: { entryIds?: string[] }): Promise<unknown>;
}
export interface CliPreviewDiagnostic {
	blocking?: boolean;
	code: string;
	phase: "discovery" | "layout" | "runtime" | "transform";
	severity: "error" | "info" | "warning";
	summary: string;
}
export interface CliPreviewRuntimeIssue {
	blocking?: boolean;
	code: string;
	phase: "layout" | "runtime" | "transform";
	severity?: "error" | "info" | "warning";
	summary: string;
	target: string;
}
export interface CliPreviewWarningState {
	degradedTargets: string[];
	fidelity: "degraded" | "preserved" | null;
	warningCodes: string[];
}
export interface CliPreviewHeadlessExecutionEntry {
	degradedHostWarnings: CliPreviewRuntimeIssue[];
	layoutDebug: unknown | null;
	layoutIssues: CliPreviewRuntimeIssue[];
	loadIssue: CliPreviewRuntimeIssue | null;
	render: {
		status: "load_failed" | "render_failed" | "rendered" | "skipped";
	};
	renderIssue: CliPreviewRuntimeIssue | null;
	runtimeIssues: CliPreviewRuntimeIssue[];
	severity: "error" | "pass" | "skipped" | "warning";
	viewport: {
		height: number;
		ready: boolean;
		source: string;
		width: number;
	};
	warningState: CliPreviewWarningState;
}
export interface CliPreviewHeadlessSnapshotEntry {
	descriptor: {
		id: string;
		relativePath: string;
		status:
			| "ambiguous"
			| "blocked_by_layout"
			| "blocked_by_runtime"
			| "blocked_by_transform"
			| "needs_harness"
			| "ready";
		targetName: string;
		title: string;
	};
	diagnostics: CliPreviewDiagnostic[];
}
export interface CliPreviewHeadlessSnapshot {
	entries: Record<string, CliPreviewHeadlessSnapshotEntry>;
	execution: {
		entries: Record<string, CliPreviewHeadlessExecutionEntry>;
		summary: {
			error: number;
			pass: number;
			selectedEntryCount: number;
			total: number;
			warning: number;
		};
	};
	workspaceIndex: {
		entries: Array<{
			id: string;
			relativePath: string;
			status:
				| "ambiguous"
				| "blocked_by_layout"
				| "blocked_by_runtime"
				| "blocked_by_transform"
				| "needs_harness"
				| "ready";
			targetName: string;
			title: string;
		}>;
		projectName: string;
	};
}
export interface CliPreviewCheckEntryResult {
	descriptor: CliPreviewHeadlessSnapshotEntry["descriptor"];
	diagnostics: CliPreviewDiagnostic[];
	execution: CliPreviewHeadlessExecutionEntry;
}
export interface CliPreviewCheckResult {
	entries: CliPreviewCheckEntryResult[];
	failOn: CliCheckFailOn;
	passed: boolean;
	projectName: string;
	summary: {
		error: number;
		pass: number;
		selectedEntryCount: number;
		total: number;
		warning: number;
	};
}
export interface CliPreviewModule {
	buildPreviewArtifacts(options?: {
		artifactKinds?: CliPreviewBuildArtifactKind[];
		configFile?: string;
		cwd?: string;
		outDir?: string;
		transformMode?: CliBuildTransformMode;
	}): Promise<unknown>;
	createPreviewHeadlessSession(
		options?: CliResolvedPreviewConfig,
	): Promise<CliPreviewHeadlessSession>;
	loadPreviewConfig(options?: {
		configFile?: string;
		cwd?: string;
	}): Promise<CliResolvedPreviewConfig>;
	startPreviewServer(
		options?: CliResolvedPreviewConfig,
		runtimeOptions?: {
			progressWriter?: CliOutputWriter;
		},
	): Promise<unknown>;
}
export interface CliCommandRuntime {
	loadPreviewModuleFn?: () => Promise<CliPreviewModule>;
	readCliVersionFn: () => string;
	stdout: CliOutputWriter;
	stderr: CliOutputWriter;
	writeFileFn?: typeof fs.writeFile;
}
export interface PreviewCommandOptions {
	configFile?: string;
	cwd?: string;
	host?: string;
	open: boolean;
	port?: number;
	transformMode?: CliPreviewTransformMode;
}
export interface SnapshotCommandOptions {
	configFile?: string;
	cwd?: string;
	outputPath?: string;
	transformMode?: CliPreviewTransformMode;
}
export interface ConfigCommandOptions {
	configFile?: string;
	cwd?: string;
}
export interface BuildCommandOptions {
	artifactKinds: CliPreviewBuildArtifactKind[];
	configFile?: string;
	cwd?: string;
	outDir: string;
	transformMode?: CliBuildTransformMode;
}
export interface CheckCommandOptions {
	configFile?: string;
	cwd?: string;
	entryId?: string;
	failOn?: CliCheckFailOn;
	format?: CliCheckFormat;
	transformMode?: CliPreviewTransformMode;
}
export declare function runPreviewCommand(
	options: PreviewCommandOptions,
	runtimeOverrides: Partial<CliCommandRuntime>,
): Promise<void>;
export declare function runSnapshotCommand(
	options: SnapshotCommandOptions,
	runtimeOverrides: Partial<CliCommandRuntime>,
): Promise<void>;
export declare function runCheckCommand(
	options: CheckCommandOptions,
	runtimeOverrides: Partial<CliCommandRuntime>,
): Promise<void>;
export declare function runBuildCommand(
	options: BuildCommandOptions,
	runtimeOverrides: Partial<CliCommandRuntime>,
): Promise<void>;
export declare function runConfigCommand(
	options: ConfigCommandOptions,
	runtimeOverrides: Partial<CliCommandRuntime>,
): Promise<void>;
