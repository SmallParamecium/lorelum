export interface TimeoutSignal {
  readonly signal: AbortSignal;
  timedOut(): boolean;
  dispose(): void;
}

/**
 * Creates a cancellable deadline signal for a bounded operation.
 *
 * `AbortSignal.timeout()` owns a timer that cannot be cancelled after a successful operation.
 * Short-lived callers must dispose this handle so an already-completed request does not keep
 * their event loop alive until its original timeout expires.
 */
export function createTimeoutSignal(timeoutMs: number, parent?: AbortSignal): TimeoutSignal {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new DOMException("The operation timed out", "TimeoutError"));
  }, timeoutMs);
  const signal = parent ? AbortSignal.any([controller.signal, parent]) : controller.signal;
  let disposed = false;
  return {
    signal,
    timedOut: () => controller.signal.aborted,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      clearTimeout(timer);
    },
  };
}
