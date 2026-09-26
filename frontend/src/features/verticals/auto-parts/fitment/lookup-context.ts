/** Discard a lookup if the counter changes stores before it finishes. */
export function createFitmentLookupContext() {
  let version = 0;
  return {
    invalidate() { version += 1; },
    async run<T>(read: () => Promise<T>): Promise<{ current: true; value: T } | { current: false }> {
      const started = version;
      try {
        const value = await read();
        return started === version ? { current: true, value } : { current: false };
      } catch (error) {
        if (started !== version) return { current: false };
        throw error;
      }
    },
  };
}
