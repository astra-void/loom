import {
	normalizePreviewRuntimeError,
	publishPreviewRuntimeIssue,
} from "./runtimeError";

const FRAME_SCHEDULER_KEY = Symbol.for(
	"loom-dev.preview-runtime.frameScheduler",
);

// Target ~60fps for the timer-based fallback clock used when
// requestAnimationFrame is unavailable or paused (hidden or headless tabs).
const FALLBACK_FRAME_INTERVAL_MS = 1000 / 60;

// Cap the per-frame delta so a stalled frame — system sleep, a debugger pause,
// a long synchronous task, or any gap that never fires a visibilitychange —
// doesn't push a multi-second delta into every RunService callback and tween,
// which would make animations jump or complete instantly on resume.
const MAX_FRAME_DELTA_MS = 250;

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
	private frameHandleIsTimer = false;
	private lastFrameTime: number | undefined = undefined;
	private visibilityListenerAttached = false;

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

	private now() {
		return typeof performance !== "undefined" &&
			typeof performance.now === "function"
			? performance.now()
			: Date.now();
	}

	private isDocumentHidden() {
		return (
			typeof document !== "undefined" && document.visibilityState === "hidden"
		);
	}

	private ensureScheduled() {
		this.attachVisibilityListener();

		if (this.frameHandle !== undefined) {
			return;
		}

		this.lastFrameTime = this.now();
		this.frameHandle = this.requestNextFrame();
	}

	private requestNextFrame() {
		const requestAnimationFrame =
			globalThis.requestAnimationFrame?.bind(globalThis);

		// Prefer requestAnimationFrame while the document is visible. Browsers
		// pause rAF entirely for hidden tabs (and headless/automated previews run
		// hidden), which would freeze every RunService-driven animation and any
		// screenshot of motion, so fall back to a setTimeout clock in that case.
		if (requestAnimationFrame && !this.isDocumentHidden()) {
			this.frameHandleIsTimer = false;
			return requestAnimationFrame(this.step);
		}

		const setTimeout = globalThis.setTimeout?.bind(globalThis);
		if (!setTimeout) {
			throw new Error(
				"@loom-dev/preview-runtime requires requestAnimationFrame or setTimeout.",
			);
		}

		this.frameHandleIsTimer = true;
		return setTimeout(() => {
			this.step(this.now());
		}, FALLBACK_FRAME_INTERVAL_MS) as unknown as number;
	}

	private cancelFrame() {
		if (this.frameHandle === undefined) {
			return;
		}

		if (this.frameHandleIsTimer) {
			globalThis.clearTimeout?.(this.frameHandle);
		} else if (typeof globalThis.cancelAnimationFrame === "function") {
			globalThis.cancelAnimationFrame(this.frameHandle);
		}

		this.frameHandle = undefined;
	}

	private attachVisibilityListener() {
		if (
			this.visibilityListenerAttached ||
			typeof document === "undefined" ||
			typeof document.addEventListener !== "function"
		) {
			return;
		}

		document.addEventListener("visibilitychange", this.handleVisibilityChange);
		this.visibilityListenerAttached = true;
	}

	private detachVisibilityListener() {
		if (
			!this.visibilityListenerAttached ||
			typeof document === "undefined" ||
			typeof document.removeEventListener !== "function"
		) {
			return;
		}

		document.removeEventListener(
			"visibilitychange",
			this.handleVisibilityChange,
		);
		this.visibilityListenerAttached = false;
	}

	private readonly handleVisibilityChange = () => {
		if (this.subscribers.size === 0) {
			return;
		}

		// Visibility decides which clock should drive frames. A
		// requestAnimationFrame callback scheduled before the tab was hidden never
		// fires, so cancel whatever is pending and reschedule under the clock that
		// matches the current visibility.
		this.cancelFrame();
		this.lastFrameTime = this.now();
		this.frameHandle = this.requestNextFrame();
	};

	private stop() {
		this.cancelFrame();
		this.detachVisibilityListener();
		this.lastFrameTime = undefined;
		this.elapsedTime = 0;
	}

	private readonly step = (now: number) => {
		this.frameHandle = undefined;

		const previousFrameTime = this.lastFrameTime ?? now;
		const deltaTime =
			Math.min(MAX_FRAME_DELTA_MS, Math.max(0, now - previousFrameTime)) / 1000;
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
