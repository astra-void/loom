import { usageError } from "./core/errors";
import { CLI_BINARY_NAME, getCliVersion } from "./packageMetadata";
import type {
	CliBuildTransformMode,
	CliCommandRuntime,
	CliPreviewBuildArtifactKind,
	CliPreviewTransformMode,
} from "./preview";
import {
	runBuildCommand,
	runConfigCommand,
	runPreviewCommand,
	runSnapshotCommand,
} from "./preview";

const HELP_TEXT = `Loom CLI

Usage:
  ${CLI_BINARY_NAME} <command> [options]

Commands:
  preview [--cwd <path>] [--config <path>] [--port <number>] [--host <host>] [--open]
          [--transform-mode <strict-fidelity|compatibility>]
    Start the preview dev server.

  serve [--cwd <path>] [--config <path>] [--port <number>] [--host <host>] [--open]
        [--transform-mode <strict-fidelity|compatibility>]
    Alias for preview.

  snapshot [--cwd <path>] [--config <path>] [--output <path>]
           [--transform-mode <strict-fidelity|compatibility>]
    Emit a full headless preview snapshot as JSON.

  build [--cwd <path>] [--config <path>] --out-dir <path>
        [--artifact-kind <module|entry-metadata|layout-schema>]
        [--transform-mode <strict-fidelity|compatibility|mocked|design-time>]
    Build preview artifacts from resolved config targets.

  config [--cwd <path>] [--config <path>]
    Print the resolved preview config as JSON.

  help      Show this help message.
  version   Print CLI version.

Global options:
  --help
  --version

Examples:
  ${CLI_BINARY_NAME} preview --cwd apps/preview-harness
  ${CLI_BINARY_NAME} preview --config ./loom.config.ts --port 4175 --open
  ${CLI_BINARY_NAME} snapshot --cwd packages/preview --output ./preview-snapshot.json
  ${CLI_BINARY_NAME} build --cwd packages/preview --out-dir ./generated
  ${CLI_BINARY_NAME} config --cwd packages/preview
`;

interface ParsedCommandLine {
	command?: string;
	commandArgs: string[];
	showHelp: boolean;
	showVersion: boolean;
}

interface SharedCommandArgs {
	configFile?: string;
	cwd?: string;
}

interface ParsedPreviewArgs extends SharedCommandArgs {
	host?: string;
	open: boolean;
	port?: number;
	transformMode?: CliPreviewTransformMode;
}

interface ParsedSnapshotArgs extends SharedCommandArgs {
	outputPath?: string;
	transformMode?: CliPreviewTransformMode;
}

interface ParsedBuildArgs extends SharedCommandArgs {
	artifactKinds: CliPreviewBuildArtifactKind[];
	outDir: string;
	transformMode?: CliBuildTransformMode;
}

const PREVIEW_TRANSFORM_MODES = [
	"strict-fidelity",
	"compatibility",
] as const satisfies readonly CliPreviewTransformMode[];

const BUILD_TRANSFORM_MODES = [
	"strict-fidelity",
	"compatibility",
	"mocked",
	"design-time",
] as const satisfies readonly CliBuildTransformMode[];

const BUILD_ARTIFACT_KINDS = [
	"module",
	"entry-metadata",
	"layout-schema",
] as const satisfies readonly CliPreviewBuildArtifactKind[];

type ParsedRequiredValue =
	| {
			matched: true;
			nextIndex: number;
			value: string;
	  }
	| {
			matched: false;
			nextIndex: number;
			value: undefined;
	  };

function printHelp(runtime: Pick<CliCommandRuntime, "stdout">) {
	runtime.stdout.write(`${HELP_TEXT}\n`);
}

function parseTopLevel(argv: string[]): ParsedCommandLine {
	if (argv.length === 0) {
		return {
			showHelp: true,
			showVersion: false,
			commandArgs: [],
		};
	}

	const first = argv[0];
	if (first === "--help" || first === "-h" || first === "help") {
		return {
			showHelp: true,
			showVersion: false,
			commandArgs: [],
		};
	}

	if (first === "--version" || first === "-v" || first === "version") {
		return {
			showHelp: false,
			showVersion: true,
			commandArgs: [],
		};
	}

	if (first.startsWith("-")) {
		throw usageError(`Unknown global option: ${first}`);
	}

	return {
		command: first,
		commandArgs: argv.slice(1),
		showHelp: false,
		showVersion: false,
	};
}

function hasHelpFlag(args: string[]) {
	return args.includes("--help") || args.includes("-h");
}

function parseRequiredValue(
	args: string[],
	index: number,
	token: string,
	option: string,
): ParsedRequiredValue {
	if (token === option) {
		const value = args[index + 1];
		if (!value || value.startsWith("-")) {
			throw usageError(`Missing value for ${option}.`);
		}

		return {
			matched: true,
			nextIndex: index + 1,
			value,
		};
	}

	const prefix = `${option}=`;
	if (token.startsWith(prefix)) {
		const value = token.slice(prefix.length);
		if (value.length === 0) {
			throw usageError(`Missing value for ${option}.`);
		}

		return {
			matched: true,
			nextIndex: index,
			value,
		};
	}

	return {
		matched: false,
		nextIndex: index,
		value: undefined,
	};
}

