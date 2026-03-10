type HookLike<THook> = THook | { handler: THook };

export function getHookHandler<THook extends (...args: any[]) => any>(
  hook: HookLike<THook> | null | undefined,
): THook | undefined {
  if (typeof hook === "function") {
    return hook;
  }

  return hook?.handler;
}
