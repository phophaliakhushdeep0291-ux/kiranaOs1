import { useEffect, useState } from "react";
import { getAgentCapabilities, type AgentCapabilities } from "./agent-client";

/** Fetch only when the assistant opens. Never carry one login/trade's examples into another. */
export function useAssistantCapabilities(scope: string | null) {
  const [loaded, setLoaded] = useState<{ scope: string; value: AgentCapabilities } | null>(null);
  useEffect(() => {
    if (!scope) return;
    const request = new AbortController();
    getAgentCapabilities(request.signal).then(value => {
      if (!request.signal.aborted) setLoaded({ scope, value });
    }).catch(() => { /* Generic read examples remain usable when capability lookup is unavailable. */ });
    return () => request.abort();
  }, [scope]);
  return loaded?.scope === scope ? loaded.value : null;
}
