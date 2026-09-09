import { describe, expect, it } from "vitest";
import { completionPayload, initialCompletion, type RunDetails } from "@/features/verticals/manufacturing/production-run";

function fixture(): RunDetails {
  return {
    run: { id: "run", bomId: "recipe", locationId: "location", runNumber: "RUN-1", status: "planned", qcStatus: "pending", plannedOutputBaseQty: 20,
      bom: { id: "recipe", name: "Recipe", status: "active", finishedProductId: "finished", outputQuantityBaseQty: 10,
        items: [{ materialProductId: "raw", quantityBaseQty: 12, wastagePercent: 10 }, { materialProductId: "label", quantityBaseQty: 5, wastagePercent: 0 }] } },
    products: [
      { id: "finished", packagingMode: "per_pack", sellingUnits: [{ id: "bag", isActive: true, conversionToBase: 2 }] },
      { id: "raw", batchTrackingEnabled: true, sellingUnits: [] },
      { id: "label", sellingUnits: [] },
    ] as RunDetails["products"],
    lots: [{ id: "lot", productId: "raw", batchNumber: "RAW-1", expiresOn: "2028-01-01", availableBaseQty: 30 }],
  };
}
function ready(details: RunDetails) {
  const draft = initialCompletion(details);
  draft.batch = " FINISHED-1 "; draft.manufacturedOn = "2026-09-09"; draft.expiresOn = "2027-09-09";
  draft.materials.raw.inventoryLotId = "lot";
  return draft;
}
describe("production entry", () => {
  it("scales every ingredient including wastage and starts with a QC hold", () => {
    const draft = initialCompletion(fixture());
    expect(draft.actual).toMatchObject({ amount: "10", sellingUnitId: "bag" });
    expect(draft.materials.raw.amount).toBe("26.4");
    expect(draft.materials.label.amount).toBe("10");
    expect(draft.materials.raw.inventoryLotId).toBe("");
    expect(draft.qcStatus).toBe("conditional");
  });
  it("submits actual quantities and reconciled packaging instead of silently replacing them with the plan", () => {
    const details = fixture(); const draft = ready(details);
    draft.actual.amount = "9"; draft.materials.raw.amount = "25";
    const payload = completionPayload(details, draft);
    expect(payload.actualOutputBaseQty).toBe(18);
    expect(payload.outputs).toEqual([{ quantityBaseQty: 18, sellingUnitId: "bag", packageCount: 9 }]);
    expect(payload.consumptions[0]).toMatchObject({ actualBaseQty: 25, inventoryLotId: "lot" });
    expect(payload.finishedBatchNumber).toBe("FINISHED-1");
  });
  it("requires every recipe material and a usable batch belonging to that material", () => {
    const details = fixture(); const draft = ready(details);
    delete draft.materials.label;
    expect(() => completionPayload(details, draft)).toThrow("quantity");
    draft.materials.label = { amount: "10", sellingUnitId: "" };
    draft.materials.raw.inventoryLotId = "";
    expect(() => completionPayload(details, draft)).toThrow("sourceBatch");
    draft.materials.raw.inventoryLotId = "lot"; details.lots[0].productId = "label";
    expect(() => completionPayload(details, draft)).toThrow("sourceBatch");
  });
  it("blocks quantities above the selected batch's available stock", () => {
    const details = fixture(); const draft = ready(details); draft.materials.raw.amount = "31";
    expect(() => completionPayload(details, draft)).toThrow("stock");
  });
  it.each(["2026-99-01", "2026-02-30", "", "2026-09-09"])("reports an actionable date error for %s", (expiry) => {
    const details = fixture(); const draft = ready(details); draft.expiresOn = expiry;
    expect(() => completionPayload(details, draft)).toThrow(/^dates$/);
  });
  it("rejects missing, inactive or unknown packaging", () => {
    const details = fixture(); const draft = ready(details);
    for (const id of ["", "unknown"]) { draft.actual.sellingUnitId = id; expect(() => completionPayload(details, draft)).toThrow("quantity"); }
    draft.actual.sellingUnitId = "bag"; details.products[0].sellingUnits![0].isActive = false;
    expect(() => completionPayload(details, draft)).toThrow("quantity");
  });
});
