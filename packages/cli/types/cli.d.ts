import type { CliCommandRuntime } from "./preview";
export declare function runCli(
	argv: string[],
	runtimeOverrides?: Partial<CliCommandRuntime>,
): Promise<void>;
