import { getPassthroughArgs, runNapi } from "./napi-cli.mjs";

const result = runNapi(
	["build", "--platform", "--release", ...getPassthroughArgs()],
	{ check: false },
);

process.exit(result.status ?? 1);
