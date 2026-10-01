const PREFIX = "artha:counter-draft:v1:";
const MAX_AGE = 7 * 24 * 60 * 60 * 1000;
const MAX_BYTES = 500_000;

interface Persistence<T> {
  key: string;
  parse: (value: unknown) => T;
}

/** Session/location-scoped form recovery. Persistence is explicit and validated.
 * An interrupted submission is never retried automatically: its server result
 * may have committed before the browser closed.
 */
export function createCounterDraft<T>(initial: () => T, persistence?: Persistence<T>) {
  const scopes = new Map<string, ReturnType<typeof createStore>>();

  function createStore(scope?: string) {
    const key = scope && persistence ? PREFIX + JSON.stringify([persistence.key, scope]) : null;
    let snapshot = { value: initial(), pending: false, recoveryRequired: false, storageFailed: false };
    if (key) {
      try {
        const raw = window.localStorage.getItem(key);
        if (raw) {
          if (raw.length > MAX_BYTES) throw new Error("Oversized draft");
          const record = JSON.parse(raw);
          if (record.version !== 1 || !Number.isFinite(record.savedAt) || Date.now() - record.savedAt > MAX_AGE
            || record.savedAt > Date.now() + 60_000 || typeof record.submitting !== "boolean") throw new Error("Invalid draft");
          snapshot.value = persistence!.parse(record.value);
          snapshot.recoveryRequired = record.submitting;
        }
      } catch {
        try { window.localStorage.removeItem(key); } catch { /* Unavailable storage is reported on the next edit. */ }
      }
    }
    const persist = (remove = false) => {
      if (!key) return;
      try {
        if (remove) window.localStorage.removeItem(key);
        else {
          const raw = JSON.stringify({ version: 1, savedAt: Date.now(), value: snapshot.value, submitting: snapshot.pending || snapshot.recoveryRequired });
          if (raw.length > MAX_BYTES) throw new Error("Oversized draft");
          window.localStorage.setItem(key, raw);
        }
        snapshot = { ...snapshot, storageFailed: false };
      } catch { snapshot = { ...snapshot, storageFailed: true }; }
    };
    let disposed = false;
    const listeners = new Set<() => void>();
    const emit = () => listeners.forEach((listener) => listener());
    const reset = () => { snapshot = { value: initial(), pending: false, recoveryRequired: false, storageFailed: false }; persist(true); emit(); };
    return {
      getSnapshot: () => snapshot,
      subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
      update(patch: Partial<T> | ((current: T) => T)) {
        if (disposed || snapshot.pending || snapshot.recoveryRequired) return;
        snapshot = { ...snapshot, value: typeof patch === "function" ? patch(snapshot.value) : { ...snapshot.value, ...patch }, pending: false };
        persist();
        emit();
      },
      discard() { if (!disposed && !snapshot.pending) reset(); },
      async submit<R>(save: () => Promise<R>): Promise<R> {
        if (disposed || snapshot.pending || snapshot.recoveryRequired) throw new Error("Draft submission is already running or its session has ended");
        snapshot = { ...snapshot, pending: true };
        persist();
        emit();
        try {
          const result = await save();
          if (!disposed) reset();
          return result;
        } catch (error) {
          if (!disposed) { snapshot = { ...snapshot, pending: false }; persist(); emit(); }
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
      if (!store) { store = createStore(scope); scopes.set(scope, store); }
      return store;
    },
    clear,
  };
}

const draftCleanups = new Set<() => void>();

export function clearCounterDrafts() {
  draftCleanups.forEach((clear) => clear());
  // Lazy-loaded forms may not have registered a cleanup in this browser run.
  try {
    const storage = window.localStorage;
    for (let index = storage.length - 1; index >= 0; index--) {
      const key = storage.key(index);
      if (key?.startsWith(PREFIX)) storage.removeItem(key);
    }
  } catch { /* Signing out must still succeed when storage is unavailable. */ }
}

export function counterDraftScope(session: string | null, locationId: string | null): string | null {
  return session ? JSON.stringify([session, locationId]) : null;
}
