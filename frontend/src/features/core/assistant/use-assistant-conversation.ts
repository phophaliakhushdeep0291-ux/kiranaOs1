import { useCallback, useContext, useMemo, useSyncExternalStore, type SetStateAction } from "react";
import { AuthContext } from "@/features/core/auth/auth-context";
import { getActiveLocationId, LOCATION_CHANGED_EVENT } from "@/features/core/stores/location-context";
import { assistantConversationScope, getAssistantConversation, updateAssistantConversation, type AssistantConversation } from "./conversation-memory";

function subscribeLocation(listener: () => void) {
  window.addEventListener(LOCATION_CHANGED_EVENT, listener);
  window.addEventListener("storage", listener);
  return () => { window.removeEventListener(LOCATION_CHANGED_EVENT, listener); window.removeEventListener("storage", listener); };
}

export function useAssistantConversation(context: string | null) {
  // Re-render on a local or cross-tab auth change, even while the panel is open.
  useContext(AuthContext);
  useSyncExternalStore(subscribeLocation, getActiveLocationId, () => null);
  const scope = assistantConversationScope(context ?? "billing");
  // A billing panel has no stable bill ID here. Keep it local to this mount so
  // yesterday's pending cart action cannot be restored onto a different bill.
  const store = useMemo(() => getAssistantConversation(context ? scope : null), [scope, context]);
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const isCurrent = useCallback(() => scope === assistantConversationScope(context ?? "billing"), [scope, context]);
  return { store, value: snapshot.value, isCurrent };
}

export function useConversationField<K extends keyof AssistantConversation>(
  conversation: ReturnType<typeof useAssistantConversation>, key: K,
): [AssistantConversation[K], (value: SetStateAction<AssistantConversation[K]>) => void] {
  const { store, isCurrent } = conversation;
  const set = useCallback((value: SetStateAction<AssistantConversation[K]>) => {
    if (!isCurrent()) return;
    updateAssistantConversation(store, current => ({
      ...current,
      [key]: typeof value === "function" ? (value as (previous: AssistantConversation[K]) => AssistantConversation[K])(current[key]) : value,
    }));
  }, [store, key, isCurrent]);
  return [conversation.value[key], set];
}
