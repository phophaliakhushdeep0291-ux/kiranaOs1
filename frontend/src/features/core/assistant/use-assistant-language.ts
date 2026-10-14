import { useContext, useMemo, useSyncExternalStore } from "react";
import { AuthContext } from "@/features/core/auth/auth-context";
import { authSessionInstance, loadAuthSession } from "@/lib/storage/auth-storage";
import { createCounterDraft } from "@/lib/counter-draft";
import { canonicalAssistantLanguage } from "./assistant-language";

const preferences = createCounterDraft(() => "auto");
/** Shared with the floating microphone; isolated and discarded with the login. */
export function useAssistantLanguage() {
  useContext(AuthContext);
  const scope = authSessionInstance(loadAuthSession());
  const store = useMemo(() => preferences.forScope(scope), [scope]);
  const language = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot).value;
  return [language, (value: string) => {
    if (scope === authSessionInstance(loadAuthSession())) store.update(() => canonicalAssistantLanguage(value) ?? "auto");
  }] as const;
}
