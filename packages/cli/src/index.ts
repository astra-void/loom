#!/usr/bin/env node

import { runCli } from "./cli";
import { ExitCode, toCliError } from "./core/errors";

async function main() {
  try {
    await runCli(process.argv.slice(2));
  } catch (error) {
    const cliError = toCliError(error);
    process.stderr.write(`Error: ${cliError.message}\n`);

    if (cliError.kind === "Unexpected" && cliError.cause instanceof Error) {
      process.stderr.write(`${cliError.cause.stack ?? cliError.cause.message}\n`);
    }

    process.exitCode = cliError.exitCode;
    return;
  }

  process.exitCode = ExitCode.Success;
}

void main();
