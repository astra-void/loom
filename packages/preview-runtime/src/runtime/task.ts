import { subscribeToFrames } from "./frameScheduler";
import { normalizePreviewRuntimeError, publishPreviewRuntimeIssue } from "./runtimeError";

export type TaskCallback<TArgs extends readonly unknown[] = readonly unknown[]> = (...args: TArgs) => void;
export type TaskHandle = ReturnType<typeof globalThis.setTimeout>;

function normalizeDelay(seconds?: number) {
  if (seconds === undefined || !Number.isFinite(seconds)) {
    return 0;
  }

  return Math.max(0, seconds);
}

export function wait(seconds?: number) {
  const targetSeconds = normalizeDelay(seconds);
  const startedAt = performance.now();

  return new Promise<number>((resolve) => {
    const unsubscribe = subscribeToFrames(({ now }) => {
      const elapsed = Math.max(0, (now - startedAt) / 1000);
      if (elapsed + Number.EPSILON < targetSeconds) {
        return;
      }

      unsubscribe();
      resolve(elapsed);
    });
  });
}

export function delay<TArgs extends readonly unknown[]>(
  seconds: number,
  callback: TaskCallback<TArgs>,
  ...args: TArgs
) {
  const timeoutId = globalThis.setTimeout(
    () => {
      try {
        callback(...args);
      } catch (error) {
        publishPreviewRuntimeIssue(
          normalizePreviewRuntimeError(
            {
              code: "TASK_DELAY_ERROR",
              details: "task.delay",
              kind: "TransformExecutionError",
              phase: "runtime",
              summary: `task.delay failed: ${error instanceof Error ? error.message : String(error)}`,
            },
            error,
          ),
        );
      }
    },
    normalizeDelay(seconds) * 1000,
  );

  return timeoutId;
}

export function spawn<TArgs extends readonly unknown[], TResult>(
  callback: (...args: TArgs) => TResult,
  ...args: TArgs
) {
  try {
    return callback(...args);
  } catch (error) {
    publishPreviewRuntimeIssue(
      normalizePreviewRuntimeError(
        {
          code: "TASK_SPAWN_ERROR",
          details: "task.spawn",
          kind: "TransformExecutionError",
          phase: "runtime",
          summary: `task.spawn failed: ${error instanceof Error ? error.message : String(error)}`,
        },
        error,
      ),
    );
    return undefined;
  }
}

export function defer<TArgs extends readonly unknown[]>(callback: TaskCallback<TArgs>, ...args: TArgs) {
  queueMicrotask(() => {
    try {
      callback(...args);
    } catch (error) {
      publishPreviewRuntimeIssue(
        normalizePreviewRuntimeError(
          {
            code: "TASK_DEFER_ERROR",
            details: "task.defer",
            kind: "TransformExecutionError",
            phase: "runtime",
            summary: `task.defer failed: ${error instanceof Error ? error.message : String(error)}`,
          },
          error,
        ),
      );
    }
  });
}

export function cancel(handle: unknown) {
  if (handle == null) {
    return;
  }

  if (typeof handle === "object" && handle !== null && "cancel" in handle) {
    const cancel = (handle as { cancel?: () => void }).cancel;
    if (typeof cancel === "function") {
      cancel();
      return;
    }
  }

  globalThis.clearTimeout(handle as TaskHandle);
}

export interface TaskLibrary {
  readonly cancel: typeof cancel;
  readonly wait: typeof wait;
  readonly delay: typeof delay;
  readonly spawn: typeof spawn;
  readonly defer: typeof defer;
}

export const task: TaskLibrary = {
  cancel,
  wait,
  delay,
  spawn,
  defer,
};

export default task;
