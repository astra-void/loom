type AnyHook = (...args: never[]) => unknown;
type HookLike<THook extends AnyHook> = THook | { handler: THook };

export function getHookHandler<THook extends AnyHook>(
	hook: HookLike<THook> | null | undefined,
): THook | undefined {
	if (typeof hook === "function") {
		return hook;
	}

	return hook?.handler;
}

export function getHookResultCode(result: unknown) {
	if (typeof result === "string") {
		return result;
	}

	if (
		typeof result === "object" &&
		result !== null &&
		"code" in result &&
		typeof result.code === "string"
	) {
		return result.code;
	}

	return "";
}

export function getHookResultId(result: unknown) {
	if (typeof result === "string") {
		return result;
	}

	if (
		typeof result === "object" &&
		result !== null &&
		"id" in result &&
		typeof result.id === "string"
	) {
		return result.id;
	}

	return undefined;
}
