function cancellationError(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException("Task was cancelled.", "AbortError");
}

/**
 * Serializes the real task promises while allowing an individual caller to
 * stop waiting immediately. This is useful for browser APIs that expose no
 * cancellation primitive: the queue remains locked until the real work ends.
 */
export class SerialTaskQueue {
  private tail: Promise<void> = Promise.resolve();

  run<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) return Promise.reject(cancellationError(signal));
    const actual = this.tail.then(task, task);
    this.tail = actual.then(
      () => undefined,
      () => undefined,
    );
    if (!signal) return actual;

    return new Promise<T>((resolve, reject) => {
      const onAbort = () => reject(cancellationError(signal));
      signal.addEventListener("abort", onAbort, { once: true });
      actual.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
    });
  }
}
