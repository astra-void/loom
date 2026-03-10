import { normalizePreviewRuntimeError, publishPreviewRuntimeIssue } from "./runtimeError";

const FRAME_SCHEDULER_KEY = Symbol.for("lattice-ui.preview-runtime.frameScheduler");

export interface FrameState {
  readonly now: number;
  readonly deltaTime: number;
  readonly elapsedTime: number;
}

export type FrameSubscriber = (frameState: FrameState) => void;

class FrameScheduler {
  private readonly subscribers = new Set<FrameSubscriber>();
  private elapsedTime = 0;
  private frameHandle: number | undefined = undefined;
  private lastFrameTime: number | undefined = undefined;

  subscribe(subscriber: FrameSubscriber) {
    this.subscribers.add(subscriber);
    this.ensureScheduled();

    return () => {
      if (!this.subscribers.delete(subscriber)) {
        return;
      }

      if (this.subscribers.size === 0) {
        this.stop();
      }
    };
  }

  private ensureScheduled() {
    if (this.frameHandle !== undefined) {
      return;
    }

    this.lastFrameTime = performance.now();
    this.frameHandle = this.requestNextFrame();
  }

  private requestNextFrame() {
    const requestAnimationFrame = globalThis.requestAnimationFrame?.bind(globalThis);
    if (!requestAnimationFrame) {
      throw new Error("@lattice-ui/preview-runtime requires requestAnimationFrame.");
    }

    return requestAnimationFrame(this.step);
  }

  private stop() {
    if (this.frameHandle !== undefined && typeof globalThis.cancelAnimationFrame === "function") {
      globalThis.cancelAnimationFrame(this.frameHandle);
    }

    this.frameHandle = undefined;
    this.lastFrameTime = undefined;
    this.elapsedTime = 0;
  }

  private readonly step = (now: number) => {
    this.frameHandle = undefined;

    const previousFrameTime = this.lastFrameTime ?? now;
    const deltaTime = Math.max(0, (now - previousFrameTime) / 1000);
    this.lastFrameTime = now;
    this.elapsedTime += deltaTime;

    const subscribers = [...this.subscribers];
    for (const subscriber of subscribers) {
      try {
        subscriber({
          now,
          deltaTime,
          elapsedTime: this.elapsedTime,
        });
      } catch (error) {
        publishPreviewRuntimeIssue(
          normalizePreviewRuntimeError(
            {
              code: "FRAME_CALLBACK_ERROR",
              details: "frame",
              kind: "TransformExecutionError",
              phase: "runtime",
              summary: `Frame callback failed: ${error instanceof Error ? error.message : String(error)}`,
            },
            error,
          ),
        );
      }
    }

    if (this.subscribers.size === 0) {
      this.stop();
      return;
    }

    this.frameHandle = this.requestNextFrame();
  };
}

type GlobalFrameScheduler = typeof globalThis & {
  [FRAME_SCHEDULER_KEY]?: FrameScheduler;
};

function getFrameScheduler() {
  const globalScheduler = globalThis as GlobalFrameScheduler;

  if (!globalScheduler[FRAME_SCHEDULER_KEY]) {
    globalScheduler[FRAME_SCHEDULER_KEY] = new FrameScheduler();
  }

  return globalScheduler[FRAME_SCHEDULER_KEY];
}

export function subscribeToFrames(subscriber: FrameSubscriber) {
  return getFrameScheduler().subscribe(subscriber);
}
