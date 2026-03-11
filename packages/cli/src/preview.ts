import { promises as fs } from "node:fs";
import * as path from "node:path";

export type CliPreviewTransformMode = "strict-fidelity" | "compatibility";

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
	mode: "config-file" | "package-root";
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
}

export interface CliPreviewModule {
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
		const serializedSnapshot = `${JSON.stringify(session.getSnapshot(), null, 2)}\n`;
		if (options.outputPath) {
			await runtime.writeFileFn(
				path.resolve(options.outputPath),
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
