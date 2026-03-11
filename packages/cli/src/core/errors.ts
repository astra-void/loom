export enum ExitCode {
	Success = 0,
	Unexpected = 1,
	Usage = 2,
}

export type CliErrorKind = "Usage" | "Unexpected";

export class CliError extends Error {
	readonly kind: CliErrorKind;
	readonly exitCode: ExitCode;
	readonly cause?: unknown;

	constructor(
		message: string,
		kind: CliErrorKind,
		exitCode: ExitCode,
		cause?: unknown,
	) {
		super(message);
		this.name = "CliError";
		this.kind = kind;
		this.exitCode = exitCode;
		this.cause = cause;
	}
}

export function usageError(message: string): CliError {
	return new CliError(message, "Usage", ExitCode.Usage);
}

export function toCliError(error: unknown): CliError {
	if (error instanceof CliError) {
		return error;
	}

	if (error instanceof Error) {
		return new CliError(
			error.message,
			"Unexpected",
			ExitCode.Unexpected,
			error,
		);
	}

	return new CliError(
		"Unexpected unknown error.",
		"Unexpected",
		ExitCode.Unexpected,
		error,
	);
}
