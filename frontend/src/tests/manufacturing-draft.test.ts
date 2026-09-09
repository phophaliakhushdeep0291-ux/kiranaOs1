import { describe, expect, it } from "vitest";
import { productionDraftKey, readProductionDraft, removeProductionDraft, writeProductionDraft, type DraftStorage } from "@/features/verticals/manufacturing/production-draft";
import type { CompletionDraft } from "@/features/verticals/manufacturing/production-run";

const scope = { shopId: "shop", userId: "owner", locationId: "factory", runId: "run", bomId: "bom" };
const draft: CompletionDraft = { outputs: [{ key: "out", amount: "7", sellingUnitId: "bag" }], materials: { raw: [
  { key: "one", amount: "3.2", sellingUnitId: "", inventoryLotId: "lot1" },
  { key: "two", amount: "5", sellingUnitId: "", inventoryLotId: "lot2" },
] }, batch: "Finished-1", manufacturedOn: "2026-09-09", expiresOn: "2027-09-09", qcStatus: "conditional", notes: "Review moisture" };
function storage(): DraftStorage {
  const values = new Map<string, string>();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); }, removeItem: key => { values.delete(key); } };
}
describe("recoverable production entry", () => {
  it("restores split sources, actual output, dates and QC notes after remount, and clears only the completed run", () => {
    const device = storage(); const key = productionDraftKey(scope); const other = productionDraftKey({ ...scope, runId: "another-run" });
    expect(writeProductionDraft(device, key, draft)).toBe(true);
    writeProductionDraft(device, other, { ...draft, batch: "Other batch" });
    expect(readProductionDraft(device, key)).toEqual({ problem: false, draft });
    removeProductionDraft(device, key);
    expect(readProductionDraft(device, key).draft).toBeNull();
    expect(readProductionDraft(device, other).draft?.batch).toBe("Other batch");
  });
  it.each(["shopId", "userId", "locationId", "runId", "bomId"] as const)("does not share drafts when %s changes", (field) => {
    const device = storage(); writeProductionDraft(device, productionDraftKey(scope), draft);
    expect(readProductionDraft(device, productionDraftKey({ ...scope, [field]: "different" })).draft).toBeNull();
  });
  it.each(["broken json", JSON.stringify({ version: 100, draft }), JSON.stringify({ version: 1, draft: { ...draft, outputs: [] } }), JSON.stringify({ version: 1, draft: { ...draft, qcStatus: "anything" } })])("reports an unreadable or incompatible draft without throwing", (raw) => {
    const device = storage(); device.setItem("key", raw);
    expect(readProductionDraft(device, "key")).toEqual({ draft: null, problem: true });
  });
  it("reports blocked storage and quota errors instead of claiming the draft was saved", () => {
    const fail = () => { throw new Error("Storage blocked"); };
    const device: DraftStorage = { getItem: fail, setItem: fail, removeItem: fail };
    expect(readProductionDraft(device, "key")).toEqual({ draft: null, problem: true });
    expect(writeProductionDraft(device, "key", draft)).toBe(false);
    expect(() => removeProductionDraft(device, "key")).not.toThrow();
  });
});
