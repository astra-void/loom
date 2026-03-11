type HookLike<THook> = THook | { handler: THook };

export function getHookHandler<THook extends (...args: unknown[]) => unknown>(
	hook: HookLike<THook> | null | undefined,
): THook | undefined {
	if (typeof hook === "function") {
		return hook;
	}

	return hook?.handler;
}