function parseTransformMode<TMode extends string>(
	value: string,
	allowedModes: readonly TMode[],
): TMode {
	if (allowedModes.includes(value as TMode)) {
		return value as TMode;
	}

	throw usageError(
		`Invalid --transform-mode value "${value}". Use ${allowedModes.join(", ")}.`,
	);
}

function parseArtifactKind(value: string): CliPreviewBuildArtifactKind {
	if (
		BUILD_ARTIFACT_KINDS.includes(value as CliPreviewBuildArtifactKind)
	) {
		return value as CliPreviewBuildArtifactKind;
	}

	throw usageError(
		`Invalid --artifact-kind value "${value}". Use ${BUILD_ARTIFACT_KINDS.join(", ")}.`,
	);
}

function parsePort(value: string): number {
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
		throw usageError(
			`Invalid --port value "${value}". Use an integer between 1 and 65535.`,
		);
	}

	return parsed;
}

function parseSharedArgs(args: string[], command: string): SharedCommandArgs {
	const output: SharedCommandArgs = {};

	for (let index = 0; index < args.length; index += 1) {
		const token = args[index];

		const cwdValue = parseRequiredValue(args, index, token, "--cwd");
		if (cwdValue.matched) {
			output.cwd = cwdValue.value;
			index = cwdValue.nextIndex;
			continue;
		}

		const configValue = parseRequiredValue(args, index, token, "--config");
		if (configValue.matched) {
			output.configFile = configValue.value;
			index = configValue.nextIndex;
			continue;
		}

		if (token.startsWith("-")) {
			throw usageError(`Unknown option for ${command}: ${token}`);
		}

		throw usageError(
			`${command} does not accept positional arguments. Received: ${token}`,
		);
	}

	return output;
}

function parsePreviewArgs(
	args: string[],
	command: "preview" | "serve",
): ParsedPreviewArgs {
	const output: ParsedPreviewArgs = {
		open: false,
	};

	for (let index = 0; index < args.length; index += 1) {
		const token = args[index];

		const cwdValue = parseRequiredValue(args, index, token, "--cwd");
		if (cwdValue.matched) {
			output.cwd = cwdValue.value;
			index = cwdValue.nextIndex;
			continue;
		}

		const configValue = parseRequiredValue(args, index, token, "--config");
		if (configValue.matched) {
			output.configFile = configValue.value;
			index = configValue.nextIndex;
			continue;
		}

		const hostValue = parseRequiredValue(args, index, token, "--host");
		if (hostValue.matched) {
			output.host = hostValue.value;
			index = hostValue.nextIndex;
			continue;
		}

		const portValue = parseRequiredValue(args, index, token, "--port");
		if (portValue.matched) {
			output.port = parsePort(portValue.value);
			index = portValue.nextIndex;
			continue;
		}

		const transformModeValue = parseRequiredValue(
			args,
			index,
			token,
			"--transform-mode",
		);
		if (transformModeValue.matched) {
			output.transformMode = parseTransformMode(
				transformModeValue.value,
				PREVIEW_TRANSFORM_MODES,
			);
			index = transformModeValue.nextIndex;
			continue;
		}

		if (token === "--open") {
			output.open = true;
			continue;
		}

		if (token.startsWith("-")) {
			throw usageError(`Unknown option for ${command}: ${token}`);
		}

		throw usageError(
			`${command} does not accept positional arguments. Received: ${token}`,
		);
	}

	return output;
}

function parseSnapshotArgs(args: string[]): ParsedSnapshotArgs {
	const output: ParsedSnapshotArgs = {};

	for (let index = 0; index < args.length; index += 1) {
		const token = args[index];

		const cwdValue = parseRequiredValue(args, index, token, "--cwd");
		if (cwdValue.matched) {
			output.cwd = cwdValue.value;
			index = cwdValue.nextIndex;
			continue;
		}

		const configValue = parseRequiredValue(args, index, token, "--config");
		if (configValue.matched) {
			output.configFile = configValue.value;
			index = configValue.nextIndex;
			continue;
		}

		const outputValue = parseRequiredValue(args, index, token, "--output");
		if (outputValue.matched) {
			output.outputPath = outputValue.value;
			index = outputValue.nextIndex;
			continue;
		}

		const transformModeValue = parseRequiredValue(
			args,
			index,
			token,
			"--transform-mode",
		);
		if (transformModeValue.matched) {
			output.transformMode = parseTransformMode(
				transformModeValue.value,
				PREVIEW_TRANSFORM_MODES,
			);
			index = transformModeValue.nextIndex;
			continue;
		}

		if (token.startsWith("-")) {
			throw usageError(`Unknown option for snapshot: ${token}`);
		}

		throw usageError(
			`snapshot does not accept positional arguments. Received: ${token}`,
		);
	}

	return output;
}

