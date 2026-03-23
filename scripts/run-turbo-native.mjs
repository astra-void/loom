import { spawnSync } from "node:child_process";
import { getNativeTarget } from "./native-target.mjs";

const result = spawnSync("pnpm", ["exec", "turbo", ...process.argv.slice(2)], {
	env: {
		...process.env,
		LOOM_NATIVE_TARGET: getNativeTarget(),
	},
	stdio: "inherit",
});

if (result.error) {
	throw result.error;
}

process.exit(result.status ?? 1);
