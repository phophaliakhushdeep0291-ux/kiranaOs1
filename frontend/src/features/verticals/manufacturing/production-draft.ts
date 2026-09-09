import { z } from "zod";
import type { CompletionDraft } from "./production-run";

const quantity = z.object({ key: z.string().min(1).max(64), amount: z.string().max(32), sellingUnitId: z.string().max(64), inventoryLotId: z.string().max(64).optional() });
const storedDraft = z.object({
  version: z.literal(1),
  draft: z.object({
    outputs: z.array(quantity).min(1).max(50), materials: z.record(z.array(quantity).min(1).max(50)),
    batch: z.string().max(80), manufacturedOn: z.string().max(10), expiresOn: z.string().max(10),
    qcStatus: z.enum(["passed", "conditional"]), notes: z.string().max(1000),
  }),
});
export type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type ProductionDraftScope = { shopId: string; userId: string; locationId: string; runId: string; bomId: string };
export function productionDraftKey(scope: ProductionDraftScope) {
  return `artha:production-draft:${JSON.stringify([scope.shopId, scope.userId, scope.locationId, scope.runId, scope.bomId])}`;
}
export function readProductionDraft(storage: DraftStorage, key: string): { draft: CompletionDraft | null; problem: boolean } {
  try {
    const raw = storage.getItem(key);
    if (!raw) return { draft: null, problem: false };
    if (raw.length > 500_000) return { draft: null, problem: true };
    const result = storedDraft.safeParse(JSON.parse(raw));
    if (!result.success || Object.values(result.data.draft.materials).reduce((sum, rows) => sum + rows.length, 0) > 1000) return { draft: null, problem: true };
    return { draft: result.data.draft, problem: false };
  } catch { return { draft: null, problem: true }; }
}
export function writeProductionDraft(storage: DraftStorage, key: string, draft: CompletionDraft) {
  try { storage.setItem(key, JSON.stringify({ version: 1, draft })); return true; }
  catch { return false; }
}
export function removeProductionDraft(storage: DraftStorage, key: string) {
  try { storage.removeItem(key); } catch { /* The server's closed-run guard still prevents duplicate stock. */ }
}
