import { useEffect, useState } from "react";
import { initialCompletion, type RunDetails } from "./production-run";
import { productionDraftKey, readProductionDraft, removeProductionDraft, writeProductionDraft, type DraftStorage, type ProductionDraftScope } from "./production-draft";

// Defer access to localStorage until inside the guarded storage operations.
const storage: DraftStorage = {
  getItem: (key) => localStorage.getItem(key),
  setItem: (key, value) => localStorage.setItem(key, value),
  removeItem: (key) => localStorage.removeItem(key),
};
export function useProductionDraft(details: RunDetails, scope: ProductionDraftScope | null) {
  const key = scope ? productionDraftKey(scope) : null;
  const [restored] = useState(() => {
    const result = key ? readProductionDraft(storage, key) : { draft: null, problem: true };
    const materialIds = details.run.bom.items.map((item) => item.materialProductId);
    if (result.draft && (Object.keys(result.draft.materials).length !== materialIds.length || materialIds.some((id) => !result.draft?.materials[id]))) return { draft: null, problem: true };
    return result;
  });
  const [draft, setDraft] = useState(() => restored.draft ?? initialCompletion(details));
  const [saved, setSaved] = useState(false);
  useEffect(() => { setSaved(!!key && writeProductionDraft(storage, key, draft)); }, [draft, key]);
  return { draft, setDraft, saved, restored: !!restored.draft, restoreProblem: restored.problem, clear: () => { if (key) removeProductionDraft(storage, key); } };
}
