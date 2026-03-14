import { promises as fs } from "node:fs";
import * as path from "node:path";
import { usageError } from "./core/errors";

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
	startPreviewServer(options?: CliResolvedPreviewConfig): Promise<unknown>;
}

export interface CliCommandRuntime {
	loadPreviewModuleFn?: () => Promise<CliPreviewModule>;
	readCliVersionFn: () => string;
	stdout: CliOutputWriter;
	writeFileFn?: typeof fs.writeFile;
}

interface ResolvedCliCommandRuntime {
	loadPreviewModuleFn: () => Promise<CliPreviewModule>;
	readCliVersionFn: () => string;
	stdout: CliOutputWriter;
	writeFileFn: typeof fs.writeFile;
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

async function loadPreviewModule(): Promise<CliPreviewModule> {
	// Keep native dynamic import so the CommonJS CLI can load the preview package's ESM entry.
	const dynamicImport = new Function(
		"specifier",
		"return import(specifier);",
	) as (specifier: string) => Promise<CliPreviewModule>;

	return dynamicImport("@loom-dev/preview");
}

function writeJson(stdout: CliOutputWriter, value: unknown) {
	stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function createRuntime(
	runtimeOverrides: Partial<CliCommandRuntime>,
): ResolvedCliCommandRuntime {
	return {
		loadPreviewModuleFn:
			runtimeOverrides.loadPreviewModuleFn ?? loadPreviewModule,
		readCliVersionFn: runtimeOverrides.readCliVersionFn ?? (() => "0.0.0"),
		stdout: runtimeOverrides.stdout ?? process.stdout,
		writeFileFn: runtimeOverrides.writeFileFn ?? fs.writeFile,
	};
}

function resolveCommandPathFromCwd(filePath: string, cwd: string) {
	return path.isAbsolute(filePath) ? filePath : path.resolve(cwd, filePath);
}

function applyResolvedConfigOverrides(
	resolvedConfig: CliResolvedPreviewConfig,
	options: {
		host?: string;
		open?: boolean;
		port?: number;
		transformMode?: CliPreviewTransformMode;
	},
): CliResolvedPreviewConfig {
	return {
		...resolvedConfig,
		...(options.transformMode ? { transformMode: options.transformMode } : {}),
		server: {
			...resolvedConfig.server,
			...(options.host ? { host: options.host } : {}),
			...(options.open ? { open: true } : {}),
			...(options.port !== undefined ? { port: options.port } : {}),
		},
	};
}

function serializeResolvedConfig(resolvedConfig: CliResolvedPreviewConfig) {
	const { targetDiscovery: _targetDiscovery, ...serializable } = resolvedConfig;
	return serializable;
}

function readHeadlessSnapshot(snapshot: unknown): CliPreviewHeadlessSnapshot {
	return snapshot as CliPreviewHeadlessSnapshot;
}

function createCheckEntryResult(
	snapshot: CliPreviewHeadlessSnapshot,
	entryId: string,
): CliPreviewCheckEntryResult {
	const payload = snapshot.entries[entryId];
	const execution = snapshot.execution.entries[entryId];
	if (!payload || !execution) {
		throw new Error(`Missing execution snapshot for preview entry: ${entryId}`);
	}

	return {
		descriptor: payload.descriptor,
		diagnostics: payload.diagnostics,
		execution,
	};
}

function buildCheckResult(
	snapshot: CliPreviewHeadlessSnapshot,
	failOn: CliCheckFailOn,
	entryId?: string,
): CliPreviewCheckResult {
	const targetEntries = entryId
		? snapshot.workspaceIndex.entries.filter((entry) => entry.id === entryId)
		: snapshot.workspaceIndex.entries;
	if (entryId && targetEntries.length === 0) {
		throw usageError(`Unknown preview entry: ${entryId}`);
	}

	const entries = targetEntries.map((entry) =>
		createCheckEntryResult(snapshot, entry.id),
	);
	const summary = entries.reduce(
		(accumulator, entry) => {
			switch (entry.execution.severity) {
				case "error":
					accumulator.error += 1;
					break;
				case "warning":
					accumulator.warning += 1;
					break;
				case "pass":
					accumulator.pass += 1;
					break;
			}

			return accumulator;
		},
		{
			error: 0,
			pass: 0,
			selectedEntryCount: entries.length,
			total: entries.length,
			warning: 0,
		},
	);
	const passed =
		failOn === "warning"
			? summary.error === 0 && summary.warning === 0
			: summary.error === 0;

	return {
		entries,
		failOn,
		passed,
		projectName: snapshot.workspaceIndex.projectName,
		summary,
	};
}

function formatPrettyCheckResult(result: CliPreviewCheckResult) {
	const lines = [
		`${result.projectName}`,
		`entries=${result.summary.total} pass=${result.summary.pass} warning=${result.summary.warning} error=${result.summary.error} fail-on=${result.failOn} passed=${result.passed ? "yes" : "no"}`,
	];

	for (const entry of result.entries) {
		lines.push(
			`${entry.execution.severity.toUpperCase()} ${entry.descriptor.id} status=${entry.descriptor.status} render=${entry.execution.render.status}`,
		);

		if (entry.execution.warningState.warningCodes.length > 0) {
			lines.push(
				`  warnings: ${entry.execution.warningState.warningCodes.join(", ")}`,
			);
		}

		if (entry.execution.warningState.degradedTargets.length > 0) {
			lines.push(
				`  degraded: ${entry.execution.warningState.degradedTargets.join(", ")}`,
			);
		}

		lines.push(
			`  viewport: ${entry.execution.viewport.width}x${entry.execution.viewport.height} ready=${entry.execution.viewport.ready} source=${entry.execution.viewport.source}`,
		);

		const diagnostics = entry.diagnostics.filter((diagnostic) => {
			const blocking = diagnostic.blocking ?? diagnostic.severity === "error";
			return blocking || entry.execution.severity !== "pass";
		});
		for (const diagnostic of diagnostics) {
			lines.push(
				`  diagnostic ${diagnostic.severity.toUpperCase()} ${diagnostic.phase} ${diagnostic.code}: ${diagnostic.summary}`,
			);
		}

		for (const issue of [
			...entry.execution.runtimeIssues,
			...entry.execution.layoutIssues,
		]) {
			const severity = issue.severity ?? "error";
			lines.push(
				`  issue ${severity.toUpperCase()} ${issue.phase} ${issue.code}: ${issue.summary}`,
			);
		}

		if (entry.execution.loadIssue) {
			lines.push(`  load: ${entry.execution.loadIssue.summary}`);
		}

		if (entry.execution.renderIssue) {
			lines.push(`  render: ${entry.execution.renderIssue.summary}`);
		}
	}

	return `${lines.join("\n")}\n`;
}

export async function runPreviewCommand(
	options: PreviewCommandOptions,
	runtimeOverrides: Partial<CliCommandRuntime>,
): Promise<void> {
	const runtime = createRuntime(runtimeOverrides);
	const previewModule = await runtime.loadPreviewModuleFn();
	const resolvedConfig = await previewModule.loadPreviewConfig({
		...(options.configFile ? { configFile: options.configFile } : {}),
		...(options.cwd ? { cwd: options.cwd } : {}),
	});
	const effectiveConfig = applyResolvedConfigOverrides(resolvedConfig, options);
	await previewModule.startPreviewServer(effectiveConfig);
}

export async function runSnapshotCommand(
	options: SnapshotCommandOptions,
	runtimeOverrides: Partial<CliCommandRuntime>,
): Promise<void> {
	const runtime = createRuntime(runtimeOverrides);
	const previewModule = await runtime.loadPreviewModuleFn();
	const resolvedConfig = await previewModule.loadPreviewConfig({
		...(options.configFile ? { configFile: options.configFile } : {}),
		...(options.cwd ? { cwd: options.cwd } : {}),
	});
	const effectiveConfig = applyResolvedConfigOverrides(resolvedConfig, options);
	const session =
		await previewModule.createPreviewHeadlessSession(effectiveConfig);

	try {
		const snapshot = await session.run();
		const serializedSnapshot = `${JSON.stringify(snapshot, null, 2)}\n`;
		if (options.outputPath) {
			await runtime.writeFileFn(
				resolveCommandPathFromCwd(options.outputPath, effectiveConfig.cwd),
				serializedSnapshot,
				"utf8",
			);
			return;
		}

		runtime.stdout.write(serializedSnapshot);
	} finally {
		session.dispose();
	}
}

export async function runCheckCommand(
	options: CheckCommandOptions,
	runtimeOverrides: Partial<CliCommandRuntime>,
): Promise<void> {
	const runtime = createRuntime(runtimeOverrides);
	const previewModule = await runtime.loadPreviewModuleFn();
	const resolvedConfig = await previewModule.loadPreviewConfig({
		...(options.configFile ? { configFile: options.configFile } : {}),
		...(options.cwd ? { cwd: options.cwd } : {}),
	});
	const effectiveConfig = applyResolvedConfigOverrides(resolvedConfig, options);
	const session =
		await previewModule.createPreviewHeadlessSession(effectiveConfig);

	try {
		const initialSnapshot = readHeadlessSnapshot(session.getSnapshot());
		if (options.entryId && !initialSnapshot.entries[options.entryId]) {
			throw usageError(`Unknown preview entry: ${options.entryId}`);
		}

		if (options.entryId) {
			await session.run({ entryIds: [options.entryId] });
		} else {
			await session.run();
		}

		const snapshot = readHeadlessSnapshot(session.getSnapshot());
		const checkResult = buildCheckResult(
			snapshot,
			options.failOn ?? "error",
			options.entryId,
		);

		if ((options.format ?? "pretty") === "json") {
			writeJson(runtime.stdout, checkResult);
		} else {
			runtime.stdout.write(formatPrettyCheckResult(checkResult));
		}

		if (!checkResult.passed) {
			throw new Error(
				`Preview check failed with fail-on=${checkResult.failOn}.`,
			);
		}
	} finally {
		session.dispose();
	}
}

export async function runBuildCommand(
	options: BuildCommandOptions,
	runtimeOverrides: Partial<CliCommandRuntime>,
): Promise<void> {
	const runtime = createRuntime(runtimeOverrides);
	const previewModule = await runtime.loadPreviewModuleFn();
	const result = await previewModule.buildPreviewArtifacts({
		artifactKinds: options.artifactKinds,
		...(options.configFile ? { configFile: options.configFile } : {}),
		...(options.cwd ? { cwd: options.cwd } : {}),
		outDir: options.outDir,
		...(options.transformMode ? { transformMode: options.transformMode } : {}),
	});

	writeJson(runtime.stdout, result);
}

export async function runConfigCommand(
	options: ConfigCommandOptions,
	runtimeOverrides: Partial<CliCommandRuntime>,
): Promise<void> {
	const runtime = createRuntime(runtimeOverrides);
	const previewModule = await runtime.loadPreviewModuleFn();
	const resolvedConfig = await previewModule.loadPreviewConfig({
		...(options.configFile ? { configFile: options.configFile } : {}),
		...(options.cwd ? { cwd: options.cwd } : {}),
	});

	writeJson(runtime.stdout, serializeResolvedConfig(resolvedConfig));
}

