#!/usr/bin/env node

import { ExitCode, formatCliError, toCliError } from "./core/errors";

const setSourceMapsEnabled = (
	process as typeof process & {
		setSourceMapsEnabled?: (enabled: boolean) => void;
	}
).setSourceMapsEnabled;

async function main() {
	setSourceMapsEnabled?.(true);

	try {
		const { runCli } = await import("./cli.js");
		await runCli(process.argv.slice(2));
	} catch (error) {
		const cliError = toCliError(error);
		process.stderr.write(formatCliError(cliError));

		process.exitCode = cliError.exitCode;
		return;
	}

	process.exitCode = ExitCode.Success;
}

void main();
