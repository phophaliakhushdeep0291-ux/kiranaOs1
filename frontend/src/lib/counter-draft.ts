/** Opt-in, tab-lifetime form state. Never writes customer data or credentials to disk.
 * Pages still unmount when the counter locks; only their draft values survive.
 */
export function createCounterDraft<T>(initial: () => T) {
  const scopes = new Map<string, ReturnType<typeof createStore>>();

  function createStore() {
    let snapshot = { value: initial(), pending: false };
    let disposed = false;
    const listeners = new Set<() => void>();
    const emit = () => listeners.forEach((listener) => listener());
    const reset = () => { snapshot = { value: initial(), pending: false }; emit(); };
    return {
      getSnapshot: () => snapshot,
      subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
      update(patch: Partial<T> | ((current: T) => T)) {
        if (disposed || snapshot.pending) return;
        snapshot = { value: typeof patch === "function" ? patch(snapshot.value) : { ...snapshot.value, ...patch }, pending: false };
        emit();
      },
      discard() { if (!disposed && !snapshot.pending) reset(); },
      async submit<R>(save: () => Promise<R>): Promise<R> {
        if (disposed || snapshot.pending) throw new Error("Draft submission is already running or its session has ended");
        snapshot = { ...snapshot, pending: true };
        emit();
        try {
          const result = await save();
          if (!disposed) reset();
          return result;
        } catch (error) {
          if (!disposed) { snapshot = { ...snapshot, pending: false }; emit(); }
          throw error;
        }
      },
      dispose() { disposed = true; reset(); },
    };
  }

  const clear = () => { scopes.forEach((store) => store.dispose()); scopes.clear(); };
  draftCleanups.add(clear);
  return {
    forScope(scope: string | null) {
      // No authenticated scope must never share cached drafts.
      if (!scope) return createStore();
      let store = scopes.get(scope);
      if (!store) { store = createStore(); scopes.set(scope, store); }
      return store;
    },
    clear,
  };
}

const draftCleanups = new Set<() => void>();

export function clearCounterDrafts() {
  draftCleanups.forEach((clear) => clear());
}

export function counterDraftScope(session: string | null, locationId: string | null): string | null {
  return session ? JSON.stringify([session, locationId]) : null;
}
