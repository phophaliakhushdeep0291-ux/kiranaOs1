import { useMemo, useSyncExternalStore } from "react";
import { useAuth } from "@/features/core/auth/useAuth";
import { getActiveLocationId, LOCATION_CHANGED_EVENT } from "@/features/core/stores/location-context";
import { authSessionInstance } from "@/lib/storage/auth-storage";
import { counterDraftScope, type createCounterDraft } from "@/lib/counter-draft";

function subscribeLocation(listener: () => void) {
  window.addEventListener(LOCATION_CHANGED_EVENT, listener);
  return () => window.removeEventListener(LOCATION_CHANGED_EVENT, listener);
}

export function useCounterDraft<T>(draft: ReturnType<typeof createCounterDraft<T>>) {
  // Auth context triggers a new scope on sign-in/shop switch; token rotation
  // retains the backend session ID and therefore the same draft.
  useAuth();
  const location = useSyncExternalStore(subscribeLocation, getActiveLocationId, () => null);
  const scope = counterDraftScope(authSessionInstance(), location);
  const store = useMemo(() => draft.forScope(scope), [draft, scope]);
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  return { ...snapshot, update: store.update, discard: store.discard, submit: store.submit, scope };
}
