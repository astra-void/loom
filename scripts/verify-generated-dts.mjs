import { spawnSync } from "node:child_process";

const GENERATED_PATHS = [
	"packages/compiler/index.d.ts",
	"packages/compiler/wrapper.d.ts",
	"packages/layout-engine/pkg",
	"packages/preview-runtime/dist",
	"packages/preview-engine/dist",
	"packages/preview/dist",
	"packages/cli/dist",
];

const status = spawnSync(
	"git",
	["status", "--short", "--", ...GENERATED_PATHS],
	{
		cwd: process.cwd(),
		encoding: "utf8",
		stdio: ["inherit", "pipe", "inherit"],
	},
);

if (status.error) {
	throw status.error;
}

const output = status.stdout.trim();
if (output.length > 0) {
	process.stderr.write(
		`Generated declaration artifacts are out of date:\n${output}\n`,
	);
	process.exit(status.status ?? 1);
}
