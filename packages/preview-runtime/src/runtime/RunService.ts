import { subscribeToFrames } from "./frameScheduler";
import { normalizePreviewRuntimeError, publishPreviewRuntimeIssue } from "./runtimeError";

const RUN_SERVICE_KEY = Symbol.for("lattice-ui.preview-runtime.RunService");

export interface RBXScriptConnection {
  readonly Connected: boolean;
  Disconnect(): void;
}

export interface RBXScriptSignal<TArgs extends readonly unknown[] = readonly unknown[]> {
  Connect(listener: (...args: TArgs) => void): RBXScriptConnection;
}

class SignalConnection<TArgs extends readonly unknown[]> implements RBXScriptConnection {
  public Connected = true;

  public constructor(
    private readonly signal: Signal<TArgs>,
    private readonly listener: (...args: TArgs) => void,
  ) {}

  public Disconnect() {
    if (!this.Connected) {
      return;
    }

    this.Connected = false;
    this.signal.disconnect(this);
  }

  public invoke(...args: TArgs) {
    if (!this.Connected) {
      return;
    }

    this.listener(...args);
  }
}

class Signal<TArgs extends readonly unknown[]> implements RBXScriptSignal<TArgs> {
  private readonly connections = new Set<SignalConnection<TArgs>>();

  public constructor(private readonly onListenerCountChanged: () => void) {}

  public Connect(listener: (...args: TArgs) => void) {
    const connection = new SignalConnection(this, listener);
    this.connections.add(connection);
    this.onListenerCountChanged();
    return connection;
  }

  public fire(...args: TArgs) {
    const connections = [...this.connections];
    for (const connection of connections) {
      try {
        connection.invoke(...args);
      } catch (error) {
        publishPreviewRuntimeIssue(
          normalizePreviewRuntimeError(
            {
              code: "RUNSERVICE_CALLBACK_ERROR",
              details: "RunService",
              kind: "TransformExecutionError",
              phase: "runtime",
              summary: `RunService callback failed: ${error instanceof Error ? error.message : String(error)}`,
            },
            error,
          ),
        );
      }
    }
  }

  public get size() {
    return this.connections.size;
  }

  public disconnect(connection: SignalConnection<TArgs>) {
    if (!this.connections.delete(connection)) {
      return;
    }

    this.onListenerCountChanged();
  }
}

export interface PreviewRunService {
  readonly RenderStepped: RBXScriptSignal<[deltaTime: number]>;
  readonly Heartbeat: RBXScriptSignal<[deltaTime: number]>;
  readonly Stepped: RBXScriptSignal<[time: number, deltaTime: number]>;
  IsClient(): true;
  IsServer(): false;
}

class PreviewRunServiceImpl implements PreviewRunService {
  private frameUnsubscribe: (() => void) | undefined = undefined;

  private readonly syncFrameLoop = () => {
    const hasListeners =
      this.renderSteppedSignal.size > 0 || this.heartbeatSignal.size > 0 || this.steppedSignal.size > 0;

    if (!hasListeners) {
      if (this.frameUnsubscribe) {
        this.frameUnsubscribe();
        this.frameUnsubscribe = undefined;
      }

      return;
    }

    if (this.frameUnsubscribe) {
      return;
    }

    this.frameUnsubscribe = subscribeToFrames(({ deltaTime, elapsedTime }) => {
      this.renderSteppedSignal.fire(deltaTime);
      this.steppedSignal.fire(elapsedTime, deltaTime);
      this.heartbeatSignal.fire(deltaTime);
    });
  };

  private readonly renderSteppedSignal = new Signal<[deltaTime: number]>(this.syncFrameLoop);
  private readonly heartbeatSignal = new Signal<[deltaTime: number]>(this.syncFrameLoop);
  private readonly steppedSignal = new Signal<[time: number, deltaTime: number]>(this.syncFrameLoop);

  public readonly RenderStepped: RBXScriptSignal<[deltaTime: number]> = this.renderSteppedSignal;
  public readonly Heartbeat: RBXScriptSignal<[deltaTime: number]> = this.heartbeatSignal;
  public readonly Stepped: RBXScriptSignal<[time: number, deltaTime: number]> = this.steppedSignal;

  public IsClient() {
    return true as const;
  }

  public IsServer() {
    return false as const;
  }
}

type GlobalRunService = typeof globalThis & {
  [RUN_SERVICE_KEY]?: PreviewRunService;
};

function getRunService() {
  const globalRunService = globalThis as GlobalRunService;

  if (!globalRunService[RUN_SERVICE_KEY]) {
    globalRunService[RUN_SERVICE_KEY] = new PreviewRunServiceImpl();
  }

  return globalRunService[RUN_SERVICE_KEY];
}

export const RunService = getRunService();

export default RunService;