function parseBuildArgs(args: string[]): ParsedBuildArgs {
	const output: Partial<ParsedBuildArgs> & {
		artifactKinds: CliPreviewBuildArtifactKind[];
	} = {
		artifactKinds: [],
	};

	for (let index = 0; index < args.length; index += 1) {
		const token = args[index];

		const cwdValue = parseRequiredValue(args, index, token, "--cwd");
		if (cwdValue.matched) {
			output.cwd = cwdValue.value;
			index = cwdValue.nextIndex;
			continue;
		}

		const configValue = parseRequiredValue(args, index, token, "--config");
		if (configValue.matched) {
			output.configFile = configValue.value;
			index = configValue.nextIndex;
			continue;
		}

		const outDirValue = parseRequiredValue(args, index, token, "--out-dir");
		if (outDirValue.matched) {
			output.outDir = outDirValue.value;
			index = outDirValue.nextIndex;
			continue;
		}

		const artifactKindValue = parseRequiredValue(
			args,
			index,
			token,
			"--artifact-kind",
		);
		if (artifactKindValue.matched) {
			output.artifactKinds.push(parseArtifactKind(artifactKindValue.value));
			index = artifactKindValue.nextIndex;
			continue;
		}

		const transformModeValue = parseRequiredValue(
			args,
			index,
			token,
			"--transform-mode",
		);
		if (transformModeValue.matched) {
			output.transformMode = parseTransformMode(
				transformModeValue.value,
				BUILD_TRANSFORM_MODES,
			);
			index = transformModeValue.nextIndex;
			continue;
		}

		if (token.startsWith("-")) {
			throw usageError(`Unknown option for build: ${token}`);
		}

		throw usageError(
			`build does not accept positional arguments. Received: ${token}`,
		);
	}

	if (!output.outDir) {
		throw usageError("build requires --out-dir.");
	}

	const artifactKinds: CliPreviewBuildArtifactKind[] =
		output.artifactKinds.length > 0 ? output.artifactKinds : ["module"];
	if (new Set(artifactKinds).size !== artifactKinds.length) {
		throw usageError("Duplicate --artifact-kind values are not allowed.");
	}

	if (
		output.transformMode === "design-time" &&
		artifactKinds.includes("module")
	) {
		throw usageError(
			"Design-time builds do not support module artifacts. Specify --artifact-kind entry-metadata and/or --artifact-kind layout-schema.",
		);
	}

	return {
		artifactKinds,
		...(output.configFile ? { configFile: output.configFile } : {}),
		...(output.cwd ? { cwd: output.cwd } : {}),
		outDir: output.outDir,
		...(output.transformMode ? { transformMode: output.transformMode } : {}),
	};
}

function createLegacyCommandError(command: string) {
	return usageError(
		`"${command}" is not supported. Use ${CLI_BINARY_NAME} preview, ${CLI_BINARY_NAME} build, ${CLI_BINARY_NAME} snapshot, or ${CLI_BINARY_NAME} config.`,
	);
}

export async function runCli(
	argv: string[],
	runtimeOverrides: Partial<CliCommandRuntime> = {},
): Promise<void> {
	const runtime: CliCommandRuntime = {
		readCliVersionFn: runtimeOverrides.readCliVersionFn ?? getCliVersion,
		loadPreviewModuleFn: runtimeOverrides.loadPreviewModuleFn,
		stdout: runtimeOverrides.stdout ?? process.stdout,
		writeFileFn: runtimeOverrides.writeFileFn,
	};
	const parsed = parseTopLevel(argv);

	if (parsed.showHelp) {
		printHelp(runtime);
		return;
	}

	if (parsed.showVersion) {
		runtime.stdout.write(`${runtime.readCliVersionFn()}\n`);
		return;
	}

	if (!parsed.command) {
		printHelp(runtime);
		return;
	}

	if (hasHelpFlag(parsed.commandArgs)) {
		printHelp(runtime);
		return;
	}

	if (
		parsed.command === "create" ||
		parsed.command === "add" ||
		parsed.command === "remove" ||
		parsed.command === "upgrade" ||
		parsed.command === "doctor" ||
		parsed.command === "init"
	) {
		throw createLegacyCommandError(parsed.command);
	}

	if (parsed.command === "preview" || parsed.command === "serve") {
		await runPreviewCommand(
			parsePreviewArgs(parsed.commandArgs, parsed.command),
			runtime,
		);
		return;
	}

	if (parsed.command === "snapshot") {
		await runSnapshotCommand(parseSnapshotArgs(parsed.commandArgs), runtime);
		return;
	}

	if (parsed.command === "build") {
		await runBuildCommand(parseBuildArgs(parsed.commandArgs), runtime);
		return;
	}

	if (parsed.command === "config") {
		await runConfigCommand(
			parseSharedArgs(parsed.commandArgs, "config"),
			runtime,
		);
		return;
	}

	throw usageError(
		`Unknown command: ${parsed.command}. Supported commands: ${CLI_BINARY_NAME} preview, ${CLI_BINARY_NAME} serve, ${CLI_BINARY_NAME} build, ${CLI_BINARY_NAME} snapshot, ${CLI_BINARY_NAME} config.`,
	);
}
