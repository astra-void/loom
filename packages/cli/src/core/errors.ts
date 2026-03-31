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

function formatStackHeader(error: Error) {
	return (
		error.stack?.split(/\r?\n/u, 1)[0] ?? `${error.name}: ${error.message}`
	);
}

function formatErrorChain(
	error: unknown,
	prefix?: string,
	seen = new Set<unknown>(),
): string | undefined {
	if (error == null) {
		return undefined;
	}

	if (typeof error !== "object" && typeof error !== "function") {
		return prefix ? `${prefix}: ${String(error)}` : String(error);
	}

	if (seen.has(error)) {
		return prefix ? `${prefix}: [Circular cause]` : "[Circular cause]";
	}

	seen.add(error);

	if (error instanceof Error) {
		const lines = [
			prefix
				? `${prefix}: ${formatStackHeader(error)}`
				: formatStackHeader(error),
		];
		const stackLines = error.stack ? error.stack.split(/\r?\n/u).slice(1) : [];
		if (stackLines.length > 0) {
			lines.push(...stackLines);
		}

		const cause = (error as Error & { cause?: unknown }).cause;
		const causeChain = formatErrorChain(cause, "Caused by", seen);
		if (causeChain) {
			lines.push(causeChain);
		}

		return lines.join("\n");
	}

	return prefix ? `${prefix}: ${String(error)}` : String(error);
}

export function formatCliError(cliError: CliError): string {
	const lines = [`Error: ${cliError.message}`];

	if (cliError.kind === "Unexpected") {
		const causeChain = formatErrorChain(cliError.cause, "Caused by");
		if (causeChain) {
			lines.push(causeChain);
		}
	}

	return `${lines.join("\n")}\n`;
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
