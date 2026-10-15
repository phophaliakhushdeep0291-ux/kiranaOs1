/** Capacitor's native HTTP transport does not reject POSTs on AbortSignal.
 * Preserve the app's timeout/cancel contract, including ignoring late responses.
 * Aborting cannot undo a server write; sync's existing idempotency still applies.
 */
export function abortableFetch(transport: typeof fetch): typeof fetch {
  return (input, init) => {
    const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    if (!signal) return transport(input, init);
    if (signal.aborted) return Promise.reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
    return new Promise((resolve, reject) => {
      const abort = () => reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
      signal.addEventListener("abort", abort, { once: true });
      Promise.resolve().then(() => {
        if (signal.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
        return transport(input, init);
      }).then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
    });
  };
}
