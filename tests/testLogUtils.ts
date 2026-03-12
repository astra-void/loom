import { vi } from "vitest";

type LogPattern = RegExp | string;
type ConsoleMethod = "error" | "info" | "log" | "warn";

function matchesPattern(text: string, patterns: LogPattern[]) {
	return patterns.some((pattern) =>
		typeof pattern === "string" ? text.includes(pattern) : pattern.test(text),
	);
}

function createCircularSafeReplacer() {
	const seen = new WeakSet<object>();

	return (_key: string, value: unknown) => {
		if (typeof value !== "object" || value === null) {
			return value;
		}

		if (seen.has(value)) {
			return "[Circular]";
		}

		seen.add(value);
		return value;
	};
}

function stringifyLogArg(arg: unknown) {
	if (typeof arg === "string") {
		return arg;
	}

	if (arg instanceof Error) {
		return [arg.name, arg.message, arg.stack].filter(Boolean).join("\n");
	}

	if (typeof arg === "object" && arg !== null) {
		try {
			return JSON.stringify(arg, createCircularSafeReplacer());
		} catch {
			return String(arg);
		}
	}

	return String(arg);
}

function serializeArgs(args: unknown[]) {
	return args.map((arg) => stringifyLogArg(arg)).join("\n");
}

export function suppressExpectedConsoleMessages(
	filters: Partial<Record<ConsoleMethod, LogPattern[]>>,
) {
	const restores: Array<() => void> = [];

	for (const method of ["error", "info", "log", "warn"] as const) {
		const patterns = filters[method];
		if (!patterns || patterns.length === 0) {
			continue;
		}

		const original = console[method].bind(console) as (
			...args: unknown[]
		) => void;
		const spy = vi
			.spyOn(console, method)
			.mockImplementation((...args: unknown[]) => {
				if (matchesPattern(serializeArgs(args), patterns)) {
					return;
				}

				original(...args);
			});

		restores.push(() => {
			spy.mockRestore();
		});
	}

	return () => {
		for (const restore of restores) {
			restore();
		}
	};
}

export function suppressExpectedStderrMessages(patterns: LogPattern[]) {
	const original = process.stderr.write.bind(process.stderr);
	const spy = vi.spyOn(process.stderr, "write").mockImplementation(((
		chunk: string | Uint8Array,
		...rest: unknown[]
	) => {
		const text =
			typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");

		if (matchesPattern(text, patterns)) {
			for (const value of rest) {
				if (typeof value === "function") {
					value();
					break;
				}
			}

			return true;
		}

		return original(chunk as never, ...(rest as []));
	}) as typeof process.stderr.write);

	return () => {
		spy.mockRestore();
	};
}
