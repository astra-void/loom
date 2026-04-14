export declare enum ExitCode {
	Success = 0,
	Unexpected = 1,
	Usage = 2,
}
export type CliErrorKind = "Usage" | "Unexpected";
export declare class CliError extends Error {
	readonly kind: CliErrorKind;
	readonly exitCode: ExitCode;
	readonly cause?: unknown;
	constructor(
		message: string,
		kind: CliErrorKind,
		exitCode: ExitCode,
		cause?: unknown,
	);
}
export declare function usageError(message: string): CliError;
export declare function formatCliError(cliError: CliError): string;
export declare function toCliError(error: unknown): CliError;
